export type Group = 'AGENT' | 'PERSONAL' | 'VIP' | 'WITHDRAWAL' | 'PERMANENT_STOP' | 'MCG' | 'PKR_SSG' | 'BKK_BAJI' | 'BKK_JB' | 'BKK_6S' | 'LOCAL_BANK' | 'BDT_LOCAL_BANK'
export const GROUPS: Group[] = ['AGENT', 'PERSONAL', 'VIP', 'WITHDRAWAL', 'PERMANENT_STOP', 'MCG', 'PKR_SSG', 'BKK_BAJI', 'BKK_JB', 'BKK_6S', 'LOCAL_BANK', 'BDT_LOCAL_BANK']
/** Agent types shown as tabs for each currency-gateway (one type shows no tabs). Keyed like 'BDT-SSG'. */
export const GATEWAY_GROUPS: Record<string, Group[]> = {
  'BDT-SSG': ['AGENT', 'PERSONAL', 'VIP', 'WITHDRAWAL', 'PERMANENT_STOP'],
  'BDT-MCG': ['MCG'],
  'PKR-SSG': ['PKR_SSG'],
  'PKR-BKK': ['BKK_BAJI', 'BKK_JB', 'BKK_6S'],
}
export const GROUP_LABEL: Record<Group, string> = {
  AGENT: 'Agents',
  PERSONAL: 'Personal',
  VIP: 'VIP',
  WITHDRAWAL: 'Withdrawal only',
  PERMANENT_STOP: 'Permanent Stop',
  MCG: 'MCG Agents',
  PKR_SSG: 'PKR SSG Agents',
  BKK_BAJI: 'BAJI',
  BKK_JB: 'JEETBUZZ',
  BKK_6S: 'SIX6S',
  LOCAL_BANK: 'Local Bank',
  BDT_LOCAL_BANK: 'BDT Local Bank',
}
/** Brand name shown for each PKR-BKK group (the sheet's Brand column holds the same names). */
export const BKK_BRAND: Partial<Record<Group, string>> = { BKK_BAJI: 'BAJI', BKK_JB: 'JEETBUZZ', BKK_6S: 'SIX6S' }

/** Sheet tab name -> group. Add new tabs here when more gateways go live. */
export const SHEET_GROUP: Record<string, { group: Group; currency: string; gateway: string }> = {
  'BDT-SSG-AGENT': { group: 'AGENT', currency: 'BDT', gateway: 'SSG' },
  'BDT-SSG-PERSONAL': { group: 'PERSONAL', currency: 'BDT', gateway: 'SSG' },
  'BDT-SSG-VIP': { group: 'VIP', currency: 'BDT', gateway: 'SSG' },
  'BDT-SSG-WITHDRAWAL-ONLY': { group: 'WITHDRAWAL', currency: 'BDT', gateway: 'SSG' },
  'BDT-SSG-PERMANENT-STOP': { group: 'PERMANENT_STOP', currency: 'BDT', gateway: 'SSG' },
  'BDT-MCG': { group: 'MCG', currency: 'BDT', gateway: 'MCG' },
  'PKR-SSG': { group: 'PKR_SSG', currency: 'PKR', gateway: 'SSG' },
  // PKR-BKK is ONE tab for all three brands (copy of the Bangkok-Pay MONITORING sheet). The brand of every row comes from its
  // Brand column (see normalizeBkk), so the group below is only a placeholder.
  'PKR-BKK': { group: 'BKK_BAJI', currency: 'PKR', gateway: 'BKK' },
}
export const DATA_SHEETS = Object.keys(SHEET_GROUP)
/**
 * PKR Local Bank (banks only). The tab is a values-only copy of the MONITORING sheet of the Local Bank workbook, filled by
 * the Apps Script sync. It stacks several tables, so it is read by src/lib/localBank.ts, not by normalize() (not in SHEET_GROUP).
 */
