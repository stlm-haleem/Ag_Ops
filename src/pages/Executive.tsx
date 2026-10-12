import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from 'recharts'
import { PageTitle } from '../components/Layout'
import { ChartCard, Empty, Kpi, Section } from '../components/ui'
import { compact, fmt, kpis } from '../lib/metrics'
import { useData } from '../lib/store'
import { GROUPS, GROUP_LABEL } from '../lib/types'

export default function Executive() {
  const { rows, analytics, loading } = useData()
  const [currency, setCurrency] = useState('')
  const [gateway, setGateway] = useState('')
  const [wallet, setWallet] = useState('')
  const [login, setLogin] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const wallets = useMemo(() => [...new Set(rows.map(r => r.wallet))].sort(), [rows])
  const states = useMemo(() => [...new Set(rows.map(r => r.login))].filter(Boolean).sort(), [rows])
  const scoped = useMemo(() => rows.filter(r => (!currency || r.currency === currency) && (!gateway || r.gateway === gateway) && (!wallet || r.wallet === wallet) && (!login || r.login === login)), [rows, currency, gateway, wallet, login])
  const k = useMemo(() => kpis(scoped), [scoped])
  const bdt = useMemo(() => kpis(rows.filter(r => r.currency === 'BDT')), [rows])

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

  const byGroup = useMemo(() => GROUPS.map(g => ({ name: GROUP_LABEL[g], rBal: scoped.filter(r => r.group === g).reduce((s, r) => s + r.rBal, 0), aBal: scoped.filter(r => r.group === g).reduce((s, r) => s + r.aBal, 0) })), [scoped])

  const sel = (v: string, set: (s: string) => void, label: string, opts: string[]) => (
    <label className="text-xs text-slate-500">{label}
      <select className="input mt-1 block w-36" value={v} onChange={e => set(e.target.value)}><option value="">All</option>{opts.map(o => <option key={o}>{o}</option>)}</select>
    </label>
  )

  return (
    <>
      <PageTitle title="Executive Dashboard" subtitle="Division-wide view. Live today: BDT · SSG and BDT · MCG (other gateways and currencies will appear as they are connected)." />

      <div className="card flex flex-wrap items-end gap-3 p-3">
        {sel(currency, setCurrency, 'Currency', ['BDT'])}
        {sel(gateway, setGateway, 'Merchant / gateway', gateways)}
        {sel(wallet, setWallet, 'Wallet', wallets)}
        {sel(login, setLogin, 'Status', states)}
        <label className="text-xs text-slate-500">From<input type="date" className="input mt-1 block" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-xs text-slate-500">To<input type="date" className="input mt-1 block" value={to} onChange={e => setTo(e.target.value)} /></label>
        <button className="btn" onClick={() => { setCurrency(''); setGateway(''); setWallet(''); setLogin(''); setFrom(''); setTo('') }}>Reset</button>
        <span className="ml-auto text-xs text-slate-400">Brand filter will be added once brand data exists in the sheets.</span>
      </div>

      {!rows.length && <div className="card p-8 text-center text-slate-500">{loading ? 'Loading data…' : <>No data loaded yet. Go to <Link className="text-brand-600 underline" to="/admin/data-sources">Admin → Data Sources</Link>.</>}</div>}

      <Section title="Balance">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Total running balance" value={compact(k.rBal)} sub={`Actual: ${compact(k.aBal)}`} tone="info" />
          <Kpi label="BDT balance" value={compact(bdt.rBal)} sub={fmt(bdt.rBal)} />
          <Kpi label="PKR balance" value="—" sub="Not connected yet" />
          <Kpi label="INR balance" value="—" sub="Not connected yet" />
        </div>
      </Section>

      <Section title="Transaction flow (from current sheet snapshot)">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Total deposit" value={compact(k.deposit)} sub={fmt(k.deposit)} tone="good" />
          <Kpi label="Total payout (withdrawal)" value={compact(k.withdrawal)} sub={fmt(k.withdrawal)} />
          <Kpi label="Total settlement" value="—" sub="No settlement column in the sheets yet" />
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
          <Kpi label="Payment gateways" value={fmt(new Set(scoped.map(r => r.gateway)).size)} sub="others pending" />
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

      <ChartCard title="Running vs actual balance by agent type">
        <ResponsiveContainer><BarChart data={byGroup}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: number) => fmt(v, 2)} /><Legend />
          <Bar dataKey="rBal" name="Running" fill="#6366f1" radius={[4, 4, 0, 0]} /><Bar dataKey="aBal" name="Actual" fill="#94a3b8" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
      </ChartCard>
    </>
  )
}
