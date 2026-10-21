import { AgentRow, BKK_BRAND, Dataset, Group, RawSheet, Settings, SHEET_GROUP, Threshold } from './types'

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
 * PKR-BKK (BAJI / JEETBUZZ / SIX6S) - ONE tab "PKR-BKK", a copy of the Bangkok-Pay MONITORING sheet.
 *
 * Three header rows, a TOTAL row, then one row per shop agent. Brand is a COLUMN (no more one tab per brand):
 *
 *   row 1 | Brand | Group | Account | Security Deposit | Opening Balance | Transactions ..................... | Status | Limit ......... | Daily Available Balance
 *   row 2 |       |       |         |                  |                 | Running Balance | Total Deposit | Manual Credit (3) | Cash Out (3) | Top up |
 *         |       |       |         |                  |                 | Total Withdrawal | Cash In (3) | Total Special Payment | Special Payment (3) |        | Available (3) | Allocation (3) | Used (3) |
 *   row 3 | wallet names JazzCash / UPaisa / NayaPay under every 3-wallet block
 *   row 4 | TOTAL row (no account -> skipped)
 *
 * Sheet formula:  Running Balance = Opening + Total Deposit + Top up - Total Withdrawal - Total Special Payment
 *   Total Deposit = sum of "Manual Credit" wallets, Total Withdrawal = sum of "Cash In" wallets.
 * Status (Active / Inactive) is the account's deposit status. "Limit exceeded" = Limit Available below 0 on any wallet.
 *
 * Apps Script sends row 1 as the header and rows 2.. as data, so the three header rows are located by looking for the wallet
 * names. Columns are found by their labels, never by fixed position (merged titles are carried across their blank cells).
 * ---------------------------------------------------------------------------------------------- */

const EMPTY_BKK = {
  brand: '', shop: '', stlm: 0, depJazz: 0, depUpaisa: 0, depNaya: 0, wdJazz: 0, wdUpaisa: 0, wdNaya: 0,
  cashOut: 0, coJazz: 0, coUpaisa: 0, coNaya: 0, spJazz: 0, spUpaisa: 0, spNaya: 0,
  avJazz: 0, avUpaisa: 0, avNaya: 0, alJazz: 0, alUpaisa: 0, alNaya: 0, usJazz: 0, usUpaisa: 0, usNaya: 0,
  dbJazz: 0, dbUpaisa: 0, dbNaya: 0,
}

const walletIndex = (label: string) => {
  const t = label.toUpperCase()
  return t.includes('JAZZ') ? 0 : t.includes('UPAISA') || t.includes('UPAYSA') ? 1 : t.includes('NAYA') ? 2 : -1
}
const clean = (v: unknown) => str(v).toUpperCase().replace(/\s+/g, ' ')

/** Brand text from the sheet -> group. Anything else is not guessed: the row is skipped. */
export function bkkGroup(brand: string): Group | null {
  const b = brand.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (b === 'BAJI' || b === 'BJ') return 'BKK_BAJI'
  if (b === 'JEETBUZZ' || b === 'JBZ' || b === 'JB') return 'BKK_JB'
  if (b === 'SIX6S' || b === '6S') return 'BKK_6S'
  return null
}

/** Cells holding a sheet error (#VALUE!, #REF!...) or a stray text where a number is expected. */
const isErr = (v: unknown) => typeof v === 'string' && v.trim() !== '' && Number.isNaN(Number(v.replace(/[, ]/g, '')))

