import { INR_BRANDS, InrBrand, InrLimits, InrSettings, RawSheet } from './types'

/**
 * INR-OVERVIEW tab (a values-only copy of the main sheet's INR-OVERVIEW tab, uploaded as CSV / Excel).
 *
 * The tab stacks several small tables side by side, so it is read by finding each table's header, not by fixed row numbers:
 *   - "Merchant Balance": one block per brand (BRAND | MERCHANT | MERCHANT CODE | AVAILABLE BALANCE ... TOTAL AVAILABLE BALANCE)
 *   - "Total WD Balance": Brand | Amount | Current WD Range | Last Updated (the "Last Updated" column is empty in practice and ignored)
 *   - "LOCAL BANKS" / "LOCAL BANK BALANCE": INR Local Bank is permanently closed, so that part is ignored entirely.
 *
 * WD = withdrawal. A brand's Total WD Balance is taken exactly as the sheet prints it; it is never recomputed.
 * If the sheet shows an error such as #REF!, the brand is flagged as a sheet error and is not compared with thresholds.
 */

export type InrStatus = 'low' | 'high' | 'ok' | 'unset' | 'na' | 'error'

export interface InrMerchantLine {
  /** `${brand}|${merchant}|${code}`: the key used for per-merchant thresholds. */
  key: string
  brand: InrBrand
  merchant: string
  code: string
  /** null when the sheet cell is blank (the merchant has no balance entry). */
  balance: number | null
  limits: InrLimits
  status: InrStatus
}

export interface InrBrandSummary {
  brand: InrBrand
  /** false when the brand was not found in the Total WD Balance table. */
  wdFound: boolean
  /** Total WD Balance exactly as the sheet prints it; null when it is an error or blank. */
  wdBalance: number | null
  /** The sheet's own error text (e.g. #REF!) or 'blank'; '' when the amount is fine. */
  wdError: string
  wdRange: string
  /** "TOTAL AVAILABLE BALANCE" printed under the brand's merchant block. */
  sheetTotal: number | null
  /** Sum of the brand's merchant lines (blank balances count as 0). */
  lineTotal: number
  /** lineTotal − wdBalance: the part of the merchant balance the sheet leaves out of Total WD Balance. null when the WD balance is unavailable. */
  notInWd: number | null
  lines: InrMerchantLine[]
  limits: InrLimits
  status: InrStatus
}

export interface InrCheck { ok: boolean; label: string; detail: string }

export interface InrData {
  brands: InrBrandSummary[]
  lines: InrMerchantLine[]
  checks: InrCheck[]
  problems: string[]
}

export const EMPTY_INR: InrData = { brands: [], lines: [], checks: [], problems: [] }
export const NO_LIMITS: InrLimits = { low: 0, high: 0 }

export const brandLabel = (b: InrBrand) => (b === 'JEETBUZZ' ? 'JEETBUZZ' : b)
export const merchantKey = (brand: InrBrand, merchant: string, code: string) => `${brand}|${merchant}|${code}`

const text = (v: unknown) => String(v ?? '').trim()

/** BAJI / JEETBUZZ (JBZ) / SIX6S (6S) as written in either table. */
export function normalizeBrand(v: unknown): InrBrand | null {
  const t = text(v).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (t === 'BAJI' || t === 'BJ') return 'BAJI'
  if (t === 'JEETBUZZ' || t === 'JBZ' || t === 'JB') return 'JEETBUZZ'
  if (t === 'SIX6S' || t === '6S' || t === 'SIX6' || t === 'S6') return 'SIX6S'
  return null
}

/** Number, or a string such as "1,674,161.76". Returns null for blank / text / errors. */
export function parseAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = text(v).replace(/,/g, '').replace(/\s+/g, '')
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}

/** Status of one balance against a Low / High pair. 0 (or blank) means that side is off. */
export function rateBalance(value: number | null, l: InrLimits): InrStatus {
  if (value === null) return 'na'
  if (l.low > 0 && value < l.low) return 'low'
  if (l.high > 0 && value > l.high) return 'high'
  return l.low > 0 || l.high > 0 ? 'ok' : 'unset'
}

/** A pair is valid when both are ≥ 0 numbers and, if both are set, Low is below High. */
export function limitsError(l: { low: number; high: number }): string {
  if (!Number.isFinite(l.low) || !Number.isFinite(l.high)) return 'Enter numbers only'
  if (l.low < 0 || l.high < 0) return 'Cannot be negative'
  if (l.low > 0 && l.high > 0 && l.low >= l.high) return 'Low must be below High'
  return ''
}

