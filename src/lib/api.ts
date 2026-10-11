import { get, set } from 'idb-keyval'
import { AnalyticsEntry, Dataset, RawSheet, Settings } from './types'

const BASE = '/api/proxy'
const CACHE_KEY = 'dataset-cache-v1'
const PASS_KEY = 'app-passcode'

export const getPasscode = () => { try { return localStorage.getItem(PASS_KEY) || '' } catch { return '' } }
export const setPasscode = (p: string) => { try { localStorage.setItem(PASS_KEY, p) } catch { /* ignore */ } }

async function call<T>(action: string, params: Record<string, string | number> = {}, body?: unknown): Promise<T> {
  const qs = new URLSearchParams({ action, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) })
  const res = await fetch(`${BASE}?${qs}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-passcode': getPasscode() },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) } catch { throw new Error(res.ok ? 'Backend returned a non-JSON response' : `Backend error ${res.status}`) }
  if (!res.ok || json?.error) throw new Error(json?.error || `Backend error ${res.status}`)
  return json as T
}

interface Manifest {
  mode: 'auto' | 'drive'
  source: 'sheet' | 'drive'
  updatedAt: string | null
  sheetError: string | null
  sheets: { name: string; header: string[]; rowCount: number }[]
  analytics: AnalyticsEntry[]
  settings: Partial<Settings>
}

const PAGE = 4000

export async function fetchDataset(onProgress?: (msg: string) => void): Promise<Dataset> {
  onProgress?.('Contacting Google Apps Script…')
  const m = await call<Manifest>('manifest')
  const sheets: RawSheet[] = []
  for (const s of m.sheets) {
    const rows: unknown[][] = []
    for (let off = 0; off < s.rowCount; off += PAGE) {
      onProgress?.(`Loading ${s.name} (${Math.min(off + PAGE, s.rowCount).toLocaleString()} / ${s.rowCount.toLocaleString()})`)
      const r = await call<{ rows: unknown[][] }>('rows', { sheet: s.name, offset: off, limit: PAGE })
      rows.push(...r.rows)
    }
    sheets.push({ name: s.name, header: s.header, rows })
  }
  const ds: Dataset = { source: m.source, mode: m.mode, updatedAt: m.updatedAt, sheetError: m.sheetError, sheets, analytics: m.analytics, settings: m.settings }
  await cacheDataset(ds)
  return ds
}

export async function cacheDataset(ds: Dataset) { try { await set(CACHE_KEY, ds) } catch { /* ignore */ } }
export async function loadCached(): Promise<Dataset | null> { try { return (await get(CACHE_KEY)) ?? null } catch { return null } }

/** Upload an Excel import to Drive in chunks (Vercel limits request bodies to ~4.5MB). Replaces the previous import. */
export async function uploadImport(ds: Dataset, onProgress?: (msg: string) => void) {
  const CHUNK = 3000
  for (const s of ds.sheets) {
    for (let i = 0, idx = 0; i < Math.max(s.rows.length, 1); i += CHUNK, idx++) {
      onProgress?.(`Uploading ${s.name} (${Math.min(i + CHUNK, s.rows.length).toLocaleString()} / ${s.rows.length.toLocaleString()})`)
      await call('importChunk', {}, { sheet: s.name, index: idx, header: idx === 0 ? s.header : undefined, rows: s.rows.slice(i, i + CHUNK) })
    }
  }
  onProgress?.('Finalising…')
  await call('importCommit', {}, { sheets: ds.sheets.map(s => ({ name: s.name, rowCount: s.rows.length })), fileName: ds.fileName })
}

export const setMode = (mode: 'auto' | 'drive') => call('setMode', { mode })
export const saveAnalytics = (entries: AnalyticsEntry[]) => call('saveAnalytics', {}, { entries })
export const saveSettings = (settings: Settings) => call('saveSettings', {}, { settings })
export const ping = () => call<{ ok: boolean }>('ping')
