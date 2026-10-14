import { RawSheet, Settings } from './types'

/* ------------------------------------------------------------------------------------------------
 * PKR Local Bank (banks only, no e-wallets)
 *
 * Source: the MONITORING tab of the Local Bank workbook, copied (values only) into the tab PKR-LOCALBANK.
 * The tab is NOT a flat table. It stacks several tables in one sheet, so everything is located by its label:
 *
 *   1. Summary      AGENT | BANK CODE | BAJI | JEETBUZZ | SIX6S | TOTAL        (closing balance per brand, active accounts)
 *   2. Bank roll-up BANKS | DAILY (DEPOSIT, WITHDRAWAL) | MONTHLY (DEPOSIT, WITHDRAWAL) | AVERAGE ... | AVAILABLE ...
 *   3. ACTIVE ACCOUNTS   (one row per bank account)
 *   4. STOP ACCOUNTS     (same columns; STATUS = STOP or TEMPORARY STOP)
 *
 * The app deliberately ignores the AVERAGE / AVAILABLE LIMIT / DAY columns: the sheet's own figures there are not
 * reliable (the withdrawal "average" is really the month total, and the available limit counts unused accounts).
 * ---------------------------------------------------------------------------------------------- */

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

/** yyyy-MM-dd for real dates and ISO-looking strings; any other text (e.g. "8/6/25") is kept exactly as written. */
function dateText(v: unknown): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  const s = str(v)
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s)
  return m ? m[1] : s
}

/* ----------------------------------- operation time ----------------------------------- */

/** Philippines (PHT) is UTC+8 and Pakistan (PKT) is UTC+5. Neither observes daylight saving, so PHT = PKT + 3 hours all year. */
export const PHT_ZONE = 'Asia/Manila'
export const PKT_ZONE = 'Asia/Karachi'
const PHT_OFFSET_H = 8
const PKT_OFFSET_H = 5

export type OpHours =
  | { kind: 'always'; text: string }
  /** Window in minutes since 00:00 PHT. start > end means the window crosses midnight (e.g. 09:00 → 01:00). */
  | { kind: 'window'; start: number; end: number; text: string }
  | { kind: 'unknown'; text: string }

const RANGE = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/
function toMinutes(h: string, m: string | undefined, ap: string): number | null {
  const hh = Number(h), mm = m === undefined ? 0 : Number(m)
  if (!(hh >= 1 && hh <= 12) || !(mm >= 0 && mm <= 59)) return null
  return ((hh % 12) + (ap === 'PM' ? 12 : 0)) * 60 + mm
}

/**
 * Reads the OPERATION TIME text. It only answers when it is certain:
 *  - "24 HRS" is always in service;
 *  - every time range must name its own zone (PHT / PH Time, or Pakistan Time / PKT);
 *  - when the text gives the same hours in both zones ("1PM-10PM (Pakistan Time) / 4PM - 1 AM PHT") both must agree;
 *  - anything else is reported as unknown instead of guessing.
 */
export function parseOperationTime(raw: unknown): OpHours {
  const text = str(raw)
  const up = text.toUpperCase().replace(/\s+/g, ' ')
  const unknown: OpHours = { kind: 'unknown', text }
  if (!up) return unknown
  if (/^24 ?(HRS?|HOURS)\.?$/.test(up)) return { kind: 'always', text }
  let found: { start: number; end: number } | null = null
  for (const seg of up.split('/')) {
    const m = RANGE.exec(seg)
    if (!m) return unknown
    const pk = /PAKISTAN|\bPKT\b|\bPK\b/.test(seg)
    const ph = /\bPHT\b|\bPH\b|PHILIPP/.test(seg)
    if (pk === ph) return unknown // no zone named, or both named in one segment
    const s = toMinutes(m[1], m[2], m[3]), e = toMinutes(m[4], m[5], m[6])
    if (s === null || e === null) return unknown
    const shift = ((pk ? PKT_OFFSET_H : PHT_OFFSET_H) * -1 + PHT_OFFSET_H) * 60 // minutes to add to reach PHT
    const start = (s + shift + 1440) % 1440, end = (e + shift + 1440) % 1440
    if (start === end) return unknown
    if (found && (found.start !== start || found.end !== end)) return unknown
    found = { start, end }
  }
  return found ? { kind: 'window', ...found, text } : unknown
}

