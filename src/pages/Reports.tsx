import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { Download, FileSpreadsheet, Printer } from 'lucide-react'
import { PageTitle } from '../components/Layout'
import { Kpi, Section } from '../components/ui'
import { KIND_LABEL, buildOps, gatewayLabel, gatewayPath } from '../lib/alerts'
import { parseBdtLocalBank } from '../lib/bdtLocalBank'
import { parseInr } from '../lib/inr'
import { parseLocalBank } from '../lib/localBank'
import { compact, fmt, kpis } from '../lib/metrics'
import { useData } from '../lib/store'
import { BDT_LOCALBANK_SHEET, INR_SHEET, LOCALBANK_SHEET } from '../lib/types'

interface SnapRow { currency: string; gateway: string; label: string; accounts: number; balance: number | null; deposit: number | null; withdrawal: number | null; low: number; high: number; other: number; to: string }

const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
}
const csv = (head: string[], body: unknown[][]) => {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [head.join(','), ...body.map(r => r.map(esc).join(','))].join('\n')
}
const today = () => new Date().toISOString().slice(0, 10)

export default function ReportsPage() {
  const { rows, dataset, settings, analytics, loading } = useData()
  const [cur, setCur] = useState('')
  const [gw, setGw] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const ops = useMemo(() => buildOps(rows, dataset, settings), [rows, dataset, settings])
  const inr = useMemo(() => parseInr(dataset?.sheets.find(s => s.name === INR_SHEET), settings.inr), [dataset, settings.inr])

  const snapshot = useMemo<SnapRow[]>(() => {
    const out: SnapRow[] = []
    const counts = (currency: string, gateway: string) => {
      const mine = ops.filter(i => i.currency === currency && i.gateway === gateway)
      const low = mine.filter(i => i.kind === 'low').length, high = mine.filter(i => i.kind === 'high').length
      return { low, high, other: mine.length - low - high }
    }
    for (const key of [...new Set(rows.map(r => `${r.currency}-${r.gateway}`))].sort()) {
      const [currency, gateway] = key.split('-')
      const k = kpis(rows.filter(r => r.currency === currency && r.gateway === gateway))
      out.push({ currency, gateway, label: gatewayLabel(gateway), accounts: k.accounts, balance: k.rBal, deposit: k.deposit, withdrawal: k.withdrawal, ...counts(currency, gateway), to: gatewayPath(currency, gateway) })
    }
    const pkr = parseLocalBank(dataset?.sheets.find(s => s.name === LOCALBANK_SHEET), settings).accounts
    if (pkr.length) { const act = pkr.filter(a => a.state === 'ACTIVE'); out.push({ currency: 'PKR', gateway: 'Local Bank', label: 'Local Bank', accounts: pkr.length, balance: act.reduce((s, a) => s + a.closing, 0), deposit: pkr.reduce((s, a) => s + a.todayDp, 0), withdrawal: pkr.reduce((s, a) => s + a.todayWd, 0), ...counts('PKR', 'Local Bank'), to: '/currency/pkr/local-bank' }) }
    const bdt = parseBdtLocalBank(dataset?.sheets.find(s => s.name === BDT_LOCALBANK_SHEET), settings).accounts
    if (bdt.length) out.push({ currency: 'BDT', gateway: 'Local Bank', label: 'Local Bank', accounts: bdt.length, balance: bdt.reduce((s, a) => s + a.balance, 0), deposit: bdt.reduce((s, a) => s + (a.todayDp ?? 0), 0), withdrawal: bdt.reduce((s, a) => s + (a.todayWd ?? 0), 0), ...counts('BDT', 'Local Bank'), to: '/currency/bdt/local-bank' })
    for (const b of inr.brands) if (b.lines.length || b.wdFound) {
      const mine = ops.filter(i => i.currency === 'INR' && i.brand === b.brand && i.gateway === 'Brand total')
      for (const [label, value, key] of [['Total available balance', b.availableTotal as number | null, 'available'], ['Total WD balance', b.wdBalance, 'WD']] as const) {
        const own = mine.filter(i => i.name.endsWith(label))
        out.push({ currency: 'INR', gateway: 'Brand total', label: `${b.brand} · ${label}`, accounts: key === 'available' ? b.lines.length : 0, balance: value, deposit: null, withdrawal: null,
          low: own.filter(i => i.kind === 'low').length, high: own.filter(i => i.kind === 'high').length, other: own.filter(i => i.kind !== 'low' && i.kind !== 'high').length, to: '/currency/inr' })
      }
    }
    return out
  }, [rows, ops, dataset, settings, inr])

  const history = useMemo(() => analytics.filter(a => (!cur || a.currency === cur) && (!gw || a.gateway === gw) && (!from || a.date >= from) && (!to || a.date <= to)).sort((a, b) => b.date.localeCompare(a.date) || a.currency.localeCompare(b.currency)), [analytics, cur, gw, from, to])
  const histTotals = useMemo(() => ({ dp: history.reduce((s, a) => s + a.deposit, 0), wd: history.reduce((s, a) => s + a.withdrawal, 0) }), [history])
  const currencies = useMemo(() => [...new Set(analytics.map(a => a.currency))].sort(), [analytics])
  const gateways = useMemo(() => [...new Set(analytics.filter(a => !cur || a.currency === cur).map(a => a.gateway))].sort(), [analytics, cur])

  const alertRows = ops.map(i => [i.currency, gatewayLabel(i.gateway), i.brand, i.name, i.balance ?? '', KIND_LABEL[i.kind], i.detail])
  const exportSnapshotCsv = () => download(`balance-snapshot-${today()}.csv`, csv(['Currency', 'Gateway', 'Accounts', 'Balance', 'Deposit', 'Withdrawal', 'Low', 'High', 'Other alerts'], snapshot.map(s => [s.currency, s.label, s.accounts, s.balance ?? '', s.deposit ?? '', s.withdrawal ?? '', s.low, s.high, s.other])))
  const exportHistoryCsv = () => download(`daily-totals-${today()}.csv`, csv(['Date', 'Currency', 'Gateway', 'Deposit', 'Withdrawal', 'Note'], history.map(a => [a.date, a.currency, a.gateway, a.deposit, a.withdrawal, a.note ?? ''])))
  const exportWorkbook = () => {
    const wb = XLSX.utils.book_new()
    const add = (name: string, head: string[], body: unknown[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...body]), name)
    add('Snapshot', ['Currency', 'Gateway', 'Accounts', 'Balance', 'Deposit', 'Withdrawal', 'Low', 'High', 'Other alerts'], snapshot.map(s => [s.currency, s.label, s.accounts, s.balance ?? '', s.deposit ?? '', s.withdrawal ?? '', s.low, s.high, s.other]))
    add('Alerts', ['Currency', 'Gateway', 'Brand', 'Account', 'Balance', 'Alert', 'Detail'], alertRows)
    if (inr.lines.length) add('INR merchants', ['Brand', 'Merchant', 'Code', 'Available balance', 'Low limit', 'High limit'], inr.lines.map(l => [l.brand, l.merchant, l.code, l.balance ?? '', l.limits.low || '', l.limits.high || '']))
    if (analytics.length) add('Daily totals', ['Date', 'Currency', 'Gateway', 'Deposit', 'Withdrawal', 'Note'], [...analytics].sort((a, b) => b.date.localeCompare(a.date)).map(a => [a.date, a.currency, a.gateway, a.deposit, a.withdrawal, a.note ?? '']))
    XLSX.writeFile(wb, `payment-ops-report-${today()}.xlsx`)
  }

  const alertCount = ops.length
  if (!rows.length && !dataset?.sheets.length) return <><PageTitle title="Reports" /><div className="card p-10 text-center text-slate-500">{loading ? 'Loading data…' : <>No data loaded yet. Go to <Link className="text-brand-600 underline" to="/admin/data-sources">Admin → Data Sources</Link>.</>}</div></>

  return (
    <>
      <PageTitle title="Reports" subtitle={`Snapshot of every gateway as loaded ${dataset?.updatedAt ? new Date(dataset.updatedAt).toLocaleString() : ''}, plus the daily deposit / withdrawal history`}
        right={<div className="flex gap-2 print:hidden"><button className="btn" onClick={() => window.print()}><Printer size={14} />Print / PDF</button><button className="btn-primary" onClick={exportWorkbook}><FileSpreadsheet size={14} />Download Excel</button></div>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Gateways reported" value={fmt(snapshot.length)} />
        <Kpi label="Accounts" value={fmt(snapshot.reduce((s, r) => s + r.accounts, 0))} sub="agents, bank accounts and INR merchant lines" />
        <Kpi label="Open alerts" value={fmt(alertCount)} tone={alertCount ? 'warn' : 'good'} sub={`${fmt(ops.filter(i => i.kind === 'low').length)} low · ${fmt(ops.filter(i => i.kind === 'high').length)} high`} />
        <Kpi label="Daily records" value={fmt(analytics.length)} sub="deposit / withdrawal history" />
      </div>

      <Section title="Balance snapshot" right={<button className="btn print:hidden" onClick={exportSnapshotCsv}><Download size={14} />CSV</button>}>
        <div className="card overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{['Currency', 'Gateway', 'Accounts', 'Balance', 'Deposit', 'Withdrawal', 'Low', 'High', 'Other alerts'].map((h, i) => <th key={h} className={`whitespace-nowrap px-3 py-2 ${i > 1 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {snapshot.map(s => (
                <tr key={`${s.currency}-${s.label}`} className="hover:bg-slate-50">
                  <td className="px-3 py-1.5">{s.currency}</td>
                  <td className="px-3 py-1.5 font-medium"><Link className="hover:text-brand-600 hover:underline" to={s.to}>{s.label}</Link></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(s.accounts)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.balance === null ? <span className="text-rose-600">sheet error</span> : fmt(s.balance, 2)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.deposit === null ? '—' : fmt(s.deposit, 2)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.withdrawal === null ? '—' : fmt(s.withdrawal, 2)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${s.low ? 'font-semibold text-rose-600' : ''}`}>{fmt(s.low)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${s.high ? 'font-semibold text-amber-600' : ''}`}>{fmt(s.high)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${s.other ? 'font-semibold text-rose-600' : ''}`}>{fmt(s.other)}</td>
                </tr>
              ))}
              {!snapshot.length && <tr><td colSpan={9} className="p-8 text-center text-slate-400">Nothing to report yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400">Balances are shown per gateway and never added across currencies. Agent gateways show running balance; PKR Local Bank shows active accounts' closing balance with today's deposit / withdrawal; INR shows each brand's Total available balance and Total WD balance.</p>
      </Section>

      <Section title="Daily deposit & withdrawal history" right={<button className="btn print:hidden" onClick={exportHistoryCsv} disabled={!history.length}><Download size={14} />CSV</button>}>
        <div className="card print:hidden flex flex-wrap items-end gap-3 p-3">
          <label className="text-xs text-slate-500">Currency<select className="input mt-1 block w-32" value={cur} onChange={e => { setCur(e.target.value); setGw('') }}><option value="">All</option>{currencies.map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="text-xs text-slate-500">Gateway<select className="input mt-1 block w-36" value={gw} onChange={e => setGw(e.target.value)}><option value="">All</option>{gateways.map(g => <option key={g}>{g}</option>)}</select></label>
          <label className="text-xs text-slate-500">From<input type="date" className="input mt-1 block" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="text-xs text-slate-500">To<input type="date" className="input mt-1 block" value={to} onChange={e => setTo(e.target.value)} /></label>
          <button className="btn" onClick={() => { setCur(''); setGw(''); setFrom(''); setTo('') }}>Reset</button>
          <span className="ml-auto text-xs text-slate-400">Totals below are summed per currency only when one currency is selected</span>
        </div>
        <div className="card max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Currency</th><th className="px-3 py-2">Gateway</th><th className="px-3 py-2 text-right">Deposit</th><th className="px-3 py-2 text-right">Withdrawal</th><th className="px-3 py-2">Note</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {history.map(a => <tr key={a.date + a.currency + a.gateway}><td className="px-3 py-1.5">{a.date}</td><td className="px-3 py-1.5">{a.currency}</td><td className="px-3 py-1.5">{a.gateway}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(a.deposit, 2)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(a.withdrawal, 2)}</td><td className="px-3 py-1.5">{a.note}</td></tr>)}
              {!history.length && <tr><td colSpan={6} className="p-8 text-center text-slate-400">No daily records for these filters.</td></tr>}
            </tbody>
            {history.length > 0 && cur && <tfoot className="bg-slate-50 font-semibold"><tr><td className="px-3 py-2" colSpan={3}>Total {cur} · {fmt(history.length)} records · deposit {compact(histTotals.dp)}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(histTotals.dp, 2)}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(histTotals.wd, 2)}</td><td /></tr></tfoot>}
          </table>
        </div>
      </Section>
    </>
  )
}
