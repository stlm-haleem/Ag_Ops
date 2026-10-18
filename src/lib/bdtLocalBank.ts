import { DataCheck, clock, minutesNow } from './localBank'
import { RawSheet, Settings } from './types'

/* ------------------------------------------------------------------------------------------------
 * BDT Local Bank (BAJI and JEETBUZZ only; there is no SIX6S here)
 *
 * Source: the MONITORING tab, copied (values only) into the tab BDT-LOCALBANK. It is a wide per-day grid:
 *
 *   row  1      weekday names (ignored: they are not reliable)
 *   row  2      the dates, one per DP/WD column pair, starting in the column after "Running Balance"
 *   row  3      header: Agent | Bank Code | Bank Name | Acct Name | Account Number | TIME DP | TIME WD | DP LIMIT | WD LIMIT | Running Balance | DP WD DP WD ...
 *   rows 4..    BAJI accounts, then one total row (no agent)
 *   "JEETBUZZ"  a label row, a second header row, JEETBUZZ accounts, one total row
 *   below       "<Brand> Total DP per Bank(s)": Day Shift and Night Shift blocks, one row per bank, in the same column grid
 *
 * Everything is located by its label, never by a fixed row number, because the sheet is rebuilt every month
 * (the date range and the number of accounts change). The "Acct Name" column is ignored on purpose.
 *
 * Time: TIME DP / TIME WD and "today" are in Sri Lanka time (confirmed by the sheet owner).
 * ---------------------------------------------------------------------------------------------- */

export const WORK_ZONE = 'Asia/Colombo'
export const WORK_ZONE_LABEL = 'Sri Lanka time'
/** An account counts as "near its limit" from this share of the daily limit. */
export const NEAR_LIMIT = 0.8

export type Brand = 'BAJI' | 'JEETBUZZ'
export type BdtHealth = 'low' | 'high' | 'healthy' | 'na'

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())
const norm = (v: unknown) => str(v).toUpperCase().replace(/\s+/g, ' ')
const num = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const s = str(v)
  if (s === '' || s === '-') return 0
  const n = Number(s.replace(/[, ]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const round2 = (n: number) => Math.round(n * 100) / 100
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)

/* ----------------------------------------- working hours ----------------------------------------- */

export type BdtHours =
  | { kind: 'always'; text: string }
  /** Minutes since 00:00 in WORK_ZONE. start > end means the window crosses midnight (e.g. 09:30 → 01:30). */
  | { kind: 'window'; start: number; end: number; text: string }
  | { kind: 'unknown'; text: string }

const RANGE = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:to|-|–|—)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i
function toMinutes(h: string, m: string | undefined, ap: string): number | null {
  const hh = Number(h), mm = m === undefined ? 0 : Number(m)
  if (!(hh >= 1 && hh <= 12) || !(mm >= 0 && mm <= 59)) return null
  return ((hh % 12) + (ap.toLowerCase() === 'pm' ? 12 : 0)) * 60 + mm
}

/** Reads "9:30am to 6:30pm" or "24 hrs". Anything else (extra words, a zone name, a missing am/pm) is "unknown": never guessed. */
export function parseHours(raw: unknown): BdtHours {
  const text = str(raw).replace(/\s+/g, ' ')
  if (!text) return { kind: 'unknown', text }
  if (/^24 ?(hrs?|hours)\.?$/i.test(text)) return { kind: 'always', text }
  const m = RANGE.exec(text)
  if (!m) return { kind: 'unknown', text }
  const s = toMinutes(m[1], m[2], m[3]), e = toMinutes(m[4], m[5], m[6])
  if (s === null || e === null || s === e) return { kind: 'unknown', text }
  return { kind: 'window', start: s, end: e, text }
}

export interface HoursState {
  state: 'open' | 'closed' | 'always' | 'unknown'
  label: string
  next: string
}
export function hoursState(h: BdtHours, at: Date = new Date()): HoursState {
  if (h.kind === 'always') return { state: 'always', label: '24 hrs', next: '' }
  if (h.kind === 'unknown') return { state: 'unknown', label: h.text || '—', next: '' }
  const now = minutesNow(WORK_ZONE, at)
  const open = h.start < h.end ? now >= h.start && now < h.end : now >= h.start || now < h.end
  return { state: open ? 'open' : 'closed', label: `${clock(h.start)}–${clock(h.end)}`, next: open ? `until ${clock(h.end)}` : `opens ${clock(h.start)}` }
}

