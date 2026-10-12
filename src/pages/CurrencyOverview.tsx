import { Link } from 'react-router-dom'
import { PageTitle } from '../components/Layout'
import { Kpi } from '../components/ui'
import { compact, fmt, kpis } from '../lib/metrics'
import { useData } from '../lib/store'

export default function CurrencyOverview({ currency }: { currency: string }) {
  const { rows } = useData()
  const k = kpis(rows.filter(r => r.currency === currency))
  const live = [{ name: 'SSG', to: '/currency/bdt/ssg', ready: true }, { name: 'MCG', to: '/currency/bdt/mcg', ready: true }, { name: 'Local Bank', to: '/currency/bdt/local-bank', ready: false }]
  return (
    <>
      <PageTitle title={`${currency} Overview`} subtitle="Summary of all payment gateways under this currency" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Running balance" value={compact(k.rBal)} sub={fmt(k.rBal)} tone="info" />
        <Kpi label="Accounts" value={fmt(k.accounts)} sub={`${fmt(k.loggedIn)} active`} />
        <Kpi label="Deposit" value={compact(k.deposit)} tone="good" />
        <Kpi label="Withdrawal" value={compact(k.withdrawal)} />
        <Kpi label="High discrepancy" value={fmt(k.highDiscrep)} tone="bad" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {live.map(g => (
          <Link key={g.name} to={g.to} className="card p-5 hover:border-brand-500">
            <div className="text-lg font-semibold">{g.name}</div>
            <div className="text-sm text-slate-500">{g.ready ? 'Live — open the full monitoring view' : 'Coming soon'}</div>
            {g.ready && <div className="mt-2 text-sm tabular-nums text-slate-700">Running balance {compact(kpis(rows.filter(r => r.currency === currency && r.gateway === g.name)).rBal)}</div>}
          </Link>
        ))}
      </div>
    </>
  )
}
