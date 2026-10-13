import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Download } from 'lucide-react'
import { AgentRow, GROUP_LABEL } from '../lib/types'
import { fmt } from '../lib/metrics'
import { Badge, HealthBadge } from './ui'

const stateTone = (s: string) => (s === 'Logged In' || s === 'Active' ? 'green' : s === 'Logged Out' || s === 'Disabled' ? 'slate' : 'red') as 'green' | 'slate' | 'red'

export type Flag = 'all' | 'low' | 'high' | 'healthy' | 'discrep' | 'limit'
const PAGE_SIZES = [25, 50, 100, 250]

type Col = { key: keyof AgentRow | 'flags'; label: string; num?: boolean; render?: (r: AgentRow) => React.ReactNode; hideInGroup?: boolean; group?: string }

/** PKR-BKK wallet status cell: the status as text (Enable / Disable / Inactive). */
const walletTone = (v: string) => (v === 'Enable' ? 'green' : v === 'Disable' ? 'amber' : 'slate') as 'green' | 'amber' | 'slate'
const statusCell = (v: string) => v ? <Badge tone={walletTone(v)}>{v}</Badge> : <span className="text-slate-400">—</span>

const money = (n: number) => <span className={n < 0 ? 'text-rose-600' : ''}>{fmt(n, 2)}</span>

