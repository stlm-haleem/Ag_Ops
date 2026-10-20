import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowDown, ArrowUp, Download, RotateCcw, Save } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PageTitle } from '../components/Layout'
import { Badge, ChartCard, Empty, Kpi, Section } from '../components/ui'
import { InrBrandSummary, InrStatus, limitsError, merchantKey, parseInr } from '../lib/inr'
import { compact, fmt } from '../lib/metrics'
import { useData } from '../lib/store'
import { INR_BRANDS, INR_SHEET, InrBrand, InrLimits, InrSettings } from '../lib/types'

/* ------------------------------------------------------------------ threshold draft ------------------------------------------------------------------ */
// Thresholds are typed as text (so "50,000" can be pasted and a half-typed value is never rewritten under the cursor),
// shown live on the page, and only stored when the user presses Save.

type Pair = { low: string; high: string }
interface Draft { brands: Record<InrBrand, Pair>; merchants: Record<string, Pair> }

const asText = (n: number) => (n > 0 ? String(n) : '')
const toNum = (t: string) => { const s = t.replace(/[,\s]/g, ''); return s === '' ? 0 : Number(s) }
const pairOf = (l?: InrLimits): Pair => ({ low: asText(l?.low ?? 0), high: asText(l?.high ?? 0) })
const toDraft = (s: InrSettings): Draft => ({
  brands: Object.fromEntries(INR_BRANDS.map(b => [b, pairOf(s.brands[b])])) as Record<InrBrand, Pair>,
  merchants: Object.fromEntries(Object.entries(s.merchants).map(([k, v]) => [k, pairOf(v)])),
})
const numbers = (p: Pair) => ({ low: toNum(p.low), high: toNum(p.high) })
/** Settings as they would be stored: empty merchant pairs are dropped, invalid numbers become 0. */
const fromDraft = (d: Draft): InrSettings => {
  const safe = (p: Pair): InrLimits => { const n = numbers(p); return { low: Number.isFinite(n.low) && n.low > 0 ? n.low : 0, high: Number.isFinite(n.high) && n.high > 0 ? n.high : 0 } }
  const merchants: Record<string, InrLimits> = {}
  for (const [k, p] of Object.entries(d.merchants)) { const l = safe(p); if (l.low > 0 || l.high > 0) merchants[k] = l }
  return { brands: Object.fromEntries(INR_BRANDS.map(b => [b, safe(d.brands[b])])) as Record<InrBrand, InrLimits>, merchants }
}
const canon = (s: InrSettings) => JSON.stringify({ b: INR_BRANDS.map(b => [s.brands[b].low, s.brands[b].high]), m: Object.entries(s.merchants).sort(([a], [b]) => a.localeCompare(b)) })

/* ----------------------------------------------------------------------- bits ----------------------------------------------------------------------- */

const STATUS: Record<InrStatus, { label: string; tone: 'red' | 'amber' | 'green' | 'slate' }> = {
  low: { label: 'Low', tone: 'red' }, high: { label: 'High', tone: 'amber' }, ok: { label: 'Within limits', tone: 'green' },
  unset: { label: 'No limits set', tone: 'slate' }, na: { label: 'No balance', tone: 'slate' }, error: { label: 'Sheet error', tone: 'red' },
}
const StatusBadge = ({ s }: { s: InrStatus }) => <Badge tone={STATUS[s].tone}>{STATUS[s].label}</Badge>
const BRAND_COLOR: Record<InrBrand, string> = { BAJI: '#6366f1', JEETBUZZ: '#10b981', SIX6S: '#f59e0b' }
const dash = <span className="text-slate-400">—</span>
const money = (n: number) => <span className={n < 0 ? 'text-rose-600' : ''}>{fmt(n, 2)}</span>