export function normalizeBkk(sh: RawSheet, meta: { group: AgentRow['group']; currency: string; gateway: string }, settings: Settings): AgentRow[] {
  const all: unknown[][] = [sh.header, ...sh.rows].filter(Array.isArray) as unknown[][]
  const subAt = all.slice(0, 6).findIndex(r => r.filter(c => walletIndex(str(c)) >= 0).length >= 3)
  if (subAt < 2) return []
  const row1 = all[0], row2 = all[subAt - 1], row3 = all[subAt], body = all.slice(subAt + 1)
  const width = Math.max(row1.length, row2.length, row3.length)

  // Titles are merged across their wallet columns: carry each title over the blank cells to its right. A new row-1 title
  // ends the row-2 title (so "Status" does not inherit "Special Payment").
  const t1: string[] = [], t2: string[] = []
  let c1 = '', c2 = ''
  for (let i = 0; i < width; i++) {
    const a = clean(row1[i]), b = clean(row2[i])
    if (a) { c1 = a; c2 = '' }
    if (b) c2 = b
    t1.push(c1); t2.push(c2)
  }
  const w3 = (i: number) => walletIndex(str(row3[i]))
  const one = (a: string, b = '') => t1.findIndex((x, i) => x === a && (b ? t2[i] === b : true) && w3(i) < 0)
  const wallets = (a: string, b = ''): number[] => {
    const idx = [-1, -1, -1]
    t1.forEach((x, i) => { if (x === a && (!b || t2[i] === b)) { const w = w3(i); if (w >= 0 && idx[w] < 0) idx[w] = i } })
    return idx
  }
  const first = (...cands: number[]) => cands.find(i => i >= 0) ?? -1
  const c = {
    brand: one('BRAND'), shop: one('GROUP'), account: first(one('ACCOUNT'), one('ACCOUNTS')),
    sdp: first(one('SECURITY DEPOSIT'), one('SDP')), opening: first(one('OPENING BALANCE'), one('OPENING')),
    sheetRBal: t2.findIndex((x, i) => x === 'RUNNING BALANCE' && w3(i) < 0),
    depTotal: t2.findIndex((x, i) => x === 'TOTAL DEPOSIT' && w3(i) < 0),
    topUp: t2.findIndex((x, i) => x === 'TOP UP' && w3(i) < 0),
    wdTotal: t2.findIndex((x, i) => x === 'TOTAL WITHDRAWAL' && w3(i) < 0),
    spTotal: t2.findIndex((x, i) => x === 'TOTAL SPECIAL PAYMENT' && w3(i) < 0),
    status: one('STATUS'),
    dep: wallets('TRANSACTIONS', 'MANUAL CREDIT'), co: wallets('TRANSACTIONS', 'CASH OUT'), wd: wallets('TRANSACTIONS', 'CASH IN'),
    sp: wallets('TRANSACTIONS', 'SPECIAL PAYMENT'),
    av: wallets('LIMIT', 'AVAILABLE'), al: wallets('LIMIT', 'ALLOCATION'), us: wallets('LIMIT', 'USED'),
    db: wallets('DAILY AVAILABLE BALANCE'),
  }
  if (c.account < 0 || c.brand < 0) return []

  const v = (r: unknown[], i: number) => (i < 0 ? 0 : num(r[i]))
  const three = (r: unknown[], idx: number[]) => idx.map(i => v(r, i)) as [number, number, number]
  const sum3 = (a: number[]) => round2(a[0] + a[1] + a[2])
  const out: AgentRow[] = []
  for (const r of body) {
    const account = str(r[c.account])
    if (!account) continue // TOTAL row and empty rows
    const group = bkkGroup(str(r[c.brand]))
    if (!group) continue
    const brand = BKK_BRAND[group] ?? ''
    const dep = three(r, c.dep), co = three(r, c.co), wd = three(r, c.wd), sp = three(r, c.sp)
    const av = three(r, c.av), al = three(r, c.al), us = three(r, c.us), db = three(r, c.db)
    const deposit = c.depTotal >= 0 ? v(r, c.depTotal) : sum3(dep)
    const withdrawal = c.wdTotal >= 0 ? v(r, c.wdTotal) : sum3(wd)
    const stlm = c.spTotal >= 0 ? v(r, c.spTotal) : sum3(sp)
    const opening = v(r, c.opening)
    const topUp = v(r, c.topUp)
    // The sheet's own formula: Running Balance = Opening + Total Deposit + Top up - Total Withdrawal - Total Special Payment
    const rBal = round2(opening + deposit + topUp - withdrawal - stlm)
    // Double check against the sheet: show a warning when the sheet value is an error or does not match.
    let remarks = ''
    const sheetR = c.sheetRBal >= 0 ? r[c.sheetRBal] : ''
    if (isErr(sheetR)) remarks = `Sheet Running Balance shows ${str(sheetR)}`
    else if (c.sheetRBal >= 0 && str(sheetR) !== '' && Math.abs(num(sheetR) - rBal) > 0.01) remarks = `Sheet Running Balance is ${num(sheetR).toLocaleString('en-US')}`
    if (c.opening >= 0 && isErr(r[c.opening])) remarks = (remarks ? remarks + '; ' : '') + `Opening Balance is "${str(r[c.opening])}" (counted as 0)`
    const status = c.status >= 0 ? str(r[c.status]) : ''
    const exceeded = av.some(x => x < 0)
    const row: AgentRow = {
      id: `${sh.name}:${account}`, account, group, currency: meta.currency, gateway: meta.gateway,
      actSdp: v(r, c.sdp), mrcLmt: 0, dpBalLimit: 0, utilizedLimit: 0,
      opening, deposit, withdrawal, adjustment: 0, unconfirmedWd: 0, charge: 0, commission: 0, topUp, sdpPaid: 0,
      rBal, aBal: 0, discrep: 0,
      status, login: status, code: '', whrs: '', wallet: '', limitStatus: exceeded ? 'EXCEED' : 'OK', acctType: brand, tags: '', remarks,
      brand, shop: c.shop >= 0 ? str(r[c.shop]) : '', stlm,
      depJazz: dep[0], depUpaisa: dep[1], depNaya: dep[2], wdJazz: wd[0], wdUpaisa: wd[1], wdNaya: wd[2],
      cashOut: sum3(co), coJazz: co[0], coUpaisa: co[1], coNaya: co[2], spJazz: sp[0], spUpaisa: sp[1], spNaya: sp[2],
      avJazz: av[0], avUpaisa: av[1], avNaya: av[2], alJazz: al[0], alUpaisa: al[1], alNaya: al[2], usJazz: us[0], usUpaisa: us[1], usNaya: us[2],
      dbJazz: db[0], dbUpaisa: db[1], dbNaya: db[2],
      health: 'healthy', highDiscrep: false, limitExceeded: false,
    }
    Object.assign(row, classify(row, settings.thresholds[group]))
    // Limit exceeded = Limit "Available" is below 0 on any wallet (there is no EXCEED column in the new sheet).
    row.limitExceeded = exceeded
    // No actual balance exists for Bangkok-Pay, so there is no discrepancy (the old shared check flagged every row at threshold 0).
    row.highDiscrep = false
    out.push(row)
  }
  return out
}

/** Wallets whose Limit "Available" is below 0, for alert text. */
export function bkkExceededWallets(r: Pick<AgentRow, 'avJazz' | 'avUpaisa' | 'avNaya'>): string[] {
  return [['JazzCash', r.avJazz], ['UPaisa', r.avUpaisa], ['NayaPay', r.avNaya]].filter(([, a]) => (a as number) < 0).map(([n]) => n as string)
}