export default function AgentTable({ rows, showType, flag, onFlag, gateway, currency }: { rows: AgentRow[]; showType: boolean; flag: Flag; onFlag: (f: Flag) => void; gateway?: string; currency?: string }) {
  const isMcg = gateway === 'MCG'
  const isPkr = currency === 'PKR' && gateway === 'SSG'
  const isBkk = gateway === 'BKK'
  const secKey = isMcg ? 'code' : 'limitStatus'
  const [q, setQ] = useState('')
  const [wallet, setWallet] = useState('')
  const [shop, setShop] = useState('')
  const [login, setLogin] = useState('')
  const [limitStatus, setLimitStatus] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'rBal', dir: -1 })
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(50)

  const wallets = useMemo(() => [...new Set(rows.map(r => r.wallet))].sort(), [rows])
  const shops = useMemo(() => [...new Set(rows.map(r => r.shop))].filter(Boolean).sort(), [rows])
  const limitStatuses = useMemo(() => [...new Set(rows.map(r => r[secKey] as string))].filter(Boolean).sort(), [rows, secKey])
  const states = useMemo(() => [...new Set(rows.map(r => r.login))].filter(Boolean).sort(), [rows])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const out = rows.filter(r =>
      (!s || r.account.toLowerCase().includes(s) || r.shop.toLowerCase().includes(s) || r.remarks.toLowerCase().includes(s) || r.tags.toLowerCase().includes(s)) &&
      (!wallet || r.wallet === wallet) && (!shop || r.shop === shop) && (!login || r.login === login) && (!limitStatus || r[secKey] === limitStatus) &&
      (flag === 'all' || (flag === 'low' && r.health === 'low') || (flag === 'high' && r.health === 'high') || (flag === 'healthy' && r.health === 'healthy') ||
        (flag === 'discrep' && r.highDiscrep) || (flag === 'limit' && r.limitExceeded)))
    const k = sort.key as keyof AgentRow
    out.sort((a, b) => {
      const x = a[k], y = b[k]
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir
    })
    return out
  }, [rows, q, wallet, shop, login, limitStatus, flag, sort])

  const pages = Math.max(1, Math.ceil(filtered.length / size))
  const cur = Math.min(page, pages - 1)
  const slice = filtered.slice(cur * size, cur * size + size)

  const cols: Col[] = [
    { key: 'account', label: 'Account' },
    { key: 'group', label: 'Type', render: r => <Badge tone="purple">{GROUP_LABEL[r.group]}</Badge>, hideInGroup: true },
    { key: 'wallet', label: 'Wallet' },
    { key: 'login', label: 'Status', render: r => <Badge tone={stateTone(r.login)}>{r.login}</Badge> },
    { key: 'code', label: isPkr ? 'Group code' : 'Txn status', hideInGroup: false },
    { key: 'whrs', label: 'Working hrs' },
    { key: 'actSdp', label: isMcg ? 'SDP' : 'ACT SDP', num: true },
    { key: 'mrcLmt', label: isMcg ? 'MRC limit' : 'MRC LMT', num: true },
    { key: 'utilizedLimit', label: isPkr ? 'DP avail. limit' : 'Utilized limit', num: true },
    { key: 'opening', label: 'Opening', num: true },
    { key: 'deposit', label: 'Deposit', num: true },
    { key: 'withdrawal', label: 'Withdrawal', num: true },
    { key: 'adjustment', label: 'Adjust.', num: true },
    { key: 'unconfirmedWd', label: 'Unconf. WD', num: true },
    { key: 'charge', label: 'Charge', num: true },
    { key: 'commission', label: 'Commission', num: true },
    { key: 'topUp', label: 'Top up', num: true },
    { key: 'rBal', label: 'R. Bal', num: true },
    { key: 'aBal', label: 'A. Bal', num: true },
    { key: 'discrep', label: 'Discrep.', num: true },
    { key: 'health', label: 'Balance', render: r => <HealthBadge h={r.health} /> },
    { key: 'flags', label: 'Alerts', render: r => <span className="flex gap-1">{r.highDiscrep && <Badge tone="red">Discrep.</Badge>}{r.limitExceeded && <Badge tone="amber">Limit exceeded</Badge>}</span> },
    { key: 'limitStatus', label: isPkr ? 'Exceed' : 'Limit status' },
    { key: 'sdpPaid', label: 'SDP paid', num: true },
    { key: 'remarks', label: isMcg ? 'Status remark' : 'Remarks' },
  ]
  const wal = (title: string, keys: (keyof AgentRow)[], num: boolean): Col[] =>
    keys.map((k, i) => ({ key: k, label: ['JazzCash', 'UPaisa', 'NayaPay'][i], group: title, num, render: num ? undefined : (r: AgentRow) => statusCell(r[k] as string) }))
  // PKR-BKK: same left-to-right order as the sheet (two-row header: group title above, wallet below).
  const bkkCols: Col[] = [
    { key: 'account', label: 'Account' },
    { key: 'brand', label: 'Brand', render: r => <Badge tone="purple">{r.brand}</Badge>, hideInGroup: true },
    { key: 'shop', label: 'Shop' },
    { key: 'login', label: 'Status', render: r => <Badge tone={stateTone(r.login)}>{r.login}</Badge> },
    { key: 'actSdp', label: 'SDP', num: true, render: r => r.actSdp > 0 ? money(r.actSdp) : <span className="text-slate-400">—</span> },
    { key: 'opening', label: 'Opening', num: true },
    ...wal('Deposit', ['depJazz', 'depUpaisa', 'depNaya'], true),
    { key: 'deposit', label: 'Total deposit', num: true, group: 'Deposit' },
    { key: 'withdrawal', label: 'Withdrawal', num: true },
    { key: 'stlm', label: 'STLM/SPC', num: true },
    { key: 'topUp', label: 'Top up', num: true },
    { key: 'rBal', label: 'R. Bal', num: true },
    { key: 'health', label: 'Balance', render: r => <HealthBadge h={r.health} /> },
    ...wal('Deposit status', ['depStJazz', 'depStUpaisa', 'depStNaya'], false),
    ...wal('Withdrawal status', ['wdStJazz', 'wdStUpaisa', 'wdStNaya'], false),
    { key: 'limitStatus', label: 'Exceed', render: r => r.limitExceeded ? <Badge tone="amber">EXCEED</Badge> : <span className="text-slate-500">{r.limitStatus}</span> },
    ...wal('Withdrawal by wallet', ['wdJazz', 'wdUpaisa', 'wdNaya'], true),
  ]
  const PKR_ONLY: string[] = ['unconfirmedWd', 'charge', 'commission', 'topUp', 'sdpPaid', 'whrs']
  const visible = isBkk ? bkkCols.filter(c => showType || !c.hideInGroup) : cols.filter(c => (showType || !c.hideInGroup) &&
    (isPkr ? c.key !== 'mrcLmt' : !PKR_ONLY.includes(c.key as string) && (isMcg ? c.key !== 'utilizedLimit' && c.key !== 'limitStatus' : c.key !== 'code')))

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const bkkHead = ['Brand', 'Shop', 'Account', 'Status', 'SDP', 'Opening', 'Deposit JazzCash', 'Deposit UPaisa', 'Deposit NayaPay', 'Total deposit', 'Withdrawal', 'STLM/SPC', 'Top up', 'R.BAL', 'Balance',
      'Dep status JazzCash', 'Dep status UPaisa', 'Dep status NayaPay', 'WD status JazzCash', 'WD status UPaisa', 'WD status NayaPay', 'Exceed', 'WD JazzCash', 'WD UPaisa', 'WD NayaPay']
    const head = isBkk ? bkkHead : ['Account', 'Type', 'Wallet', 'Status', 'ACT SDP', 'MRC LMT', 'Utilized limit', 'Opening', 'Deposit', 'Withdrawal', 'Adjustment', 'R.BAL', 'A.BAL', 'Discrep', 'Balance', 'High discrep', 'Limit exceeded', 'Limit status / Txn status', 'Remarks']
    const lines = filtered.map(r => (isBkk
      ? [r.brand, r.shop, r.account, r.login, r.actSdp, r.opening, r.depJazz, r.depUpaisa, r.depNaya, r.deposit, r.withdrawal, r.stlm, r.topUp, r.rBal, r.health,
        r.depStJazz, r.depStUpaisa, r.depStNaya, r.wdStJazz, r.wdStUpaisa, r.wdStNaya, r.limitStatus, r.wdJazz, r.wdUpaisa, r.wdNaya]
      : [r.account, r.group, r.wallet, r.login, r.actSdp, r.mrcLmt, r.utilizedLimit, r.opening, r.deposit, r.withdrawal, r.adjustment, r.rBal, r.aBal, r.discrep, r.health, r.highDiscrep, r.limitExceeded, isMcg ? r.code : r.limitStatus, r.remarks]).map(esc).join(','))
    const url = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'agents.csv'; a.click(); URL.revokeObjectURL(url)
  }

  const sel = (v: string, set: (s: string) => void, ph: string, opts: string[]) => (
    <select className="input" value={v} onChange={e => { set(e.target.value); setPage(0) }}>
      <option value="">{ph}</option>{opts.map(o => <option key={o}>{o}</option>)}
    </select>
  )

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
        <input className="input w-60" placeholder={isBkk ? 'Search account or shop…' : 'Search account, tag, remark…'} value={q} onChange={e => { setQ(e.target.value); setPage(0) }} />
        {isBkk ? sel(shop, setShop, 'All shops', shops) : sel(wallet, setWallet, 'All wallets', wallets)}
        {sel(login, setLogin, 'All statuses', states)}
        {sel(limitStatus, setLimitStatus, isMcg ? 'All txn statuses' : isBkk ? 'All exceed statuses' : 'All limit statuses', limitStatuses)}
        <select className="input" value={flag} onChange={e => { onFlag(e.target.value as Flag); setPage(0) }}>
          <option value="all">All balances & alerts</option>
          <option value="high">Higher balance</option>
          <option value="low">Low balance</option>
          <option value="healthy">Healthy balance</option>
          <option value="discrep">High discrepancy</option>
          <option value="limit">Limit exceeded</option>
        </select>
        <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
          <span>{fmt(filtered.length)} of {fmt(rows.length)} accounts</span>
          <button className="btn" onClick={exportCsv}><Download size={14} />CSV</button>
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase text-slate-500">
            {(() => {
              const sortBy = (c: Col) => c.key !== 'flags' && setSort(s => ({ key: c.key as string, dir: s.key === c.key ? (-s.dir as 1 | -1) : -1 }))
              const cell = (c: Col, i: number, rowSpan?: number) => (
                <th key={`${c.group ?? ''}${c.label}`} rowSpan={rowSpan} className={`whitespace-nowrap px-3 py-2 ${c.num ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 bg-slate-50' : ''} ${c.key !== 'flags' ? 'cursor-pointer select-none' : ''}`} onClick={() => sortBy(c)}>
                  <span className="inline-flex items-center gap-1">{c.label}{sort.key === c.key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</span>
                </th>
              )
              if (!visible.some(c => c.group)) return <tr>{visible.map((c, i) => cell(c, i))}</tr>
              // Two-row header (PKR-BKK): group title spans its wallet columns; other columns span both rows.
              const segs: { group?: string; cols: { c: Col; i: number }[] }[] = []
              visible.forEach((c, i) => {
                const last = segs[segs.length - 1]
                if (c.group && last && last.group === c.group) last.cols.push({ c, i })
                else segs.push({ group: c.group, cols: [{ c, i }] })
              })
              return <>
                <tr>{segs.map(sg => sg.group
                  ? <th key={sg.group} colSpan={sg.cols.length} className="whitespace-nowrap border-x border-slate-200 bg-slate-100 px-3 py-1.5 text-center">{sg.group}</th>
                  : cell(sg.cols[0].c, sg.cols[0].i, 2))}</tr>
                <tr>{segs.flatMap(sg => sg.group ? sg.cols.map(({ c, i }) => cell(c, i)) : [])}</tr>
              </>
            })()}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {slice.map(r => (
              <tr key={r.id} className="hover:bg-slate-50">
                {visible.map((c, i) => (
                  <td key={`${c.group ?? ''}${c.label}`} className={`px-3 py-1.5 ${c.num ? 'text-right tabular-nums' : 'whitespace-nowrap'} ${i === 0 ? 'sticky left-0 bg-white font-medium' : ''} ${c.key === 'remarks' ? 'max-w-xs truncate' : ''}`} title={c.key === 'remarks' ? r.remarks : undefined}>
                    {c.render ? c.render(r) : c.num ? money(r[c.key as keyof AgentRow] as number) : String(r[c.key as keyof AgentRow] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
            {!slice.length && <tr><td colSpan={visible.length} className="p-10 text-center text-slate-400">No accounts match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-slate-200 p-3 text-sm">
        <select className="input" value={size} onChange={e => { setSize(Number(e.target.value)); setPage(0) }}>{PAGE_SIZES.map(s => <option key={s} value={s}>{s} per page</option>)}</select>
        <div className="flex items-center gap-2">
          <button className="btn" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Prev</button>
          <span className="text-slate-500">Page {cur + 1} / {pages}</span>
          <button className="btn" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</button>
        </div>
      </div>
    </div>
  )
}