/** Minutes since midnight in the given time zone right now. */
export function minutesNow(zone: string, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0)
  return get('hour') * 60 + get('minute')
}

export const clock = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const toPkt = (phtMin: number) => (phtMin - (PHT_OFFSET_H - PKT_OFFSET_H) * 60 + 1440) % 1440

export interface ServiceState {
  state: 'open' | 'closed' | 'always' | 'unknown'
  /** e.g. "09:00–01:00 PHT · 06:00–22:00 PKT" */
  label: string
  /** e.g. "until 01:00 PHT (22:00 PKT)" */
  next: string
}
export function serviceState(h: OpHours, at: Date = new Date()): ServiceState {
  if (h.kind === 'always') return { state: 'always', label: '24 hrs', next: '' }
  if (h.kind === 'unknown') return { state: 'unknown', label: h.text || '—', next: '' }
  const now = minutesNow(PHT_ZONE, at)
  const open = h.start < h.end ? now >= h.start && now < h.end : now >= h.start || now < h.end
  const pair = (m: number) => `${clock(m)} PHT (${clock(toPkt(m))} PKT)`
  return {
    state: open ? 'open' : 'closed',
    label: `${clock(h.start)}–${clock(h.end)} PHT · ${clock(toPkt(h.start))}–${clock(toPkt(h.end))} PKT`,
    next: open ? `until ${pair(h.end)}` : `opens ${pair(h.start)}`,
  }
}

/* ------------------------------------------------ data model ------------------------------------------------ */

export type BankState = 'ACTIVE' | 'TEMPORARY' | 'STOP' | 'OTHER'
export type BankHealth = 'low' | 'high' | 'healthy' | 'na'

export interface LocalBankAccount {
  id: string
  section: 'ACTIVE' | 'STOP'
  leader: string
  agent: string
  bankCode: string
  bank: string
  accountName: string
  accountNumber: string
  opening: number
  closing: number
  securityDeposit: number
  dpLimit: number
  wdLimit: number
  /** DP / WD "ACCUMULATED" in the sheet are TODAY's totals (the sheet formulas use TODAY()), not a running total. */
  todayDp: number
  todayWd: number
  /** "TOTALL DP USED" = deposits received this month (active table only). */
  monthDp: number
  hoursText: string
  hours: OpHours
  statusText: string
  state: BankState
  dateStart: string
  dateStop: string
  remarks: string
  /** Balance per brand (active accounts listed in the summary table); null when the account is not in the summary. */
  baji: number | null
  jeetbuzz: number | null
  six6s: number | null
  health: BankHealth
  /** ACTIVE in the sheet but a stop date is filled in. */
  stopDateOnActive: boolean
  limitExceeded: boolean
}

export interface BankRollup { bank: string; todayDp: number; todayWd: number; monthDp: number; monthWd: number }
export interface BrandSummaryRow { agent: string; bankCode: string; baji: number; jeetbuzz: number; six6s: number; total: number }
export interface DataCheck { ok: boolean; label: string; detail: string }

export interface LocalBankData {
  accounts: LocalBankAccount[]
  banks: BankRollup[]
  summary: BrandSummaryRow[]
  checks: DataCheck[]
  problems: string[]
}

/** MEEZAN539203 -> MEEZAN, ALLIEDBANK110014 -> ALLIEDBANK */
export const bankOf = (bankCode: string) => /^[A-Za-z]+/.exec(bankCode.trim())?.[0].toUpperCase() ?? bankCode.trim().toUpperCase()

export function stateOf(status: string): BankState {
  const s = norm(status)
  if (s === 'ACTIVE') return 'ACTIVE'
  if (s === 'TEMPORARY STOP') return 'TEMPORARY'
  if (s === 'STOP') return 'STOP'
  return 'OTHER'
}

