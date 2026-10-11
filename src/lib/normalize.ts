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

export function classify(row: Pick<AgentRow, 'rBal' | 'discrep' | 'deposit' | 'utilizedLimit'>, t: Threshold) {
  return {
    health: row.rBal < t.low ? ('low' as const) : row.rBal > t.high ? ('high' as const) : ('healthy' as const),
    highDiscrep: Math.abs(row.discrep) >= t.discrep,
    limitExceeded: row.deposit > row.utilizedLimit,
  }
}

export function normalize(ds: Dataset, settings: Settings): AgentRow[] {
  const out: AgentRow[] = []
  for (const sh of ds.sheets) {
    const meta = SHEET_GROUP[sh.name]
    if (!meta) continue
    const idx: Record<string, number> = {}
    sh.header.forEach((h, i) => (idx[str(h).toUpperCase()] = i))
    const g = (r: unknown[], k: string) => (idx[k] === undefined ? undefined : r[idx[k]])
    const t = settings.thresholds[meta.group]
    for (const r of sh.rows) {
      const account = str(g(r, 'ACCOUNTS'))
      if (!account) continue
      const opening = num(g(r, 'OPENING'))
      const deposit = num(g(r, 'DEPOSIT'))
      const withdrawal = num(g(r, 'WITHDRAWAL'))
      const adjustment = num(g(r, 'ADJUSTMENT'))
      const aBal = num(g(r, 'A. BAL'))
      // Business formula (from the brief), recomputed instead of trusting the sheet value
      const rBal = round2(opening + deposit - withdrawal - adjustment)
      const discrep = round2(rBal - aBal)
      const mrcLmt = num(g(r, 'MRC LMT'))
      const dpBalLimit = num(g(r, 'DP Bal Limit'.toUpperCase()))
      const utilizedLimit = dpBalLimit > 0 ? dpBalLimit : mrcLmt
      const status = str(g(r, 'STATUS'))
      const row: AgentRow = {
        id: `${sh.name}:${account}`,
        account,
        group: meta.group,
        currency: meta.currency,
        gateway: meta.gateway,
        actSdp: num(g(r, 'ACT SDP')),
        mrcLmt,
        dpBalLimit,
        utilizedLimit,
        opening, deposit, withdrawal, adjustment, rBal, aBal, discrep,
        status,
        login: loginState(status),
        code: str(g(r, 'CODE')),
        whrs: str(g(r, 'W. HRS')),
        wallet: str(g(r, 'WALLET')).toUpperCase(),
        limitStatus: str(g(r, 'LIMIT STATUS')),
        acctType: str(g(r, 'ACCT TYPE')),
        tags: str(g(r, 'TAGS')),
        remarks: str(g(r, 'REMARKS')),
        health: 'healthy', highDiscrep: false, limitExceeded: false,
      }
      Object.assign(row, classify(row, t))
      out.push(row)
    }
  }
  return out
}
