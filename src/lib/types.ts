export type Group = 'AGENT' | 'PERSONAL' | 'VIP' | 'WITHDRAWAL'
export const GROUPS: Group[] = ['AGENT', 'PERSONAL', 'VIP', 'WITHDRAWAL']
export const GROUP_LABEL: Record<Group, string> = {
  AGENT: 'Agents',
  PERSONAL: 'Personal',
  VIP: 'VIP',
  WITHDRAWAL: 'Withdrawal only',
}

/** Sheet tab name -> group. Add new tabs here when more gateways go live. */
export const SHEET_GROUP: Record<string, { group: Group; currency: string; gateway: string }> = {
  'BDT-SSG-AGENT': { group: 'AGENT', currency: 'BDT', gateway: 'SSG' },
  'BDT-SSG-PERSONAL': { group: 'PERSONAL', currency: 'BDT', gateway: 'SSG' },
  'BDT-SSG-VIP': { group: 'VIP', currency: 'BDT', gateway: 'SSG' },
  'BDT-SSG-WITHDRAWAL-ONLY': { group: 'WITHDRAWAL', currency: 'BDT', gateway: 'SSG' },
}
export const DATA_SHEETS = Object.keys(SHEET_GROUP)

export type Health = 'low' | 'high' | 'healthy'
export type LoginState = 'Logged In' | 'Logged Out' | 'Locked'

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
export interface Settings { thresholds: Record<Group, Threshold> }

export const DEFAULT_SETTINGS: Settings = {
  thresholds: {
    AGENT: { low: 5000, high: 50000, discrep: 10000 },
    PERSONAL: { low: 1000, high: 30000, discrep: 1000 },
    VIP: { low: 1000, high: 20000, discrep: 10000 },
    WITHDRAWAL: { low: 5000, high: 100000, discrep: 10000 },
  },
}
