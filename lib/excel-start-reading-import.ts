import * as XLSX from 'xlsx'

export type StartReadingExcelRow = {
  rowIndex: number
  phone: string
  startValue: number
  endValue: number | null
}

function normHeader(s: string): string {
  return String(s ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function parseStartNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
    return Math.round(v * 100) / 100
  }
  const s = String(v ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/,/g, '')
    .replace(/₮/g, '')
  if (!s) return null
  const n = parseFloat(s)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

function cellToPhoneText(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return String(Math.trunc(v))
  }
  return String(v ?? '').trim()
}

function isPhoneHeader(h: string): boolean {
  const n = normHeader(h)
  if (!n) return false
  if (n === 'утас' || n === 'phone' || n === 'mobile' || n === 'утасныдугаар') return true
  if (n.includes('утас') || n.includes('phone')) return true
  return false
}

function isStartHeader(h: string): boolean {
  const n = normHeader(h)
  return n === 'эхнийзаалт' || n.includes('эхнийзаалт')
}

function isEndHeader(h: string): boolean {
  const n = normHeader(h)
  return n === 'эцсийнзаалт' || n.includes('эцсийнзаалт')
}

/** Импорт тулгах: цифр болон сүүлийн 8 орон. */
export function phoneMatchKeys(raw: string): string[] {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (!digits) return []
  const keys = new Set<string>([digits])
  if (digits.length >= 8) keys.add(digits.slice(-8))
  if (digits.length === 11 && digits.startsWith('976')) keys.add(digits.slice(3))
  return [...keys]
}

/**
 * «Утас»-аар тулгана.
 * «Эхний заалт»-ыг оруулна.
 * «Эцсийн заалт» байвал зөрүүтэй үед л шинэчилнэ.
 */
export function parseStartReadingRowsFromExcel(buf: ArrayBuffer): StartReadingExcelRow[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return []
  const sheet = wb.Sheets[sheetName]
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: true,
  })
  if (json.length === 0) return []

  const headers = Object.keys(json[0] ?? {})
  const phoneKey = headers.find((h) => isPhoneHeader(h))
  const startKey = headers.find((h) => isStartHeader(h))
  const endKey = headers.find((h) => isEndHeader(h))
  if (!phoneKey || !startKey) return []

  const out: StartReadingExcelRow[] = []
  json.forEach((raw, i) => {
    const phone = cellToPhoneText(raw[phoneKey])
    const startValue = parseStartNumber(raw[startKey])
    if (!phone || startValue == null) return
    const endValue = endKey ? parseStartNumber(raw[endKey]) : null
    out.push({ rowIndex: i + 2, phone, startValue, endValue })
  })
  return out
}
