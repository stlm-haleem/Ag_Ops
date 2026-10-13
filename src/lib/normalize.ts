import { AgentRow, BKK_BRAND, Dataset, RawSheet, Settings, SHEET_GROUP, Threshold } from './types'

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

export function higherBalanceThreshold(row: Pick<AgentRow, 'actSdp' | 'gateway' | 'currency'>, t?: Threshold) {
  if (row.actSdp > 0) return row.actSdp
  // PKR-BKK: no SDP -> use the higher-balance threshold set in Settings for the brand.
  if (row.gateway === 'BKK') return t?.high ?? Number.POSITIVE_INFINITY
  // PKR-SSG: no SDP means a locked account, so there is no higher-balance limit to compare against.
  if (row.currency === 'PKR') return Number.POSITIVE_INFINITY
  return row.gateway === 'MCG' ? 50000 : 100000
}

export function classify(row: Pick<AgentRow, 'rBal' | 'discrep' | 'deposit' | 'utilizedLimit' | 'actSdp' | 'gateway' | 'currency'>, t: Threshold) {
  const highThreshold = higherBalanceThreshold(row, t)
  return {
    health: row.rBal < t.low ? ('low' as const) : row.rBal > highThreshold ? ('high' as const) : ('healthy' as const),
    highDiscrep: Math.abs(row.discrep) >= t.discrep,
    limitExceeded: row.gateway === 'BKK' ? false : row.deposit > row.utilizedLimit,
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
    if (meta.gateway === 'BKK') { out.push(...normalizeBkk(sh, meta, settings)); continue }
    // The header should be row 1, but a synced tab can carry a title/blank row above it:
    // if there is no account column, look for the real header row in the first few rows.
    const hasAccountCol = (h: unknown) => Array.isArray(h) && h.some(c => ['ACCOUNTS', 'AGENT ID'].includes(str(c).toUpperCase()))
    let header: unknown[] = sh.header
    let body: unknown[][] = sh.rows
    if (!hasAccountCol(header)) {
      const at = body.slice(0, 10).findIndex(hasAccountCol)
      if (at >= 0) { header = body[at]; body = body.slice(at + 1) }
    }
    const idx: Record<string, number> = {}
    header.forEach((h, i) => (idx[str(h).toUpperCase()] = i))
    const col: Record<string, number | undefined> = {}
    for (const [f, names] of Object.entries(FIELD_ALIASES)) col[f] = names.map(n => idx[n]).find(i => i !== undefined)
    const g = (r: unknown[], f: string) => (col[f] === undefined ? undefined : r[col[f] as number])
    const isMcg = meta.gateway === 'MCG'
    const isPkr = meta.currency === 'PKR'
    const t = settings.thresholds[meta.group]
    for (const r of body) {
      if (!Array.isArray(r)) continue
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
        ...EMPTY_BKK,
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

/* ------------------------------------------------------------------------------------------------
 * PKR-BKK (BAJI / JEETBUZZ / SIX6S)
 *
 * Each tab has a TWO-row header. Row 1 holds the group titles (merged across the wallet columns, so only the
 * first cell has text) and row 2 holds the wallet names under them:
 *
 *   SDP | SHOP NAME | ACCOUNT NAME | OPENING | DEPOSIT [JAZZCASH UPAISA NAYAPAY TOTAL] | WITHDRAWAL | STLM/SPC | TOP UP |
 *   RUNNING BALANCE | DEPOSIT STATUS [JAZZCASH UPAISA NAYAPAY] | WITHDRAWAL STATUS [JAZZCASH UPAISA NAYAPAY] |
 *   EXCEED [status | JAZZCASH UPAISA NAYAPAY withdrawal | Remark (ignored)]
 *
 * The data starts on row 3. Apps Script sends row 1 as the header and row 2 as the first data row, so the wallet
 * row is located by looking for the wallet names. Columns are found by label, never by fixed position.
 * ---------------------------------------------------------------------------------------------- */

const EMPTY_BKK = {
  brand: '', shop: '', stlm: 0, depJazz: 0, depUpaisa: 0, depNaya: 0, wdJazz: 0, wdUpaisa: 0, wdNaya: 0,
  depStJazz: '', depStUpaisa: '', depStNaya: '', wdStJazz: '', wdStUpaisa: '', wdStNaya: '',
}

export const BKK_STATUS_LABEL: Record<string, string> = { '✅': 'Enable', '⭕': 'Disable', '❌': 'Inactive' }
export function bkkStatus(v: unknown): string {
  const s = str(v)
  for (const [icon, label] of Object.entries(BKK_STATUS_LABEL)) if (s.includes(icon)) return label
  const t = s.toLowerCase()
  if (t.startsWith('enable')) return 'Enable'
  if (t.startsWith('disable')) return 'Disable'
  if (t.startsWith('inactive')) return 'Inactive'
  return ''
}

const walletIndex = (label: string) => {
  const t = label.toUpperCase()
  return t.includes('JAZZ') ? 0 : t.includes('UPAISA') || t.includes('UPAYSA') ? 1 : t.includes('NAYA') ? 2 : -1
}

export function normalizeBkk(sh: RawSheet, meta: { group: AgentRow['group']; currency: string; gateway: string }, settings: Settings): AgentRow[] {
  const all: unknown[][] = [sh.header, ...sh.rows].filter(Array.isArray) as unknown[][]
  const subAt = all.slice(0, 4).findIndex(r => r.filter(c => walletIndex(str(c)) >= 0).length >= 3)
  if (subAt < 1) return []
  const top = all[subAt - 1], sub = all[subAt], body = all.slice(subAt + 1)
  const width = Math.max(top.length, sub.length)

  // Row 1 titles are merged: carry each title across the blank cells to its right.
  const group: string[] = []
  let cur = ''
  for (let i = 0; i < width; i++) { const t = str(top[i]).toUpperCase(); if (t) cur = t; group.push(cur) }
  const label = (i: number) => str(sub[i]).toUpperCase()

  const one = (title: string, test: (sublabel: string) => boolean = () => true) =>
    group.findIndex((g, i) => g === title && test(label(i)))
  const wallets = (title: string): number[] => {
    const idx: number[] = [-1, -1, -1]
    group.forEach((g, i) => { if (g === title) { const w = walletIndex(label(i)); if (w >= 0 && idx[w] < 0) idx[w] = i } })
    return idx
  }
  const c = {
    sdp: one('SDP'), shop: one('SHOP NAME'), account: one('ACCOUNT NAME'), opening: one('OPENING'),
    depTotal: one('DEPOSIT', l => l.includes('TOTAL') || l === 'DEPOSIT'),
    withdrawal: one('WITHDRAWAL'), stlm: one('STLM/SPC'), topUp: one('TOP UP'),
    exceed: one('EXCEED', l => l === ''),
    dep: wallets('DEPOSIT'), depSt: wallets('DEPOSIT STATUS'), wdSt: wallets('WITHDRAWAL STATUS'), wd: wallets('EXCEED'),
  }
  if (c.account < 0) return []

  const brand = BKK_BRAND[meta.group] ?? ''
  const t = settings.thresholds[meta.group]
  const v = (r: unknown[], i: number) => (i < 0 ? 0 : num(r[i]))
  const out: AgentRow[] = []
  for (const r of body) {
    const account = str(r[c.account])
    if (!account) continue
    const dep = c.dep.map(i => v(r, i)) as [number, number, number]
    const wd = c.wd.map(i => Math.abs(v(r, i))) as [number, number, number]
    const depSt = c.depSt.map(i => (i < 0 ? '' : bkkStatus(r[i])))
    const wdSt = c.wdSt.map(i => (i < 0 ? '' : bkkStatus(r[i])))
    const deposit = c.depTotal >= 0 ? v(r, c.depTotal) : dep[0] + dep[1] + dep[2]
    // The sheet stores the total withdrawal as a negative number: always treat it as an amount going out.
    const withdrawal = Math.abs(v(r, c.withdrawal))
    const opening = v(r, c.opening)
    const stlm = v(r, c.stlm)
    const topUp = v(r, c.topUp)
    // RUNNING BALANCE = Opening + Total deposit - Withdrawal - STLM/SPC - Top up
    const rBal = round2(opening + deposit - withdrawal - stlm - topUp)
    const states = [...depSt, ...wdSt]
    const login = states.includes('Enable') ? 'Active' : states.includes('Disable') ? 'Disabled' : 'Inactive'
    const exceed = c.exceed >= 0 ? str(r[c.exceed]) : ''
    const row: AgentRow = {
      id: `${sh.name}:${account}`, account, group: meta.group, currency: meta.currency, gateway: meta.gateway,
      actSdp: v(r, c.sdp), mrcLmt: 0, dpBalLimit: 0, utilizedLimit: 0,
      opening, deposit, withdrawal, adjustment: 0, unconfirmedWd: 0, charge: 0, commission: 0, topUp, sdpPaid: 0,
      rBal, aBal: 0, discrep: 0,
      status: login, login, code: '', whrs: '', wallet: '', limitStatus: exceed, acctType: brand, tags: '', remarks: '',
      brand, shop: c.shop >= 0 ? str(r[c.shop]) : '', stlm,
      depJazz: dep[0], depUpaisa: dep[1], depNaya: dep[2], wdJazz: wd[0], wdUpaisa: wd[1], wdNaya: wd[2],
      depStJazz: depSt[0], depStUpaisa: depSt[1], depStNaya: depSt[2], wdStJazz: wdSt[0], wdStUpaisa: wdSt[1], wdStNaya: wdSt[2],
      health: 'healthy', highDiscrep: false, limitExceeded: false,
    }
    Object.assign(row, classify(row, t))
    // The sheet's own EXCEED column drives the limit-exceeded alert (there is no DP limit column in these tabs).
    row.limitExceeded = exceed.toUpperCase() === 'EXCEED'
    out.push(row)
  }
  return out
}
