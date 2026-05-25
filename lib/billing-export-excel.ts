import * as XLSX from 'xlsx'

/** Төлбөр хуудсын хүснэгттэй яг ижил толгой (экспорт / импорт) */
export const BILLING_EXCEL_HEADER_LABELS = {
  year: 'Он',
  month: 'Сар',
  organization: 'Байгууллага',
  meter: 'Тоолуур',
  phone: 'Харилцагчийн утас',
  usage: 'Хэрэглээ (м³)',
  total: 'Төлбөр (₮)',
  previousRemaining: 'Өмнөх үлдэгдэл (₮)',
  paid: 'Төлөгдсөн (₮)',
  remaining: 'Үлдэгдэл (₮)',
} as const

/** Экспортод бүгдийг харуулна, импортод эхний 6-г л шаардана */
export const BILLING_EXCEL_REQUIRED_HEADERS: string[] = [
  BILLING_EXCEL_HEADER_LABELS.year,
  BILLING_EXCEL_HEADER_LABELS.month,
  BILLING_EXCEL_HEADER_LABELS.organization,
  BILLING_EXCEL_HEADER_LABELS.meter,
  BILLING_EXCEL_HEADER_LABELS.phone,
  BILLING_EXCEL_HEADER_LABELS.paid,
]

export const BILLING_EXCEL_EXPORT_HEADERS: string[] = Object.values(BILLING_EXCEL_HEADER_LABELS)

export type BillingExcelImportRow = {
  rowIndex: number
  year: number
  month: number
  organizationName: string
  organizationCode: string
  meterNumber: string
  customerPhone?: string
  usage?: number
  paidAmount: number
  total?: number
  remaining?: number
}

export type BillingExcelGridRow = {
  id: string
  year: string
  month: string
  organizationName: string
  meterNumber: string
  customerPhone: string
  usage: string
  total: string
  paidAmount: string
  remaining: string
}