export const LOCALBANK_SHEET = 'PKR-LOCALBANK'
/** Tabs filled automatically by an Apps Script sync; Excel imports must never wipe them. */
/**
 * BDT Local Bank: values-only copy of the MONITORING sheet (a wide per-day grid, BAJI table then JEETBUZZ table).
 * Read by src/lib/bdtLocalBank.ts, not by normalize() (not in SHEET_GROUP). The sheet is rebuilt every month under the same tab name.
 */
export const BDT_LOCALBANK_SHEET = 'BDT-LOCALBANK'
export const SYNCED_SHEETS = ['PKR-SSG', 'PKR-BKK', LOCALBANK_SHEET, BDT_LOCALBANK_SHEET]

/**
 * INR overview: values-only copy of the INR-OVERVIEW tab (merchant balances per brand + each brand's Total WD Balance).
 * Copied from LATEST BALANCES every 5 minutes by the Apps Script (syncINROverview); a CSV/Excel upload in Admin → Data Sources is the fallback; read by src/lib/inr.ts, not by normalize() (not in SHEET_GROUP).
 * INR Local Bank is permanently closed and is deliberately ignored.
 */
export const INR_SHEET = 'INR-OVERVIEW'
export type InrBrand = 'BAJI' | 'JEETBUZZ' | 'SIX6S'
export const INR_BRANDS: InrBrand[] = ['BAJI', 'JEETBUZZ', 'SIX6S']
/** 0 = that alert is off. */
export interface InrLimits { low: number; high: number }
export interface InrSettings {
  /** Low / high limit for each brand's Total WD Balance. */
  brands: Record<InrBrand, InrLimits>
  /** Low / high limit for each brand's Total Available Balance (all merchant balances added up). */
  available: Record<InrBrand, InrLimits>
  /** Optional low / high limit per merchant line, keyed `${brand}|${merchant}|${code}`. */
  merchants: Record<string, InrLimits>
}
export const DEFAULT_INR_SETTINGS: InrSettings = {
  brands: { BAJI: { low: 0, high: 0 }, JEETBUZZ: { low: 0, high: 0 }, SIX6S: { low: 0, high: 0 } },
  available: { BAJI: { low: 0, high: 0 }, JEETBUZZ: { low: 0, high: 0 }, SIX6S: { low: 0, high: 0 } },
  merchants: {},
}

export type Health = 'low' | 'high' | 'healthy'
/** SSG (BDT and PKR): Logged In / Logged Out / Locked. MCG: Active / Disabled / Suspended / Inactive / Locked. */
export type LoginState = string

export interface AgentRow {
  id: string
  account: string
  group: Group
  currency: string
  gateway: string
  actSdp: number
  mrcLmt: number
  dpBalLimit: number
  /** DP Bal Limit if present (>0), otherwise the merchant deposit limit */
  utilizedLimit: number
  opening: number
  deposit: number
  withdrawal: number
  adjustment: number
  /** PKR-SSG only (0 elsewhere) */
  unconfirmedWd: number
  charge: number
  commission: number
  topUp: number
  sdpPaid: number
  /**
   * PKR-BKK only (empty / 0 elsewhere): brand = BAJI / JEETBUZZ / SIX6S, one row per shop agent with 3 wallets.
   * Sheet mapping: deposit* = "Manual Credit" (Total Deposit), wd* = "Cash In" (Total Withdrawal), stlm = "Total Special Payment".
   */
  brand: string
  shop: string
  stlm: number
  depJazz: number
  depUpaisa: number
  depNaya: number
  wdJazz: number
  wdUpaisa: number
  wdNaya: number
  /** "Cash Out" per wallet (information only: the sheet does not use it in the running balance) */
  cashOut: number
  coJazz: number
  coUpaisa: number
  coNaya: number
  /** "Special Payment" per wallet */
  spJazz: number
  spUpaisa: number
  spNaya: number
  /** Limit: Available (= Allocation - Used), Allocation, Used, and Daily Available Balance per wallet */
  avJazz: number
  avUpaisa: number
  avNaya: number
  alJazz: number
  alUpaisa: number
  alNaya: number
  usJazz: number
  usUpaisa: number
  usNaya: number
  dbJazz: number
  dbUpaisa: number
  dbNaya: number
  /** OPENING + DEPOSIT - WITHDRAWAL - ADJUSTMENT (PKR-BKK: OPENING + DEPOSIT + TOP UP - WITHDRAWAL - SPECIAL PAYMENT) */
  rBal: number
  aBal: number
  /** R. BAL - A. BAL */
  discrep: number
  status: string
  login: LoginState
  code: string
  whrs: string
  wallet: string
  limitStatus: string
  acctType: string
  tags: string
  remarks: string
  health: Health
  highDiscrep: boolean
  limitExceeded: boolean
}

