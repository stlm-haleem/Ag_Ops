import { isActive } from './normalize'
import { AgentRow } from './types'

export interface Kpis {
  accounts: number
  loggedIn: number
  rBal: number
  aBal: number
  discrep: number
  deposit: number
  withdrawal: number
  adjustment: number
  flow: number
  high: number
  low: number
  highDiscrep: number
  limitExceeded: number
}

export function kpis(rows: AgentRow[]): Kpis {
  const k: Kpis = { accounts: rows.length, loggedIn: 0, rBal: 0, aBal: 0, discrep: 0, deposit: 0, withdrawal: 0, adjustment: 0, flow: 0, high: 0, low: 0, highDiscrep: 0, limitExceeded: 0 }
  for (const r of rows) {
    if (isActive(r)) k.loggedIn++
    k.rBal += r.rBal; k.aBal += r.aBal; k.discrep += r.discrep
    k.deposit += r.deposit; k.withdrawal += r.withdrawal; k.adjustment += r.adjustment
    if (r.health === 'high') k.high++
    if (r.health === 'low') k.low++
    if (r.highDiscrep) k.highDiscrep++
    if (r.limitExceeded) k.limitExceeded++
  }
  k.flow = k.deposit + k.withdrawal
  return k
}

export interface WalletStat { wallet: string; accounts: number; rBal: number; aBal: number; deposit: number; withdrawal: number; discrep: number }
export function byWallet(rows: AgentRow[]): WalletStat[] {
  const m = new Map<string, WalletStat>()
  for (const r of rows) {
    const s = m.get(r.wallet) ?? { wallet: r.wallet, accounts: 0, rBal: 0, aBal: 0, deposit: 0, withdrawal: 0, discrep: 0 }
    s.accounts++; s.rBal += r.rBal; s.aBal += r.aBal; s.deposit += r.deposit; s.withdrawal += r.withdrawal; s.discrep += r.discrep
    m.set(r.wallet, s)
  }
  return [...m.values()].sort((a, b) => b.rBal - a.rBal)
}

export const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
export const compact = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toFixed(0)
}

/** PKR-BKK: every agent row carries three wallets, so wallet totals are summed from the per-wallet columns. */
export interface BkkWalletStat { wallet: string; deposit: number; withdrawal: number; depEnabled: number; wdEnabled: number }
export function byBkkWallet(rows: AgentRow[]): BkkWalletStat[] {
  const defs: [string, 'depJazz' | 'depUpaisa' | 'depNaya', 'wdJazz' | 'wdUpaisa' | 'wdNaya', 'depStJazz' | 'depStUpaisa' | 'depStNaya', 'wdStJazz' | 'wdStUpaisa' | 'wdStNaya'][] = [
    ['JAZZCASH', 'depJazz', 'wdJazz', 'depStJazz', 'wdStJazz'],
    ['UPAISA', 'depUpaisa', 'wdUpaisa', 'depStUpaisa', 'wdStUpaisa'],
    ['NAYAPAY', 'depNaya', 'wdNaya', 'depStNaya', 'wdStNaya'],
  ]
  return defs.map(([wallet, d, w, ds, ws]) => ({
    wallet,
    deposit: rows.reduce((s, r) => s + r[d], 0),
    withdrawal: rows.reduce((s, r) => s + r[w], 0),
    depEnabled: rows.filter(r => r[ds] === 'Enable').length,
    wdEnabled: rows.filter(r => r[ws] === 'Enable').length,
  }))
}

/** Running balance per shop (PKR-BKK), largest first. */
export function byShop(rows: AgentRow[]) {
  const m = new Map<string, { shop: string; agents: number; rBal: number }>()
  for (const r of rows) {
    const s = m.get(r.shop) ?? { shop: r.shop || '—', agents: 0, rBal: 0 }
    s.agents++; s.rBal += r.rBal; m.set(r.shop, s)
  }
  return [...m.values()].sort((a, b) => b.rBal - a.rBal)
}