function normKey(s: string): string {
  return String(s ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function cell(row: Record<string, unknown>, labels: string[]): string {
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
  const s = String(raw ?? '')
    .replace(/\s/g, '')
    .replace(/,/g, '')
    .replace(/₮/g, '')
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return null
  return Math.round(Math.abs(n) * 100) / 100
}

function parseYearMonth(rawY: string, rawM: string): { year: number; month: number } | null {
  const year = parseInt(String(rawY).trim(), 10)
  const month = parseInt(String(rawM).trim(), 10)
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null
  if (!Number.isFinite(month) || month < 1 || month > 12) return null
  return { year, month }
}

/** Эхний мөрийн толгойг шалгана */
export function validateBillingExcelHeaders(headerKeys: string[]): {
  ok: boolean
  error?: string
  missing?: string[]
} {
  const normalized = headerKeys.map(normKey).filter(Boolean)
  const missing: string[] = []
  for (const required of BILLING_EXCEL_REQUIRED_HEADERS) {
    const nr = normKey(required)
    const found = normalized.some((h) => h === nr || h.includes(nr) || nr.includes(h))
    if (!found) missing.push(required)
  }
  if (missing.length === 0) return { ok: true }
  return {
    ok: false,
    missing,
    error: `Excel-ийн толгой буруу байна. Дараах багана байх ёстой: ${BILLING_EXCEL_REQUIRED_HEADERS.join(', ')}`,
  }
}

const CELL_LABELS = {
  year: [BILLING_EXCEL_HEADER_LABELS.year, 'он'],
  month: [BILLING_EXCEL_HEADER_LABELS.month, 'сар'],
  organizationName: [BILLING_EXCEL_HEADER_LABELS.organization, 'байгууллага'],
  organizationCode: ['Код', 'код'],
  meterNumber: [BILLING_EXCEL_HEADER_LABELS.meter, 'тоолуур'],
  customerPhone: [BILLING_EXCEL_HEADER_LABELS.phone, 'утас', 'харилцагчийнутас'],
  usage: [BILLING_EXCEL_HEADER_LABELS.usage, 'хэрэглээ'],
  paidAmount: [BILLING_EXCEL_HEADER_LABELS.paid, 'төлөгдсөн'],
  total: [BILLING_EXCEL_HEADER_LABELS.total, 'төлбөр'],
  remaining: [BILLING_EXCEL_HEADER_LABELS.remaining, 'үлдэгдэл'],
}

export function parseBillingExportRowsFromSheet(
  json: Record<string, unknown>[]
): { rows: BillingExcelImportRow[]; error?: string } {
  if (json.length === 0) {
    return { rows: [], error: 'Excel-д өгөгдөл олдсонгүй' }
  }

  const headerCheck = validateBillingExcelHeaders(Object.keys(json[0] ?? {}))
  if (!headerCheck.ok) {
    return { rows: [], error: headerCheck.error }
  }

  const out: BillingExcelImportRow[] = []
  let idx = 0
  for (const raw of json) {
    idx += 1
    const orgName = cell(raw, CELL_LABELS.organizationName)
    const orgCode = cell(raw, CELL_LABELS.organizationCode)
    const meterNumber = cell(raw, CELL_LABELS.meterNumber)
    const ym = parseYearMonth(cell(raw, CELL_LABELS.year), cell(raw, CELL_LABELS.month))
    const paid = parseMoney(cell(raw, CELL_LABELS.paidAmount))
    const totalRaw = cell(raw, CELL_LABELS.total)
    const total = totalRaw ? parseMoney(totalRaw) : null
    const remainingRaw = cell(raw, CELL_LABELS.remaining)
    let remaining = remainingRaw ? parseMoney(remainingRaw) : null
    const usageRaw = cell(raw, CELL_LABELS.usage)
    const usage = usageRaw ? parseMoney(usageRaw) : null
    const customerPhone = cell(raw, CELL_LABELS.customerPhone)

    if (!orgName && !orgCode && !meterNumber) continue
    if (!ym) continue
    if (paid == null) continue

    if (remaining == null && total != null) {
      remaining = Math.max(0, Math.round((total - paid) * 100) / 100)
    }

    out.push({
      rowIndex: idx,
      year: ym.year,
      month: ym.month,
      organizationName: orgName,
      organizationCode: orgCode,
      meterNumber,
      ...(customerPhone ? { customerPhone } : {}),
      ...(usage != null ? { usage } : {}),
      paidAmount: paid,
      ...(total != null ? { total } : {}),
      ...(remaining != null ? { remaining } : {}),
    })
  }

  if (out.length === 0) {
    return {
      rows: [],
      error:
        'Тохирох мөр алга. Он, сар, байгууллага, тоолуур, төлөгдсөн дүн зөв бөглөгдсөн эсэхийг шалгана уу.',
    }
  }

  return { rows: out }
}

export function parseBillingExportExcel(buf: ArrayBuffer): {
  rows: BillingExcelImportRow[]
  error?: string
} {
  const wb = XLSX.read(buf, { type: 'array' })
  const name = wb.SheetNames[0]
  if (!name) return { rows: [], error: 'Excel хуудас хоосон байна' }
  const sheet = wb.Sheets[name]
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  return parseBillingExportRowsFromSheet(json)
}

export function billingImportRowsToGridRows(rows: BillingExcelImportRow[]): Omit<BillingExcelGridRow, 'id'>[] {
  return rows.map((r) => {
    const total = r.total ?? 0
    const remaining =
      r.remaining ?? Math.max(0, Math.round((total - r.paidAmount) * 100) / 100)
    return {
      year: String(r.year),
      month: String(r.month).padStart(2, '0'),
      organizationName: r.organizationName,
      meterNumber: r.meterNumber,
      customerPhone: r.customerPhone ?? '',
      usage: r.usage != null ? String(r.usage) : '',
      total: r.total != null ? String(r.total) : '',
      paidAmount: String(r.paidAmount),
      remaining: String(remaining),
    }
  })
}

/** Хүснэгт / экспортын мөрөөс импортын grid */
export function billingDisplayRowToGridRow(input: {
  year: number
  month: number
  organizationName: string
  meterNumber: string
  customerPhones: string
  usage: number
  total: number
  paidAmount: number
  remaining: number
}): Omit<BillingExcelGridRow, 'id'> {
  return {
    year: String(input.year),
    month: String(input.month).padStart(2, '0'),
    organizationName: input.organizationName,
    meterNumber: input.meterNumber,
    customerPhone: input.customerPhones,
    usage: String(input.usage),
    total: String(input.total),
    paidAmount: String(input.paidAmount),
    remaining: String(input.remaining),
  }
}

export function billingGridRowsToImportPayload(
  rows: BillingExcelGridRow[]
): BillingExcelImportRow[] {
  const out: BillingExcelImportRow[] = []
  let idx = 0
  for (const r of rows) {
    idx += 1
    const ym = parseYearMonth(r.year, r.month)
    const paid = parseMoney(r.paidAmount)
    const meterNumber = String(r.meterNumber ?? '').trim()
    const organizationName = String(r.organizationName ?? '').trim()
    if (!ym || paid == null) continue
    if (!meterNumber && !organizationName) continue
    const total = parseMoney(r.total)
    out.push({
      rowIndex: idx,
      year: ym.year,
      month: ym.month,
      organizationName,
      organizationCode: '',
      meterNumber,
      paidAmount: paid,
      ...(total != null ? { total } : {}),
    })
  }
  return out
}

export function createEmptyBillingGridRows(count = 8): BillingExcelGridRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}-${Date.now()}`,
    year: '',
    month: '',
    organizationName: '',
    meterNumber: '',
    customerPhone: '',
    usage: '',
    total: '',
    paidAmount: '',
    remaining: '',
  }))
}

/** Clipboard TSV — эхний мөр төлбөрийн экспортын толгой байх ёстой */
export function parseBillingExportFromClipboard(text: string): {
  rows: BillingExcelImportRow[]
  error?: string
} {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length < 2) {
    return { rows: [], error: 'Толгой мөр + өгөгдөл хэрэгтэй (Excel-ээс бүтэн хуулна уу)' }
  }

  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : null
  if (!delimiter) {
    return { rows: [], error: BILLING_EXCEL_REQUIRED_HEADERS.join(', ') + ' толгойтой Excel хуулна уу' }
  }

  const split = (line: string) => line.split(delimiter).map((c) => c.trim())
  const headers = split(lines[0])
  const headerCheck = validateBillingExcelHeaders(headers)
  if (!headerCheck.ok) {
    return { rows: [], error: headerCheck.error }
  }

  const json: Record<string, unknown>[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i])
    const row: Record<string, unknown> = {}
    headers.forEach((h, j) => {
      row[h || `col${j}`] = cells[j] ?? ''
    })
    json.push(row)
  }

  return parseBillingExportRowsFromSheet(json)
}
