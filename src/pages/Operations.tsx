import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, CheckCircle2, Download } from 'lucide-react'
import { PageTitle } from '../components/Layout'
import AgentTable, { Flag } from '../components/AgentTable'
import { Badge, Kpi, Section } from '../components/ui'
import { KIND_LABEL, KIND_TONE, OpsItem, OpsKind, buildOps, gatewayLabel } from '../lib/alerts'
import { compact, fmt, kpis } from '../lib/metrics'
import { useData } from '../lib/store'
import { GATEWAY_GROUPS } from '../lib/types'

const NoData = ({ loading }: { loading: boolean }) => (
  <div className="card p-10 text-center text-slate-500">{loading ? 'Loading data…' : <>No data loaded yet. Go to <Link className="text-brand-600 underline" to="/admin/data-sources">Admin → Data Sources</Link>.</>}</div>
)

/* ------------------------------------------------------------------ All Agents ------------------------------------------------------------------ */

export function AllAgentsPage() {
  const { rows, loading } = useData()
  const [scope, setScope] = useState('ALL')
  const [flag, setFlag] = useState<Flag>('all')
  const scopes = useMemo(() => [...new Set(rows.map(r => `${r.currency}-${r.gateway}`))].sort(), [rows])
  const scoped = useMemo(() => (scope === 'ALL' ? rows : rows.filter(r => `${r.currency}-${r.gateway}` === scope)), [rows, scope])
  const k = useMemo(() => kpis(scoped), [scoped])
  const currencies = useMemo(() => [...new Set(scoped.map(r => r.currency))].sort(), [scoped])
  const single = scope === 'ALL' ? null : { currency: scope.split('-')[0], gateway: scope.split('-')[1] }
  const label = (key: string) => { const [c, g] = key.split('-'); return `${c} · ${gatewayLabel(g)}` }
  if (!rows.length) return <><PageTitle title="All Agents" /><NoData loading={loading} /></>
  return (
    <>
      <PageTitle title="All Agents" subtitle="Every agent account from every connected gateway. Bank accounts and INR merchants have their own pages." />
      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-200/60 p-1">
        {['ALL', ...scopes].map(s => (
          <button key={s} onClick={() => { setScope(s); setFlag('all') }}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${scope === s ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
            {s === 'ALL' ? 'All gateways' : label(s)} <span className="ml-1 text-xs text-slate-400">{fmt(s === 'ALL' ? rows.length : rows.filter(r => `${r.currency}-${r.gateway}` === s).length)}</span>
          </button>
        ))}
      </div>
      <Section title="Summary" right={<span className="text-xs text-slate-400">Balances are never added across currencies</span>}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
          <Kpi label="Accounts" value={fmt(k.accounts)} sub={`${fmt(k.loggedIn)} active`} />
          {currencies.map(c => { const ck = kpis(scoped.filter(r => r.currency === c)); return <Kpi key={c} label={`${c} running balance`} value={compact(ck.rBal)} sub={fmt(ck.rBal, 2)} tone="info" /> })}
          <Kpi label="Low balance" value={fmt(k.low)} tone="bad" onClick={() => setFlag(flag === 'low' ? 'all' : 'low')} active={flag === 'low'} />
          <Kpi label="Higher balance" value={fmt(k.high)} tone="warn" onClick={() => setFlag(flag === 'high' ? 'all' : 'high')} active={flag === 'high'} />
          <Kpi label="High discrepancy" value={fmt(k.highDiscrep)} tone="bad" onClick={() => setFlag(flag === 'discrep' ? 'all' : 'discrep')} active={flag === 'discrep'} />
          <Kpi label="Limit exceeded" value={fmt(k.limitExceeded)} tone="warn" onClick={() => setFlag(flag === 'limit' ? 'all' : 'limit')} active={flag === 'limit'} />
        </div>
      </Section>
      <AgentTable key={scope} rows={scoped} showType={!single || (GATEWAY_GROUPS[scope]?.length ?? 1) > 1} showScope={!single} flag={flag} onFlag={setFlag}
        gateway={single?.gateway} currency={single?.currency} />
    </>
  )
}

/* ---------------------------------------------- Low balance / High balance / Alerts ---------------------------------------------- */

type Mode = 'low' | 'high' | 'alerts'
const COPY: Record<Mode, { title: string; subtitle: string; empty: string }> = {
  low: { title: 'Low Balance', subtitle: 'Agents, bank accounts, brand totals and merchants below their low threshold, across every gateway', empty: 'Nothing is below its low threshold.' },
  high: { title: 'High Balance', subtitle: 'Agents, bank accounts, brand totals and merchants above their higher-balance threshold, across every gateway', empty: 'Nothing is above its higher-balance threshold.' },
  alerts: { title: 'Alerts', subtitle: 'Everything that needs attention: low and higher balances, discrepancies, exceeded limits, stop dates and sheet errors', empty: 'No alerts right now.' },
}
type SortKey = 'currency' | 'gateway' | 'name' | 'balance' | 'kind'

export function OpsListPage({ mode }: { mode: Mode }) {
  const { rows, dataset, settings, loading } = useData()
  const copy = COPY[mode]
  const all = useMemo(() => buildOps(rows, dataset, settings), [rows, dataset, settings])
  const base = useMemo(() => (mode === 'alerts' ? all : all.filter(i => i.kind === mode)), [all, mode])
  const [currency, setCurrency] = useState('')
  const [source, setSource] = useState('')
  const [kind, setKind] = useState<OpsKind | ''>('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: mode === 'low' ? 'balance' : 'balance', dir: mode === 'low' ? 1 : -1 })
  const [page, setPage] = useState(0)
  const size = 50

  const currencies = useMemo(() => [...new Set(base.map(i => i.currency))].sort(), [base])
  const sources = useMemo(() => [...new Set(base.filter(i => !currency || i.currency === currency).map(i => i.gateway))].sort(), [base, currency])
  const kinds = useMemo(() => (Object.keys(KIND_LABEL) as OpsKind[]).filter(k => base.some(i => i.kind === k)), [base])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const out = base.filter(i => (!currency || i.currency === currency) && (!source || i.gateway === source) && (!kind || i.kind === kind) &&
      (!s || `${i.name} ${i.brand} ${i.detail}`.toLowerCase().includes(s)))
    const k = sort.key
    out.sort((a, b) => {
      if (k === 'balance') { if (a.balance === null && b.balance === null) return 0; if (a.balance === null) return 1; if (b.balance === null) return -1; return (a.balance - b.balance) * sort.dir }
      return String(a[k]).localeCompare(String(b[k])) * sort.dir
    })
    return out
  }, [base, currency, source, kind, q, sort])
  const pages = Math.max(1, Math.ceil(list.length / size))
  const cur = Math.min(page, pages - 1)
  const slice = list.slice(cur * size, cur * size + size)
  const reset = () => setPage(0)

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['Currency', 'Gateway', 'Brand', 'Account', 'Balance', 'Alert', 'Detail']
    const body = list.map((i: OpsItem) => [i.currency, gatewayLabel(i.gateway), i.brand, i.name, i.balance ?? '', KIND_LABEL[i.kind], i.detail].map(esc).join(','))
    const url = URL.createObjectURL(new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `${mode}-balance.csv`; a.click(); URL.revokeObjectURL(url)
  }
  const sortBy = (key: SortKey) => { setSort(s => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : key === 'balance' ? -1 : 1 })); reset() }
  const th = (key: SortKey, label: string, right?: boolean) => (
    <th className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 ${right ? 'text-right' : ''}`} onClick={() => sortBy(key)}>
      <span className="inline-flex items-center gap-1">{label}{sort.key === key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</span>
    </th>
  )

  if (!rows.length && !dataset?.sheets.length) return <><PageTitle title={copy.title} subtitle={copy.subtitle} /><NoData loading={loading} /></>
  return (
    <>
      <PageTitle title={copy.title} subtitle={copy.subtitle} />
      <Section title="By currency" right={<span className="text-xs text-slate-400">Click a currency to filter</span>}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Total" value={fmt(base.length)} sub={mode === 'alerts' ? `${fmt(new Set(base.map(i => i.name)).size)} accounts` : 'accounts'} tone={base.length ? 'warn' : 'good'} onClick={() => { setCurrency(''); setSource(''); reset() }} active={!currency} />
          {['BDT', 'PKR', 'INR'].map(c => <Kpi key={c} label={c} value={fmt(base.filter(i => i.currency === c).length)} tone={base.some(i => i.currency === c) ? 'warn' : 'default'}
            onClick={() => { setCurrency(currency === c ? '' : c); setSource(''); reset() }} active={currency === c} />)}
        </div>
      </Section>

      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <input className="input w-60" placeholder="Search account, brand, detail…" value={q} onChange={e => { setQ(e.target.value); reset() }} />
          <select className="input" value={currency} onChange={e => { setCurrency(e.target.value); setSource(''); reset() }}><option value="">All currencies</option>{currencies.map(c => <option key={c}>{c}</option>)}</select>
          <select className="input" value={source} onChange={e => { setSource(e.target.value); reset() }}><option value="">All gateways</option>{sources.map(g => <option key={g} value={g}>{gatewayLabel(g)}</option>)}</select>
          {mode === 'alerts' && <select className="input" value={kind} onChange={e => { setKind(e.target.value as OpsKind | ''); reset() }}><option value="">All alert types</option>{kinds.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>}
          <div className="ml-auto flex items-center gap-2 text-sm text-slate-500"><span>{fmt(list.length)} of {fmt(base.length)}</span><button className="btn" onClick={exportCsv} disabled={!list.length}><Download size={14} />CSV</button></div>
        </div>
        {!base.length ? (
          <div className="flex flex-col items-center gap-2 p-12 text-slate-500"><CheckCircle2 className="text-emerald-500" size={32} /><div>{copy.empty}</div></div>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
                {th('currency', 'Currency')}{th('gateway', 'Gateway')}{th('name', 'Account')}{th('balance', 'Balance', true)}{th('kind', 'Alert')}<th className="px-3 py-2">Detail</th><th /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {slice.map(i => (
                  <tr key={i.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-1.5">{i.currency}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">{gatewayLabel(i.gateway)}{i.brand && <span className="ml-1.5 text-xs text-slate-400">{i.brand}</span>}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-medium">{i.name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{i.balance === null ? <span className="text-slate-400">—</span> : <span className={i.balance < 0 ? 'text-rose-600' : ''}>{fmt(i.balance, 2)}</span>}</td>
                    <td className="px-3 py-1.5"><Badge tone={KIND_TONE[i.kind]}>{KIND_LABEL[i.kind]}</Badge></td>
                    <td className="px-3 py-1.5 text-slate-600">{i.detail}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right"><Link className="text-brand-600 hover:underline" to={i.to}>Open</Link></td>
                  </tr>
                ))}
                {!slice.length && <tr><td colSpan={7} className="p-10 text-center text-slate-400">Nothing matches these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {base.length > size && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 p-3 text-sm">
            <button className="btn" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Prev</button>
            <span className="text-slate-500">Page {cur + 1} / {pages}</span>
            <button className="btn" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</button>
          </div>
        )}
      </div>
    </>
  )
}
