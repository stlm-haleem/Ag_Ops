import * as XLSX from 'xlsx'
import { AnalyticsEntry, DATA_SHEETS, Dataset, RawSheet } from './types'

const toDate = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` }
  return String(v ?? '').slice(0, 10)
}

export async function parseExcel(file: File): Promise<Dataset> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const sheets: RawSheet[] = []
  for (const name of DATA_SHEETS) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' })
    if (aoa.length < 2) continue
    const header = (aoa[0] as unknown[]).map(h => String(h ?? '').trim())
    const rows = aoa.slice(1).filter(r => (r as unknown[]).some(c => c !== '' && c !== null))
    sheets.push({ name, header, rows: rows as unknown[][] })
  }
  if (!sheets.length) throw new Error('No BDT-SSG tabs with data were found in this file.')

  const analytics: AnalyticsEntry[] = []
  const aws = wb.Sheets['Analytics']
  if (aws) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(aws, { header: 1, raw: true, defval: '' })
    const h = ((aoa[0] as unknown[]) || []).map(x => String(x).trim().toUpperCase())
    const ix = (k: string) => h.indexOf(k)
    for (const r of aoa.slice(1) as unknown[][]) {
      if (ix('DATE') < 0 || r[ix('DATE')] === '') continue
      analytics.push({
        date: toDate(r[ix('DATE')]),
        currency: String(r[ix('CURRENCY')] || 'BDT'),
        gateway: String(r[ix('GATEWAY')] || 'SSG'),
        deposit: Number(r[ix('DEPOSIT')]) || 0,
        withdrawal: Number(r[ix('WITHDRAWAL')]) || 0,
        note: String(r[ix('NOTE')] ?? ''),
      })
    }
  }
  return { source: 'excel', updatedAt: new Date().toISOString(), fileName: file.name, sheets, analytics }
}
