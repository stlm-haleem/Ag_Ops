import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Download } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PageTitle } from '../components/Layout'
import { Badge, ChartCard, Empty, HealthBadge, Kpi, Section } from '../components/ui'
import { compact, fmt } from '../lib/metrics'
import { useData } from '../lib/store'
import { clock, minutesNow } from '../lib/localBank'
import { BdtAccount, BdtHours, Brand, NEAR_LIMIT, WORK_ZONE, WORK_ZONE_LABEL, bankTotals, hoursState, parseBdtLocalBank, shortDate } from '../lib/bdtLocalBank'
import { BDT_LOCALBANK_SHEET } from '../lib/types'

type BrandSel = 'ALL' | Brand
type Flag = 'all' | 'dpOver' | 'wdOver' | 'near' | 'high' | 'low' | 'breach'
type Sortable = string | number | null

const dash = <span className="text-slate-400">—</span>
const money = (n: number) => <span className={n < 0 ? 'text-rose-600' : ''}>{fmt(n, 2)}</span>
const maskAcct = (n: string) => (n.length > 4 ? `••••${n.slice(-4)}` : n)

/** Re-renders every 30 s so the open / closed badges follow the clock. */
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(t) }, [])
  return now
}

function HoursCell({ h, now, kind }: { h: BdtHours; now: Date; kind: 'Deposit' | 'Withdrawal' }) {
  const s = hoursState(h, now)
  return (
    <div className="space-y-0.5" title={`${kind} hours as written in the sheet: ${h.text || '—'} (${WORK_ZONE_LABEL})`}>
      {s.state === 'open' && <Badge tone="green">Open</Badge>}
      {s.state === 'always' && <Badge tone="green">Open · 24 hrs</Badge>}
      {s.state === 'closed' && <Badge tone="slate">Closed</Badge>}
      {s.state === 'unknown' && <Badge tone="amber">Hours unclear</Badge>}
      <div className="text-[11px] leading-4 text-slate-500">{s.state === 'unknown' ? (h.text || 'No hours given') : s.label}{s.next ? ` · ${s.next}` : ''}</div>
    </div>
  )
}

/** Today's amount against the daily limit: "120,000 / 300,000" with a bar that turns amber at 80% and red above 100%. */
function UseBar({ amount, limit, use }: { amount: number | null; limit: number; use: number | null }) {
  if (amount === null) return dash
  if (limit <= 0) return <span className="tabular-nums">{fmt(amount, 2)}</span>
  const pct = (use ?? 0) * 100
  const tone = pct > 100 ? 'bg-rose-500' : pct >= NEAR_LIMIT * 100 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="min-w-[8.5rem]" title={`${fmt(amount, 2)} of ${fmt(limit, 2)}`}>
      <div className="flex justify-between gap-2 text-xs tabular-nums"><span className={pct > 100 ? 'font-semibold text-rose-600' : ''}>{fmt(amount)}</span><span className="text-slate-400">/ {fmt(limit)}</span></div>
      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <div className="text-[10px] text-slate-400">{pct.toFixed(0)}%</div>
    </div>
  )
}

interface Col { label: string; num?: boolean; sort: (a: BdtAccount) => Sortable; render: (a: BdtAccount) => React.ReactNode }

