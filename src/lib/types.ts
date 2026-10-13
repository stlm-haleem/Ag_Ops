export type Group = 'AGENT' | 'PERSONAL' | 'VIP' | 'WITHDRAWAL' | 'PERMANENT_STOP' | 'MCG' | 'PKR_SSG' | 'BKK_BAJI' | 'BKK_JB' | 'BKK_6S'
export const GROUPS: Group[] = ['AGENT', 'PERSONAL', 'VIP', 'WITHDRAWAL', 'PERMANENT_STOP', 'MCG', 'PKR_SSG', 'BKK_BAJI', 'BKK_JB', 'BKK_6S']
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
}
/** Brand name shown for each PKR-BKK group. */
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
  'PKR-BJ-BKK': { group: 'BKK_BAJI', currency: 'PKR', gateway: 'BKK' },
  'PKR-JB-BKK': { group: 'BKK_JB', currency: 'PKR', gateway: 'BKK' },
  'PKR-6S-BKK': { group: 'BKK_6S', currency: 'PKR', gateway: 'BKK' },
}
export const DATA_SHEETS = Object.keys(SHEET_GROUP)
/** Tabs filled automatically by an Apps Script sync; Excel imports must never wipe them. */
export const SYNCED_SHEETS = ['PKR-SSG', 'PKR-BJ-BKK', 'PKR-JB-BKK', 'PKR-6S-BKK']

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
  /** PKR-BKK only (empty / 0 elsewhere): brand = BAJI / JEETBUZZ / SIX6S, one row per shop agent with 3 wallets */
  brand: string
  shop: string
  stlm: number
  depJazz: number
  depUpaisa: number
  depNaya: number
  wdJazz: number
  wdUpaisa: number
  wdNaya: number
  /** Per-wallet status: Enable / Disable / Inactive (sheet icons ✅ ⭕ ❌) */
  depStJazz: string
  depStUpaisa: string
  depStNaya: string
  wdStJazz: string
  wdStUpaisa: string
  wdStNaya: string
  /** OPENING + DEPOSIT - WITHDRAWAL - ADJUSTMENT */
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
  },
  gatewayBalance: { 'BDT-SSG': { high: 0 }, 'BDT-MCG': { high: 0 }, 'PKR-SSG': { high: 0 }, 'PKR-BKK': { high: 0 } },
}
