export type BankGridRow = {
  id: string
  amount: string
  description: string
  meterNumber: string
}

export function createEmptyBankGridRows(count = 12): BankGridRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}-${Date.now()}`,
    amount: '',
    description: '',
    meterNumber: '',
  }))
}

function looksLikeHeader(firstCell: string, secondCell: string): boolean {
  const a = firstCell.toLowerCase()
  if (/дүн|amount|орлого|credit|sum/i.test(a)) return true
  if (/утга|тайлбар|description|memo|гүйлгээ/i.test(secondCell)) return true
  if (/тоолуур|meter/i.test(a) || /тоолуур|meter/i.test(secondCell)) return true
  return false
}

function parseMoneyCell(raw: string): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  const n = parseFloat(s.replace(/\s/g, '').replace(/,/g, '.'))
  if (!Number.isFinite(n)) return s
  return String(Math.abs(n))
}

/** Excel-ээс хуулсан tab/semicolon тусгаарлагдсан текстийг grid мөр болгоно */
export function parseClipboardToBankGridRows(text: string): Omit<BankGridRow, 'id'>[] {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const out: Omit<BankGridRow, 'id'>[] = []
  let startIdx = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const parts =
      line.includes('\t') ? line.split('\t') : line.includes(';') ? line.split(';') : [line]

    const cells = parts.map((p) => p.trim())
    if (cells.length === 0) continue

    if (i === 0 && cells.length >= 2 && looksLikeHeader(cells[0], cells[1] ?? '')) {
      startIdx = 1
      continue
    }

    let amount = ''
    let description = ''
    let meterNumber = ''

    if (cells.length >= 3) {
      amount = parseMoneyCell(cells[0])
      description = cells[1] ?? ''
      meterNumber = cells[2] ?? ''
    } else if (cells.length === 2) {
      const c0 = cells[0]
      const c1 = cells[1]
      const n0 = parseFloat(c0.replace(/,/g, '.'))
      if (Number.isFinite(n0) && Math.abs(n0) >= 1) {
        amount = parseMoneyCell(c0)
        description = c1
      } else {
        description = [c0, c1].filter(Boolean).join(' ')
        amount = ''
      }
    } else {
      const only = cells[0]
      const n = parseFloat(only.replace(/,/g, '.'))
      if (Number.isFinite(n) && Math.abs(n) >= 100) {
        amount = parseMoneyCell(only)
      } else {
        description = only
      }
    }

    if (!amount && !description.trim()) continue
    out.push({ amount, description, meterNumber })
  }

  if (startIdx > 0 && out.length === 0) {
    return parseClipboardToBankGridRows(lines.slice(1).join('\n'))
  }

  return out
}

import type { BankStatementParsedRow } from '@/lib/bank-statement-excel'

export function bankStatementParsedToGridRows(
  rows: BankStatementParsedRow[]
): Omit<BankGridRow, 'id'>[] {
  return rows.map((r) => ({
    amount: String(r.amount),
    description: r.description,
    meterNumber: r.meterNumber ?? '',
  }))
}

export function bankGridRowsToImportPayload(rows: BankGridRow[]): {
  rowIndex: number
  amount: number
  description: string
  meterNumber?: string
}[] {
  const out: { rowIndex: number; amount: number; description: string; meterNumber?: string }[] = []
  let idx = 0
  for (const r of rows) {
    idx += 1
    const amount = parseFloat(String(r.amount ?? '').replace(/,/g, '.'))
    const description = String(r.description ?? '').trim()
    const meterNumber = String(r.meterNumber ?? '').trim()
    if (!Number.isFinite(amount) || amount <= 0) continue
    if (!description && !meterNumber) continue
    out.push({
      rowIndex: idx,
      amount: Math.round(Math.abs(amount) * 100) / 100,
      description: description || '(утга хоосон)',
      ...(meterNumber ? { meterNumber } : {}),
    })
  }
  return out
}