export default function BdtLocalBankPage() {
  const { dataset, settings, loading } = useData()
  const now = useNow()
  const [brand, setBrand] = useState<BrandSel>('ALL')
  const [bankSel, setBankSel] = useState('')
  const [showUnused, setShowUnused] = useState(true)
  const [flag, setFlag] = useState<Flag>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ label: string; dir: 1 | -1 }>({ label: 'Balance', dir: -1 })

  const sheet = dataset?.sheets.find(s => s.name === BDT_LOCALBANK_SHEET)
  // `now` is read at parse time so "today" follows the clock (Sri Lanka date); the parse is cheap and re-runs every 30 s.
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: WORK_ZONE }).format(now)
  const data = useMemo(() => parseBdtLocalBank(sheet, settings, new Date()), [sheet, settings, todayKey])
  const th = settings.thresholds.BDT_LOCAL_BANK ?? { low: 0, high: 0, discrep: 0 }
  const balanceRules = th.low > 0 || th.high > 0

  const all = data.accounts
  const brandRows = useMemo(() => all.filter(a => brand === 'ALL' || a.brand === brand), [all, brand])
  const bankNames = useMemo(() => [...new Set(brandRows.map(a => a.bank))].sort(), [brandRows])
  const scoped = useMemo(() => brandRows.filter(a => (!bankSel || a.bank === bankSel) && (showUnused || !a.unused)), [brandRows, bankSel, showUnused])
  useEffect(() => { if (bankSel && !bankNames.includes(bankSel)) setBankSel('') }, [bankNames, bankSel])

  const hasToday = data.todayIdx >= 0
  const k = useMemo(() => ({
    dpOver: scoped.filter(a => a.dpExceeded).length,
    wdOver: scoped.filter(a => a.wdExceeded).length,
    near: scoped.filter(a => a.dpNear || a.wdNear).length,
    high: scoped.filter(a => a.health === 'high').length,
    low: scoped.filter(a => a.health === 'low').length,
    breach: scoped.filter(a => a.breaches.length > 0).length,
    breachDays: scoped.reduce((s, a) => s + a.breaches.length, 0),
    balance: scoped.reduce((s, a) => s + a.balance, 0),
    todayDp: scoped.reduce((s, a) => s + (a.todayDp ?? 0), 0),
    todayWd: scoped.reduce((s, a) => s + (a.todayWd ?? 0), 0),
    monthDp: scoped.reduce((s, a) => s + a.monthDp, 0),
    monthWd: scoped.reduce((s, a) => s + a.monthWd, 0),
    dpOpen: scoped.filter(a => { const s = hoursState(a.dpHours, now).state; return s === 'open' || s === 'always' }).length,
    wdOpen: scoped.filter(a => { const s = hoursState(a.wdHours, now).state; return s === 'open' || s === 'always' }).length,
    unclear: scoped.filter(a => a.dpHours.kind === 'unknown' || a.wdHours.kind === 'unknown').length,
  }), [scoped, now])
  const byBrand = useMemo(() => (['BAJI', 'JEETBUZZ'] as Brand[]).map(b => ({ brand: b, accounts: all.filter(a => a.brand === b), balance: all.filter(a => a.brand === b).reduce((s, a) => s + a.balance, 0) })), [all])
  const banks = useMemo(() => bankTotals(scoped), [scoped])

  // daily trend: every day up to today (or the last day that has data)
  const trend = useMemo(() => {
    const upTo = Math.max(data.todayIdx, data.lastDataIdx)
    return data.dates.slice(0, upTo + 1).map((d, i) => ({ date: d.label, Deposit: scoped.reduce((s, a) => s + a.dp[i], 0), Withdrawal: scoped.reduce((s, a) => s + a.wd[i], 0) }))
  }, [data, scoped])

  const events = useMemo(() => scoped.flatMap(a => a.breaches.map(b => ({ ...b, agent: a.agent, brand: a.brand, bank: a.bank }))).sort((x, y) => y.iso.localeCompare(x.iso) || x.agent.localeCompare(y.agent)), [scoped])

  const cols: Col[] = [
    { label: 'Agent', sort: a => a.agent, render: a => <span title={`Sheet row ${a.row}`}>{a.agent}</span> },
    { label: 'Brand', sort: a => a.brand, render: a => <Badge tone={a.brand === 'BAJI' ? 'blue' : 'purple'}>{a.brand}</Badge> },
    { label: 'Bank', sort: a => a.bank, render: a => a.bank },
    { label: 'Bank code', sort: a => a.bankCode, render: a => <span title={a.accountNumber ? `Account ${maskAcct(a.accountNumber)}` : 'Account number not available in the sheet'}>{a.bankCode}</span> },
    { label: 'DP hours (SL)', sort: a => (a.dpHours.kind === 'window' ? a.dpHours.start : -1), render: a => <HoursCell h={a.dpHours} now={now} kind="Deposit" /> },
    { label: 'WD hours (SL)', sort: a => (a.wdHours.kind === 'window' ? a.wdHours.start : -1), render: a => <HoursCell h={a.wdHours} now={now} kind="Withdrawal" /> },
    { label: 'Today DP / limit', sort: a => a.dpUse ?? a.todayDp, render: a => <UseBar amount={a.todayDp} limit={a.dpLimit} use={a.dpUse} /> },
    { label: 'Today WD / limit', sort: a => a.wdUse ?? a.todayWd, render: a => <UseBar amount={a.todayWd} limit={a.wdLimit} use={a.wdUse} /> },
    { label: 'Month DP', num: true, sort: a => a.monthDp, render: a => money(a.monthDp) },
    { label: 'Month WD', num: true, sort: a => a.monthWd, render: a => money(a.monthWd) },
    { label: 'Breach days', num: true, sort: a => a.breaches.length, render: a => (a.breaches.length ? <span className="font-semibold text-amber-600">{a.breaches.length}</span> : <span className="text-slate-400">0</span>) },
    { label: 'Balance', num: true, sort: a => a.balance, render: a => money(a.balance) },
    { label: 'Balance flag', sort: a => a.health, render: a => (a.unused ? <Badge>Unused</Badge> : a.health === 'na' ? dash : <HealthBadge h={a.health} />) },
    { label: 'Last activity', sort: a => a.lastActive, render: a => (a.lastActive ? shortDate(a.lastActive) : dash) },
    { label: 'Alerts', sort: a => Number(a.dpExceeded) + Number(a.wdExceeded), render: a => (
      <span className="flex flex-wrap gap-1">
        {a.dpExceeded && <Badge tone="red">DP over limit</Badge>}
        {a.wdExceeded && <Badge tone="red">WD over limit</Badge>}
        {!a.dpExceeded && a.dpNear && <Badge tone="amber">DP near limit</Badge>}
        {!a.wdExceeded && a.wdNear && <Badge tone="amber">WD near limit</Badge>}
      </span>) },
  ]

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const out = scoped.filter(a =>
      (!s || [a.agent, a.bankCode, a.bank, a.brand].some(x => x.toLowerCase().includes(s))) &&
      (flag === 'all' || (flag === 'dpOver' && a.dpExceeded) || (flag === 'wdOver' && a.wdExceeded) || (flag === 'near' && (a.dpNear || a.wdNear)) ||
        (flag === 'high' && a.health === 'high') || (flag === 'low' && a.health === 'low') || (flag === 'breach' && a.breaches.length > 0)))
    const col = cols.find(c => c.label === sort.label) ?? cols[0]
    out.sort((a, b) => {
      const x = col.sort(a), y = col.sort(b)
      if (x === null && y === null) return 0
      if (x === null) return 1
      if (y === null) return -1
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, q, flag, sort, now])

  if (!sheet || !all.length) return (
    <>
      <PageTitle title="BDT · Local Bank" />
      <div className="card p-10 text-center text-slate-500">
        {loading ? 'Loading data…' : !sheet ? <>The <b>{BDT_LOCALBANK_SHEET}</b> tab has not been loaded yet. Check that the Apps Script has the BDT Local Bank sync installed (run <code>setupBDTLocalBankFiveMinuteSync</code>) and that the tab exists, then reload.</> : 'The tab was loaded but no bank accounts were recognised.'}
        {sheet && data.problems.length > 0 && <div className="mx-auto mt-4 max-w-3xl rounded-lg bg-amber-50 p-3 text-left text-xs text-amber-800">{data.problems.map(p => <div key={p}>{p}</div>)}</div>}
      </div>
    </>
  )

  const pick = (f: Flag) => setFlag(flag === f ? 'all' : f)
  const nowClock = clock(minutesNow(WORK_ZONE, now))
  const first = data.dates[0], last = data.dates[data.dates.length - 1]
  const off = (n: number) => (hasToday ? fmt(n) : '—')
  const offSub = hasToday ? undefined : 'Today is not in this sheet'

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['Agent', 'Brand', 'Bank', 'Bank code', 'TIME DP', 'TIME WD', 'DP limit', 'WD limit', 'Today DP', 'Today WD', 'Month DP', 'Month WD', 'Breach days', 'Balance', 'Balance flag', 'Last activity']
    const lines = rows.map(a => [a.agent, a.brand, a.bank, a.bankCode, a.dpHours.text, a.wdHours.text, a.dpLimit, a.wdLimit, a.todayDp ?? '', a.todayWd ?? '', a.monthDp, a.monthWd, a.breaches.length, a.balance, a.unused ? 'unused' : a.health, a.lastActive].map(esc).join(','))
    const url = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }))
    const el = document.createElement('a'); el.href = url; el.download = 'bdt-local-bank-accounts.csv'; el.click(); URL.revokeObjectURL(url)
  }

  const rollups = data.rollups.filter(r => (brand === 'ALL' || r.brand === brand) && (!bankSel || r.bank === bankSel))
  const rollGroups = (['BAJI', 'JEETBUZZ'] as Brand[]).flatMap(b => (['DAY', 'NIGHT'] as const).map(s => ({ brand: b, shift: s, items: rollups.filter(r => r.brand === b && r.shift === s) }))).filter(g => g.items.length)
  const todayOf = (v: number[]) => (hasToday ? v[data.todayIdx] : null)

  return (
    <>
      <PageTitle title="BDT · Local Bank" subtitle="BAJI and JEETBUZZ bank accounts — daily DP / WD limits, working hours, balances and deposits / withdrawals"
        right={<div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600 shadow-sm ring-1 ring-slate-200" title="TIME DP / TIME WD in the sheet and the 'today' column are read in Sri Lanka time.">
          Now <b className="tabular-nums">{nowClock}</b> {WORK_ZONE_LABEL} · today <b className="tabular-nums">{shortDate(data.today)}</b></div>} />

      {!hasToday && (
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
          Today ({data.today}, Sri Lanka) is not inside this sheet's dates ({first.label} → {last.label}). Today's figures and limit alerts are switched off until the tab rolls over; month totals still show.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
        <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-slate-200">
          {(['ALL', 'BAJI', 'JEETBUZZ'] as BrandSel[]).map(b => (
            <button key={b} onClick={() => setBrand(b)} className={`px-3 py-1.5 text-sm font-medium ${brand === b ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {b === 'ALL' ? 'All' : b}<span className={`ml-1.5 text-xs ${brand === b ? 'text-white/80' : 'text-slate-400'}`}>{fmt(all.filter(a => b === 'ALL' || a.brand === b).length)}</span>
            </button>))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={showUnused} onChange={e => setShowUnused(e.target.checked)} />
          <span>Show unused accounts</span><span className="text-xs text-slate-400">{fmt(all.filter(a => a.unused).length)}</span>
        </label>
        <select className="input ml-auto" value={bankSel} onChange={e => setBankSel(e.target.value)}>
          <option value="">All banks</option>{bankNames.map(b => <option key={b}>{b}</option>)}
        </select>
      </div>

      <Section title="Alerts (click to filter the table)" right={<span className="text-xs text-slate-400">Near limit = {NEAR_LIMIT * 100}% or more of the daily limit · Low &lt; {th.low > 0 ? fmt(th.low) : 'off'} · High &gt; {th.high > 0 ? fmt(th.high) : 'off'} (Settings)</span>}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Kpi label="DP limit exceeded" value={off(k.dpOver)} tone="bad" sub={offSub ?? "Today's deposits above the daily DP limit"} onClick={() => pick('dpOver')} active={flag === 'dpOver'} />
          <Kpi label="WD limit exceeded" value={off(k.wdOver)} tone="bad" sub={offSub ?? "Today's withdrawals above the daily WD limit"} onClick={() => pick('wdOver')} active={flag === 'wdOver'} />
          <Kpi label="Near limit" value={off(k.near)} tone="warn" sub={offSub ?? `Today's DP or WD at ${NEAR_LIMIT * 100}%–100% of the limit`} onClick={() => pick('near')} active={flag === 'near'} />
          <Kpi label="Higher balance" value={th.high > 0 ? fmt(k.high) : '—'} tone="warn" sub={th.high > 0 ? `Running balance above ${fmt(th.high)}` : 'Set the higher threshold in Settings'} onClick={() => pick('high')} active={flag === 'high'} />
          <Kpi label="Low balance" value={th.low > 0 ? fmt(k.low) : '—'} tone="bad" sub={th.low > 0 ? `Running balance below ${fmt(th.low)}` : 'Set the low threshold in Settings'} onClick={() => pick('low')} active={flag === 'low'} />
          <Kpi label="Limit breaches this month" value={fmt(k.breach)} tone="warn" sub={`${fmt(k.breachDays)} account-days over a daily limit`} onClick={() => pick('breach')} active={flag === 'breach'} />
        </div>
      </Section>

      <Section title="Today & this month" right={<span className="text-xs text-slate-400">Sheet dates {first.label} → {last.label} · last day with data {data.lastDataIdx >= 0 ? data.dates[data.lastDataIdx].label : '—'}</span>}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
          <Kpi label="Today deposit" value={hasToday ? compact(k.todayDp) : '—'} sub={hasToday ? fmt(k.todayDp, 2) : offSub} tone="good" />
          <Kpi label="Today withdrawal" value={hasToday ? compact(k.todayWd) : '—'} sub={hasToday ? fmt(k.todayWd, 2) : offSub} />
          <Kpi label="Month deposit" value={compact(k.monthDp)} sub={fmt(k.monthDp, 2)} tone="good" />
          <Kpi label="Month withdrawal" value={compact(k.monthWd)} sub={fmt(k.monthWd, 2)} />
          <Kpi label="Deposit open now" value={`${fmt(k.dpOpen)} / ${fmt(scoped.length)}`} tone="good" sub={k.unclear ? `${fmt(k.unclear)} with unclear hours` : 'By TIME DP'} />
          <Kpi label="Withdrawal open now" value={`${fmt(k.wdOpen)} / ${fmt(scoped.length)}`} tone="good" sub="By TIME WD" />
          <Kpi label="Running balance" value={compact(k.balance)} sub={fmt(k.balance, 2)} tone="info" />
          <Kpi label="Accounts" value={fmt(scoped.length)} sub={`${fmt(scoped.filter(a => a.unused).length)} unused`} />
        </div>
      </Section>

      <Section title="Balance by brand" right={<span className="text-xs text-slate-400">Sum of each brand's Running Balance</span>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {byBrand.map(b => <Kpi key={b.brand} label={b.brand} value={compact(b.balance)} sub={`${fmt(b.balance, 2)} · ${fmt(b.accounts.length)} accounts`} tone="info" />)}
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title="Daily deposit vs withdrawal">
            {trend.length ? <ResponsiveContainer><BarChart data={trend}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" fontSize={11} /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: number) => fmt(v, 2)} /><Legend />
              <Bar dataKey="Deposit" fill="#10b981" radius={[4, 4, 0, 0]} /><Bar dataKey="Withdrawal" fill="#f43f5e" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <Empty>No activity yet</Empty>}
          </ChartCard>
        </div>
        <ChartCard title="Month deposit vs withdrawal per bank">
          <ResponsiveContainer><BarChart data={banks}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="bank" /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: number) => fmt(v, 2)} /><Legend />
            <Bar dataKey="monthDp" name="Deposit" fill="#10b981" radius={[4, 4, 0, 0]} /><Bar dataKey="monthWd" name="Withdrawal" fill="#f43f5e" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4">
        <div>
          <ChartCard title="Running balance per account">
            <ResponsiveContainer><BarChart data={scoped}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="agent" fontSize={10} interval={0} angle={-40} textAnchor="end" height={80} /><YAxis tickFormatter={compact} /><Tooltip formatter={(v: number) => fmt(v, 2)} />
              <Bar dataKey="balance" name="Running balance" fill="#6366f1" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          </ChartCard>
        </div>
        <div className="card overflow-auto">
          <div className="p-4 text-sm font-semibold text-slate-700">Bank summary</div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Bank', 'Accts', 'Today DP', 'Today WD', 'Month DP', 'Month WD', 'Balance'].map((h, i) => <th key={h} className={`whitespace-nowrap px-2 py-2 ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {banks.map(b => <tr key={b.bank}><td className="px-2 py-1.5 font-medium">{b.bank}</td><td className="px-2 py-1.5 text-right tabular-nums">{b.accounts}</td><td className="px-2 py-1.5 text-right tabular-nums">{hasToday ? fmt(b.todayDp) : '—'}</td><td className="px-2 py-1.5 text-right tabular-nums">{hasToday ? fmt(b.todayWd) : '—'}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmt(b.monthDp)}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmt(b.monthWd)}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmt(b.balance)}</td></tr>)}
              <tr className="bg-slate-50 font-semibold"><td className="px-2 py-1.5">Total</td><td className="px-2 py-1.5 text-right tabular-nums">{scoped.length}</td><td className="px-2 py-1.5 text-right tabular-nums">{hasToday ? fmt(k.todayDp) : '—'}</td><td className="px-2 py-1.5 text-right tabular-nums">{hasToday ? fmt(k.todayWd) : '—'}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmt(k.monthDp)}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmt(k.monthWd)}</td><td className="px-2 py-1.5 text-right tabular-nums">{fmt(k.balance)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <Section title="Accounts">
        <div className="card">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
            <input className="input w-64" placeholder="Search agent, bank, bank code…" value={q} onChange={e => setQ(e.target.value)} />
            <select className="input" value={flag} onChange={e => setFlag(e.target.value as Flag)}>
              <option value="all">All accounts</option>
              <option value="dpOver">DP limit exceeded</option>
              <option value="wdOver">WD limit exceeded</option>
              <option value="near">Near limit</option>
              <option value="high">Higher balance</option>
              <option value="low">Low balance</option>
              <option value="breach">Breached a limit this month</option>
            </select>
            <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
              <span>{fmt(rows.length)} of {fmt(all.length)} accounts</span>
              <button className="btn" onClick={exportCsv}><Download size={14} />CSV</button>
            </div>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>{cols.map((c, i) => (
                  <th key={c.label} className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 ${c.num ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 bg-slate-50' : ''}`}
                    onClick={() => setSort(s => ({ label: c.label, dir: s.label === c.label ? (-s.dir as 1 | -1) : -1 }))}>
                    <span className="inline-flex items-center gap-1">{c.label}{sort.label === c.label && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</span>
                  </th>))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(a => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    {cols.map((c, i) => <td key={c.label} className={`px-3 py-1.5 align-top ${c.num ? 'text-right tabular-nums' : 'whitespace-nowrap'} ${i === 0 ? 'sticky left-0 bg-white font-medium' : ''}`}>{c.render(a)}</td>)}
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={cols.length} className="p-10 text-center text-slate-400">No accounts match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <Section title="Limit breaches this month" right={<span className="text-xs text-slate-400">Every day an account went above its daily DP or WD limit · {fmt(events.length)} events</span>}>
        <div className="card max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{['Date', 'Agent', 'Brand', 'Bank', 'Type', 'Amount', 'Limit', 'Over by'].map((h, i) => <th key={h} className={`whitespace-nowrap px-3 py-2 ${i > 4 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {events.map((e, i) => (
                <tr key={`${e.agent}-${e.iso}-${e.kind}-${i}`} className="hover:bg-slate-50">
                  <td className="px-3 py-1.5 tabular-nums">{shortDate(e.iso)}</td><td className="px-3 py-1.5 font-medium">{e.agent}</td>
                  <td className="px-3 py-1.5"><Badge tone={e.brand === 'BAJI' ? 'blue' : 'purple'}>{e.brand}</Badge></td><td className="px-3 py-1.5">{e.bank}</td>
                  <td className="px-3 py-1.5"><Badge tone={e.kind === 'DP' ? 'green' : 'red'}>{e.kind === 'DP' ? 'Deposit' : 'Withdrawal'}</Badge></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(e.amount, 2)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(e.limit, 2)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-rose-600">{fmt(e.amount - e.limit, 2)}</td>
                </tr>))}
              {!events.length && <tr><td colSpan={8} className="p-8 text-center text-slate-400">No account went over a daily limit this month.</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Day / Night shift by bank (as in the sheet)" right={<span className="text-xs text-slate-400">The sheet's “Day Shift” block adds up every account of the bank; “Night Shift” is the accounts whose TIME DP runs past midnight</span>}>
        <div className="card overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{['Brand', 'Shift', 'Bank', 'Today DP', 'Today WD', 'Month DP', 'Month WD', 'Check'].map((h, i) => <th key={h} className={`whitespace-nowrap px-3 py-2 ${i > 2 && i < 7 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rollGroups.flatMap(g => {
                const tDp = g.items.reduce((s, r) => s + (todayOf(r.dp) ?? 0), 0), tWd = g.items.reduce((s, r) => s + (todayOf(r.wd) ?? 0), 0)
                const mDp = g.items.reduce((s, r) => s + r.dp.reduce((x, y) => x + y, 0), 0), mWd = g.items.reduce((s, r) => s + r.wd.reduce((x, y) => x + y, 0), 0)
                return [
                  ...g.items.map(r => {
                    const td = todayOf(r.dp), tw = todayOf(r.wd)
                    const accDp = r.expectedDp.reduce((x, y) => x + y, 0), accWd = r.expectedWd.reduce((x, y) => x + y, 0)
                    return (
                      <tr key={`${g.brand}-${g.shift}-${r.bank}`} className="hover:bg-slate-50">
                        <td className="px-3 py-1.5"><Badge tone={g.brand === 'BAJI' ? 'blue' : 'purple'}>{g.brand}</Badge></td>
                        <td className="px-3 py-1.5">{g.shift === 'DAY' ? 'Day' : 'Night'}</td><td className="px-3 py-1.5 font-medium">{r.bank}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{td === null ? '—' : fmt(td)}</td><td className="px-3 py-1.5 text-right tabular-nums">{tw === null ? '—' : fmt(tw)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.dp.reduce((x, y) => x + y, 0))}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.wd.reduce((x, y) => x + y, 0))}</td>
                        <td className="px-3 py-1.5">{r.matches ? <Badge tone="green">Matches accounts</Badge> : <span title={`Sheet row ${r.row}`}><Badge tone="red">Sheet differs</Badge> <span className="text-xs text-slate-500">accounts: DP {fmt(accDp)} · WD {fmt(accWd)}</span></span>}</td>
                      </tr>)
                  }),
                  <tr key={`${g.brand}-${g.shift}-total`} className="bg-slate-50 font-semibold">
                    <td className="px-3 py-1.5">{g.brand}</td><td className="px-3 py-1.5">{g.shift === 'DAY' ? 'Day' : 'Night'}</td><td className="px-3 py-1.5">Total</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{hasToday ? fmt(tDp) : '—'}</td><td className="px-3 py-1.5 text-right tabular-nums">{hasToday ? fmt(tWd) : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(mDp)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(mWd)}</td><td />
                  </tr>,
                ]
              })}
              {!rollGroups.length && <tr><td colSpan={8} className="p-8 text-center text-slate-400">No shift roll-up rows were found in the sheet.</td></tr>}
            </tbody>
          </table>
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