export function parseInr(sheet: RawSheet | undefined, inr: InrSettings): InrData {
  if (!sheet) return EMPTY_INR
  const grid: unknown[][] = [sheet.header, ...sheet.rows].filter(Array.isArray) as unknown[][]
  const cell = (r: number, c: number) => (r >= 0 && r < grid.length ? grid[r][c] : undefined)
  const up = (r: number, c: number) => text(cell(r, c)).toUpperCase()
  const problems: string[] = []
  const checks: InrCheck[] = []

  // ---- Merchant balance blocks: header = BRAND | MERCHANT | MERCHANT CODE | AVAILABLE BALANCE
  interface Block { brand: InrBrand; lines: { merchant: string; code: string; balance: number | null }[]; sheetTotal: number | null }
  const blocks: Block[] = []
  for (let r = 0; r < grid.length; r++) {
    const width = grid[r].length
    for (let c = 0; c < width; c++) {
      if (up(r, c) !== 'BRAND' || up(r, c + 1) !== 'MERCHANT' || !up(r, c + 2).startsWith('MERCHANT CODE') || !up(r, c + 3).startsWith('AVAILABLE')) continue
      let brand: InrBrand | null = null
      const lines: Block['lines'] = []
      let sheetTotal: number | null = null
      for (let i = r + 1; i < grid.length; i++) {
        const first = up(i, c)
        if (first.startsWith('TOTAL AVAILABLE')) { sheetTotal = parseAmount(cell(i, c + 3)); break }
        if (first === 'BRAND') break // next block began without a total row
        if (first) { const b = normalizeBrand(cell(i, c)); if (b) brand = b; else problems.push(`Unrecognised brand "${text(cell(i, c))}" in the merchant balance table (row ${i + 2}).`) }
        const merchant = text(cell(i, c + 1))
        if (!merchant) continue
        lines.push({ merchant, code: text(cell(i, c + 2)), balance: parseAmount(cell(i, c + 3)) })
      }
      if (!brand) { problems.push(`A merchant balance block at row ${r + 2} has no recognisable brand and was skipped.`); continue }
      blocks.push({ brand, lines, sheetTotal })
    }
  }

  // ---- Total WD Balance table: header = Brand | Amount | Current WD Range
  interface Wd { found: boolean; balance: number | null; error: string; range: string }
  const wd = new Map<InrBrand, Wd>()
  for (let r = 0; r < grid.length && wd.size < INR_BRANDS.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (up(r, c) !== 'BRAND' || up(r, c + 1) !== 'AMOUNT') continue
      for (let i = r + 1; i < grid.length; i++) {
        const label = text(cell(i, c))
        if (!label) continue
        const b = normalizeBrand(label)
        if (!b) { problems.push(`Unrecognised brand "${label}" in the Total WD Balance table (row ${i + 2}).`); continue }
        const raw = cell(i, c + 1)
        const n = parseAmount(raw)
        const t = text(raw)
        wd.set(b, { found: true, balance: n, error: n !== null ? '' : t.startsWith('#') ? t : t ? `not a number ("${t}")` : 'blank', range: text(cell(i, c + 2)) })
      }
    }
  }

  const out: InrBrandSummary[] = INR_BRANDS.map(brand => {
    const own = blocks.filter(b => b.brand === brand)
    if (own.length > 1) problems.push(`${brand} appears in ${own.length} merchant balance blocks; the first one is used.`)
    const block = own[0]
    const limits = inr.brands[brand] ?? NO_LIMITS
    const lines: InrMerchantLine[] = (block?.lines ?? []).map(l => {
      const key = merchantKey(brand, l.merchant, l.code)
      const lim = inr.merchants[key] ?? NO_LIMITS
      return { key, brand, merchant: l.merchant, code: l.code, balance: l.balance, limits: lim, status: rateBalance(l.balance, lim) }
    })
    const w = wd.get(brand)
    const lineTotal = lines.reduce((s, l) => s + (l.balance ?? 0), 0)
    const wdBalance = w?.balance ?? null
    if (!block) problems.push(`${brand}: no merchant balance block found in the file.`)
    if (!w) problems.push(`${brand}: not found in the Total WD Balance table.`)
    if (block && block.sheetTotal !== null) {
      const ok = Math.abs(lineTotal - block.sheetTotal) < 0.02
      checks.push({ ok, label: `${brand}: merchant lines add up to the sheet's total`, detail: ok ? `${lineTotal.toFixed(2)}` : `Lines add to ${lineTotal.toFixed(2)} but the sheet prints ${block.sheetTotal.toFixed(2)}` })
    }
    if (w && w.error) checks.push({ ok: false, label: `${brand}: Total WD Balance`, detail: `The sheet shows ${w.error}. Fix that cell in INR-OVERVIEW and upload the CSV again.` })
    return {
      brand, wdFound: !!w, wdBalance, wdError: w?.error ?? '', wdRange: w?.range ?? '', sheetTotal: block?.sheetTotal ?? null, lineTotal,
      notInWd: wdBalance === null ? null : lineTotal - wdBalance, lines, limits,
      status: !w || w.error ? 'error' : rateBalance(wdBalance, limits),
    }
  })

  return { brands: out, lines: out.flatMap(b => b.lines), checks, problems }
}
