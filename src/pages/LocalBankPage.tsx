import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Download } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PageTitle } from '../components/Layout'
import { Badge, ChartCard, Empty, HealthBadge, Kpi, Section } from '../components/ui'
import { compact, fmt } from '../lib/metrics'
import { useData } from '../lib/store'
import { BankState, LocalBankAccount, clock, minutesNow, parseLocalBank, PHT_ZONE, PKT_ZONE, serviceState } from '../lib/localBank'
import { LOCALBANK_SHEET } from '../lib/types'

type Flag = 'all' | 'high' | 'low' | 'healthy' | 'limit' | 'stopdate'
type SortKey = keyof LocalBankAccount | 'hours'

const STATES: { value: BankState; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'TEMPORARY', label: 'Temporary stop' },
  { value: 'STOP', label: 'Stopped' },
]
const stateTone = (s: BankState) => (s === 'ACTIVE' ? 'green' : s === 'TEMPORARY' ? 'amber' : s === 'STOP' ? 'red' : 'slate') as 'green' | 'amber' | 'red' | 'slate'
const stateLabel = (a: LocalBankAccount) => (a.state === 'OTHER' ? a.statusText || '—' : STATES.find(s => s.value === a.state)!.label)
const money = (n: number) => <span className={n < 0 ? 'text-rose-600' : ''}>{fmt(n, 2)}</span>
const dash = <span className="text-slate-400">—</span>
const maskAcct = (n: string) => (n.length > 4 ? `••••${n.slice(-4)}` : n)

/** Re-renders every 30 s so the "in service now" badges follow the clock. */
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(t) }, [])
  return now
}

function HoursCell({ a, now }: { a: LocalBankAccount; now: Date }) {
  const s = serviceState(a.hours, now)
  // Only accounts that are ACTIVE can be "in service"; a stopped account shows its hours without a live badge.
  const live = a.state === 'ACTIVE'
  return (
    <div className="space-y-0.5" title={a.hoursText}>
      {live && s.state === 'open' && <Badge tone="green">In service now</Badge>}
      {live && s.state === 'always' && <Badge tone="green">In service · 24 hrs</Badge>}
      {live && s.state === 'closed' && <Badge tone="slate">Outside hours</Badge>}
      {live && s.state === 'unknown' && <Badge tone="amber">Hours unclear</Badge>}
      {!live && <Badge tone={stateTone(a.state)}>{stateLabel(a)}</Badge>}
      <div className="text-[11px] leading-4 text-slate-500">{s.state === 'unknown' ? (a.hoursText || 'No hours given') : s.label}{live && s.next ? ` · ${s.next}` : ''}</div>
    </div>
  )
}

