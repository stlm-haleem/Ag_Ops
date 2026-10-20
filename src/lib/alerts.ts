import { parseBdtLocalBank } from './bdtLocalBank'
import { parseInr } from './inr'
import { parseLocalBank } from './localBank'
import { AgentRow, BDT_LOCALBANK_SHEET, Dataset, INR_SHEET, LOCALBANK_SHEET, Settings } from './types'

/**
 * One flat list of everything that needs attention, across every currency and gateway, so the Operations pages
 * (Low Balance, High Balance, Alerts) and the Reports page read the same numbers as the gateway pages.
 */
export type OpsKind = 'low' | 'high' | 'discrep' | 'limit' | 'stopdate' | 'error'

export const KIND_LABEL: Record<OpsKind, string> = {
  low: 'Low balance', high: 'Higher balance', discrep: 'High discrepancy', limit: 'Limit exceeded', stopdate: 'Stop date on ACTIVE', error: 'Sheet error',
}
export const KIND_TONE: Record<OpsKind, 'red' | 'amber' | 'purple'> = { low: 'red', high: 'amber', discrep: 'red', limit: 'amber', stopdate: 'red', error: 'purple' }

export interface OpsItem {
  id: string
  currency: string
  /** SSG / MCG / BKK / Local Bank / Brand total / Merchant */
  gateway: string
  /** Brand when the item belongs to one (PKR BKK, INR, BDT Local Bank). */
  brand: string
  name: string
  balance: number | null
  kind: OpsKind
  detail: string
  /** Page that shows the item in full. */
  to: string
}

export const gatewayPath = (currency: string, gateway: string) =>
  currency === 'INR' ? '/currency/inr'
    : gateway === 'Local Bank' ? `/currency/${currency.toLowerCase()}/local-bank`
      : gateway === 'BKK' ? '/currency/pkr/bangkok-pay'
        : `/currency/${currency.toLowerCase()}/${gateway.toLowerCase()}`

export const gatewayLabel = (g: string) => (g === 'BKK' ? 'Bangkok-Pay' : g)

export function buildOps(rows: AgentRow[], dataset: Dataset | null, settings: Settings): OpsItem[] {
  const out: OpsItem[] = []
  for (const r of rows) {
    const base = { currency: r.currency, gateway: r.gateway, brand: r.brand, name: r.account, balance: r.rBal, to: gatewayPath(r.currency, r.gateway) }
    if (r.health === 'low') out.push({ ...base, id: `${r.id}|low`, kind: 'low', detail: 'Running balance is below the low threshold' })
    if (r.health === 'high') out.push({ ...base, id: `${r.id}|high`, kind: 'high', detail: r.actSdp > 0 ? `Running balance is above its SDP (${r.actSdp.toLocaleString('en-US')})` : 'Running balance is above the higher-balance threshold' })
    if (r.highDiscrep) out.push({ ...base, id: `${r.id}|discrep`, kind: 'discrep', detail: `Running − actual balance = ${r.discrep.toLocaleString('en-US', { maximumFractionDigits: 2 })}` })
    if (r.limitExceeded) out.push({ ...base, id: `${r.id}|limit`, kind: 'limit', detail: r.gateway === 'BKK' ? 'Marked EXCEED in the sheet' : 'Deposit is above the utilized limit' })
  }

  if (dataset) {
    // PKR Local Bank
    for (const a of parseLocalBank(dataset.sheets.find(s => s.name === LOCALBANK_SHEET), settings).accounts) {
      const base = { currency: 'PKR', gateway: 'Local Bank', brand: '', name: `${a.agent} · ${a.bankCode}`, balance: a.closing, to: '/currency/pkr/local-bank' }
      if (a.health === 'low') out.push({ ...base, id: `${a.id}|low`, kind: 'low', detail: 'Active account, closing balance below the low threshold' })
      if (a.health === 'high') out.push({ ...base, id: `${a.id}|high`, kind: 'high', detail: a.securityDeposit > 0 ? 'Closing balance is above its security deposit' : 'Closing balance is above the higher-balance threshold' })
      if (a.limitExceeded) out.push({ ...base, id: `${a.id}|limit`, kind: 'limit', detail: "Today's deposit / withdrawal is above the daily limit" })
      if (a.stopDateOnActive) out.push({ ...base, id: `${a.id}|stopdate`, kind: 'stopdate', detail: 'Status is ACTIVE but a stop date is filled in' })
    }
    // BDT Local Bank
    for (const a of parseBdtLocalBank(dataset.sheets.find(s => s.name === BDT_LOCALBANK_SHEET), settings).accounts) {
      const base = { currency: 'BDT', gateway: 'Local Bank', brand: a.brand, name: `${a.agent} · ${a.bankCode}`, balance: a.balance, to: '/currency/bdt/local-bank' }
      if (a.health === 'low') out.push({ ...base, id: `${a.id}|low`, kind: 'low', detail: 'Running balance is below the low threshold' })
      if (a.health === 'high') out.push({ ...base, id: `${a.id}|high`, kind: 'high', detail: 'Running balance is above the high threshold' })
      if (a.dpExceeded || a.wdExceeded) out.push({ ...base, id: `${a.id}|limit`, kind: 'limit', detail: `${a.dpExceeded ? 'Deposit' : ''}${a.dpExceeded && a.wdExceeded ? ' and ' : ''}${a.wdExceeded ? 'Withdrawal' : ''} above the daily limit today` })
    }
    // INR (thresholds are entered by hand on the INR page)
    for (const b of parseInr(dataset.sheets.find(s => s.name === INR_SHEET), settings.inr).brands) {
      const metrics = [
        { label: 'Total available balance', value: b.availableTotal as number | null, status: b.availableStatus, lim: b.availableLimits, tag: 'avail' },
        { label: 'Total WD balance', value: b.wdBalance, status: b.status, lim: b.limits, tag: 'wd' },
      ]
      for (const m of metrics) {
        const base = { currency: 'INR', gateway: 'Brand total', brand: b.brand, name: `${b.brand} · ${m.label}`, balance: m.value, to: '/currency/inr' }
        if (m.status === 'low') out.push({ ...base, id: `inr|${b.brand}|${m.tag}|low`, kind: 'low', detail: `Below the Low limit (${m.lim.low.toLocaleString('en-US')})` })
        if (m.status === 'high') out.push({ ...base, id: `inr|${b.brand}|${m.tag}|high`, kind: 'high', detail: `Above the High limit (${m.lim.high.toLocaleString('en-US')})` })
        if (m.status === 'error' && m.tag === 'wd') out.push({ ...base, id: `inr|${b.brand}|error`, kind: 'error', detail: b.wdFound ? `The sheet shows ${b.wdError} for this amount` : 'Not found in the Total WD Balance table' })
      }
      for (const l of b.lines) {
        const m = { currency: 'INR', gateway: 'Merchant', brand: b.brand, name: `${b.brand} · ${l.merchant}${l.code && l.code !== '-' ? ` (${l.code})` : ''}`, balance: l.balance, to: '/currency/inr' }
        if (l.status === 'low') out.push({ ...m, id: `inr|${l.key}|low`, kind: 'low', detail: `Below the Low limit (${l.limits.low.toLocaleString('en-US')})` })
        if (l.status === 'high') out.push({ ...m, id: `inr|${l.key}|high`, kind: 'high', detail: `Above the High limit (${l.limits.high.toLocaleString('en-US')})` })
      }
    }
  }
  return out
}