function LimitInputs({ value, onChange, size = 'md', ariaLabel }: { value: Pair; onChange: (p: Pair) => void; size?: 'sm' | 'md'; ariaLabel: string }) {
  const err = limitsError(numbers(value))
  const cls = `input tabular-nums ${size === 'sm' ? 'w-28 py-1 text-xs' : 'w-full'} ${err ? 'border-rose-400 ring-1 ring-rose-300' : ''}`
  return (
    <>
      <input inputMode="decimal" className={cls} placeholder="Low" aria-label={`${ariaLabel} low`} value={value.low} onChange={e => onChange({ ...value, low: e.target.value })} />
      <input inputMode="decimal" className={cls} placeholder="High" aria-label={`${ariaLabel} high`} value={value.high} onChange={e => onChange({ ...value, high: e.target.value })} />
    </>
  )
}

function BrandCard({ b, pair, onChange }: { b: InrBrandSummary; pair: Pair; onChange: (p: Pair) => void }) {
  const lim = numbers(pair)
  const err = limitsError(lim)
  const pct = b.wdBalance !== null && lim.high > 0 ? Math.max(0, (b.wdBalance / lim.high) * 100) : null
  const bar = b.status === 'high' ? 'bg-amber-500' : b.status === 'low' ? 'bg-rose-500' : 'bg-emerald-500'
  return (
    <div className={`card space-y-3 p-4 ${b.status === 'high' ? 'border-amber-400 bg-amber-50' : b.status === 'low' || b.status === 'error' ? 'border-rose-300 bg-rose-50' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: BRAND_COLOR[b.brand] }} />{b.brand}</div>
        <StatusBadge s={b.status} />
      </div>
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Total WD balance</div>
        {b.wdBalance !== null
          ? <div className="mt-0.5 text-2xl font-semibold tabular-nums">{fmt(b.wdBalance, 2)}</div>
          : <div className="mt-1 flex items-start gap-1.5 text-sm text-rose-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{b.wdFound ? <>The sheet shows <b>{b.wdError}</b> for this amount. It is not compared with thresholds until it is fixed in INR-OVERVIEW and the CSV is uploaded again.</> : 'Not found in the Total WD Balance table.'}</span></div>}
        {b.wdRange && <div className="mt-0.5 text-xs text-slate-500">Current WD range {b.wdRange}</div>}
      </div>
      {pct !== null && <div>
        <div className="relative h-2 overflow-hidden rounded-full bg-slate-200"><div className={`h-full ${bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
          {lim.low > 0 && lim.high > lim.low && <div className="absolute top-0 h-full w-0.5 bg-slate-700/60" style={{ left: `${(lim.low / lim.high) * 100}%` }} title={`Low ${fmt(lim.low)}`} />}</div>
        <div className="mt-1 text-xs text-slate-500">{fmt(pct, 0)}% of the High limit ({compact(lim.high)})</div>
      </div>}
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-slate-500"><span>Low (alert below) · High (alert above)</span>
          {(pair.low || pair.high) && <button className="text-slate-400 hover:text-slate-700" onClick={() => onChange({ low: '', high: '' })}>Clear</button>}</div>
        <div className="grid grid-cols-2 gap-2"><LimitInputs value={pair} onChange={onChange} ariaLabel={`${b.brand} brand`} /></div>
        {err && <div className="mt-1 text-xs text-rose-600">{err}</div>}
      </div>
      <div className="space-y-0.5 border-t border-slate-200 pt-2 text-xs text-slate-500">
        <div className="flex justify-between"><span>Merchant balances (sheet total)</span><span className="tabular-nums text-slate-700">{fmt(b.sheetTotal ?? b.lineTotal, 2)}</span></div>
        {b.notInWd !== null && Math.abs(b.notInWd) >= 0.005 && <div className="flex justify-between"><span>Not included in Total WD balance</span><span className="tabular-nums text-slate-700">{fmt(b.notInWd, 2)}</span></div>}
      </div>
    </div>
  )
}

type Flag = 'all' | 'high' | 'low' | 'na'
type SortKey = 'brand' | 'merchant' | 'code' | 'balance' | 'status'
const RANK: Record<InrStatus, number> = { error: 0, low: 1, high: 2, ok: 3, unset: 4, na: 5 }

/* ------------------------------------------------------------------------ page ------------------------------------------------------------------------ */

export default function InrPage() {
  const { dataset, settings, loading, updateSettings } = useData()
  const sheet = dataset?.sheets.find(s => s.name === INR_SHEET)
  const savedKey = canon(settings.inr)
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings.inr))
  const draftSettings = useMemo(() => fromDraft(draft), [draft])
  const dirty = canon(draftSettings) !== savedKey
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  // Pick up thresholds that arrive from the server, but never overwrite what the user is typing.
  useEffect(() => { if (!dirty) setDraft(toDraft(settings.inr)) }, [savedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Everything on the page is rated against the draft, so a typed limit shows its effect at once; Save makes it permanent.
  const data = useMemo(() => parseInr(sheet, draftSettings), [sheet, draftSettings])
  const [tab, setTab] = useState<'ALL' | InrBrand>('ALL')
  const [flag, setFlag] = useState<Flag>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'balance', dir: -1 })

  const errors = useMemo(() => {
    const e: string[] = []
    for (const b of INR_BRANDS) { const m = limitsError(numbers(draft.brands[b])); if (m) e.push(`${b}: ${m}`) }
    for (const [k, p] of Object.entries(draft.merchants)) { const m = limitsError(numbers(p)); if (m) e.push(`${k.split('|').slice(0, 2).join(' · ')}: ${m}`) }
    return e
  }, [draft])

  const setBrandPair = (b: InrBrand, p: Pair) => { setNote(null); setDraft(d => ({ ...d, brands: { ...d.brands, [b]: p } })) }
  const setLinePair = (key: string, p: Pair) => { setNote(null); setDraft(d => ({ ...d, merchants: { ...d.merchants, [key]: p } })) }
  const save = async () => {
    if (errors.length) return
    setSaving(true)
    try {
      const r = await updateSettings({ ...settings, inr: draftSettings })
      setNote(r?.synced === false
        ? { ok: false, text: 'Saved in this browser only: the server could not be reached, so other devices will not see these thresholds yet. Save again when the connection is back.' }
        : { ok: true, text: 'Thresholds saved.' })
    } finally { setSaving(false) }
  }
  useEffect(() => { if (!note?.ok) return; const t = window.setTimeout(() => setNote(null), 4000); return () => window.clearTimeout(t) }, [note])
  const discard = () => { setDraft(toDraft(settings.inr)); setNote(null) }

  const shownBrands = useMemo(() => data.brands.filter(b => tab === 'ALL' || b.brand === tab), [data, tab])
  const lines = useMemo(() => shownBrands.flatMap(b => b.lines), [shownBrands])
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const out = lines.filter(l => (!s || `${l.merchant} ${l.code} ${l.brand}`.toLowerCase().includes(s)) &&
      (flag === 'all' || (flag === 'high' && l.status === 'high') || (flag === 'low' && l.status === 'low') || (flag === 'na' && l.balance === null)))
    const k = sort.key
    out.sort((a, b) => {
      if (k === 'balance') { if (a.balance === null && b.balance === null) return 0; if (a.balance === null) return 1; if (b.balance === null) return -1; return (a.balance - b.balance) * sort.dir }
      if (k === 'status') return (RANK[a.status] - RANK[b.status]) * sort.dir
      return String(a[k]).localeCompare(String(b[k])) * sort.dir
    })
    return out
  }, [lines, q, flag, sort])

  const k = useMemo(() => {
    const wdOk = shownBrands.filter(b => b.wdBalance !== null)
    return {
      wd: wdOk.reduce((s, b) => s + (b.wdBalance ?? 0), 0),
      wdMissing: shownBrands.filter(b => b.wdBalance === null).map(b => b.brand),
      available: shownBrands.reduce((s, b) => s + b.lineTotal, 0),
      brandHigh: shownBrands.filter(b => b.status === 'high').length, brandLow: shownBrands.filter(b => b.status === 'low').length,
      brandErr: shownBrands.filter(b => b.status === 'error').length,
      lineHigh: lines.filter(l => l.status === 'high').length, lineLow: lines.filter(l => l.status === 'low').length,
    }
  }, [shownBrands, lines])

  const merchantChart = useMemo(() => {
    const m = new Map<string, Record<string, number | string>>()
    for (const b of shownBrands) {
      const dup = new Set(b.lines.map(l => l.merchant).filter((x, i, a) => a.indexOf(x) !== i))
      for (const l of b.lines) {
        const name = dup.has(l.merchant) ? `${l.merchant} (${l.code})` : l.merchant
        const row = m.get(name) ?? { name }
        row[b.brand] = ((row[b.brand] as number) ?? 0) + (l.balance ?? 0)
        m.set(name, row)
      }
    }
    const total = (r: Record<string, number | string>) => INR_BRANDS.reduce((s, b) => s + ((r[b] as number) ?? 0), 0)
    return [...m.values()].sort((a, b) => total(b) - total(a))
  }, [shownBrands])
  const compareChart = useMemo(() => shownBrands.map(b => ({ brand: b.brand, wd: b.wdBalance ?? undefined, merchants: b.lineTotal })), [shownBrands])
  const share = useMemo(() => data.brands.map(b => ({ name: b.brand, value: Math.max(0, b.lineTotal), color: BRAND_COLOR[b.brand] })).filter(x => x.value > 0), [data])

  if (!sheet || !data.brands.some(b => b.lines.length || b.wdFound)) return (
    <>
      <PageTitle title="INR · Overview" />
      <div className="card p-10 text-center text-slate-500">
        {loading ? 'Loading data…' : !sheet
          ? <>The <b>{INR_SHEET}</b> data has not been uploaded yet. Download the <b>INR-OVERVIEW</b> tab from the main Google Sheet as CSV (for example <span className="font-mono">MAIN_AN - INR-OVERVIEW.csv</span>) and upload it in <Link className="text-brand-600 underline" to="/admin/data-sources">Admin → Data Sources</Link>. The file name only needs to contain “INR”.</>
          : 'The file was loaded but no INR merchant balances or Total WD Balance table were recognised.'}
        {sheet && data.problems.length > 0 && <div className="mx-auto mt-4 max-w-3xl rounded-lg bg-amber-50 p-3 text-left text-xs text-amber-800">{data.problems.map(p => <div key={p}>{p}</div>)}</div>}
      </div>
    </>
  )

  const failing = data.checks.filter(c => !c.ok)
  const sortBy = (key: SortKey) => setSort(s => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : key === 'balance' ? -1 : 1 }))
  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['Brand', 'Merchant', 'Merchant code', 'Available balance', 'Low limit', 'High limit', 'Status']
    const body = rows.map(l => [l.brand, l.merchant, l.code, l.balance ?? '', l.limits.low || '', l.limits.high || '', STATUS[l.status].label].map(esc).join(','))
    const url = URL.createObjectURL(new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'inr-merchant-balances.csv'; a.click(); URL.revokeObjectURL(url)
  }
  const th = (key: SortKey, label: string, right?: boolean) => (
    <th className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 ${right ? 'text-right' : ''}`} onClick={() => sortBy(key)}>
      <span className="inline-flex items-center gap-1">{label}{sort.key === key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</span>
    </th>
  )
  const pick = (f: Flag) => setFlag(flag === f ? 'all' : f)

  return (
    <>
      <PageTitle title="INR · Overview" subtitle="Merchant balances and Total WD (withdrawal) balance for BAJI, JEETBUZZ and SIX6S"
        right={dataset?.updatedAt ? <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600 shadow-sm ring-1 ring-slate-200">Data loaded {new Date(dataset.updatedAt).toLocaleString()}</div> : undefined} />

      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-200/60 p-1">
        {(['ALL', ...INR_BRANDS] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setFlag('all') }}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === t ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
            {t === 'ALL' ? 'All' : t} <span className="ml-1 text-xs text-slate-400">{fmt(t === 'ALL' ? data.lines.length : data.brands.find(b => b.brand === t)?.lines.length ?? 0)}</span>
          </button>
        ))}
      </div>

      {(k.brandErr > 0 || failing.some(c => !c.label.includes('Total WD'))) && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>{failing.map(c => <div key={c.label}><b>{c.label}.</b> {c.detail}</div>)}</div></div>
      )}

      <Section title="Total WD balance by brand" right={<span className="text-xs text-slate-400">Type a Low / High limit: it shows at once, and applies for everyone after you press Save</span>}>
        <div className={`grid gap-3 ${shownBrands.length === 1 ? 'md:grid-cols-1 xl:grid-cols-2' : 'md:grid-cols-3'}`}>
          {shownBrands.map(b => <BrandCard key={b.brand} b={b} pair={draft.brands[b.brand]} onChange={p => setBrandPair(b.brand, p)} />)}
        </div>
      </Section>

      <Section title="Alerts (click a merchant alert to filter the table)">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Kpi label="Total WD balance" value={compact(k.wd)} sub={k.wdMissing.length ? `Excludes ${k.wdMissing.join(', ')} (sheet error)` : fmt(k.wd, 2)} tone="info" />
          <Kpi label="Merchant balances" value={compact(k.available)} sub={fmt(k.available, 2)} />
          <Kpi label="Brands above High" value={fmt(k.brandHigh)} tone="warn" sub="Total WD balance" />
          <Kpi label="Brands below Low" value={fmt(k.brandLow)} tone="bad" sub="Total WD balance" />
          <Kpi label="Merchants above High" value={fmt(k.lineHigh)} tone="warn" sub="Needs a merchant limit" onClick={() => pick('high')} active={flag === 'high'} />
          <Kpi label="Merchants below Low" value={fmt(k.lineLow)} tone="bad" sub="Needs a merchant limit" onClick={() => pick('low')} active={flag === 'low'} />
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title="Available balance by merchant" height={Math.max(240, merchantChart.length * 44 + 60)}>
            {merchantChart.length ? <ResponsiveContainer><BarChart data={merchantChart} layout="vertical" margin={{ left: 30 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={compact} /><YAxis type="category" dataKey="name" width={110} fontSize={11} /><Tooltip formatter={(v: number) => fmt(v, 2)} /><Legend />
              {INR_BRANDS.filter(b => tab === 'ALL' || tab === b).map(b => <Bar key={b} dataKey={b} stackId="a" name={b} fill={BRAND_COLOR[b]} />)}</BarChart></ResponsiveContainer> : <Empty>No merchant balances</Empty>}
          </ChartCard>
        </div>
        <div className="space-y-4">
          <ChartCard title="Total WD balance vs merchant balances" height={240}>
            <ResponsiveContainer><BarChart data={compareChart}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="brand" fontSize={10} /><YAxis tickFormatter={compact} width={48} /><Tooltip formatter={(v: number) => fmt(v, 2)} /><Legend />
              <Bar dataKey="wd" name="Total WD" fill="#6366f1" radius={[4, 4, 0, 0]} /><Bar dataKey="merchants" name="Merchants" fill="#94a3b8" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Merchant balance share by brand" height={200}>
            {share.length ? <ResponsiveContainer><PieChart><Pie data={share} dataKey="value" nameKey="name" innerRadius={38} outerRadius={64} paddingAngle={2}>{share.map(p => <Cell key={p.name} fill={p.color} />)}</Pie><Tooltip formatter={(v: number) => fmt(v, 2)} /><Legend /></PieChart></ResponsiveContainer> : <Empty>No data</Empty>}
          </ChartCard>
        </div>
      </div>

      <Section title="Merchant balances">
        <div className="card">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
            <input className="input w-60" placeholder="Search merchant, code, brand…" value={q} onChange={e => setQ(e.target.value)} />
            <select className="input" value={flag} onChange={e => setFlag(e.target.value as Flag)}>
              <option value="all">All balances</option><option value="high">Above High</option><option value="low">Below Low</option><option value="na">No balance entered</option>
            </select>
            <span className="text-xs text-slate-400">Optional per-merchant Low / High: leave blank for no alert</span>
            <div className="ml-auto flex items-center gap-2 text-sm text-slate-500"><span>{fmt(rows.length)} of {fmt(lines.length)} lines</span><button className="btn" onClick={exportCsv}><Download size={14} />CSV</button></div>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
                {th('brand', 'Brand')}{th('merchant', 'Merchant')}{th('code', 'Code')}{th('balance', 'Available balance', true)}
                <th className="px-3 py-2">Low · High limit</th>{th('status', 'Status')}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(l => {
                  const key = merchantKey(l.brand, l.merchant, l.code)
                  const pair = draft.merchants[key] ?? { low: '', high: '' }
                  return (
                    <tr key={key} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-3 py-1.5"><Badge tone="purple">{l.brand}</Badge></td>
                      <td className="whitespace-nowrap px-3 py-1.5 font-medium">{l.merchant}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{l.code || dash}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.balance === null ? dash : money(l.balance)}</td>
                      <td className="px-3 py-1.5"><div className="flex gap-1.5"><LimitInputs size="sm" value={pair} onChange={p => setLinePair(key, p)} ariaLabel={`${l.brand} ${l.merchant} ${l.code}`} /></div></td>
                      <td className="px-3 py-1.5"><StatusBadge s={l.status} /></td>
                    </tr>
                  )
                })}
                {!rows.length && <tr><td colSpan={6} className="p-10 text-center text-slate-400">No merchant lines match these filters.</td></tr>}
              </tbody>
              {rows.length > 0 && <tfoot className="bg-slate-50 font-semibold"><tr><td className="px-3 py-2" colSpan={3}>Total of the lines shown</td><td className="px-3 py-2 text-right tabular-nums">{fmt(rows.reduce((s, l) => s + (l.balance ?? 0), 0), 2)}</td><td colSpan={2} /></tr></tfoot>}
            </table>
          </div>
        </div>
      </Section>

      <details className="card p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-slate-700">Data checks ({fmt(data.checks.filter(c => c.ok).length)} passed{failing.length ? `, ${fmt(failing.length)} need attention` : ''}{data.problems.length ? `, ${fmt(data.problems.length)} notes` : ''})</summary>
        <ul className="mt-3 space-y-1">
          {data.checks.map(c => <li key={c.label} className={c.ok ? 'text-slate-600' : 'text-rose-700'}>{c.ok ? '✓' : '✗'} {c.label} — {c.detail}</li>)}
          {data.problems.map(p => <li key={p} className="text-amber-700">⚠ {p}</li>)}
        </ul>
        <p className="mt-3 text-xs text-slate-400">The “Last Updated” column of Total WD Balance is empty in the sheet and is ignored. INR Local Bank is permanently closed and is not read. Total WD balance is shown exactly as the sheet prints it.</p>
      </details>

      {(dirty || note) && (
        <div className="sticky bottom-3 z-20 mx-auto w-full max-w-3xl">
          <div className={`card flex flex-wrap items-center gap-3 p-3 shadow-lg ${dirty ? 'border-brand-500' : ''}`}>
            {dirty ? <>
              <div className="min-w-0 flex-1 text-sm">{errors.length ? <span className="text-rose-700">Fix before saving: {errors.join(' · ')}</span> : <span className="text-slate-700"><b>Unsaved threshold changes.</b> The page above already shows their effect.</span>}</div>
              <button className="btn" onClick={discard} disabled={saving}><RotateCcw size={14} />Discard</button>
              <button className="btn-primary" onClick={save} disabled={saving || errors.length > 0}><Save size={14} />{saving ? 'Saving…' : 'Save thresholds'}</button>
            </> : <div className={`flex-1 text-sm ${note!.ok ? 'text-emerald-700' : 'text-amber-700'}`}>{note!.text}</div>}
          </div>
        </div>
      )}
    </>
  )
}