export default function LocalBankPage() {
  const { dataset, settings, loading } = useData()
  const now = useNow()
  const [shown, setShown] = useState<Set<BankState>>(() => new Set<BankState>(['ACTIVE']))
  const [flag, setFlag] = useState<Flag>('all')
  const [q, setQ] = useState('')
  const [bankSel, setBankSel] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'closing', dir: -1 })

  const sheet = dataset?.sheets.find(s => s.name === LOCALBANK_SHEET)
  const data = useMemo(() => parseLocalBank(sheet, settings), [sheet, settings])
  const th = settings.thresholds.LOCAL_BANK
  const toggle = (v: BankState) => setShown(prev => { const n = new Set(prev); if (n.has(v)) n.delete(v); else n.add(v); return n })

  const all = data.accounts
  const statusRows = useMemo(() => all.filter(a => shown.has(a.state)), [all, shown])
  const scoped = useMemo(() => statusRows.filter(a => !bankSel || a.bank === bankSel), [statusRows, bankSel])
  const active = useMemo(() => scoped.filter(a => a.state === 'ACTIVE'), [scoped])

  const k = useMemo(() => ({
    accounts: scoped.length,
    active: active.length,
    closing: scoped.reduce((s, a) => s + a.closing, 0),
    opening: scoped.reduce((s, a) => s + a.opening, 0),
    sd: scoped.reduce((s, a) => s + a.securityDeposit, 0),
    high: scoped.filter(a => a.health === 'high').length,
    low: scoped.filter(a => a.health === 'low').length,
    limit: scoped.filter(a => a.limitExceeded).length,
    stopDate: scoped.filter(a => a.stopDateOnActive).length,
    baji: scoped.reduce((s, a) => s + (a.baji ?? 0), 0),
    jeetbuzz: scoped.reduce((s, a) => s + (a.jeetbuzz ?? 0), 0),
    six6s: scoped.reduce((s, a) => s + (a.six6s ?? 0), 0),
  }), [scoped, active])
  // Always about every stopped account, whatever the status filter says: this is money sitting idle.
  const stopped = useMemo(() => all.filter(a => a.section === 'STOP' || a.state === 'STOP' || a.state === 'TEMPORARY'), [all])
  const stoppedBal = stopped.reduce((s, a) => s + a.closing, 0)
  const svc = useMemo(() => active.map(a => serviceState(a.hours, now).state), [active, now])
  const inService = svc.filter(s => s === 'open' || s === 'always').length
  const unclear = svc.filter(s => s === 'unknown').length

  const bankNames = useMemo(() => [...new Set(all.map(a => a.bank))].sort(), [all])
  const totals = useMemo(() => ({
    monthDp: data.banks.reduce((s, b) => s + b.monthDp, 0), monthWd: data.banks.reduce((s, b) => s + b.monthWd, 0),
    todayDp: data.banks.reduce((s, b) => s + b.todayDp, 0), todayWd: data.banks.reduce((s, b) => s + b.todayWd, 0),
  }), [data.banks])
  const pie = [
    { name: 'Healthy', value: active.length - k.high - k.low, color: '#10b981' },
    { name: 'High', value: k.high, color: '#f59e0b' },
    { name: 'Low', value: k.low, color: '#ef4444' },
  ]

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const out = scoped.filter(a =>
      (!s || [a.agent, a.bankCode, a.accountName, a.leader, a.remarks].some(x => x.toLowerCase().includes(s))) &&
      (flag === 'all' || (flag === 'high' && a.health === 'high') || (flag === 'low' && a.health === 'low') || (flag === 'healthy' && a.health === 'healthy') ||
        (flag === 'limit' && a.limitExceeded) || (flag === 'stopdate' && a.stopDateOnActive)))
    const key = sort.key
    out.sort((a, b) => {
      const x = key === 'hours' ? a.hoursText : a[key], y = key === 'hours' ? b.hoursText : b[key]
      if (x === null && y === null) return 0
      if (x === null) return 1
      if (y === null) return -1
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir
    })
    return out
  }, [scoped, q, flag, sort])

  if (!sheet || !all.length) return (
    <>
      <PageTitle title="PKR · Local Bank" />
      <div className="card p-10 text-center text-slate-500">
        {loading ? 'Loading data…' : !sheet ? <>The <b>{LOCALBANK_SHEET}</b> tab has not been loaded yet. Check that the Apps Script has the Local Bank sync installed and that the tab exists, then reload.</> : 'The tab was loaded but no bank accounts were recognised.'}
        {sheet && data.problems.length > 0 && <div className="mx-auto mt-4 max-w-3xl rounded-lg bg-amber-50 p-3 text-left text-xs text-amber-800">{data.problems.map(p => <div key={p}>{p}</div>)}</div>}
      </div>
    </>
  )

  const pick = (f: Flag) => setFlag(flag === f ? 'all' : f)
  const nowPht = clock(minutesNow(PHT_ZONE, now)), nowPkt = clock(minutesNow(PKT_ZONE, now))
  const head: { key: SortKey; label: string; num?: boolean; render: (a: LocalBankAccount) => React.ReactNode }[] = [
    { key: 'agent', label: 'Agent', render: a => a.agent },
    { key: 'leader', label: 'Leader', render: a => a.leader || dash },
    { key: 'bankCode', label: 'Bank code', render: a => <span title={`Account ${maskAcct(a.accountNumber)}`}>{a.bankCode}</span> },
    { key: 'accountName', label: 'Account name', render: a => a.accountName || dash },
    { key: 'state', label: 'Status', render: a => <Badge tone={stateTone(a.state)}>{stateLabel(a)}</Badge> },
    { key: 'hours', label: 'Operation time', render: a => <HoursCell a={a} now={now} /> },
    { key: 'baji', label: 'BAJI', num: true, render: a => (a.baji === null ? dash : money(a.baji)) },
    { key: 'jeetbuzz', label: 'JEETBUZZ', num: true, render: a => (a.jeetbuzz === null ? dash : money(a.jeetbuzz)) },
    { key: 'six6s', label: 'SIX6S', num: true, render: a => (a.six6s === null ? dash : money(a.six6s)) },
    { key: 'opening', label: 'Opening', num: true, render: a => money(a.opening) },
    { key: 'closing', label: 'Closing balance', num: true, render: a => money(a.closing) },
    { key: 'health', label: 'Balance', render: a => (a.health === 'na' ? dash : <HealthBadge h={a.health} />) },
    { key: 'securityDeposit', label: 'Security deposit', num: true, render: a => (a.securityDeposit > 0 ? money(a.securityDeposit) : dash) },
    { key: 'todayDp', label: 'Today DP', num: true, render: a => money(a.todayDp) },
    { key: 'dpLimit', label: 'DP daily limit', num: true, render: a => (a.dpLimit > 0 ? money(a.dpLimit) : dash) },
    { key: 'todayWd', label: 'Today WD', num: true, render: a => money(a.todayWd) },
    { key: 'wdLimit', label: 'WD daily limit', num: true, render: a => (a.wdLimit > 0 ? money(a.wdLimit) : dash) },
    { key: 'monthDp', label: 'Month DP', num: true, render: a => (a.section === 'ACTIVE' ? money(a.monthDp) : dash) },
    { key: 'dateStart', label: 'Date start', render: a => a.dateStart || dash },
    { key: 'dateStop', label: 'Date stop', render: a => a.dateStop || dash },
    { key: 'limitExceeded', label: 'Alerts', render: a => (
      <span className="flex flex-wrap gap-1">
        {a.limitExceeded && <Badge tone="amber">Limit exceeded</Badge>}
        {a.stopDateOnActive && <Badge tone="red">Stop date on ACTIVE</Badge>}
      </span>) },
    { key: 'remarks', label: 'Remarks', render: a => a.remarks ? <span className="block max-w-xs truncate" title={a.remarks}>{a.remarks}</span> : dash },
  ]

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const cols = ['Agent', 'Leader', 'Bank code', 'Account name', 'Status', 'Operation time', 'BAJI', 'JEETBUZZ', 'SIX6S', 'Opening', 'Closing balance', 'Balance', 'Security deposit',
      'Today DP', 'DP daily limit', 'Today WD', 'WD daily limit', 'Month DP', 'Date start', 'Date stop', 'Limit exceeded', 'Stop date on ACTIVE', 'Remarks']
    const lines = rows.map(a => [a.agent, a.leader, a.bankCode, a.accountName, a.statusText, a.hoursText, a.baji ?? '', a.jeetbuzz ?? '', a.six6s ?? '', a.opening, a.closing, a.health, a.securityDeposit,
      a.todayDp, a.dpLimit, a.todayWd, a.wdLimit, a.monthDp, a.dateStart, a.dateStop, a.limitExceeded, a.stopDateOnActive, a.remarks].map(esc).join(','))
    const url = URL.createObjectURL(new Blob([[cols.join(','), ...lines].join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'local-bank-accounts.csv'; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageTitle title="PKR · Local Bank" subtitle="Bank accounts only — balances, deposits, withdrawals, limits and operation hours"
        right={<div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600 shadow-sm ring-1 ring-slate-200" title="Philippines time is UTC+8 and Pakistan time is UTC+5 (no daylight saving), so PHT is always PKT + 3 hours.">
          Now <b className="tabular-nums">{nowPht}</b> PHT · <b className="tabular-nums">{nowPkt}</b> PKT</div>} />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
        <span className="text-sm font-medium text-slate-600">Account status</span>
        {STATES.map(st => (
          <label key={st.value} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={shown.has(st.value)} onChange={() => toggle(st.value)} />
            <span>{st.label}</span><span className="text-xs text-slate-400">{fmt(all.filter(a => a.state === st.value).length)}</span>
          </label>
        ))}
        <select className="input ml-auto" value={bankSel} onChange={e => setBankSel(e.target.value)}>
          <option value="">All banks</option>{bankNames.map(b => <option key={b}>{b}</option>)}
        </select>
      </div>

      <Section title="Alerts (click to filter the table)" right={<span className="text-xs text-slate-400">Low &lt; {fmt(th.low)} · High &gt; security deposit (none: {fmt(th.high)}) (Settings)</span>}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Higher balance accounts" value={fmt(k.high)} tone="warn" sub="Closing balance above security deposit" onClick={() => pick('high')} active={flag === 'high'} />
          <Kpi label="Low balance accounts" value={fmt(k.low)} tone="bad" sub="Active, closing balance below low threshold" onClick={() => pick('low')} active={flag === 'low'} />
          <Kpi label="Limit exceeded" value={fmt(k.limit)} tone="warn" sub="Today's DP / WD above the daily limit" onClick={() => pick('limit')} active={flag === 'limit'} />
          <Kpi label="Stop date on ACTIVE" value={fmt(k.stopDate)} tone="bad" sub="Status ACTIVE but a stop date is filled in" onClick={() => pick('stopdate')} active={flag === 'stopdate'} />
        </div>
      </Section>

      <Section title="Banks — deposit & withdrawal" right={<span className="text-xs text-slate-400">Today = sheet's TODAY() at the last sync · Month = month to date</span>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {data.banks.map(b => <Kpi key={b.bank} label={b.bank} value={compact(b.monthDp)} tone="info"
            sub={`Month deposit · Withdrawal ${fmt(b.monthWd)} · Today ${fmt(b.todayDp)} / ${fmt(b.todayWd)}`} />)}
        </div>
      </Section>

      <Section title="Balances & flow">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
          <Kpi label="Accounts" value={fmt(k.accounts)} sub={`${fmt(k.active)} active`} />
          <Kpi label="Closing balance" value={compact(k.closing)} sub={fmt(k.closing, 2)} tone="info" />
          <Kpi label="Opening balance" value={compact(k.opening)} sub={fmt(k.opening, 2)} />
          <Kpi label="Security deposit" value={compact(k.sd)} sub={fmt(k.sd)} />
          <Kpi label="Month deposit" value={compact(totals.monthDp)} sub={fmt(totals.monthDp)} tone="good" />
          <Kpi label="Month withdrawal" value={compact(totals.monthWd)} sub={`${fmt(totals.monthWd)} (incl. special payments)`} />
          <Kpi label="In service now" value={`${fmt(inService)} / ${fmt(active.length)}`} tone="good" sub={unclear ? `${fmt(unclear)} with unclear hours` : 'Active accounts, by operation time'} />
          <Kpi label="Held in stopped accounts" value={compact(stoppedBal)} sub={`${fmt(stopped.length)} accounts · ${fmt(stoppedBal, 2)}`} tone={stoppedBal > 0 ? 'warn' : 'default'} />
        </div>
      </Section>

      <Section title="Balance by brand" right={<span className="text-xs text-slate-400">Active accounts listed in the sheet's brand summary</span>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label="BAJI" value={compact(k.baji)} sub={fmt(k.baji, 2)} tone="info" />
          <Kpi label="JEETBUZZ" value={compact(k.jeetbuzz)} sub={fmt(k.jeetbuzz, 2)} tone="info" />
          <Kpi label="SIX6S" value={compact(k.six6s)} sub={fmt(k.six6s, 2)} tone="info" />
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title="Closing balance vs security deposit">
            <ResponsiveContainer><BarChart data={scoped}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="agent" fontSize={10} interval={0} angle={-30} textAnchor="end" height={70} /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: number) => fmt(v, 2)} /><Legend />
              <Bar dataKey="closing" name="Closing balance" fill="#6366f1" radius={[4, 4, 0, 0]} /><Bar dataKey="securityDeposit" name="Security deposit" fill="#94a3b8" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          </ChartCard>
        </div>
        <ChartCard title="Balance health (active accounts)">
          {active.length ? <ResponsiveContainer><PieChart><Pie data={pie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>{pie.map(p => <Cell key={p.name} fill={p.color} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer> : <Empty>No active accounts</Empty>}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Month deposit vs withdrawal per bank">
          <ResponsiveContainer><BarChart data={data.banks}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="bank" /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: number) => fmt(v, 2)} /><Legend />
            <Bar dataKey="monthDp" name="Deposit" fill="#10b981" radius={[4, 4, 0, 0]} /><Bar dataKey="monthWd" name="Withdrawal" fill="#f43f5e" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
        </ChartCard>
        <div className="card overflow-auto">
          <div className="p-4 text-sm font-semibold text-slate-700">Bank summary</div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Bank', 'Today DP', 'Today WD', 'Month DP', 'Month WD'].map((h, i) => <th key={h} className={`whitespace-nowrap px-2 py-2 ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.banks.map(b => <tr key={b.bank}><td className="px-2 py-1.5 font-medium">{b.bank}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmt(b.todayDp)}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmt(b.todayWd)}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmt(b.monthDp)}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmt(b.monthWd)}</td></tr>)}
              <tr className="bg-slate-50 font-semibold"><td className="px-2 py-1.5">Total</td><td className="px-2 py-1.5 text-right tabular-nums">{fmt(totals.todayDp)}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmt(totals.todayWd)}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmt(totals.monthDp)}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmt(totals.monthWd)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <Section title="Accounts">
        <div className="card">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
            <input className="input w-64" placeholder="Search agent, bank code, name, remark…" value={q} onChange={e => setQ(e.target.value)} />
            <select className="input" value={flag} onChange={e => setFlag(e.target.value as Flag)}>
              <option value="all">All balances & alerts</option>
              <option value="high">Higher balance</option>
              <option value="low">Low balance</option>
              <option value="healthy">Healthy balance</option>
              <option value="limit">Limit exceeded</option>
              <option value="stopdate">Stop date on ACTIVE</option>
            </select>
            <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
              <span>{fmt(rows.length)} of {fmt(all.length)} accounts</span>
              <button className="btn" onClick={exportCsv}><Download size={14} />CSV</button>
            </div>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>{head.map((c, i) => (
                  <th key={c.label} className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 ${c.num ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 bg-slate-50' : ''}`}
                    onClick={() => setSort(s => ({ key: c.key, dir: s.key === c.key ? (-s.dir as 1 | -1) : -1 }))}>
                    <span className="inline-flex items-center gap-1">{c.label}{sort.key === c.key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</span>
                  </th>))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(a => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    {head.map((c, i) => <td key={c.label} className={`px-3 py-1.5 ${c.num ? 'text-right tabular-nums' : 'whitespace-nowrap'} ${i === 0 ? 'sticky left-0 bg-white font-medium' : ''}`}>{c.render(a)}</td>)}
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={head.length} className="p-10 text-center text-slate-400">No accounts match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <Section title="Data checks (sheet tables against each other)">
        <div className="card divide-y divide-slate-100 text-sm">
          {data.checks.map(c => (
            <div key={c.label} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <Badge tone={c.ok ? 'green' : 'red'}>{c.ok ? 'OK' : 'CHECK'}</Badge><span className="font-medium text-slate-700">{c.label}</span><span className="text-xs text-slate-500">{c.detail}</span>
            </div>
          ))}
          {data.problems.map(p => <div key={p} className="flex items-center gap-3 px-4 py-2"><Badge tone="amber">Layout</Badge><span className="text-slate-700">{p}</span></div>)}
          {!data.checks.length && !data.problems.length && <div className="px-4 py-3 text-slate-400">No checks available.</div>}
        </div>
      </Section>
    </>
  )
}
