import { useRef, useState } from 'react'
import { Database, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react'
import { PageTitle } from '../components/Layout'
import { Badge } from '../components/ui'
import { getPasscode, setPasscode } from '../lib/api'
import { detectImportTarget, importTargetLabel } from '../lib/excel'
import { fmt } from '../lib/metrics'
import { useData } from '../lib/store'

const SRC: Record<string, string> = { sheet: 'Google Sheet (live)', drive: 'Google Drive import (backup)', excel: 'Excel import (this browser)', cache: 'Browser cache (offline)' }

export default function DataSources() {
  const { dataset, rows, analytics, loading, progress, backendOk, refresh, importExcel, switchToSheet, addAnalytics } = useData()
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pass, setPass] = useState(getPasscode())
  const today = new Date().toISOString().slice(0, 10)
  const [rec, setRec] = useState({ date: today, currency: 'BDT', gateway: 'SSG', deposit: '', withdrawal: '', note: '' })
  const [recMsg, setRecMsg] = useState('')

  const onFile = async (f?: File) => {
    if (!f) return
    const target = detectImportTarget(f.name)
    const prompt = target
      ? `This filename identifies ${importTargetLabel(target)}. Only that tab's records will be replaced in Google Sheets and its Drive backup. Other tabs and daily analytics will be preserved. Continue?`
      : 'This file was not identified as an individual tab from its filename. All recognized operational tabs in the workbook will replace the existing operational dataset. Daily analytics will be preserved. Continue?'
    if (!confirm(prompt)) { if (fileRef.current) fileRef.current.value = ''; return }
    try { const r = await importExcel(f); setMsg({ ok: r.uploaded, text: r.message }) } catch (e: any) { setMsg({ ok: false, text: e.message }) }
    if (fileRef.current) fileRef.current.value = ''
  }

  const prefill = () => setRec(r => ({ ...r, deposit: String(rows.reduce((s, x) => s + x.deposit, 0)), withdrawal: String(rows.reduce((s, x) => s + x.withdrawal, 0)) }))
  const saveRec = async () => {
    try {
      await addAnalytics([{ date: rec.date, currency: rec.currency, gateway: rec.gateway, deposit: Number(rec.deposit) || 0, withdrawal: Number(rec.withdrawal) || 0, note: rec.note }])
      setRecMsg('Saved to Analytics.')
    } catch (e: any) { setRecMsg('Could not save: ' + e.message) }
  }

  return (
    <>
      <PageTitle title="Data Sources" subtitle="Where the numbers come from, and how to back them up" right={<button className="btn" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Reload</button>} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3 p-5">
          <div className="flex items-center gap-2 font-semibold"><Database size={18} />Current data</div>
          <div className="text-sm">Source: <Badge tone={dataset?.source === 'sheet' ? 'green' : 'amber'}>{dataset ? SRC[dataset.source] : 'None'}</Badge></div>
          <div className="text-sm text-slate-600">Backend (Apps Script): {backendOk ? <Badge tone="green">Connected</Badge> : <Badge tone="red">Not reachable</Badge>}</div>
          {dataset?.updatedAt && <div className="text-sm text-slate-600">Updated: {new Date(dataset.updatedAt).toLocaleString()}{dataset.fileName ? ` · ${dataset.fileName}` : ''}</div>}
          {dataset?.sheetError && <div className="text-sm text-amber-700">Google Sheet issue: {dataset.sheetError}</div>}
          <ul className="text-sm text-slate-600">{dataset?.sheets.map(s => <li key={s.name}>{s.name}: {fmt(s.rows.length)} rows</li>)}</ul>
          {dataset?.mode === 'drive' && backendOk && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">The app is serving the Excel import stored in Drive. <button className="underline" onClick={switchToSheet}>Switch back to the live Google Sheet</button></div>
          )}
        </div>

        <div className="card space-y-3 p-5">
          <div className="flex items-center gap-2 font-semibold"><FileSpreadsheet size={18} />Excel import (backup)</div>
          <p className="text-sm text-slate-600">Upload one sheet at a time or a full workbook. A filename such as <b>monitoring_vip_20261008_121023.xlsx</b> is recognized as <b>BDT-SSG-VIP</b>; only that tab and its Drive backup are replaced. If the filename does not identify a tab, recognized operational tabs in the workbook are imported as a full replacement. Daily analytics history is always preserved.</p>
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
          <button className="btn-primary" disabled={loading} onClick={() => fileRef.current?.click()}><Upload size={14} />Choose Excel file…</button>
          {loading && progress && <div className="text-sm text-slate-500">{progress}</div>}
          {msg && <div className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-amber-700'}`}>{msg.text}</div>}
          <div className="border-t pt-3">
            <label className="text-xs text-slate-500">App passcode (only if you set APP_PASSCODE on Vercel)</label>
            <div className="mt-1 flex gap-2"><input type="password" className="input w-48" value={pass} onChange={e => setPass(e.target.value)} /><button className="btn" onClick={() => { setPasscode(pass); refresh() }}>Save</button></div>
          </div>
        </div>
      </div>

      <div className="card space-y-3 p-5">
        <div className="font-semibold">Daily totals (feeds the time-series chart)</div>
        <p className="text-sm text-slate-600">Record the daily total by date, currency, and merchant/gateway. Saving the same date/currency/gateway again updates that record instead of duplicating it. Operational imports never erase this history.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-500">Date<input type="date" className="input mt-1 block" value={rec.date} onChange={e => setRec({ ...rec, date: e.target.value })} /></label>
          <label className="text-xs text-slate-500">Currency<select className="input mt-1 block" value={rec.currency} onChange={e => setRec({ ...rec, currency: e.target.value })}><option>BDT</option><option>PKR</option><option>INR</option></select></label>
          <label className="text-xs text-slate-500">Gateway<select className="input mt-1 block" value={rec.gateway} onChange={e => setRec({ ...rec, gateway: e.target.value })}><option>SSG</option><option>MCG</option><option>Local Bank</option><option>Bangkok-Pay</option><option>SIMPAISA</option></select></label>
          <label className="text-xs text-slate-500">Total deposit<input type="number" className="input mt-1 block w-40" value={rec.deposit} onChange={e => setRec({ ...rec, deposit: e.target.value })} /></label>
          <label className="text-xs text-slate-500">Total withdrawal<input type="number" className="input mt-1 block w-40" value={rec.withdrawal} onChange={e => setRec({ ...rec, withdrawal: e.target.value })} /></label>
          <label className="text-xs text-slate-500">Note<input className="input mt-1 block w-56" value={rec.note} onChange={e => setRec({ ...rec, note: e.target.value })} /></label>
          <button className="btn" onClick={prefill} disabled={!rows.length}>Prefill from current sheet totals</button>
          <button className="btn-primary" onClick={saveRec} disabled={!rec.date}>Save record</button>
        </div>
        {recMsg && <div className="text-sm text-slate-600">{recMsg}</div>}
        <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm"><thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Currency</th><th className="px-3 py-2">Gateway</th><th className="px-3 py-2 text-right">Deposit</th><th className="px-3 py-2 text-right">Withdrawal</th><th className="px-3 py-2">Note</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{[...analytics].reverse().map(a => <tr key={a.date + a.currency + a.gateway}><td className="px-3 py-1.5">{a.date}</td><td className="px-3 py-1.5">{a.currency}</td><td className="px-3 py-1.5">{a.gateway}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(a.deposit, 2)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(a.withdrawal, 2)}</td><td className="px-3 py-1.5">{a.note}</td></tr>)}
              {!analytics.length && <tr><td colSpan={6} className="p-6 text-center text-slate-400">No records yet.</td></tr>}</tbody></table>
        </div>
      </div>
    </>
  )
}
