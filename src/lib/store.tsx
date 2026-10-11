import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as api from './api'
import { parseExcel } from './excel'
import { normalize } from './normalize'
import { AgentRow, AnalyticsEntry, DEFAULT_SETTINGS, Dataset, Settings } from './types'

interface Ctx {
  dataset: Dataset | null
  rows: AgentRow[]
  analytics: AnalyticsEntry[]
  settings: Settings
  loading: boolean
  progress: string
  error: string | null
  backendOk: boolean
  refresh: () => Promise<void>
  importExcel: (f: File) => Promise<{ uploaded: boolean; message: string }>
  switchToSheet: () => Promise<void>
  updateSettings: (s: Settings) => Promise<void>
  addAnalytics: (e: AnalyticsEntry[]) => Promise<void>
}

const C = createContext<Ctx>(null as unknown as Ctx)
export const useData = () => useContext(C)

const SETTINGS_KEY = 'settings-v1'
const mergeSettings = (s?: Partial<Settings>): Settings => ({
  thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(s?.thresholds ?? {}) },
})
const readLocalSettings = (): Settings | null => { try { const v = localStorage.getItem(SETTINGS_KEY); return v ? mergeSettings(JSON.parse(v)) : null } catch { return null } }

export function DataProvider({ children }: { children: ReactNode }) {
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [settings, setSettings] = useState<Settings>(() => readLocalSettings() ?? DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [backendOk, setBackendOk] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const ds = await api.fetchDataset(setProgress)
      setDataset(ds); setBackendOk(true)
      if (ds.settings?.thresholds) setSettings(mergeSettings(ds.settings))
    } catch (e: any) {
      setBackendOk(false)
      const cached = await api.loadCached()
      if (cached) { setDataset({ ...cached, source: cached.source === 'excel' ? 'excel' : 'cache' }); setError(`Backend unavailable (${e.message}). Showing last data saved in this browser.`) }
      else setError(`Backend unavailable (${e.message}). Import your Excel file in Admin → Data Sources to get started.`)
    } finally { setLoading(false); setProgress('') }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const rows = useMemo(() => (dataset ? normalize(dataset, settings) : []), [dataset, settings])
  const analytics = dataset?.analytics ?? []

  const importExcel = useCallback(async (file: File) => {
    setLoading(true); setError(null)
    try {
      setProgress('Reading Excel file…')
      const parsed = await parseExcel(file)
      // Keep manually-recorded daily history unless the file brings its own Analytics rows
      const next: Dataset = { ...parsed, analytics: parsed.analytics.length ? parsed.analytics : dataset?.analytics ?? [] }
      setDataset(next)
      await api.cacheDataset(next)
      let message = 'Imported into the app (saved in this browser only — backend not reachable).'
      let uploaded = false
      try {
        await api.uploadImport(next, setProgress)
        if (parsed.analytics.length) await api.saveAnalytics(parsed.analytics)
        uploaded = true; setBackendOk(true)
        message = 'Imported and saved to Google Drive. The previous import was replaced.'
        setDataset({ ...next, mode: 'drive' })
      } catch (e: any) { message = `Imported locally, but the Drive upload failed: ${e.message}` }
      return { uploaded, message }
    } finally { setLoading(false); setProgress('') }
  }, [dataset])

  const switchToSheet = useCallback(async () => { await api.setMode('auto'); await refresh() }, [refresh])

  const updateSettings = useCallback(async (s: Settings) => {
    setSettings(s)
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* ignore */ }
    try { await api.saveSettings(s) } catch { /* local copy still applies */ }
  }, [])

  const addAnalytics = useCallback(async (entries: AnalyticsEntry[]) => {
    await api.saveAnalytics(entries)
    setDataset(d => {
      if (!d) return d
      const list = [...d.analytics]
      for (const en of entries) {
        const i = list.findIndex(a => a.date === en.date && a.currency === en.currency && a.gateway === en.gateway)
        if (i >= 0) list[i] = en; else list.push(en)
      }
      list.sort((a, b) => a.date.localeCompare(b.date))
      return { ...d, analytics: list }
    })
  }, [])

  return <C.Provider value={{ dataset, rows, analytics, settings, loading, progress, error, backendOk, refresh, importExcel, switchToSheet, updateSettings, addAnalytics }}>{children}</C.Provider>
}