export function parseLocalBank(sheet: RawSheet | undefined, settings: Settings): LocalBankData {
  const empty: LocalBankData = { accounts: [], banks: [], summary: [], checks: [], problems: [] }
  if (!sheet) return empty
  // Row 1 of the sheet arrives as the "header"; the real tables start below it.
  const grid: unknown[][] = [sheet.header, ...sheet.rows].filter(Array.isArray) as unknown[][]
  const problems: string[] = []
  const cell = (r: number, c: number) => (c < 0 ? undefined : grid[r]?.[c])

  /* ---- 1. summary (brand balances) and 2. bank roll-up share the same header row ---- */
  const summary: BrandSummaryRow[] = []
  const banks: BankRollup[] = []
  const sumAt = grid.findIndex(r => { const n = r.map(norm); return n.includes('AGENT') && n.includes('BANK CODE') && n.includes('BAJI') && n.includes('JEETBUZZ') && n.includes('SIX6S') })
  if (sumAt < 0) problems.push('Brand summary table (AGENT / BANK CODE / BAJI / JEETBUZZ / SIX6S) not found.')
  else {
    const h = grid[sumAt].map(norm)
    const c = { agent: h.indexOf('AGENT'), code: h.indexOf('BANK CODE'), baji: h.indexOf('BAJI'), jb: h.indexOf('JEETBUZZ'), s6: h.indexOf('SIX6S'), total: h.indexOf('TOTAL') }
    for (let i = sumAt + 1; i < grid.length; i++) {
      const agent = str(cell(i, c.agent))
      if (!agent || norm(agent) === 'TOTAL') break
      const baji = num(cell(i, c.baji)), jeetbuzz = num(cell(i, c.jb)), six6s = num(cell(i, c.s6))
      summary.push({ agent, bankCode: str(cell(i, c.code)), baji, jeetbuzz, six6s, total: c.total >= 0 ? num(cell(i, c.total)) : round2(baji + jeetbuzz + six6s) })
    }
    const b = h.indexOf('BANKS'), d = h.findIndex(x => x.startsWith('DAILY TRANSACTION')), m = h.findIndex(x => x.startsWith('MONTHLY TRANSACTION'))
    if (b >= 0 && d >= 0 && m >= 0) {
      // Sub-header (DEPOSIT / WITHDRAWAL) sits on the next row; check it so a shifted layout is caught instead of misread.
      const sub = grid[sumAt + 1]?.map(norm) ?? []
      if (sub[d] === 'DEPOSIT' && sub[d + 1] === 'WITHDRAWAL' && sub[m] === 'DEPOSIT' && sub[m + 1] === 'WITHDRAWAL') {
        for (let i = sumAt + 1; i < Math.min(grid.length, sumAt + 12); i++) {
          const name = norm(cell(i, b))
          if (!name) continue
          if (name === 'TOTAL') break
          banks.push({ bank: name, todayDp: num(cell(i, d)), todayWd: num(cell(i, d + 1)), monthDp: num(cell(i, m)), monthWd: num(cell(i, m + 1)) })
        }
      } else problems.push('Bank roll-up columns are not where expected (DEPOSIT / WITHDRAWAL under DAILY and MONTHLY).')
    } else problems.push('Bank roll-up table (BANKS / DAILY / MONTHLY) not found.')
  }

  /* ---- 3. active and 4. stop account tables ---- */
  const t = settings.thresholds.LOCAL_BANK
  const accounts: LocalBankAccount[] = []
  const readTable = (title: string, section: 'ACTIVE' | 'STOP') => {
    const at = grid.findIndex(r => r.some(x => norm(x) === title))
    if (at < 0) { problems.push(`"${title}" table not found.`); return }
    const hAt = [1, 2, 3].map(k => at + k).find(i => grid[i] && grid[i].map(norm).includes('LEADER') && grid[i].map(norm).includes('AGENT'))
    if (hAt === undefined) { problems.push(`Header row of "${title}" not found.`); return }
    const h = grid[hAt].map(norm)
    const ix = (...names: string[]) => h.findIndex(x => names.includes(x))
    const c = {
      leader: ix('LEADER'), agent: ix('AGENT'), code: ix('BANK CODE'), name: ix('ACOUNT NAME', 'ACCOUNT NAME'), number: ix('ACCOUNT NUMBER'),
      opening: ix('OPENING BALANCE'), closing: ix('CLOSING BALANCE'), sd: ix('SECURITY DEPOSIT'), dpLim: ix('DP DAILY LIMIT'), wdLim: ix('WD DAILY LIMIT'),
      dpAcc: ix('DP ACCUMULATED'), wdAcc: ix('WD ACCUMULATED'), monthDp: ix('TOTALL DP USED', 'TOTAL DP USED'), hours: ix('OPERATION TIME'),
      status: ix('STATUS'), start: ix('DATE START'), stop: ix('DATE STOP'), remarks: ix('REMARKS'),
    }
    const need: [string, number][] = [['AGENT', c.agent], ['BANK CODE', c.code], ['CLOSING BALANCE', c.closing], ['STATUS', c.status]]
    const missing = need.filter(([, i]) => i < 0).map(([n]) => n)
    if (missing.length) { problems.push(`"${title}": column(s) not found: ${missing.join(', ')}.`); return }
    for (let i = hAt + 1; i < grid.length; i++) {
      const agent = str(cell(i, c.agent)), leader = str(cell(i, c.leader))
      if (!agent && !leader) break // blank row or the TOTAL row ends the table
      if (!agent) continue
      const bankCode = str(cell(i, c.code))
      const statusText = str(cell(i, c.status))
      const state = stateOf(statusText)
      const closing = num(cell(i, c.closing))
      const securityDeposit = num(cell(i, c.sd))
      const dpLimit = num(cell(i, c.dpLim)), wdLimit = num(cell(i, c.wdLim))
      const todayDp = num(cell(i, c.dpAcc)), todayWd = num(cell(i, c.wdAcc))
      const dateStop = dateText(cell(i, c.stop))
      const hoursText = str(cell(i, c.hours))
      const high = securityDeposit > 0 ? securityDeposit : t.high
      accounts.push({
        id: `${section}:${agent}:${bankCode}`, section, leader, agent, bankCode, bank: bankOf(bankCode),
        accountName: str(cell(i, c.name)), accountNumber: str(cell(i, c.number)),
        opening: num(cell(i, c.opening)), closing, securityDeposit, dpLimit, wdLimit, todayDp, todayWd,
        monthDp: section === 'ACTIVE' ? num(cell(i, c.monthDp)) : 0,
        hoursText, hours: parseOperationTime(hoursText), statusText, state,
        dateStart: dateText(cell(i, c.start)), dateStop, remarks: str(cell(i, c.remarks)),
        baji: null, jeetbuzz: null, six6s: null,
        health: state !== 'ACTIVE' ? 'na' : closing < t.low ? 'low' : closing > high ? 'high' : 'healthy',
        stopDateOnActive: state === 'ACTIVE' && dateStop !== '',
        limitExceeded: (dpLimit > 0 && todayDp > dpLimit) || (wdLimit > 0 && todayWd > wdLimit),
      })
    }
  }
  readTable('ACTIVE ACCOUNTS', 'ACTIVE')
  readTable('STOP ACCOUNTS', 'STOP')

  // Attach the brand split (summary table) to the matching active account.
  for (const a of accounts) {
    if (a.section !== 'ACTIVE') continue
    const s = summary.find(x => x.agent === a.agent && x.bankCode === a.bankCode)
    if (s) { a.baji = s.baji; a.jeetbuzz = s.jeetbuzz; a.six6s = s.six6s }
  }

  /* ---- consistency checks between the sheet's own tables ---- */
  const checks: DataCheck[] = []
  const active = accounts.filter(a => a.section === 'ACTIVE')
  if (summary.length && active.length) {
    const sumTotal = round2(summary.reduce((s, r) => s + r.total, 0))
    const actTotal = round2(active.reduce((s, a) => s + a.closing, 0))
    checks.push({ ok: Math.abs(sumTotal - actTotal) < 0.01, label: 'Summary total = active closing balances', detail: `${sumTotal.toLocaleString('en-US')} vs ${actTotal.toLocaleString('en-US')}` })
    const brandBad = summary.filter(r => Math.abs(round2(r.baji + r.jeetbuzz + r.six6s) - r.total) >= 0.01)
    checks.push({ ok: !brandBad.length, label: 'BAJI + JEETBUZZ + SIX6S = total (each agent)', detail: brandBad.length ? brandBad.map(r => r.agent).join(', ') : 'all agents match' })
    const perAcct = summary.filter(r => { const a = active.find(x => x.agent === r.agent && x.bankCode === r.bankCode); return !a || Math.abs(a.closing - r.total) >= 0.01 })
    checks.push({ ok: !perAcct.length, label: 'Summary balance = account closing balance (each agent)', detail: perAcct.length ? perAcct.map(r => r.agent).join(', ') : 'all agents match' })
  }
  return { accounts, banks, summary, checks, problems }
}
