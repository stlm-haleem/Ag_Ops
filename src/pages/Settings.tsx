import { useState } from 'react'
import { PageTitle } from '../components/Layout'
import { useData } from '../lib/store'
import { DEFAULT_SETTINGS, GROUPS, GROUP_LABEL, Settings } from '../lib/types'

export default function SettingsPage() {
  const { settings, updateSettings } = useData()
  const [draft, setDraft] = useState<Settings>(structuredClone(settings))
  const [saved, setSaved] = useState(false)
  const set = (g: (typeof GROUPS)[number], k: 'low' | 'discrep' | 'high', v: string) => { setSaved(false); setDraft(d => ({ ...d, thresholds: { ...d.thresholds, [g]: { ...d.thresholds[g], [k]: Number(v) || 0 } } })) }
  const setGw = (key: string, v: string) => { setSaved(false); setDraft(d => ({ ...d, gatewayBalance: { ...d.gatewayBalance, [key]: { high: Math.max(0, Number(v) || 0) } } })) }

  return (
    <>
      <PageTitle title="System Settings" subtitle="Balance and discrepancy thresholds apply instantly across dashboards." />
      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-2">Agent type</th><th className="px-4 py-2">Low balance if R. Bal &lt;</th><th className="px-4 py-2">High discrepancy if |R−A| ≥</th><th className="px-4 py-2">Higher balance if R. Bal &gt; (PKR BKK / Local Bank, when no SDP)</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {GROUPS.map(g => {
              const noActual = g.startsWith('BKK_') || g === 'LOCAL_BANK'
              return (
              <tr key={g}><td className="px-4 py-3 font-medium">{g.startsWith('BKK_') ? `PKR BKK · ${GROUP_LABEL[g]}` : g === 'LOCAL_BANK' ? `PKR ${GROUP_LABEL[g]}` : GROUP_LABEL[g]}</td>
                <td className="px-4 py-3"><input type="number" className="input w-40" value={draft.thresholds[g].low} onChange={e => set(g, 'low', e.target.value)} /></td>
                <td className="px-4 py-3">{noActual ? <span className="text-slate-400">n/a (no actual balance)</span> : <input type="number" className="input w-40" value={draft.thresholds[g].discrep} onChange={e => set(g, 'discrep', e.target.value)} />}</td>
                <td className="px-4 py-3">{noActual ? <input type="number" className="input w-40" value={draft.thresholds[g].high} onChange={e => set(g, 'high', e.target.value)} /> : <span className="text-slate-400">—</span>}</td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="card space-y-3 p-4">
        <div className="text-sm text-slate-600">Higher balance is determined per account: R. Bal above SDP is high; when SDP is blank or 0, the fallback is 100,000 for BDT SSG and 50,000 for MCG. <b>PKR SSG</b> has no fallback: an account without an SDP is treated as a locked account and is never flagged as higher balance.</div>
        <div className="text-sm font-semibold text-slate-700">Gateway total running balance — flag as HIGH above</div>
        <div className="flex flex-wrap gap-4">
          {Object.keys(draft.gatewayBalance).map(key => (
            <label key={key} className="text-xs text-slate-500">{key}
              <input type="number" min={0} className="input mt-1 block w-48" value={draft.gatewayBalance[key].high || ''} placeholder="Not set" onChange={e => setGw(key, e.target.value)} />
            </label>
          ))}
        </div>
        <div className="text-xs text-slate-400">Leave empty to turn the gateway threshold off.</div>
      </div>
      <div className="card space-y-1 p-4 text-sm text-slate-600">
        <div><b>Limit exceeded</b> = Deposit &gt; utilized limit. Utilized limit is <i>DP Bal Limit</i>; if it is blank/0, the merchant limit <i>MRC LMT</i> is used.</div>
        <div><b>Running balance</b> = Opening + Deposit − Withdrawal − Adjustment. <b>Discrepancy</b> = Running − Actual.</div>
        <div><b>MCG</b> has no DP Bal Limit, so its utilized limit is <i>MRC. Limit</i>. Its Wallet Balance is used as the actual balance, and Active / Disabled / Suspended is derived from Status and Transaction Status.</div>
        <div><b>PKR SSG</b> status is read from the sheet: login yes = Logged In, login no = Logged Out, locked account = Locked. Its running balance uses the same formula as BDT SSG, and its utilized limit is DP AVAILABLE LIMIT.</div>
        <div><b>PKR BKK</b> (BAJI, JEETBUZZ, SIX6S) has no actual balance, so there is no discrepancy. Running balance = Opening + Total deposit − Withdrawal − STLM/SPC − Top up. Higher balance = running balance above the account's SDP; with no SDP, the brand's own “Higher balance” threshold above is used. Limit exceeded comes from the sheet's EXCEED column.</div>
        <div><b>PKR Local Bank</b> (banks only, no e-wallets) is read from the MONITORING sheet. Closing balance comes from the sheet. Higher balance = an <i>active</i> account whose closing balance is above its security deposit; with no security deposit, the “Higher balance” threshold above is used. Low balance = an active account below the low threshold. Stopped accounts are not rated. “Today DP / WD” are the sheet's today totals (the sheet's “DP / WD ACCUMULATED” columns). Limit exceeded = today's DP or WD above the account's daily limit. Operation time is read as Philippines time (PHT, UTC+8) or Pakistan time (PKT, UTC+5); a time the app cannot read with certainty is shown as “Hours unclear”.</div>
        <div>All accounts are counted in the KPIs (logged in, logged out and locked). Critical is intentionally not flagged yet.</div>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={async () => { await updateSettings(draft); setSaved(true) }}>Save thresholds</button>
        <button className="btn" onClick={() => { setDraft(structuredClone(DEFAULT_SETTINGS)); setSaved(false) }}>Reset to defaults</button>
        {saved && <span className="text-sm text-emerald-600">Saved</span>}
      </div>
    </>
  )
}
