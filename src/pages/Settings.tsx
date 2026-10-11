import { useState } from 'react'
import { PageTitle } from '../components/Layout'
import { useData } from '../lib/store'
import { DEFAULT_SETTINGS, GROUPS, GROUP_LABEL, Settings } from '../lib/types'

export default function SettingsPage() {
  const { settings, updateSettings } = useData()
  const [draft, setDraft] = useState<Settings>(structuredClone(settings))
  const [saved, setSaved] = useState(false)
  const set = (g: (typeof GROUPS)[number], k: 'low' | 'high' | 'discrep', v: string) => { setSaved(false); setDraft(d => ({ thresholds: { ...d.thresholds, [g]: { ...d.thresholds[g], [k]: Number(v) || 0 } } })) }

  return (
    <>
      <PageTitle title="System Settings" subtitle="Thresholds are set per agent type and apply instantly to all dashboards (BDT)." />
      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-2">Agent type</th><th className="px-4 py-2">Low balance if R. Bal &lt;</th><th className="px-4 py-2">High balance if R. Bal &gt;</th><th className="px-4 py-2">High discrepancy if |R−A| ≥</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {GROUPS.map(g => (
              <tr key={g}><td className="px-4 py-3 font-medium">{GROUP_LABEL[g]}</td>
                {(['low', 'high', 'discrep'] as const).map(k => <td key={k} className="px-4 py-3"><input type="number" className="input w-40" value={draft.thresholds[g][k]} onChange={e => set(g, k, e.target.value)} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card space-y-1 p-4 text-sm text-slate-600">
        <div><b>Limit exceeded</b> = Deposit &gt; utilized limit. Utilized limit is <i>DP Bal Limit</i>; if it is blank/0, the merchant limit <i>MRC LMT</i> is used.</div>
        <div><b>Running balance</b> = Opening + Deposit − Withdrawal − Adjustment. <b>Discrepancy</b> = Running − Actual.</div>
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
