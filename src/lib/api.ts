import { get, set } from 'idb-keyval'
import { AnalyticsEntry, Dataset, RawSheet, Settings } from './types'

export class ApiError extends Error { status: number; constructor(m: string, status: number) { super(m); this.status = status } }
const BASE = '/api/proxy'
const CACHE_KEY = 'dataset-cache-v1'
const PASS_KEY = 'app-passcode'

export const getPasscode = () => { try { return localStorage.getItem(PASS_KEY) || '' } catch { return '' } }
export const setPasscode = (p: string) => { try { localStorage.setItem(PASS_KEY, p) } catch { /* ignore */ } }

async function call<T>(action: string, params: Record<string, string | number> = {}, body?: unknown): Promise<T> {
  const qs = new URLSearchParams({ action, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) })
  const res = await fetch(`${BASE}?${qs}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-passcode': getPasscode() },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) } catch { throw new ApiError(res.ok ? 'Backend returned a non-JSON response' : `Backend error ${res.status}`, res.status) }
  if (!res.ok || json?.error) throw new ApiError(json?.error || `Backend error ${res.status}`, res.status)
  return json as T
}

interface Manifest {
  mode: 'auto' | 'drive'
  source: 'sheet' | 'drive'
  updatedAt: string | null
  revision?: string
  sheetError: string | null
  sheets: { name: string; header: string[]; rowCount: number; revision?: string }[]
  analytics: AnalyticsEntry[]
  settings: Partial<Settings>
}

const PAGE = 4000
const MAX_PARALLEL_REQUESTS = 3

/** Fetch a small number of sheet chunks concurrently to reduce sequential round-trip time. */
export async function fetchDataset(onProgress?: (msg: string) => void, knownDataset?: Dataset | null): Promise<Dataset> {
  const startedAt = performance.now()
  onProgress?.('Checking latest data version…')
  const m = await call<Manifest>('manifest')
  // If the source revision is unchanged, reuse all cached rows and skip every rows request.
  if (knownDataset && m.revision && knownDataset.revision === m.revision) {
    onProgress?.('No data changes detected; keeping the current dataset.')
    return { ...knownDataset, source: m.source, mode: m.mode, updatedAt: m.updatedAt, sheetError: m.sheetError,
      analytics: m.analytics, settings: m.settings, revision: m.revision }
  }

  const sourceChanged = !!knownDataset && knownDataset.source !== 'cache' && knownDataset.source !== m.source
  let reloadNames = new Set<string>()
  if (!knownDataset || sourceChanged) {
    m.sheets.forEach(s => reloadNames.add(s.name))
  } else {
    m.sheets.forEach(s => {
      const old = knownDataset.sheets.find(x => x.name === s.name)
      const sameHeader = !!old && old.header.length === s.header.length && old.header.every((v, i) => v === s.header[i])
      if (!old || old.revision !== s.revision || old.rows.length !== s.rowCount || !sameHeader) reloadNames.add(s.name)
    })
    // A source-level change without a per-sheet revision signal means a change may have
    // bypassed Apps Script's edit tracking. Fall back to a full refresh for correctness.
    if (!reloadNames.size && m.revision !== knownDataset.revision) m.sheets.forEach(s => reloadNames.add(s.name))
  }

  const sheets: RawSheet[] = m.sheets.map(sheet => {
    const old = knownDataset?.sheets.find(x => x.name === sheet.name)
    if (!reloadNames.has(sheet.name) && old) return { ...old, revision: sheet.revision }
    return { name: sheet.name, header: sheet.header, revision: sheet.revision, rows: new Array(sheet.rowCount) }
  })
  const jobs: { sheetIndex: number; sheet: Manifest['sheets'][number]; offset: number }[] = []
  m.sheets.forEach((sheet, sheetIndex) => {
    if (!reloadNames.has(sheet.name)) return
    for (let offset = 0; offset < sheet.rowCount; offset += PAGE) jobs.push({ sheetIndex, sheet, offset })
  })

  let completed = 0
  let nextJob = 0
  const workers = Array.from({ length: Math.min(MAX_PARALLEL_REQUESTS, jobs.length) }, async () => {
    while (nextJob < jobs.length) {
      const jobIndex = nextJob++
      const job = jobs[jobIndex]
      const end = Math.min(job.offset + PAGE, job.sheet.rowCount)
      onProgress?.(`Loading changed data (${completed.toLocaleString()} / ${jobs.length} batches) · ${job.sheet.name}`)
      const result = await call<{ rows: unknown[][] }>('rows', { sheet: job.sheet.name, offset: job.offset, limit: PAGE })
      result.rows.forEach((row, index) => { sheets[job.sheetIndex].rows[job.offset + index] = row })
      completed++
      onProgress?.(`Loaded ${completed.toLocaleString()} / ${jobs.length} batches · ${job.sheet.name} (${end.toLocaleString()} / ${job.sheet.rowCount.toLocaleString()})`)
    }
  })
  await Promise.all(workers)

  const ds: Dataset = {
    source: m.source, mode: m.mode, updatedAt: m.updatedAt, revision: m.revision,
    sheetError: m.sheetError, sheets, analytics: m.analytics, settings: m.settings,
  }
  await cacheDataset(ds)
  const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1)
  onProgress?.(jobs.length ? `Data refreshed in ${elapsed}s` : 'Data version updated; no operational rows needed downloading.')
  return ds
}

export async function cacheDataset(ds: Dataset) { try { await set(CACHE_KEY, ds) } catch { /* ignore */ } }
export async function loadCached(): Promise<Dataset | null> { try { return (await get(CACHE_KEY)) ?? null } catch { return null } }

/** Upload an Excel import in bounded JSON chunks, then replace either one detected tab or the whole operational dataset. */
export async function uploadImport(ds: Dataset, onProgress?: (msg: string) => void): Promise<{ revision?: string }> {
  const importId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now()}${Math.random().toString(16).slice(2)}`
  const MAX_CHUNK_CHARS = 1_200_000 // safely below the standard Vercel request-body limit for typical spreadsheet rows
  const sheetsMeta: { name: string; rowCount: number; chunkCount: number }[] = []

  for (const s of ds.sheets) {
    let chunk: unknown[][] = []
    let chunkChars = 2
    let index = 0
    let startRow = 0
    const uploadChunk = async (rows: unknown[][], chunkIndex: number) => {
      onProgress?.(`Uploading ${s.name} · batch ${chunkIndex + 1}`)
      await call('importChunk', {}, { importId, sheet: s.name, index: chunkIndex, startRow,
        header: chunkIndex === 0 ? s.header : undefined, rows })
      startRow += rows.length
    }

    for (const row of s.rows) {
      const rowChars = JSON.stringify(row).length + 1
      if (chunk.length && chunkChars + rowChars > MAX_CHUNK_CHARS) {
        await uploadChunk(chunk, index++)
        chunk = []
        chunkChars = 2
      }
      chunk.push(row)
      chunkChars += rowChars
    }
    // Always send one chunk so an empty sheet can intentionally replace existing records.
    if (chunk.length || index === 0) await uploadChunk(chunk, index++)
    sheetsMeta.push({ name: s.name, rowCount: s.rows.length, chunkCount: index })
  }

  onProgress?.('Validating import and replacing the selected Google Sheet / Drive backup…')
  const result = await call<{ revision?: string }>('importCommit', {}, {
    importId,
    sheets: sheetsMeta,
    fileName: ds.fileName || '',
    replaceMode: ds.importTargetSheet ? 'selected' : 'all',
    targetSheet: ds.importTargetSheet || '',
  })
  onProgress?.('Import completed.')
  return result
}

/** Ask Apps Script to record today's deposit/withdrawal totals now (same job as the end-of-day trigger). */
export const recordDaily = () => call<{ ok: boolean; recorded: AnalyticsEntry[]; skipped: string[] }>('recordDaily', {}, {})
export const setMode = (mode: 'auto' | 'drive') => call('setMode', { mode })
export const saveAnalytics = (entries: AnalyticsEntry[]) => call('saveAnalytics', {}, { entries })
export const saveSettings = (settings: Settings) => call('saveSettings', {}, { settings })
export const ping = () => call<{ ok: boolean }>('ping')
