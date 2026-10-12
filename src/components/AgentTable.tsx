import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Download } from 'lucide-react'
import { AgentRow, GROUP_LABEL } from '../lib/types'
import { fmt } from '../lib/metrics'
import { Badge, HealthBadge } from './ui'

const STATE_ICON: Record<string, string> = { 'Logged In': '✅', 'Logged Out': '⭕', Locked: '🔒' }
const stateTone = (s: string) => (s === 'Logged In' || s === 'Active' ? 'green' : s === 'Logged Out' || s === 'Disabled' ? 'slate' : 'red') as 'green' | 'slate' | 'red'

export type Flag = 'all' | 'low' | 'high' | 'healthy' | 'discrep' | 'limit'
const PAGE_SIZES = [25, 50, 100, 250]

type Col = { key: keyof AgentRow | 'flags'; label: string; num?: boolean; render?: (r: AgentRow) => React.ReactNode; hideInGroup?: boolean }

const money = (n: number) => <span className={n < 0 ? 'text-rose-600' : ''}>{fmt(n, 2)}</span>

export default function AgentTable({ rows, showType, flag, onFlag, gateway, currency }: { rows: AgentRow[]; showType: boolean; flag: Flag; onFlag: (f: Flag) => void; gateway?: string; currency?: string }) {
  const isMcg = gateway === 'MCG'
  const isPkr = currency === 'PKR'
  const secKey = isMcg ? 'code' : 'limitStatus'
  const [q, setQ] = useState('')
  const [wallet, setWallet] = useState('')
  const [login, setLogin] = useState('')
  const [limitStatus, setLimitStatus] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'rBal', dir: -1 })
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(50)

  const wallets = useMemo(() => [...new Set(rows.map(r => r.wallet))].sort(), [rows])
  const limitStatuses = useMemo(() => [...new Set(rows.map(r => r[secKey] as string))].filter(Boolean).sort(), [rows, secKey])
  const states = useMemo(() => [...new Set(rows.map(r => r.login))].filter(Boolean).sort(), [rows])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const out = rows.filter(r =>
      (!s || r.account.toLowerCase().includes(s) || r.remarks.toLowerCase().includes(s) || r.tags.toLowerCase().includes(s)) &&
      (!wallet || r.wallet === wallet) && (!login || r.login === login) && (!limitStatus || r[secKey] === limitStatus) &&
      (flag === 'all' || (flag === 'low' && r.health === 'low') || (flag === 'high' && r.health === 'high') || (flag === 'healthy' && r.health === 'healthy') ||
        (flag === 'discrep' && r.highDiscrep) || (flag === 'limit' && r.limitExceeded)))
    const k = sort.key as keyof AgentRow
    out.sort((a, b) => {
      const x = a[k], y = b[k]
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir
    })
    return out
  }, [rows, q, wallet, login, limitStatus, flag, sort])

  const pages = Math.max(1, Math.ceil(filtered.length / size))
  const cur = Math.min(page, pages - 1)
  const slice = filtered.slice(cur * size, cur * size + size)

  const cols: Col[] = [
    { key: 'account', label: 'Account' },
    { key: 'group', label: 'Type', render: r => <Badge tone="purple">{GROUP_LABEL[r.group]}</Badge>, hideInGroup: true },
    { key: 'wallet', label: 'Wallet' },
    { key: 'login', label: 'Status', render: r => <Badge tone={stateTone(r.login)}>{isPkr ? `${STATE_ICON[r.login] ?? ''} ` : ''}{r.login}</Badge> },
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
  const PKR_ONLY: string[] = ['unconfirmedWd', 'charge', 'commission', 'topUp', 'sdpPaid', 'whrs']
  const visible = cols.filter(c => (showType || !c.hideInGroup) &&
    (isPkr ? c.key !== 'mrcLmt' : !PKR_ONLY.includes(c.key as string) && (isMcg ? c.key !== 'utilizedLimit' && c.key !== 'limitStatus' : c.key !== 'code')))

  const exportCsv = () => {
    const head = ['Account', 'Type', 'Wallet', 'Status', 'ACT SDP', 'MRC LMT', 'Utilized limit', 'Opening', 'Deposit', 'Withdrawal', 'Adjustment', 'R.BAL', 'A.BAL', 'Discrep', 'Balance', 'High discrep', 'Limit exceeded', 'Limit status / Txn status', 'Remarks']
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = filtered.map(r => [r.account, r.group, r.wallet, r.login, r.actSdp, r.mrcLmt, r.utilizedLimit, r.opening, r.deposit, r.withdrawal, r.adjustment, r.rBal, r.aBal, r.discrep, r.health, r.highDiscrep, r.limitExceeded, isMcg ? r.code : r.limitStatus, r.remarks].map(esc).join(','))
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
        <input className="input w-60" placeholder="Search account, tag, remark…" value={q} onChange={e => { setQ(e.target.value); setPage(0) }} />
        {sel(wallet, setWallet, 'All wallets', wallets)}
        {sel(login, setLogin, 'All statuses', states)}
        {sel(limitStatus, setLimitStatus, isMcg ? 'All txn statuses' : 'All limit statuses', limitStatuses)}
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
            <tr>
              {visible.map((c, i) => (
                <th key={c.label} className={`whitespace-nowrap px-3 py-2 ${c.num ? 'text-right' : ''} ${i === 0 ? 'sticky left-0 bg-slate-50' : ''} ${c.key !== 'flags' ? 'cursor-pointer select-none' : ''}`}
                  onClick={() => c.key !== 'flags' && setSort(s => ({ key: c.key as string, dir: s.key === c.key ? (-s.dir as 1 | -1) : -1 }))}>
                  <span className="inline-flex items-center gap-1">{c.label}{sort.key === c.key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {slice.map(r => (
              <tr key={r.id} className="hover:bg-slate-50">
                {visible.map((c, i) => (
                  <td key={c.label} className={`px-3 py-1.5 ${c.num ? 'text-right tabular-nums' : 'whitespace-nowrap'} ${i === 0 ? 'sticky left-0 bg-white font-medium' : ''} ${c.key === 'remarks' ? 'max-w-xs truncate' : ''}`} title={c.key === 'remarks' ? r.remarks : undefined}>
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