/** Raw dataset exactly as stored in Drive / returned by Apps Script / read from Excel */
export interface RawSheet { name: string; header: string[]; rows: unknown[][]; revision?: string }
export interface AnalyticsEntry { date: string; currency: string; gateway: string; deposit: number; withdrawal: number; note?: string }

export type DataSource = 'sheet' | 'drive' | 'excel' | 'cache'
export interface Dataset {
  source: DataSource
  updatedAt: string | null
  fileName?: string
  mode?: 'auto' | 'drive'
  sheetError?: string | null
  sheets: RawSheet[]
  analytics: AnalyticsEntry[]
  settings?: Partial<Settings>
  /** Revision fingerprint supplied by Apps Script to skip unchanged full downloads. */
  revision?: string
  /** Set when a filename identifies one operational tab (e.g. monitoring_vip_20261008_121023). */
  importTargetSheet?: string
}

export interface Threshold { low: number; high: number; discrep: number }
export interface Settings {
  thresholds: Record<Group, Threshold>
  /** Total running-balance threshold per gateway, keyed like 'BDT-SSG'. high = 0 means not set. */
  gatewayBalance: Record<string, { high: number }>
  /** INR thresholds, entered by hand on the INR page. */
  inr: InrSettings
}

export const DEFAULT_SETTINGS: Settings = {
  thresholds: {
    AGENT: { low: 5000, high: 50000, discrep: 10000 },
    PERSONAL: { low: 1000, high: 30000, discrep: 1000 },
    VIP: { low: 1000, high: 20000, discrep: 10000 },
    WITHDRAWAL: { low: 5000, high: 100000, discrep: 10000 },
    // Initial defaults match Withdrawal only; adjust in Admin → Settings to your operating thresholds.
    PERMANENT_STOP: { low: 5000, high: 100000, discrep: 10000 },
    MCG: { low: 1000, high: 30000, discrep: 5000 },
    // 'high' is unused for PKR SSG: higher balance is judged against each account's SDP.
    PKR_SSG: { low: 5000, high: 50000, discrep: 10000 },
    // PKR-BKK: no actual balance exists, so 'discrep' is unused. 'high' is the higher-balance limit for agents without an SDP.
    BKK_BAJI: { low: 5000, high: 100000, discrep: 0 },
    BKK_JB: { low: 5000, high: 100000, discrep: 0 },
    BKK_6S: { low: 5000, high: 100000, discrep: 0 },
    // PKR Local Bank: no actual balance. 'high' is the higher-balance limit for an active account without a security deposit (SDP).
    LOCAL_BANK: { low: 5000, high: 100000, discrep: 0 },
    // BDT Local Bank: set by hand in Settings. 0 = that alert is off (no balance rule is assumed).
    BDT_LOCAL_BANK: { low: 0, high: 0, discrep: 0 },
  },
  gatewayBalance: { 'BDT-SSG': { high: 0 }, 'BDT-MCG': { high: 0 }, 'PKR-SSG': { high: 0 }, 'PKR-BKK': { high: 0 } },
  inr: DEFAULT_INR_SETTINGS,
}
