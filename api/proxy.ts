// Vercel serverless function: forwards requests to the Google Apps Script Web App
// and adds the secret token server-side so it never reaches the browser.
/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function handler(req: any, res: any) {
  const base = process.env.APPS_SCRIPT_URL
  const token = process.env.APPS_SCRIPT_TOKEN
  const passcode = process.env.APP_PASSCODE

  if (!base || !token) {
    res.status(503).json({ error: 'Backend not configured (APPS_SCRIPT_URL / APPS_SCRIPT_TOKEN missing)' })
    return
  }
  if (passcode && req.headers['x-app-passcode'] !== passcode) {
    res.status(401).json({ error: 'Passcode required' })
    return
  }

  const url = new URL(base)
  for (const [k, v] of Object.entries(req.query || {})) url.searchParams.set(k, String(v))
  url.searchParams.set('token', token)

  try {
    const init: any = { redirect: 'follow' }
    if (req.method === 'POST') {
      init.method = 'POST'
      init.headers = { 'Content-Type': 'text/plain;charset=utf-8' }
      init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})
    }
    const upstream = await fetch(url.toString(), init)
    const text = await upstream.text()
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.status(upstream.ok ? 200 : 502).send(text)
  } catch (e: any) {
    res.status(502).json({ error: 'Could not reach Apps Script: ' + (e?.message || e) })
  }
}
