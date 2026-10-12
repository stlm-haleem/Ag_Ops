import * as XLSX from 'xlsx'
import { DATA_SHEETS, Dataset, RawSheet, SHEET_GROUP } from './types'

const normalizeToken = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

/** Infer the one tab to replace from a descriptive filename. Filename takes precedence over workbook tab names. */
export function detectImportTarget(fileName: string): string | null {
  const token = normalizeToken(fileName.replace(/\.[^.]+$/, ''))
  if (/(^|_)mcg(_|$)/.test(token)) return 'BDT-MCG'
  // Check the more specific group first so "withdrawal_only" cannot be mistaken for a general agent file.
  if (/(^|_)(permanent_stop|permanentstop|permanent)(_|$)/.test(token)) return 'BDT-SSG-PERMANENT-STOP'
  if (/(^|_)(withdrawal_only|withdraw_only|withdrawal|withdraw)(_|$)/.test(token)) return 'BDT-SSG-WITHDRAWAL-ONLY'
  if (/(^|_)(personal|personals)(_|$)/.test(token)) return 'BDT-SSG-PERSONAL'
  if (/(^|_)vip(_|$)/.test(token)) return 'BDT-SSG-VIP'
  if (/(^|_)(agent|agents)(_|$)/.test(token)) return 'BDT-SSG-AGENT'
  // Also accept the canonical sheet names when included in a filename.
  for (const name of DATA_SHEETS) {
    if (token.includes(normalizeToken(name))) return name
  }
  return null
}

export function importTargetLabel(sheetName: string): string {
  const group = SHEET_GROUP[sheetName]?.group
  if (group === 'MCG') return 'BDT · MCG'
  if (group === 'WITHDRAWAL') return 'BDT · SSG · Withdrawal only'
  if (group === 'PERMANENT_STOP') return 'BDT · SSG · Permanent Stop'
  if (group) return `BDT · SSG · ${group === 'AGENT' ? 'Agents' : group === 'PERSONAL' ? 'Personal' : 'VIP'}`
  return sheetName
}

export async function parseExcel(file: File): Promise<Dataset> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const filenameTarget = detectImportTarget(file.name)
  const nonAnalyticsNames = wb.SheetNames.filter(n => normalizeToken(n) !== 'analytics')

  // A named single-sheet import targets exactly one known operational tab. If the workbook
  // contains the canonical tab use it; otherwise use the first non-Analytics tab in the file.
  let selected: { sourceName: string; targetName: string }[] = []
  let importTargetSheet: string | undefined
  if (filenameTarget) {
    const sourceName = wb.SheetNames.includes(filenameTarget)
      ? filenameTarget
      : (nonAnalyticsNames[0] || '')
    if (!sourceName) throw new Error('The workbook does not contain an operational worksheet.')
    selected = [{ sourceName, targetName: filenameTarget }]
    importTargetSheet = filenameTarget
  } else {
    // Full workbook import: include each recognized operational tab and replace the full operational dataset.
    selected = DATA_SHEETS.filter(name => wb.Sheets[name]).map(name => ({ sourceName: name, targetName: name }))
  }

  const sheets: RawSheet[] = []
  for (const item of selected) {
    const ws = wb.Sheets[item.sourceName]
    if (!ws) continue
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' })
    if (aoa.length < 2) continue
    const header = (aoa[0] as unknown[]).map(h => String(h ?? '').trim())
    const rows = (aoa.slice(1) as unknown[][])
      .filter(r => r.some(c => c !== '' && c !== null && c !== undefined))
      .map(r => Array.from({ length: header.length }, (_, i) => r[i] ?? ''))
    sheets.push({ name: item.targetName, header, rows })
  }
  if (!sheets.length) {
    const targetHint = filenameTarget ? ` for ${importTargetLabel(filenameTarget)}` : ''
    throw new Error(`No usable operational records were found${targetHint}. Check the worksheet header and data rows.`)
  }

  // Daily analytics are maintained independently in the app. Do not import/replace them with an operational workbook.
  return {
    source: 'excel', updatedAt: new Date().toISOString(), fileName: file.name,
    sheets, analytics: [], importTargetSheet: importTargetSheet && sheets.some(s => s.name === importTargetSheet) ? importTargetSheet : undefined,
  }
}
