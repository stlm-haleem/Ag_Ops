import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PageTitle } from '../components/Layout'
import { ChartCard, Empty, Kpi, Section } from '../components/ui'
import AgentTable, { Flag } from '../components/AgentTable'
import { byBkkWallet, byShop, byWallet, compact, fmt, kpis } from '../lib/metrics'
import { useData } from '../lib/store'
import { GATEWAY_GROUPS, GROUPS, GROUP_LABEL, Group } from '../lib/types'

type Tab = 'ALL' | Group

/** PKR-SSG login-status filter: one checkbox per status. */
const PKR_STATUSES = [
  { value: 'Logged In', label: 'Login: Yes' },
  { value: 'Logged Out', label: 'Login: No' },
  { value: 'Locked', label: 'Locked account' },
]

export default function GatewayPage({ currency, gateway }: { currency: string; gateway: string }) {
  const { rows, loading, settings, dataset } = useData()
  const isPkr = currency === 'PKR' && gateway === 'SSG'
  const isBkk = gateway === 'BKK'
  const groups = GATEWAY_GROUPS[`${currency}-${gateway}`] ?? GROUPS
  const [tab, setTab] = useState<Tab>('ALL')
  const [flag, setFlag] = useState<Flag>('all')
  const [loginStatus, setLoginStatus] = useState('')
  // PKR: statuses that are switched off. Locked accounts are hidden by default.
  const [hiddenStates, setHiddenStates] = useState<Set<string>>(() => new Set(['Locked']))
  const toggleState = (v: string) => setHiddenStates(prev => { const n = new Set(prev); if (n.has(v)) n.delete(v); else n.add(v); return n })

  const tabInfo = dataset?.sheets.find(sh => sh.name === `${currency}-${gateway}`)
  const gwRows = useMemo(() => rows.filter(r => r.currency === currency && r.gateway === gateway), [rows, currency, gateway])
  const loginStatuses = useMemo(() => [...new Set(gwRows.map(r => r.login))].sort(), [gwRows])
  const statusRows = useMemo(() => isPkr
    ? gwRows.filter(r => !hiddenStates.has(r.login))
    : !loginStatus ? gwRows : gwRows.filter(r => r.login === loginStatus), [gwRows, loginStatus, isPkr, hiddenStates])
  const scoped = useMemo(() => (tab === 'ALL' ? statusRows : statusRows.filter(r => r.group === tab)), [statusRows, tab])
  const visualRows = useMemo(() => gateway === 'SSG' ? scoped.filter(r => r.wallet.trim() !== '' && r.wallet.trim().toUpperCase() !== 'IBBL') : scoped, [scoped, gateway])
  const k = useMemo(() => kpis(scoped), [scoped])
  const visualK = useMemo(() => kpis(visualRows), [visualRows])
  const wallets = useMemo(() => byWallet(visualRows), [visualRows])
  const bkkWallets = useMemo(() => byBkkWallet(scoped), [scoped])
  const shops = useMemo(() => byShop(scoped).slice(0, 12), [scoped])
  const bkkSum = useMemo(() => ({ stlm: scoped.reduce((s, r) => s + r.stlm, 0), topUp: scoped.reduce((s, r) => s + r.topUp, 0), cashOut: scoped.reduce((s, r) => s + r.cashOut, 0) }), [scoped])
  const top = useMemo(() => [...visualRows].sort((a, b) => b.rBal - a.rBal).slice(0, 10), [visualRows])
  const top5W = useMemo(() => [...visualRows].sort((a, b) => b.withdrawal - a.withdrawal).slice(0, 10), [visualRows])
  const pie = [
    { name: 'Healthy', value: visualK.accounts - visualK.low - visualK.high, color: '#10b981' },
    { name: 'High', value: visualK.high, color: '#f59e0b' },
    { name: 'Low', value: visualK.low, color: '#ef4444' },
  ]
  const activeGroup: Group | null = tab === 'ALL' ? (groups.length === 1 ? groups[0] : null) : tab
  const th = activeGroup ? settings.thresholds[activeGroup] : null
  if (!gwRows.length) return (
    <>
      <PageTitle title={`${currency} · ${gateway}`} />
      <div className="card p-10 text-center text-slate-500">{loading ? 'Loading data…' : 'No data yet. Go to Admin → Data Sources to import your Excel file or connect the Google Sheet.'}
        {!loading && tabInfo && <div className="mx-auto mt-4 max-w-3xl rounded-lg bg-amber-50 p-3 text-left text-xs text-amber-800">
          The <b>{tabInfo.name}</b> tab was loaded ({fmt(tabInfo.rows.length)} rows) but no accounts were recognised. Header found: <span className="break-words font-mono">{tabInfo.header.map(h => String(h)).join(' | ') || '(empty)'}</span>
          <div className="mt-1">First data row: <span className="break-words font-mono">{(tabInfo.rows.find(r => Array.isArray(r)) ?? []).slice(0, 8).map(c => String(c)).join(' | ')}</span></div>
        </div>}</div>
    </>
  )

  const count = (g: Tab) => (g === 'ALL' ? statusRows.length : statusRows.filter(r => r.group === g).length)
  const pick = (f: Flag) => setFlag(flag === f ? 'all' : f)

  return (
    <>
      <PageTitle title={`${currency} · ${gateway}`} subtitle={isBkk ? 'Shop agents by brand — balances, deposits, withdrawals, special payments and wallet limits' : 'Agent wallet monitoring — balances, activity, limits and discrepancies'} />

      {groups.length > 1 && <div className="flex flex-wrap gap-1 rounded-xl bg-slate-200/60 p-1">
        {(['ALL', ...groups] as Tab[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setFlag('all') }}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === t ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
            {t === 'ALL' ? 'All' : GROUP_LABEL[t]} <span className="ml-1 text-xs text-slate-400">{fmt(count(t))}</span>
          </button>
        ))}
      </div>}

      {isPkr && <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
        <span className="text-sm font-medium text-slate-600">Login status</span>
        {PKR_STATUSES.map(st => {
          const n = gwRows.filter(r => r.login === st.value).length
          return (
            <label key={st.value} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!hiddenStates.has(st.value)} onChange={() => toggleState(st.value)} />
              <span>{st.label}</span><span className="text-xs text-slate-400">{fmt(n)}</span>
            </label>
          )
        })}
      </div>}

      {gateway === 'SSG' && !isPkr && <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
        <label className="text-sm font-medium text-slate-600" htmlFor="dashboard-login-status">Login status</label>
        <select id="dashboard-login-status" className="input min-w-48" value={loginStatus} onChange={e => setLoginStatus(e.target.value)}>
          <option value="">All login statuses</option>
          {loginStatuses.map(status => <option key={status} value={status}>{status}</option>)}
        </select>
      </div>}

      <Section title="Alerts (click to filter the table)" right={th && <span className="text-xs text-slate-400">Low &lt; {fmt(th.low)} · High &gt; SDP ({isBkk ? `no SDP: ${fmt(th.high)}` : isPkr ? 'no SDP = locked account' : `fallback ${gateway === 'MCG' ? '50,000' : '100,000'}`}){isBkk ? '' : ` · Discrep. ≥ ${fmt(th.discrep)}`} (Settings)</span>}>
        <div className={`grid grid-cols-2 gap-3 ${isBkk ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
          <Kpi label="Higher balance agents" value={fmt(k.high)} tone="warn" sub={isBkk ? 'R. Bal above SDP (no SDP: Settings threshold)' : isPkr ? 'R. Bal above SDP' : `R. Bal above SDP (fallback ${gateway === 'MCG' ? '50,000' : '100,000'})`} onClick={() => pick('high')} active={flag === 'high'} />
          <Kpi label="Low balance agents" value={fmt(k.low)} tone="bad" sub="R. Bal below low threshold (incl. negative)" onClick={() => pick('low')} active={flag === 'low'} />
          {!isBkk && <Kpi label="High discrepancy agents" value={fmt(k.highDiscrep)} tone="bad" sub="|R. Bal − A. Bal| above threshold" onClick={() => pick('discrep')} active={flag === 'discrep'} />}
          <Kpi label="Limit exceeded" value={fmt(k.limitExceeded)} tone="warn" sub={isBkk ? 'Limit available below 0 on any wallet' : 'Deposit > utilized limit'} onClick={() => pick('limit')} active={flag === 'limit'} />
        </div>
      </Section>

      {isBkk ? <Section title="Wallets — deposit & withdrawal">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{bkkWallets.map(w => <Kpi key={w.wallet} label={w.wallet} value={compact(w.deposit)} sub={`Deposit · Withdrawal ${fmt(w.withdrawal)} · Cash out ${fmt(w.cashOut)} · ${fmt(w.exceeded)} over limit`} tone="info" />)}</div>
      </Section> : <Section title="Running balance by wallet" right={gateway === 'SSG' ? <span className="text-xs text-slate-400">IBBL and blank wallets excluded from wallet cards and charts</span> : undefined}>
        {wallets.length
          ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{wallets.map(w => <Kpi key={w.wallet} label={w.wallet} value={compact(w.rBal)} sub={`${fmt(w.accounts)} accounts · ${fmt(w.rBal, 2)}`} tone="info" />)}</div>
          : <div className="card p-4 text-sm text-slate-400">No wallet balances to display.</div>}
      </Section>}

      {isBkk ? <Section title="Balances & flow">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
          <Kpi label="Accounts" value={fmt(k.accounts)} sub={`${fmt(k.loggedIn)} active · ${fmt(k.accounts - k.loggedIn)} inactive`} />
          <Kpi label="Running balance" value={compact(k.rBal)} sub={fmt(k.rBal, 2)} tone="info" />
          <Kpi label="Deposit" value={compact(k.deposit)} sub={fmt(k.deposit)} tone="good" />
          <Kpi label="Withdrawal" value={compact(k.withdrawal)} sub={fmt(k.withdrawal)} />
          <Kpi label="Special payment" value={compact(bkkSum.stlm)} sub={fmt(bkkSum.stlm)} />
          <Kpi label="Top up" value={compact(bkkSum.topUp)} sub={fmt(bkkSum.topUp)} />
          <Kpi label="Cash out" value={compact(bkkSum.cashOut)} sub="Information only (not in R. Bal)" />
          <Kpi label="Total flow" value={compact(k.flow)} sub="Deposit + Withdrawal" />
        </div>
      </Section> : <Section title="Balances & flow">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
          <Kpi label="Accounts" value={fmt(k.accounts)} sub={`${fmt(k.loggedIn)} ${gateway === 'MCG' ? 'active' : 'logged in'}`} />
          <Kpi label="Running balance" value={compact(k.rBal)} sub={fmt(k.rBal, 2)} tone="info" />
          <Kpi label="Actual balance" value={compact(k.aBal)} sub={fmt(k.aBal, 2)} tone="info" />
          <Kpi label="Net discrepancy" value={compact(k.discrep)} sub="R. Bal − A. Bal" tone={k.discrep === 0 ? 'good' : 'warn'} />
          <Kpi label="Deposit" value={compact(k.deposit)} sub={fmt(k.deposit)} tone="good" />
          <Kpi label="Withdrawal" value={compact(k.withdrawal)} sub={fmt(k.withdrawal)} />
          <Kpi label="Adjustment" value={compact(k.adjustment)} sub={fmt(k.adjustment)} />
          <Kpi label="Total flow" value={compact(k.flow)} sub="Deposit + Withdrawal" />
        </div>
      </Section>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {isBkk ? <ChartCard title="Running balance by shop (top 12)">
            <ResponsiveContainer><BarChart data={shops}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="shop" fontSize={11} /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: number) => fmt(v, 2)} />
              <Bar dataKey="rBal" name="Running" fill="#6366f1" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          </ChartCard> : (
          <ChartCard title="Running vs actual balance by wallet">
            <ResponsiveContainer><BarChart data={wallets}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="wallet" /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: number) => fmt(v, 2)} /><Legend />
              <Bar dataKey="rBal" name="Running" fill="#6366f1" radius={[4, 4, 0, 0]} /><Bar dataKey="aBal" name="Actual" fill="#94a3b8" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          </ChartCard>
          )}
        </div>
        <ChartCard title="Balance health (accounts)">
          {k.accounts ? <ResponsiveContainer><PieChart><Pie data={pie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>{pie.map(p => <Cell key={p.name} fill={p.color} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer> : <Empty>No data</Empty>}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Deposit vs withdrawal per wallet">
          <ResponsiveContainer><BarChart data={isBkk ? bkkWallets : wallets}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="wallet" /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: number) => fmt(v, 2)} /><Legend />
            <Bar dataKey="deposit" name="Deposit" fill="#10b981" radius={[4, 4, 0, 0]} /><Bar dataKey="withdrawal" name="Withdrawal" fill="#f43f5e" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
        </ChartCard>
        {isBkk ? <div className="card overflow-auto">
          <div className="p-4 text-sm font-semibold text-slate-700">Wallet summary</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Wallet', 'Deposit', 'Withdrawal', 'Cash out', 'Special payment', 'Limit available', 'Over limit'].map((h, i) => <th key={h} className={`px-3 py-2 ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {bkkWallets.map(w => <tr key={w.wallet}><td className="px-3 py-1.5 font-medium">{w.wallet}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.deposit)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.withdrawal)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.cashOut)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.special)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.available)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.exceeded)}</td></tr>)}
            </tbody>
          </table>
        </div> : (
        <div className="card overflow-auto">
          <div className="p-4 text-sm font-semibold text-slate-700">Wallet summary</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Wallet', 'Accounts', 'Deposit', 'Withdrawal', 'R. Bal', 'A. Bal', 'Discrep.'].map((h, i) => <th key={h} className={`px-3 py-2 ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {wallets.map(w => <tr key={w.wallet}><td className="px-3 py-1.5 font-medium">{w.wallet}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.accounts)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.deposit)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.withdrawal)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.rBal)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.aBal)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.discrep)}</td></tr>)}
            </tbody>
          </table>
        </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Top 10 accounts by running balance" height={300}>
          <ResponsiveContainer><BarChart data={top} layout="vertical" margin={{ left: 40 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={compact} /><YAxis type="category" dataKey="account" width={110} fontSize={11} /><Tooltip formatter={(v: number) => fmt(v, 2)} /><Bar dataKey="rBal" name="R. Bal" fill="#6366f1" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Top 10 accounts by withdrawal volume" height={300}>
          <ResponsiveContainer><BarChart data={top5W} layout="vertical" margin={{ left: 40 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={compact} /><YAxis type="category" dataKey="account" width={110} fontSize={11} /><Tooltip formatter={(v: number) => fmt(v, 2)} /><Bar dataKey="withdrawal" name="Withdrawal" fill="#f43f5e" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer>
        </ChartCard>
      </div>

      <Section title={`Accounts — ${tab === 'ALL' ? (groups.length > 1 ? 'All types' : GROUP_LABEL[groups[0]]) : GROUP_LABEL[tab]}`}>
        <AgentTable rows={scoped} showType={tab === 'ALL' && groups.length > 1} flag={flag} onFlag={setFlag} gateway={gateway} currency={currency} />
      </Section>
    </>
  )
}
