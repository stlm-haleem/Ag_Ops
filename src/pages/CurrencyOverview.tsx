import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { PageTitle } from '../components/Layout'
import { Kpi } from '../components/ui'
import { buildOps } from '../lib/alerts'
import { parseBdtLocalBank } from '../lib/bdtLocalBank'
import { parseLocalBank } from '../lib/localBank'
import { compact, fmt, kpis } from '../lib/metrics'
import { useData } from '../lib/store'
import { BDT_LOCALBANK_SHEET, LOCALBANK_SHEET } from '../lib/types'

/** Gateways under each currency: `gateway` is the value stored on the agent rows ('Local Bank' = bank accounts, read from their own tab). */
const CARDS: Record<string, { name: string; gateway: string; to: string }[]> = {
  BDT: [
    { name: 'SSG', gateway: 'SSG', to: '/currency/bdt/ssg' },
    { name: 'MCG', gateway: 'MCG', to: '/currency/bdt/mcg' },
    { name: 'Local Bank', gateway: 'Local Bank', to: '/currency/bdt/local-bank' },
  ],
  PKR: [
    { name: 'SSG', gateway: 'SSG', to: '/currency/pkr/ssg' },
    { name: 'Bangkok-Pay', gateway: 'BKK', to: '/currency/pkr/bangkok-pay' },
    { name: 'Local Bank', gateway: 'Local Bank', to: '/currency/pkr/local-bank' },
  ],
}

export default function CurrencyOverview({ currency }: { currency: 'BDT' | 'PKR' }) {
  const { rows, dataset, settings, loading } = useData()
  // Local banks are not part of `rows` (they have their own sheet layout), so their balance comes from their own parsers.
  const bankBalance = useMemo(() => {
    if (!dataset) return 0
    if (currency === 'BDT') return parseBdtLocalBank(dataset.sheets.find(s => s.name === BDT_LOCALBANK_SHEET), settings).accounts.reduce((s, a) => s + a.balance, 0)
    return parseLocalBank(dataset.sheets.find(s => s.name === LOCALBANK_SHEET), settings).accounts.filter(a => a.state === 'ACTIVE').reduce((s, a) => s + a.closing, 0)
  }, [currency, dataset, settings])
  const ops = useMemo(() => buildOps(rows, dataset, settings).filter(i => i.currency === currency), [rows, dataset, settings, currency])
  const cur = useMemo(() => rows.filter(r => r.currency === currency), [rows, currency])
  const k = useMemo(() => kpis(cur), [cur])
  const bankLoaded = !!dataset?.sheets.some(s => s.name === (currency === 'BDT' ? BDT_LOCALBANK_SHEET : LOCALBANK_SHEET))

  return (
    <>
      <PageTitle title={`${currency} Overview`} subtitle="Summary of all payment gateways under this currency" />
      {!cur.length && !bankLoaded && <div className="card p-8 text-center text-slate-500">{loading ? 'Loading data…' : <>No {currency} data loaded yet. Go to <Link className="text-brand-600 underline" to="/admin/data-sources">Admin → Data Sources</Link>.</>}</div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Kpi label="Agent running balance" value={compact(k.rBal)} sub={fmt(k.rBal)} tone="info" />
        <Kpi label="Local bank balance" value={compact(bankBalance)} sub={currency === 'PKR' ? 'Active accounts, closing balance' : fmt(bankBalance)} tone="info" />
        <Kpi label="Agent accounts" value={fmt(k.accounts)} sub={`${fmt(k.loggedIn)} active`} />
        <Kpi label="Deposit" value={compact(k.deposit)} tone="good" />
        <Kpi label="Withdrawal" value={compact(k.withdrawal)} />
        <Kpi label="High discrepancy" value={fmt(k.highDiscrep)} tone="bad" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {CARDS[currency].map(g => {
          const mine = ops.filter(i => i.gateway === g.gateway)
          const low = mine.filter(i => i.kind === 'low').length, high = mine.filter(i => i.kind === 'high').length
          const other = mine.length - low - high
          const isBank = g.gateway === 'Local Bank'
          const live = isBank ? bankLoaded : rows.some(r => r.currency === currency && r.gateway === g.gateway)
          return (
            <Link key={g.name} to={g.to} className="card p-5 hover:border-brand-500">
              <div className="text-lg font-semibold">{g.name}</div>
              <div className="text-sm text-slate-500">{live ? 'Live — open the full monitoring view' : 'No data loaded yet'}</div>
              {live && <div className="mt-2 text-sm tabular-nums text-slate-700">Running balance {compact(isBank ? bankBalance : kpis(rows.filter(r => r.currency === currency && r.gateway === g.gateway)).rBal)}</div>}
              {live && <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                <span className={`rounded-full px-2 py-0.5 ${low ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{fmt(low)} low</span>
                <span className={`rounded-full px-2 py-0.5 ${high ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>{fmt(high)} high</span>
                {other > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-700">{fmt(other)} other alerts</span>}
              </div>}
            </Link>
          )
        })}
      </div>
    </>
  )
}
