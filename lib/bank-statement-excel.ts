import * as XLSX from 'xlsx'

function normKey(s: string): string {
  return String(s ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function cellString(row: Record<string, unknown>, labels: string[]): string {
  const entries = Object.entries(row)
  for (const label of labels) {
    const nl = normKey(label)
    for (const [hk, val] of entries) {
      const nk = normKey(hk)
      if (!nk) continue
      if (nk === nl || nk.includes(nl) || nl.includes(nk)) {
        if (val == null || val === '') return ''
        return String(val).trim()
      }
    }
  }
  return ''
}

function parseMoney(raw: string): number | null {
  const s = raw.replace(/\s/g, '').replace(/,/g, '.')
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return null
  return Math.abs(n)
}

/** Гүйлгээний утгаас SMS-ээр илгээсэн 6 оронтой код олно */
export function extractPaymentCodesFromText(text: string): string[] {
  const t = String(text ?? '')
  const found = t.match(/\b\d{6}\b/g)
  if (!found) return []
  return [...new Set(found)]
}

export type BankStatementParsedRow = {
  rowIndex: number
  amount: number
  description: string
  /** Grid-ээс гараар оруулсан тоолуурын дугаар */
  meterNumber?: string
}

const AMOUNT_LABELS = [
  'Дүн',
  'дүн',
  'Мөнгөн дүн',
  'Гүйлгээний дүн',
  'Орлого',
  'Кредит',
  'Credit',
  'Amount',
  'amount',
  'SUM',
  'Sum',
]

const DESC_LABELS = [
  'Утга',
  'утга',
  'Тайлбар',
  'Гүйлгээ',
  'Гүйлгээний утга',
  'Гүйлгээний дэлгэрэнгүй',
  'Description',
  'Detail',
  'Memo',
  'Тэмдэглэл',
]

const METER_LABELS = ['Тоолуур', 'тоолуур', 'Meter', 'meter', 'Дугаар']

function labelMatchesAny(cell: string, labels: string[]): boolean {
  const nk = normKey(cell)
  if (!nk) return false
  return labels.some((label) => {
    const nl = normKey(label)
    return nk === nl || nk.includes(nl) || nl.includes(nk)
  })
}

function rowLooksLikeHeader(cells: string[]): boolean {
  if (cells.length < 2) return false
  return (
    cells.some((c) => labelMatchesAny(c, AMOUNT_LABELS)) ||
    cells.some((c) => labelMatchesAny(c, DESC_LABELS)) ||
    cells.some((c) => labelMatchesAny(c, METER_LABELS))
  )
}

/** JSON мөрүүдээс банкны гүйлгээний мөрүүдийг гаргана (Excel sheet_to_json эсвэл clipboard-ийн толгойтой хүснэгт) */
export function parseBankStatementRecords(
  json: Record<string, unknown>[]
): BankStatementParsedRow[] {
  const out: BankStatementParsedRow[] = []
  let idx = 0
  for (const raw of json) {
    idx += 1
    let amountStr = cellString(raw, AMOUNT_LABELS)
    let desc = cellString(raw, DESC_LABELS)
    const meterNumber = cellString(raw, METER_LABELS)

    if (!desc) {
      desc = Object.values(raw)
        .filter((v) => typeof v === 'string' && String(v).trim().length > 0)
        .map((v) => String(v).trim())
        .join(' | ')
    }

    let amount = amountStr ? parseMoney(amountStr) : null

    if (amount == null || amount <= 0) {
      let best = 0
      for (const v of Object.values(raw)) {
        if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) > best) {
          best = Math.abs(v)
        } else if (v != null && v !== '') {
          const p = parseMoney(String(v))
          if (p != null && p > best && p >= 100) best = p
        }
      }
      if (best >= 100) amount = best
    }

    if (amount == null || amount <= 0) continue
    if (!desc || desc.length < 2) desc = '(утга хоосон)'

    out.push({
      rowIndex: idx,
      amount: Math.round(amount * 100) / 100,
      description: desc,
      ...(meterNumber ? { meterNumber } : {}),
    })
  }
  return out
}

/**
 * Excel-ээс хуулсан tab/semicolon тусгаарлагдсан текст (эхний мөр ихэвчлэн толгой).
 */
export function parseBankStatementRowsFromClipboard(text: string): BankStatementParsedRow[] {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return []

  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : null
  if (!delimiter) return []

  const splitLine = (line: string) => line.split(delimiter).map((c) => c.trim())
  const firstCells = splitLine(lines[0])
  const hasHeader = rowLooksLikeHeader(firstCells)
  const colCount = Math.max(...lines.map((l) => splitLine(l).length))
  const headerKeys = hasHeader
    ? firstCells
    : Array.from({ length: colCount }, (_, i) => `col${i}`)
  const dataLines = hasHeader ? lines.slice(1) : lines

  const json: Record<string, unknown>[] = []
  for (const line of dataLines) {
    const cells = splitLine(line)
    if (cells.every((c) => !c)) continue
    const row: Record<string, unknown> = {}
    headerKeys.forEach((h, i) => {
      row[h || `col${i}`] = cells[i] ?? ''
    })
    json.push(row)
  }

  return parseBankStatementRecords(json)
}

/**
 * Банкны хуулгын эхний sheet (1-р мөр = толгой).
 * «Дүн/Орлого» болон «Утга/Тайлбар» баганаас уншина; толгой олдохгүй бол мөр бүрийн тоо/текстээс таамаглана.
 */
export function parseBankStatementRowsFromExcel(buf: ArrayBuffer): BankStatementParsedRow[] {
  const wb = XLSX.read(buf, { type: 'array' })
  const name = wb.SheetNames[0]
  if (!name) return []
  const sheet = wb.Sheets[name]
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  return parseBankStatementRecords(json)
}
