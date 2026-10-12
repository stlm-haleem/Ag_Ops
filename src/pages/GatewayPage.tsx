import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PageTitle } from '../components/Layout'
import { ChartCard, Empty, Kpi, Section } from '../components/ui'
import AgentTable, { Flag } from '../components/AgentTable'
import { byWallet, compact, fmt, kpis } from '../lib/metrics'
import { useData } from '../lib/store'
import { GATEWAY_GROUPS, GROUPS, GROUP_LABEL, Group } from '../lib/types'

type Tab = 'ALL' | Group

export default function GatewayPage({ currency, gateway }: { currency: string; gateway: string }) {
  const { rows, loading, settings, updateSettings } = useData()
  const groups = GATEWAY_GROUPS[gateway] ?? GROUPS
  const [tab, setTab] = useState<Tab>('ALL')
  const gwKey = `${currency}-${gateway}`
  const gwThreshold = settings.gatewayBalance?.[gwKey]?.high ?? 0
  const [thDraft, setThDraft] = useState<string | null>(null)
  const [thSaved, setThSaved] = useState(false)
  const [flag, setFlag] = useState<Flag>('all')

  const gwRows = useMemo(() => rows.filter(r => r.currency === currency && r.gateway === gateway), [rows, currency, gateway])
  const scoped = useMemo(() => (tab === 'ALL' ? gwRows : gwRows.filter(r => r.group === tab)), [gwRows, tab])
  const visualRows = useMemo(() => gateway === 'SSG' ? scoped.filter(r => r.wallet.trim() !== '' && r.wallet.trim().toUpperCase() !== 'IBBL') : scoped, [scoped, gateway])
  const k = useMemo(() => kpis(scoped), [scoped])
  const visualK = useMemo(() => kpis(visualRows), [visualRows])
  const wallets = useMemo(() => byWallet(visualRows), [visualRows])
  const top = useMemo(() => [...visualRows].sort((a, b) => b.rBal - a.rBal).slice(0, 10), [visualRows])
  const top5W = useMemo(() => [...visualRows].sort((a, b) => b.withdrawal - a.withdrawal).slice(0, 10), [visualRows])
  const pie = [
    { name: 'Healthy', value: visualK.accounts - visualK.low - visualK.high, color: '#10b981' },
    { name: 'High', value: visualK.high, color: '#f59e0b' },
    { name: 'Low', value: visualK.low, color: '#ef4444' },
  ]
  const activeGroup: Group | null = tab === 'ALL' ? (groups.length === 1 ? groups[0] : null) : tab
  const th = activeGroup ? settings.thresholds[activeGroup] : null
  const gwTotal = useMemo(() => kpis(gwRows).rBal, [gwRows])
  const gwOver = gwThreshold > 0 && gwTotal > gwThreshold
  const saveThreshold = async () => {
    await updateSettings({ ...settings, gatewayBalance: { ...settings.gatewayBalance, [gwKey]: { high: Math.max(0, Number(thDraft) || 0) } } })
    setThDraft(null); setThSaved(true)
  }

  if (!gwRows.length) return (
    <>
      <PageTitle title={`${currency} · ${gateway}`} />
      <div className="card p-10 text-center text-slate-500">{loading ? 'Loading data…' : 'No data yet. Go to Admin → Data Sources to import your Excel file or connect the Google Sheet.'}</div>
    </>
  )

  const count = (g: Tab) => (g === 'ALL' ? gwRows.length : gwRows.filter(r => r.group === g).length)
  const pick = (f: Flag) => setFlag(flag === f ? 'all' : f)

  return (
    <>
      <PageTitle title={`${currency} · ${gateway}`} subtitle="Agent wallet monitoring — balances, activity, limits and discrepancies" />

      {groups.length > 1 && <div className="flex flex-wrap gap-1 rounded-xl bg-slate-200/60 p-1">
        {(['ALL', ...groups] as Tab[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setFlag('all') }}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === t ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
            {t === 'ALL' ? 'All' : GROUP_LABEL[t]} <span className="ml-1 text-xs text-slate-400">{fmt(count(t))}</span>
          </button>
        ))}
      </div>}

      <Section title="Alerts (click to filter the table)" right={th && <span className="text-xs text-slate-400">Low &lt; {fmt(th.low)} · High &gt; SDP (fallback {gateway === 'MCG' ? '50,000' : '100,000'}) · Discrep. ≥ {fmt(th.discrep)} (Settings)</span>}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Higher balance agents" value={fmt(k.high)} tone="warn" sub={`R. Bal above SDP (fallback ${gateway === 'MCG' ? '50,000' : '100,000'})`} onClick={() => pick('high')} active={flag === 'high'} />
          <Kpi label="Low balance agents" value={fmt(k.low)} tone="bad" sub="R. Bal below low threshold (incl. negative)" onClick={() => pick('low')} active={flag === 'low'} />
          <Kpi label="High discrepancy agents" value={fmt(k.highDiscrep)} tone="bad" sub="|R. Bal − A. Bal| above threshold" onClick={() => pick('discrep')} active={flag === 'discrep'} />
          <Kpi label="Limit exceeded" value={fmt(k.limitExceeded)} tone="warn" sub="Deposit > utilized limit" onClick={() => pick('limit')} active={flag === 'limit'} />
        </div>
      </Section>

      <Section title="Running balance by wallet" right={gateway === 'SSG' ? <span className="text-xs text-slate-400">IBBL and blank wallets excluded from wallet cards and charts</span> : undefined}>
        {wallets.length
          ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{wallets.map(w => <Kpi key={w.wallet} label={w.wallet} value={compact(w.rBal)} sub={`${fmt(w.accounts)} accounts · ${fmt(w.rBal, 2)}`} tone="info" />)}</div>
          : <div className="card p-4 text-sm text-slate-400">No wallet balances to display.</div>}
      </Section>

      <Section title="Balances & flow">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
          <Kpi label="Accounts" value={fmt(k.accounts)} sub={`${fmt(k.loggedIn)} ${gateway === 'MCG' ? 'active' : 'logged in'}`} />
          <Kpi label="Running balance" value={compact(k.rBal)} sub={gwOver && tab === 'ALL' ? `HIGH · above ${compact(gwThreshold)}` : fmt(k.rBal, 2)} tone={gwOver && tab === 'ALL' ? 'warn' : 'info'} />
          <Kpi label="Actual balance" value={compact(k.aBal)} sub={fmt(k.aBal, 2)} tone="info" />
          <Kpi label="Net discrepancy" value={compact(k.discrep)} sub="R. Bal − A. Bal" tone={k.discrep === 0 ? 'good' : 'warn'} />
          <Kpi label="Deposit" value={compact(k.deposit)} sub={fmt(k.deposit)} tone="good" />
          <Kpi label="Withdrawal" value={compact(k.withdrawal)} sub={fmt(k.withdrawal)} />
          <Kpi label="Adjustment" value={compact(k.adjustment)} sub={fmt(k.adjustment)} />
          <Kpi label="Total flow" value={compact(k.flow)} sub="Deposit + Withdrawal" />
        </div>
      </Section>

      <Section title={`${gateway} running-balance threshold`}>
        <div className={`card flex flex-wrap items-center gap-4 p-4 ${gwOver ? 'border-amber-400 bg-amber-50' : ''}`}>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-700">Total {gateway} running balance: <span className="tabular-nums">{fmt(gwTotal, 2)}</span></div>
            <div className="mt-0.5 text-sm">
              {gwThreshold > 0
                ? gwOver ? <span className="font-semibold text-amber-700">HIGH — above your threshold of {fmt(gwThreshold)} by {fmt(gwTotal - gwThreshold)}</span>
                         : <span className="text-emerald-600">Within your threshold of {fmt(gwThreshold)} ({fmt((gwTotal / gwThreshold) * 100, 0)}% used)</span>
                : <span className="text-slate-500">No threshold set. Enter the total running balance above which {gateway} should be flagged as high.</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="number" inputMode="decimal" min={0} className="input w-44" placeholder="High above…" value={thDraft ?? (gwThreshold || '')} onChange={e => { setThDraft(e.target.value); setThSaved(false) }} />
            <button className="btn-primary" disabled={thDraft === null} onClick={saveThreshold}>Save threshold</button>
            {thSaved && thDraft === null && <span className="text-sm text-emerald-600">Saved</span>}
          </div>
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title="Running vs actual balance by wallet">
            <ResponsiveContainer><BarChart data={wallets}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="wallet" /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: number) => fmt(v, 2)} /><Legend />
              <Bar dataKey="rBal" name="Running" fill="#6366f1" radius={[4, 4, 0, 0]} /><Bar dataKey="aBal" name="Actual" fill="#94a3b8" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          </ChartCard>
        </div>
        <ChartCard title="Balance health (accounts)">
          {k.accounts ? <ResponsiveContainer><PieChart><Pie data={pie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>{pie.map(p => <Cell key={p.name} fill={p.color} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer> : <Empty>No data</Empty>}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Deposit vs withdrawal per wallet">
          <ResponsiveContainer><BarChart data={wallets}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="wallet" /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: number) => fmt(v, 2)} /><Legend />
            <Bar dataKey="deposit" name="Deposit" fill="#10b981" radius={[4, 4, 0, 0]} /><Bar dataKey="withdrawal" name="Withdrawal" fill="#f43f5e" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
        </ChartCard>
        <div className="card overflow-auto">
          <div className="p-4 text-sm font-semibold text-slate-700">Wallet summary</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Wallet', 'Accounts', 'Deposit', 'Withdrawal', 'R. Bal', 'A. Bal', 'Discrep.'].map((h, i) => <th key={h} className={`px-3 py-2 ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {wallets.map(w => <tr key={w.wallet}><td className="px-3 py-1.5 font-medium">{w.wallet}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.accounts)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.deposit)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.withdrawal)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.rBal)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.aBal)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(w.discrep)}</td></tr>)}
            </tbody>
          </table>
        </div>
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
        <AgentTable rows={scoped} showType={tab === 'ALL' && groups.length > 1} flag={flag} onFlag={setFlag} gateway={gateway} />
      </Section>
    </>
  )
}
