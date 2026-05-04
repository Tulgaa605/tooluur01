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
  'Description',
  'Detail',
  'Memo',
  'Тэмдэглэл',
]

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
  const out: BankStatementParsedRow[] = []
  let idx = 0
  for (const raw of json) {
    idx += 1
    let amountStr = cellString(raw, AMOUNT_LABELS)
    let desc = cellString(raw, DESC_LABELS)

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

    out.push({ rowIndex: idx, amount: Math.round(amount * 100) / 100, description: desc })
  }
  return out
}
