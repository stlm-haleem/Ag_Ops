import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
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
  refreshing: boolean
  progress: string
  error: string | null
  backendOk: boolean
  needsPasscode: boolean
  submitPasscode: (p: string) => Promise<void>
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
  const datasetRef = useRef<Dataset | null>(null)
  useEffect(() => { datasetRef.current = dataset }, [dataset])
  const [settings, setSettings] = useState<Settings>(() => readLocalSettings() ?? DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [backendOk, setBackendOk] = useState(false)
  const [needsPasscode, setNeedsPasscode] = useState(false)

  const refresh = useCallback(async () => {
    // Keep the current/cached dashboard visible during refreshes. Only show the
    // blocking loading state when there is no usable dataset yet.
    setLoading(current => datasetRef.current === null ? true : current)
    setRefreshing(true)
    setError(null)
    setNeedsPasscode(false)
    try {
      const ds = await api.fetchDataset(setProgress)
      datasetRef.current = ds
      setDataset(ds)
      setBackendOk(true)
      if (ds.settings?.thresholds) setSettings(mergeSettings(ds.settings))
    } catch (e: any) {
      setBackendOk(false)
      if (e?.status === 401) {
        setNeedsPasscode(true)
        return
      }
      // Don't replace a usable current dataset with an older cache if refresh fails.
      if (datasetRef.current) {
        setError(`Refresh failed (${e.message}). Showing the data already loaded in this session.`)
      } else {
        const cached = await api.loadCached()
        if (cached) {
          setDataset({ ...cached, source: cached.source === 'excel' ? 'excel' : 'cache' })
          setError(`Backend unavailable (${e.message}). Showing saved browser data; it may be outdated.`)
        } else {
          setError(`Backend unavailable (${e.message}). Import your Excel file in Admin → Data Sources to get started.`)
        }
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
      setProgress('')
    }
  }, [])

  // On startup, hydrate from IndexedDB first so returning users can see their
  // previous dashboard while the live Google Sheets refresh runs in the background.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const cached = await api.loadCached()
      if (cancelled) return
      if (cached) {
        const localDataset = { ...cached, source: cached.source === 'excel' ? 'excel' as const : 'cache' as const }
        datasetRef.current = localDataset
        setDataset(localDataset)
        setLoading(false)
      }
      await refresh()
    })()
    return () => { cancelled = true }
  }, [refresh])


  const rows = useMemo(() => (dataset ? normalize(dataset, settings) : []), [dataset, settings])
  const analytics = dataset?.analytics ?? []

  const importExcel = useCallback(async (file: File) => {
    setLoading(true); setError(null)
    try {
      setProgress('Reading Excel file…')
      const parsed = await parseExcel(file)
      // Keep manually-recorded daily history unless the file brings its own Analytics rows
      const next: Dataset = { ...parsed, analytics: parsed.analytics.length ? parsed.analytics : dataset?.analytics ?? [] }
      datasetRef.current = next
      setDataset(next)
      await api.cacheDataset(next)
      let message = 'Imported into the app (saved in this browser only — backend not reachable).'
      let uploaded = false
      try {
        await api.uploadImport(next, setProgress)
        if (parsed.analytics.length) await api.saveAnalytics(parsed.analytics)
        uploaded = true; setBackendOk(true)
        message = 'Imported and saved to Google Drive. The previous import was replaced.'
        datasetRef.current = { ...next, mode: 'drive' }
        setDataset({ ...next, mode: 'drive' })
      } catch (e: any) { message = `Imported locally, but the Drive upload failed: ${e.message}` }
      return { uploaded, message }
    } finally { setLoading(false); setProgress('') }
  }, [dataset])

  const submitPasscode = useCallback(async (p: string) => { api.setPasscode(p); await refresh() }, [refresh])

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

  return <C.Provider value={{ dataset, rows, analytics, settings, loading, refreshing, progress, error, backendOk, needsPasscode, submitPasscode, refresh, importExcel, switchToSheet, updateSettings, addAnalytics }}>{children}</C.Provider>
}