/* ------------------------------------------------ dates ------------------------------------------------ */

/** yyyy-MM-dd from an ISO string (what the Apps Script sends), a Date, or the sheet's own MM/DD/YYYY text. */
function parseDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  const s = str(v)
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (m) {
    const a = Number(m[1]), b = Number(m[2])
    const [mo, d] = a > 12 ? [b, a] : [a, b] // the sheet is MM/DD/YYYY; a first number above 12 can only be a day
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
    return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return null
}
/** Today's date (yyyy-MM-dd) in Sri Lanka time. */
export const todayIso = (at: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: WORK_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
const weekdayOf = (iso: string) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]
const addDay = (iso: string) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
/** "10/18" */
export const shortDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}`

/* --------------------------------------------- data model --------------------------------------------- */

export interface BdtDay { iso: string; label: string }

export interface BdtBreach { iso: string; kind: 'DP' | 'WD'; amount: number; limit: number }

export interface BdtAccount {
  id: string
  brand: Brand
  agent: string
  bank: string
  bankCode: string
  /** Digits only when the sheet really holds them; '' when it holds a rounded number such as 2.05012E+16. */
  accountNumber: string
  dpHours: BdtHours
  wdHours: BdtHours
  /** TIME DP crosses midnight (e.g. 9:30am to 01:30am): the sheet counts these accounts in its "Night Shift" block. */
  night: boolean
  dpLimit: number
  wdLimit: number
  balance: number
  dp: number[]
  wd: number[]
  /** null when today's date is not in the sheet's date range. */
  todayDp: number | null
  todayWd: number | null
  monthDp: number
  monthWd: number
  dpUse: number | null
  wdUse: number | null
  dpExceeded: boolean
  wdExceeded: boolean
  dpNear: boolean
  wdNear: boolean
  breaches: BdtBreach[]
  /** Last date with a deposit or a withdrawal, '' if none this month. */
  lastActive: string
  /** No balance and no deposit/withdrawal all month. */
  unused: boolean
  health: BdtHealth
  row: number
}

export interface BdtRollup {
  brand: Brand
  shift: 'DAY' | 'NIGHT'
  bank: string
  dp: number[]
  wd: number[]
  /** The month figure printed in the sheet's own column J (kept to cross-check it). */
  sheetTotal: number
  row: number
  /** Same bank/shift worked out from the account rows, for comparison. */
  expectedDp: number[]
  expectedWd: number[]
  matches: boolean
}

export interface BdtBrandTotals { brand: Brand; dp: number[]; wd: number[]; balance: number; found: boolean }

export interface BdtData {
  dates: BdtDay[]
  today: string
  /** Index of today in `dates`, or -1 when today's date is outside the sheet's date range. */
  todayIdx: number
  lastDataIdx: number
  accounts: BdtAccount[]
  rollups: BdtRollup[]
  totals: BdtBrandTotals[]
  checks: DataCheck[]
  problems: string[]
}

export const EMPTY_BDT: BdtData = { dates: [], today: '', todayIdx: -1, lastDataIdx: -1, accounts: [], rollups: [], totals: [], checks: [], problems: [] }

/* ---------------------------------------------- parsing ---------------------------------------------- */

interface Cols { agent: number; bankCode: number; bank: number; acctNo: number; timeDp: number; timeWd: number; dpLimit: number; wdLimit: number; balance: number }

function colsOf(row: unknown[]): Cols | null {
  const find = (...names: string[]) => row.findIndex(c => names.includes(norm(c)))
  const c: Cols = {
    agent: find('AGENT'), bankCode: find('BANK CODE'), bank: find('BANK NAME'), acctNo: find('ACCT NUMBER', 'ACCOUNT NUMBER'),
    timeDp: find('TIME DP'), timeWd: find('TIME WD'), dpLimit: find('DP LIMIT'), wdLimit: find('WD LIMIT'), balance: find('RUNNING BALANCE'),
  }
  return c.agent >= 0 && c.bankCode >= 0 && c.bank >= 0 && c.balance >= 0 ? c : null
}

const fmtMoney = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

export function parseBdtLocalBank(sheet: RawSheet | undefined, settings: Settings, at: Date = new Date()): BdtData {
  const out: BdtData = { ...EMPTY_BDT, accounts: [], rollups: [], totals: [], checks: [], problems: [], dates: [] }
  if (!sheet) return out
  // The tab's first row is the manifest header; the rows request starts at row 2. Together they are the whole sheet.
  const grid: unknown[][] = [sheet.header, ...sheet.rows]
  const headerRows: number[] = []
  grid.forEach((r, i) => { if (norm(r?.[0]) === 'AGENT' && colsOf(r)) headerRows.push(i) })
  if (!headerRows.length) { out.problems.push('No table with the headers Agent / Bank Code / Bank Name / Running Balance was found in the tab.'); return out }

  const h0 = headerRows[0]
  const cols0 = colsOf(grid[h0])!
  const first = cols0.balance + 1 // first day column (a DP column)

  // --- dates (the row above the first header), one per DP/WD pair
  if (h0 === 0) { out.problems.push('The date row above the first table is missing.'); return out }
  const dateRow = grid[h0 - 1] ?? []
  for (let c = first; ; c += 2) {
    const iso = parseDate(dateRow[c])
    if (!iso) break
    out.dates.push({ iso, label: shortDate(iso) })
  }
  if (!out.dates.length) { out.problems.push('No dates were found above the DP/WD columns.'); return out }
  const nDays = out.dates.length
  const dayCols = (row: unknown[]) => {
    const dp: number[] = [], wd: number[] = []
    for (let i = 0; i < nDays; i++) { dp.push(num(row[first + 2 * i])); wd.push(num(row[first + 2 * i + 1])) }
    return { dp, wd }
  }

  out.today = todayIso(at)
  out.todayIdx = out.dates.findIndex(d => d.iso === out.today)
  const th = settings.thresholds.BDT_LOCAL_BANK ?? { low: 0, high: 0, discrep: 0 }
  const ti = out.todayIdx

  // --- the account tables (BAJI first, then JEETBUZZ)
  const tableEnd: number[] = []
  headerRows.forEach((h, k) => {
    const cols = colsOf(grid[h])!
    const label = norm(grid[h - 1]?.[0])
    const brand: Brand | null = label.includes('JEET') ? 'JEETBUZZ' : label.includes('BAJI') ? 'BAJI' : k === 0 ? 'BAJI' : null
    if (!brand) { out.problems.push(`A table labelled "${str(grid[h - 1]?.[0]) || '(blank)'}" was skipped: only BAJI and JEETBUZZ exist in BDT Local Bank.`); return }
    if (out.accounts.some(a => a.brand === brand)) { out.problems.push(`A second ${brand} table was ignored.`); return }
    let r = h + 1
    for (; r < grid.length; r++) {
      const row = grid[r] ?? []
      const agent = str(row[cols.agent])
      if (!agent) break
      const bankCode = str(row[cols.bankCode])
      const bank = bankOf(bankCode, str(row[cols.bank]))
      const { dp, wd } = dayCols(row)
      const dpHours = parseHours(row[cols.timeDp]), wdHours = parseHours(row[cols.timeWd])
      const dpLimit = cols.dpLimit >= 0 ? num(row[cols.dpLimit]) : 0
      const wdLimit = cols.wdLimit >= 0 ? num(row[cols.wdLimit]) : 0
      const balance = num(row[cols.balance])
      const monthDp = round2(sum(dp)), monthWd = round2(sum(wd))
      const todayDp = ti >= 0 ? dp[ti] : null, todayWd = ti >= 0 ? wd[ti] : null
      const dpUse = todayDp !== null && dpLimit > 0 ? todayDp / dpLimit : null
      const wdUse = todayWd !== null && wdLimit > 0 ? todayWd / wdLimit : null
      const breaches: BdtBreach[] = []
      for (let i = 0; i < nDays; i++) {
        if (dpLimit > 0 && dp[i] > dpLimit) breaches.push({ iso: out.dates[i].iso, kind: 'DP', amount: dp[i], limit: dpLimit })
        if (wdLimit > 0 && wd[i] > wdLimit) breaches.push({ iso: out.dates[i].iso, kind: 'WD', amount: wd[i], limit: wdLimit })
      }
      let lastActive = ''
      for (let i = nDays - 1; i >= 0; i--) if (dp[i] || wd[i]) { lastActive = out.dates[i].iso; break }
      const unused = balance === 0 && monthDp === 0 && monthWd === 0
      let health: BdtHealth = 'na'
      if (!unused && (th.low > 0 || th.high > 0)) health = th.low > 0 && balance < th.low ? 'low' : th.high > 0 && balance > th.high ? 'high' : 'healthy'
      const rawNo = row[cols.acctNo]
      const accountNumber = cols.acctNo < 0 ? '' : typeof rawNo === 'number' ? (Number.isSafeInteger(rawNo) ? String(rawNo) : '') : /^\d+$/.test(str(rawNo)) ? str(rawNo) : ''
      out.accounts.push({
        id: `${brand}|${agent}|${bankCode}|${r}`, brand, agent, bank, bankCode, accountNumber, dpHours, wdHours,
        night: dpHours.kind === 'window' && dpHours.start > dpHours.end,
        dpLimit, wdLimit, balance, dp, wd, todayDp, todayWd, monthDp, monthWd, dpUse, wdUse,
        dpExceeded: todayDp !== null && dpLimit > 0 && todayDp > dpLimit,
        wdExceeded: todayWd !== null && wdLimit > 0 && todayWd > wdLimit,
        dpNear: dpUse !== null && dpUse >= NEAR_LIMIT && dpUse <= 1,
        wdNear: wdUse !== null && wdUse >= NEAR_LIMIT && wdUse <= 1,
        breaches, lastActive, unused, health, row: r + 1,
      })
    }
    // the total row directly under the table (no agent)
    const tr = grid[r] ?? []
    const hasTotals = r < grid.length && (str(tr[cols.balance]) !== '' || tr.slice(first, first + 2 * nDays).some(v => str(v) !== ''))
    const t = hasTotals ? dayCols(tr) : { dp: [], wd: [] }
    out.totals.push({ brand, dp: t.dp, wd: t.wd, balance: hasTotals ? num(tr[cols.balance]) : 0, found: hasTotals })
    tableEnd.push(r)
  })
  if (!out.accounts.length) { out.problems.push('The tables were found but they hold no account rows.'); return out }
  out.lastDataIdx = (() => { for (let i = nDays - 1; i >= 0; i--) if (out.accounts.some(a => a.dp[i] || a.wd[i])) return i; return -1 })()

  // --- the shift roll-ups below the tables ("<Brand> Total DP per Bank(s)" -> Day / Night -> one row per bank)
  const lblCol = cols0.wdLimit >= 0 ? cols0.wdLimit : cols0.balance - 1
  const bankCol = cols0.balance
  let brand: Brand | null = null, shift: 'DAY' | 'NIGHT' | null = null
  for (let r = Math.max(...tableEnd, h0); r < grid.length; r++) {
    const row = grid[r] ?? []
    const t = norm(row[lblCol])
    if (t.includes('TOTAL DP PER BANK')) { brand = t.includes('JEET') ? 'JEETBUZZ' : t.includes('BAJI') ? 'BAJI' : null; shift = null; continue }
    if (norm(row[bankCol]) === 'BANK' && /^(DAY|NIGHT)/.test(t)) { shift = t.startsWith('NIGHT') ? 'NIGHT' : 'DAY'; continue }
    if (!brand || !shift) continue
    const bank = norm(row[bankCol])
    if (!bank) continue // the shift's total row
    const { dp, wd } = dayCols(row)
    const mine = out.accounts.filter(a => a.brand === brand && a.bank === bank && (shift === 'DAY' || a.night))
    const expectedDp = out.dates.map((_, i) => round2(sum(mine.map(a => a.dp[i])))), expectedWd = out.dates.map((_, i) => round2(sum(mine.map(a => a.wd[i]))))
    const same = (x: number[], y: number[]) => x.every((v, i) => Math.abs(v - y[i]) < 0.01)
    out.rollups.push({ brand, shift, bank, dp, wd, sheetTotal: num(row[lblCol]), row: r + 1, expectedDp, expectedWd, matches: same(dp, expectedDp) && same(wd, expectedWd) })
  }

  out.checks = buildChecks(out, grid, h0, first)
  return out
}

/** The bank is the letters of the bank code before its digits (IBBL524712 -> IBBL), which is how the sheet's roll-up names it. */
function bankOf(code: string, name: string): string {
  const m = /^[A-Za-z]+/.exec(code)
  if (m) return m[0].toUpperCase()
  const n = name.toUpperCase()
  return n.includes('ISLAMI') ? 'IBBL' : n.includes('DUTCH') ? 'DBBL' : n.includes('CITY') ? 'CBL' : n.includes('BRAC') ? 'BRAC' : n || 'OTHER'
}

/* ---------------------------------------------- checks ---------------------------------------------- */

function buildChecks(d: BdtData, grid: unknown[][], h0: number, first: number): DataCheck[] {
  const checks: DataCheck[] = []
  const add = (label: string, ok: boolean, detail: string) => checks.push({ label, ok, detail })
  const list = (xs: string[], n = 6) => xs.slice(0, n).join(', ') + (xs.length > n ? ` … (+${xs.length - n} more)` : '')

  // dates
  const gaps = d.dates.filter((x, i) => i > 0 && addDay(d.dates[i - 1].iso) !== x.iso)
  add('Date columns run one day at a time', gaps.length === 0, gaps.length ? `Unexpected jump before ${list(gaps.map(g => g.label))}` : `${d.dates[0].label} → ${d.dates[d.dates.length - 1].label} (${d.dates.length} days)`)
  const wk = grid[h0 - 2] as unknown[] | undefined
  if (wk) {
    const labelled = d.dates.map((x, i) => ({ x, w: norm(wk[first + 2 * i]) })).filter(e => e.w)
    const bad = labelled.filter(e => e.w !== weekdayOf(e.x.iso))
    if (labelled.length) add('Weekday names in row 1 match the dates', bad.length === 0, bad.length ? `${bad.length} of ${labelled.length} do not match (e.g. ${bad[0].x.label} is a ${weekdayOf(bad[0].x.iso).toLowerCase()} but row 1 says ${bad[0].w.toLowerCase()}). The app ignores that row and trusts the dates.` : 'All match.')
  }

  // each brand's totals against its accounts
  for (const t of d.totals) {
    const mine = d.accounts.filter(a => a.brand === t.brand)
    if (!t.found) { add(`${t.brand}: total row`, false, 'No total row found under the table.'); continue }
    const bad: string[] = []
    d.dates.forEach((x, i) => {
      const dp = round2(sum(mine.map(a => a.dp[i]))), wd = round2(sum(mine.map(a => a.wd[i])))
      if (Math.abs(dp - t.dp[i]) > 0.01) bad.push(`${x.label} DP`)
      if (Math.abs(wd - t.wd[i]) > 0.01) bad.push(`${x.label} WD`)
    })
    add(`${t.brand}: daily DP / WD totals = sum of accounts`, bad.length === 0, bad.length ? `Differences: ${list(bad)}` : `All ${d.dates.length} days agree (month DP ${fmtMoney(sum(t.dp))}, WD ${fmtMoney(sum(t.wd))})`)
    const bal = round2(sum(mine.map(a => a.balance)))
    add(`${t.brand}: running balance total = sum of accounts`, Math.abs(bal - t.balance) < 0.01, `Accounts ${fmtMoney(bal)} · sheet ${fmtMoney(t.balance)}`)
  }

  // shift roll-ups
  const missing: string[] = []
  for (const brand of ['BAJI', 'JEETBUZZ'] as Brand[]) {
    const accts = d.accounts.filter(a => a.brand === brand)
    if (!accts.length) continue
    for (const shift of ['DAY', 'NIGHT'] as const) {
      const banks = [...new Set(accts.filter(a => shift === 'DAY' || a.night).map(a => a.bank))]
      for (const b of banks) if (!d.rollups.some(r => r.brand === brand && r.shift === shift && r.bank === b)) missing.push(`${brand} ${shift.toLowerCase()} ${b}`)
    }
  }
  const off = d.rollups.filter(r => !r.matches)
  add('Day / Night roll-ups = sum of the matching accounts', off.length === 0 && missing.length === 0 && d.rollups.length > 0,
    d.rollups.length === 0 ? 'No "Total DP per Bank(s)" blocks were found.'
      : [off.length ? `Different: ${list(off.map(r => `${r.brand} ${r.shift.toLowerCase()} ${r.bank} (sheet ${fmtMoney(sum(r.dp) + sum(r.wd))} · accounts ${fmtMoney(sum(r.expectedDp) + sum(r.expectedWd))})`), 4)}` : '',
        missing.length ? `Missing rows: ${list(missing)}` : ''].filter(Boolean).join(' · ') || `${d.rollups.length} bank rows agree. The sheet's Night Shift = accounts whose TIME DP runs past midnight; its Day Shift row = all accounts of that bank.`)
  const badTotal = d.rollups.filter(r => Math.abs(r.sheetTotal - (sum(r.dp) + sum(r.wd))) > 0.5)
  add("Roll-up month totals (sheet column J) = sum of their days", badTotal.length === 0, badTotal.length ? `Not equal: ${list(badTotal.map(r => `${r.brand} ${r.shift.toLowerCase()} ${r.bank} (J ${fmtMoney(r.sheetTotal)} · days ${fmtMoney(sum(r.dp) + sum(r.wd))})`), 4)}. The app adds up the days itself.` : 'All agree.')

  // account-level data quality
  const dup: string[] = []
  for (const brand of ['BAJI', 'JEETBUZZ'] as Brand[]) {
    const seen = new Map<string, string[]>()
    d.accounts.filter(a => a.brand === brand).forEach(a => seen.set(a.agent, [...(seen.get(a.agent) ?? []), a.bankCode]))
    seen.forEach((codes, agent) => { if (codes.length > 1) dup.push(`${agent} (${codes.join(' / ')})`) })
  }
  add('Agent names are unique within a brand', dup.length === 0, dup.length ? `Listed twice: ${list(dup)}. They are kept as separate accounts (told apart by bank code).` : 'No duplicates.')
  const sci = d.accounts.filter(a => !a.accountNumber)
  add('Account numbers readable', sci.length === 0, sci.length ? `${sci.length} accounts hold a rounded number (scientific notation, digits lost) — the app shows the bank code only: ${list(sci.map(a => a.agent))}` : 'All present.')
  const unclear = d.accounts.flatMap(a => [a.dpHours.kind === 'unknown' ? `${a.agent} DP "${a.dpHours.text}"` : '', a.wdHours.kind === 'unknown' ? `${a.agent} WD "${a.wdHours.text}"` : '']).filter(Boolean)
  add('Working hours understood', unclear.length === 0, unclear.length ? `Not understood (shown as "Hours unclear"): ${list(unclear)}` : 'Every TIME DP / TIME WD was read.')
  const noLimit = d.accounts.filter(a => a.dpLimit <= 0 || a.wdLimit <= 0)
  add('DP / WD limits present', noLimit.length === 0, noLimit.length ? `No limit for: ${list(noLimit.map(a => a.agent))}` : 'Every account has both limits.')
  const unused = d.accounts.filter(a => a.unused)
  add('Accounts with no balance and no activity', true, unused.length ? `${unused.length}: ${list(unused.map(a => a.agent))} — shown as "Unused", left out of low-balance alerts.` : 'None.')
  return checks
}

/* ----------------------------------------------- helpers ----------------------------------------------- */

export interface BankTotals { bank: string; accounts: number; todayDp: number; todayWd: number; monthDp: number; monthWd: number; balance: number }
/** Per-bank totals for any set of accounts (todayIdx -1 gives 0 for today). */
export function bankTotals(accts: BdtAccount[]): BankTotals[] {
  const m = new Map<string, BankTotals>()
  for (const a of accts) {
    const t = m.get(a.bank) ?? { bank: a.bank, accounts: 0, todayDp: 0, todayWd: 0, monthDp: 0, monthWd: 0, balance: 0 }
    t.accounts++; t.todayDp += a.todayDp ?? 0; t.todayWd += a.todayWd ?? 0; t.monthDp += a.monthDp; t.monthWd += a.monthWd; t.balance += a.balance
    m.set(a.bank, t)
  }
  return [...m.values()].map(t => ({ ...t, todayDp: round2(t.todayDp), todayWd: round2(t.todayWd), monthDp: round2(t.monthDp), monthWd: round2(t.monthWd), balance: round2(t.balance) }))
    .sort((a, b) => a.bank.localeCompare(b.bank))
}
