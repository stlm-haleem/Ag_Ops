import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from 'recharts'
import { PageTitle } from '../components/Layout'
import { ChartCard, Empty, Kpi, Section } from '../components/ui'
import { compact, fmt, kpis } from '../lib/metrics'
import { useData } from '../lib/store'
import { parseInr, worstStatus } from '../lib/inr'
import { INR_SHEET } from '../lib/types'
import { gatewayLabel } from '../lib/alerts'

export default function Executive() {
  const { rows, analytics, loading, settings, dataset } = useData()
  const [currency, setCurrency] = useState('BDT')
  const [gateway, setGateway] = useState('')
  const [wallet, setWallet] = useState('')
  const [brand, setBrand] = useState('')
  const [login, setLogin] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const wallets = useMemo(() => [...new Set(rows.map(r => r.wallet))].sort(), [rows])
  const gateways = useMemo(() => [...new Set(rows.map(r => r.gateway))].sort(), [rows])
  const brands = useMemo(() => [...new Set(rows.map(r => r.brand))].filter(Boolean).sort(), [rows])
  const states = useMemo(() => [...new Set(rows.map(r => r.login))].filter(Boolean).sort(), [rows])
  // One card per currency + gateway (BDT-SSG and PKR-SSG must not be summed together).
  const gwCards = useMemo(() => [...new Set(rows.map(r => `${r.currency}-${r.gateway}`))].sort().map(key => {
    const gr = rows.filter(r => `${r.currency}-${r.gateway}` === key)
    const cur = gr[0].currency, g = gr[0].gateway
    const total = kpis(gr).rBal
    const high = settings.gatewayBalance?.[key]?.high ?? 0
    return { key, gateway: g, currency: cur, total, high, over: high > 0 && total > high, agents: gr.length }
  }), [rows, settings])
  const scoped = useMemo(() => rows.filter(r => (!currency || r.currency === currency) && (!gateway || r.gateway === gateway) && (!wallet || r.wallet === wallet) && (!brand || r.brand === brand) && (!login || r.login === login)), [rows, currency, gateway, wallet, brand, login])
  const k = useMemo(() => kpis(scoped), [scoped])
  const inr = useMemo(() => parseInr(dataset?.sheets.find(sh => sh.name === INR_SHEET), settings.inr), [dataset, settings.inr])
  const inrLoaded = inr.brands.some(b => b.wdFound)
  const inrTotal = inr.brands.reduce((sum, b) => sum + (b.wdBalance ?? 0), 0)
  const inrAvailable = inr.brands.reduce((sum, b) => sum + b.availableTotal, 0)
  const inrMissing = inr.brands.filter(b => b.wdFound && b.wdBalance === null).map(b => b.brand)
  const settlement = useMemo(() => scoped.reduce((sum, r) => sum + r.stlm, 0), [scoped])
  const bdt = useMemo(() => kpis(rows.filter(r => r.currency === 'BDT')), [rows])
  const pkr = useMemo(() => kpis(rows.filter(r => r.currency === 'PKR')), [rows])

  const series = useMemo(() => {
    const m = new Map<string, { date: string; deposit: number; withdrawal: number }>()
    for (const a of analytics) {
      if ((currency && a.currency !== currency) || (gateway && a.gateway !== gateway)) continue
      if ((from && a.date < from) || (to && a.date > to)) continue
      const s = m.get(a.date) ?? { date: a.date, deposit: 0, withdrawal: 0 }
      s.deposit += a.deposit; s.withdrawal += a.withdrawal; m.set(a.date, s)
    }
    return [...m.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [analytics, currency, gateway, from, to])

  // Current deposit vs withdrawal (sheet snapshot), per gateway or per brand. Follows the filters above. INR is not part of it.
  const [flowBy, setFlowBy] = useState<'gateway' | 'brand'>('gateway')
  const flow = useMemo(() => {
    const m = new Map<string, { name: string; deposit: number; withdrawal: number }>()
    for (const r of scoped) {
      const name = flowBy === 'gateway' ? `${r.currency} · ${gatewayLabel(r.gateway)}` : r.brand
      if (!name) continue
      const e = m.get(name) ?? { name, deposit: 0, withdrawal: 0 }
      e.deposit += r.deposit; e.withdrawal += r.withdrawal; m.set(name, e)
    }
    return [...m.values()].sort((x, y) => x.name.localeCompare(y.name))
  }, [scoped, flowBy])

  const sel = (v: string, set: (s: string) => void, label: string, opts: string[]) => (
    <label className="text-xs text-slate-500">{label}
      <select className="input mt-1 block w-36" value={v} onChange={e => set(e.target.value)}><option value="">All</option>{opts.map(o => <option key={o}>{o}</option>)}</select>
    </label>
  )

  return (
    <>
      <PageTitle title="Executive Dashboard" subtitle="Division-wide view of every connected gateway: BDT, PKR and INR. Balances are never added across currencies." />

      <div className="card flex flex-wrap items-end gap-3 p-3">
        {sel(currency, setCurrency, 'Currency', ['BDT', 'PKR'])}
        {sel(gateway, setGateway, 'Merchant / gateway', gateways)}
        {sel(wallet, setWallet, 'Wallet', wallets)}
        {sel(brand, setBrand, 'Brand', brands)}
        {sel(login, setLogin, 'Status', states)}
        <label className="text-xs text-slate-500">From<input type="date" className="input mt-1 block" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-xs text-slate-500">To<input type="date" className="input mt-1 block" value={to} onChange={e => setTo(e.target.value)} /></label>
        <button className="btn" onClick={() => { setCurrency('BDT'); setGateway(''); setWallet(''); setBrand(''); setLogin(''); setFrom(''); setTo('') }}>Reset</button>
        <span className="ml-auto text-xs text-slate-400">Brand applies to Bangkok-Pay agents (BAJI, JEETBUZZ, SIX6S). INR is shown below.</span>
      </div>

      {!rows.length && <div className="card p-8 text-center text-slate-500">{loading ? 'Loading data…' : <>No data loaded yet. Go to <Link className="text-brand-600 underline" to="/admin/data-sources">Admin → Data Sources</Link>.</>}</div>}

      <Section title="Balance">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Total running balance" value={compact(k.rBal)} sub={`Actual: ${compact(k.aBal)}`} tone="info" />
          <Kpi label="BDT balance" value={compact(bdt.rBal)} sub={fmt(bdt.rBal)} />
          <Kpi label="PKR balance" value={pkr.accounts ? compact(pkr.rBal) : '—'} sub={pkr.accounts ? fmt(pkr.rBal) : 'No PKR data loaded'} />
           <Kpi label="INR available balance" value={inrLoaded ? compact(inrAvailable) : '—'} sub={inrLoaded ? 'Total available, all brands' : 'Upload INR-OVERVIEW in Data Sources'} />
          <Kpi label="INR WD balance" value={inrLoaded ? compact(inrTotal) : '—'} sub={inrLoaded ? (inrMissing.length ? `Excludes ${inrMissing.join(', ')} (sheet error)` : 'Total WD balance, all brands') : 'Upload INR-OVERVIEW in Data Sources'} tone={inrMissing.length ? 'warn' : 'default'} />
        </div>
      </Section>

      {gwCards.length > 0 && (
        <Section title="Gateway running balance vs your threshold">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {gwCards.map(c => (
              <Link key={c.key} to={`/currency/${c.currency.toLowerCase()}/${c.gateway.toLowerCase()}`} className={`card p-4 hover:border-brand-500 ${c.over ? 'border-amber-400 bg-amber-50' : ''}`}>
                <div className="flex items-center justify-between"><div className="font-semibold">{c.currency} · {c.gateway}</div>
                  {c.over ? <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900">HIGH</span> : c.high > 0 ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">OK</span> : <span className="text-xs text-slate-400">No threshold</span>}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{compact(c.total)}</div>
                {c.high > 0 && <><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className={`h-full ${c.over ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, Math.max(0, (c.total / c.high) * 100))}%` }} /></div>
                  <div className="mt-1 text-xs text-slate-500">Threshold {compact(c.high)} · {fmt((c.total / c.high) * 100, 0)}%</div></>}
              </Link>
            ))}
          </div>
        </Section>
      )}

      {inrLoaded && (
        <Section title="INR balances vs your limits">
          <div className="grid gap-3 sm:grid-cols-3">
            {inr.brands.map(b => {
              const worst = worstStatus(b.availableStatus, b.status)
              const tone = worst === 'high' ? 'border-amber-400 bg-amber-50' : worst === 'low' || worst === 'error' ? 'border-rose-300 bg-rose-50' : ''
              const pill = (st: string) => st === 'high' ? <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900">HIGH</span>
                : st === 'low' ? <span className="rounded-full bg-rose-200 px-2 py-0.5 text-xs font-semibold text-rose-900">LOW</span>
                : st === 'error' ? <span className="rounded-full bg-rose-200 px-2 py-0.5 text-xs font-semibold text-rose-900">SHEET ERROR</span>
                : st === 'ok' ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">OK</span> : <span className="text-xs text-slate-400">No limits</span>
              const lim = (l: { low: number; high: number }) => `Low ${l.low ? compact(l.low) : '—'} · High ${l.high ? compact(l.high) : '—'}`
              return (
                <Link key={b.brand} to="/currency/inr" className={`card space-y-3 p-4 hover:border-brand-500 ${tone}`}>
                  <div className="font-semibold">INR · {b.brand}</div>
                  <div><div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500"><span>Total available balance</span>{pill(b.availableStatus)}</div>
                    <div className="text-xl font-semibold tabular-nums">{compact(b.availableTotal)}</div><div className="text-xs text-slate-500">{lim(b.availableLimits)}</div></div>
                  <div><div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500"><span>Total WD balance</span>{pill(b.status)}</div>
                    <div className="text-xl font-semibold tabular-nums">{b.wdBalance === null ? '—' : compact(b.wdBalance)}</div><div className="text-xs text-slate-500">{b.wdBalance === null ? `Sheet shows ${b.wdError || 'no value'}` : lim(b.limits)}</div></div>
                </Link>
              )
            })}
          </div>
        </Section>
      )}

      <Section title="Transaction flow (from current sheet snapshot)">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Total deposit" value={compact(k.deposit)} sub={fmt(k.deposit)} tone="good" />
          <Kpi label="Total payout (withdrawal)" value={compact(k.withdrawal)} sub={fmt(k.withdrawal)} />
          <Kpi label="Total settlement" value={compact(settlement)} sub={settlement || scoped.some(r => r.gateway === 'BKK') ? 'STLM/SPC (Bangkok-Pay)' : 'Only Bangkok-Pay has a settlement column'} />
          <Kpi label="Total adjustment" value={compact(k.adjustment)} sub={fmt(k.adjustment)} />
          <Kpi label="Total flow" value={compact(k.flow)} sub="Deposit + Withdrawal" />
        </div>
      </Section>

      <Section title="Operational monitoring">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Kpi label="Active agents" value={fmt(k.loggedIn)} sub={`of ${fmt(k.accounts)} accounts`} tone="good" />
          <Kpi label="Low-balance agents" value={fmt(k.low)} tone="bad" />
          <Kpi label="High-balance agents" value={fmt(k.high)} tone="warn" />
          <Kpi label="High discrepancy" value={fmt(k.highDiscrep)} tone="bad" />
          <Kpi label="Payment gateways" value={fmt(new Set(scoped.map(r => r.gateway)).size)} sub="in the current filter" />
          <Kpi label="Wallets" value={fmt(new Set(scoped.map(r => r.wallet)).size)} />
        </div>
      </Section>

      <ChartCard title="Daily deposit vs withdrawal (recorded automatically at end of day)" height={320}>
        {series.length ? (
          <ResponsiveContainer><LineChart data={series}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: number) => fmt(v, 2)} /><Legend />
            <Line type="monotone" dataKey="deposit" name="Deposit" stroke="#10b981" strokeWidth={2} dot={series.length < 40} />
            <Line type="monotone" dataKey="withdrawal" name="Withdrawal" stroke="#f43f5e" strokeWidth={2} dot={series.length < 40} /></LineChart></ResponsiveContainer>
        ) : <Empty><span>No daily records yet. They are recorded automatically at end of day once the Apps Script daily trigger is installed (or record one in <Link className="text-brand-600 underline" to="/admin/data-sources">Admin → Data Sources</Link>).</span></Empty>}
      </ChartCard>

      <ChartCard title={`Current deposit vs withdrawal by ${flowBy}${flowBy === 'brand' ? ' (Bangkok-Pay brands)' : ''}`} height={300}
        right={<div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs">{(['gateway', 'brand'] as const).map(v => <button key={v} onClick={() => setFlowBy(v)} className={`rounded-md px-3 py-1 font-medium capitalize ${flowBy === v ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`}>{v}</button>)}</div>}>
        {flow.length ? <ResponsiveContainer><BarChart data={flow}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={11} /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: number) => fmt(v, 2)} /><Legend />
          <Bar dataKey="deposit" name="Deposit" fill="#10b981" radius={[4, 4, 0, 0]} /><Bar dataKey="withdrawal" name="Withdrawal" fill="#f43f5e" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          : <Empty>{flowBy === 'brand' ? 'No brand data in the current filter (brands exist for Bangkok-Pay only)' : 'No data'}</Empty>}
      </ChartCard>
    </>
  )
}
