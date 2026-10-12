import { AgentRow, Dataset, Settings, SHEET_GROUP, Threshold } from './types'

const num = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (v === null || v === undefined || v === '') return 0
  const n = Number(String(v).replace(/[, ]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())
const round2 = (n: number) => Math.round(n * 100) / 100

export function loginState(status: string) {
  const s = status.toLowerCase()
  if (s.includes('log in')) return 'Logged In' as const
  if (s.includes('log out')) return 'Logged Out' as const
  return 'Locked' as const
}

/** PKR-SSG status column uses emoji: ✅ login yes, ⭕ login no, 🔒 locked. An account with no SDP is always Locked. */
export function pkrState(status: string, sdp: number) {
  if (sdp <= 0) return 'Locked' as const
  if (status.includes('🔒')) return 'Locked' as const
  if (status.includes('✅')) return 'Logged In' as const
  if (status.includes('⭕')) return 'Logged Out' as const
  return loginState(status)
}

export function higherBalanceThreshold(row: Pick<AgentRow, 'actSdp' | 'gateway' | 'currency'>) {
  if (row.actSdp > 0) return row.actSdp
  // PKR-SSG: no SDP means a locked account, so there is no higher-balance limit to compare against.
  if (row.currency === 'PKR') return Number.POSITIVE_INFINITY
  return row.gateway === 'MCG' ? 50000 : 100000
}

export function classify(row: Pick<AgentRow, 'rBal' | 'discrep' | 'deposit' | 'utilizedLimit' | 'actSdp' | 'gateway' | 'currency'>, t: Threshold) {
  const highThreshold = higherBalanceThreshold(row)
  return {
    health: row.rBal < t.low ? ('low' as const) : row.rBal > highThreshold ? ('high' as const) : ('healthy' as const),
    highDiscrep: Math.abs(row.discrep) >= t.discrep,
    limitExceeded: row.deposit > row.utilizedLimit,
  }
}

const FIELD_ALIASES: Record<string, string[]> = {
  account: ['ACCOUNTS', 'AGENT ID'],
  actSdp: ['ACT SDP', 'SDP'],
  mrcLmt: ['MRC LMT', 'MRC. LIMIT', 'MRC LIMIT'],
  dpBalLimit: ['DP BAL LIMIT', 'DP AVAILABLE LIMIT'],
  opening: ['OPENING'],
  unconfirmedWd: ['UNCONFIRMED WD'],
  charge: ['CHARGE'],
  commission: ['COMMISSION'],
  topUp: ['TOP UP'],
  sdpPaid: ['SDP PAID'],
  deposit: ['DEPOSIT'],
  withdrawal: ['WITHDRAWAL'],
  adjustment: ['ADJUSTMENT'],
  aBal: ['A. BAL', 'WALLET BALANCE', 'ACTUAL BALANCE'],
  wallet: ['WALLET'],
  status: ['STATUS'],
  code: ['CODE', 'GROUP CODE'],
  whrs: ['W. HRS', 'WORKING HOURS'],
  limitStatus: ['LIMIT STATUS', 'EXCEED'],
  acctType: ['ACCT TYPE'],
  tags: ['TAGS'],
  remarks: ['REMARKS'],
  txStatus: ['TRANSACTION STATUS'],
  statusRemark: ['STATUS REMARK'],
}

/** MCG has no login state: derive it from Status (NORMAL/Suspended/...) and Transaction Status (Disabled/...). */
function mcgState(status: string, tx: string) {
  const s = status.toLowerCase()
  if (s && s !== 'normal') return s.charAt(0).toUpperCase() + s.slice(1)
  return tx.toLowerCase() === 'disabled' ? 'Disabled' : 'Active'
}

export const isActive = (r: Pick<AgentRow, 'login'>) => r.login === 'Logged In' || r.login === 'Active'

export function normalize(ds: Dataset, settings: Settings): AgentRow[] {
  const out: AgentRow[] = []
  for (const sh of ds.sheets) {
    const meta = SHEET_GROUP[sh.name]
    if (!meta) continue
    const idx: Record<string, number> = {}
    sh.header.forEach((h, i) => (idx[str(h).toUpperCase()] = i))
    const col: Record<string, number | undefined> = {}
    for (const [f, names] of Object.entries(FIELD_ALIASES)) col[f] = names.map(n => idx[n]).find(i => i !== undefined)
    const g = (r: unknown[], f: string) => (col[f] === undefined ? undefined : r[col[f] as number])
    const isMcg = meta.gateway === 'MCG'
    const isPkr = meta.currency === 'PKR'
    const t = settings.thresholds[meta.group]
    for (const r of sh.rows) {
      const account = str(g(r, 'account'))
      if (!account) continue
      const opening = num(g(r, 'opening'))
      const deposit = num(g(r, 'deposit'))
      const withdrawal = num(g(r, 'withdrawal'))
      const adjustment = num(g(r, 'adjustment'))
      const aBal = num(g(r, 'aBal'))
      // Business formula (from the brief), recomputed instead of trusting the sheet value. Same for BDT and PKR SSG.
      const rBal = round2(opening + deposit - withdrawal - adjustment)
      const discrep = round2(rBal - aBal)
      const mrcLmt = num(g(r, 'mrcLmt'))
      const dpBalLimit = num(g(r, 'dpBalLimit'))
      const utilizedLimit = dpBalLimit > 0 ? dpBalLimit : mrcLmt
      const status = str(g(r, 'status'))
      const tx = str(g(r, 'txStatus'))
      const row: AgentRow = {
        id: `${sh.name}:${account}`,
        account,
        group: meta.group,
        currency: meta.currency,
        gateway: meta.gateway,
        actSdp: num(g(r, 'actSdp')),
        mrcLmt,
        dpBalLimit,
        utilizedLimit,
        opening, deposit, withdrawal, adjustment, rBal, aBal, discrep,
        unconfirmedWd: num(g(r, 'unconfirmedWd')), charge: num(g(r, 'charge')), commission: num(g(r, 'commission')),
        topUp: num(g(r, 'topUp')), sdpPaid: num(g(r, 'sdpPaid')),
        status,
        login: isMcg ? mcgState(status, tx) : isPkr ? pkrState(status, num(g(r, 'actSdp'))) : loginState(status),
        code: isMcg ? tx : str(g(r, 'code')),
        whrs: str(g(r, 'whrs')),
        wallet: str(g(r, 'wallet')).toUpperCase(),
        limitStatus: isMcg ? status : str(g(r, 'limitStatus')),
        acctType: isMcg ? 'MCG' : str(g(r, 'acctType')),
        tags: str(g(r, 'tags')),
        remarks: isMcg ? str(g(r, 'statusRemark')) : str(g(r, 'remarks')),
        health: 'healthy', highDiscrep: false, limitExceeded: false,
      }
      Object.assign(row, classify(row, t))
      out.push(row)
    }
  }
  return out
}
