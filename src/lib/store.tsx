import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as api from './api'
import { parseExcel } from './excel'
import { normalize } from './normalize'
import { AgentRow, AnalyticsEntry, DEFAULT_INR_SETTINGS, DEFAULT_SETTINGS, Dataset, INR_SHEET, SYNCED_SHEETS, Settings } from './types'

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
  /** synced = false when the server copy could not be written (the browser copy still applies). */
  updateSettings: (s: Settings) => Promise<{ synced: boolean }>
  addAnalytics: (e: AnalyticsEntry[]) => Promise<void>
}

const C = createContext<Ctx>(null as unknown as Ctx)
export const useData = () => useContext(C)

const SETTINGS_KEY = 'settings-v1'
const mergeSettings = (s?: Partial<Settings>): Settings => ({
  thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(s?.thresholds ?? {}) },
  gatewayBalance: { ...DEFAULT_SETTINGS.gatewayBalance, ...(s?.gatewayBalance ?? {}) },
  inr: { brands: { ...DEFAULT_INR_SETTINGS.brands, ...(s?.inr?.brands ?? {}) }, merchants: { ...(s?.inr?.merchants ?? {}) } },
})
const readLocalSettings = (): Settings | null => { try { const v = localStorage.getItem(SETTINGS_KEY); return v ? mergeSettings(JSON.parse(v)) : null } catch { return null } }

export function DataProvider({ children }: { children: ReactNode }) {
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const datasetRef = useRef<Dataset | null>(null)
  const refreshInFlight = useRef(false)
  useEffect(() => { datasetRef.current = dataset }, [dataset])
  const [settings, setSettings] = useState<Settings>(() => readLocalSettings() ?? DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [backendOk, setBackendOk] = useState(false)
  const [needsPasscode, setNeedsPasscode] = useState(false)

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return
    refreshInFlight.current = true
    // Keep the current/cached dashboard visible during refreshes. Only show the
    // blocking loading state when there is no usable dataset yet.
    setLoading(current => datasetRef.current === null ? true : current)
    setRefreshing(true)
    setError(null)
    setNeedsPasscode(false)
    try {
      const ds = await api.fetchDataset(setProgress, datasetRef.current)
      datasetRef.current = ds
      setDataset(ds)
      await api.cacheDataset(ds)
      setBackendOk(true)
      if (ds.settings?.thresholds || ds.settings?.gatewayBalance || ds.settings?.inr) setSettings(mergeSettings(ds.settings))
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
      refreshInFlight.current = false
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

  // Keep the dashboard synchronized every 15 minutes. Revision checks avoid downloading
  // all rows when the source has not changed since the last successful refresh.
  useEffect(() => {
    const timer = window.setInterval(() => { void refresh() }, 15 * 60 * 1000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const rows = useMemo(() => (dataset ? normalize(dataset, settings) : []), [dataset, settings])
  const analytics = dataset?.analytics ?? []

  const importExcel = useCallback(async (file: File) => {
    setLoading(true); setError(null)
    try {
      setProgress('Reading Excel file…')
      const parsed = await parseExcel(file)
      // A named single-sheet import replaces only its matching tab in the local view;
      // a full workbook import replaces the complete operational dataset. Daily analytics
      // are always preserved independently of operational imports.
      // Tabs synced by Apps Script (PKR-SSG) and the upload-only INR tab are never touched by a full-workbook import
      // unless that workbook itself contains them.
      const mergedSheets = parsed.importTargetSheet && dataset
        ? [...dataset.sheets.filter(s => s.name !== parsed.importTargetSheet), ...parsed.sheets]
        : [...(dataset?.sheets.filter(s => (SYNCED_SHEETS.includes(s.name) || s.name === INR_SHEET) && !parsed.sheets.some(p => p.name === s.name)) ?? []), ...parsed.sheets]
      const next: Dataset = {
        ...parsed,
        source: 'excel',
        sheets: mergedSheets,
        analytics: dataset?.analytics ?? [],
        revision: undefined,
      }
      datasetRef.current = next
      setDataset(next)
      await api.cacheDataset(next)
      let message = 'Imported into this browser only; the server update did not complete.'
      let uploaded = false
      try {
        const result = await api.uploadImport(parsed, setProgress)
        uploaded = true; setBackendOk(true)
        const saved: Dataset = { ...next, source: 'sheet', mode: 'auto', revision: dataset ? result.revision : undefined, updatedAt: new Date().toISOString() }
        datasetRef.current = saved
        setDataset(saved)
        await api.cacheDataset(saved)
        message = parsed.importTargetSheet
          ? `Updated ${parsed.importTargetSheet} in Google Sheets and replaced its Drive backup. Other operational tabs and daily analytics were preserved.`
          : 'Replaced the operational dataset in Google Sheets and Drive. Daily analytics were preserved.'
      } catch (e: any) {
        setBackendOk(false)
        message = `The local preview was updated, but Google Sheets / Drive replacement failed: ${e.message}`
      }
      return { uploaded, message }
    } finally { setLoading(false); setProgress('') }
  }, [dataset])

  const submitPasscode = useCallback(async (p: string) => { api.setPasscode(p); await refresh() }, [refresh])

  const switchToSheet = useCallback(async () => { await api.setMode('auto'); await refresh() }, [refresh])

  const updateSettings = useCallback(async (s: Settings) => {
    setSettings(s)
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* ignore */ }
    try { await api.saveSettings(s); return { synced: true } } catch { return { synced: false } /* local copy still applies */ }
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
