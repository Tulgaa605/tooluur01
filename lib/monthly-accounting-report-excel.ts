import ExcelJS from 'exceljs'
import {
  computeOrganizationAdditionalFees,
  type AdditionalFeeDefinitionRow,
  type AdditionalFeeSelectionRow,
} from '@/lib/additional-fees-calc'
import { waterUsageFromReading } from '@/lib/recalculate-readings-tariff'

/** A–R (18 багана), зурагтай ижил. */
export const MONTHLY_ACCOUNTING_REPORT_HEADERS = [
  'Байгууллага',
  'тоолуур',
  'ажлын хөлс',
  'Ухаалаг карт',
  'карт цэнэглэлт',
  'Хүүний орлого',
  '',
  'өн буцаалт',
  'Олголтоо',
  'Техникийн нөхцөл',
  'Нутгийн дэм',
  'дулаан',
  'Цэвэр,бохир',
  'Суурь хураамж',
  'бохир зөөвөр',
  'ус',
  'т/хөлс',
  'дүн',
] as const

export const MONTHLY_ACCOUNTING_REPORT_COL_COUNT = MONTHLY_ACCOUNTING_REPORT_HEADERS.length
export const SUMMARY_ROW_LABEL = 'Эцсийн хэрэглэгч'
export const FOOTER_ROW_LABEL = 'Нийт дүн'

const FONT_NAME = 'Arial'
const FONT_SIZE = 7
const NUM_FMT = '#,##0.00'
const FILL_ORG_COL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD9E1F2' },
}
const FILL_TECH_COL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFFF00' },
}
const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
}

export type MonthlyAccountingReportSourceRow = {
  organizationId: string
  organizationName: string
  meterNumber?: string
  startValue?: unknown
  endValue?: unknown
  usage?: unknown
  baseClean?: unknown
  baseDirty?: unknown
  cleanAmount?: unknown
  dirtyAmount?: unknown
  heatAmount?: unknown
  additionalFeesAmount?: unknown
  total?: unknown
  meterId: string
  year: number
  month: number
}

export type AccountingReportValues = {
  meter: number
  labor: number
  smartCard: number
  cardTopUp: number
  interest: number
  otherG: number
  refund: number
  issuance: number
  technical: number
  localSupport: number
  heat: number
  clean: number
  base: number
  dirtyTransport: number
  water: number
  miscFee: number
  total: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? round2(n) : 0
}

function norm(s: string): string {
  return String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, '')
}

function feeSumByPatterns(
  lines: Array<{ name: string; amount: number }>,
  patterns: string[]
): number {
  const ps = patterns.map(norm).filter(Boolean)
  if (ps.length === 0) return 0
  return round2(
    lines
      .filter((l) => {
        const n = norm(l.name)
        return ps.some((p) => n.includes(p) || p.includes(n))
      })
      .reduce((a, l) => a + l.amount, 0)
  )
}

function buildFeeLinesForMeter(
  definitions: AdditionalFeeDefinitionRow[],
  selections: AdditionalFeeSelectionRow[]
): Array<{ name: string; amount: number }> {
  const { lines } = computeOrganizationAdditionalFees(definitions, selections, {
    waterM3: 0,
    heatM2: 0,
  })
  return lines.map((l) => ({ name: l.name, amount: l.amount }))
}

export function computeReadingReportValues(
  r: MonthlyAccountingReportSourceRow,
  feeLines: Array<{ name: string; amount: number }>
): AccountingReportValues {
  const meter = feeSumByPatterns(feeLines, ['тоолуур', 'meter'])
  const labor = feeSumByPatterns(feeLines, ['ажлын', 'хөлс', 'ajlyn'])
  const smartCard = feeSumByPatterns(feeLines, ['ухаалаг', 'smart'])
  const cardTopUp = feeSumByPatterns(feeLines, ['цэнэглэлт', 'topup'])
  const interest = feeSumByPatterns(feeLines, ['хүү', 'interest'])
  const refund = feeSumByPatterns(feeLines, ['буцаалт', 'refund'])
  const issuance = feeSumByPatterns(feeLines, ['олголт', 'issue'])
  const technical = feeSumByPatterns(feeLines, ['техникийн', 'нөхцөл'])
  const localSupport = feeSumByPatterns(feeLines, ['нутгийн', 'дэм', 'local'])
  const transport = feeSumByPatterns(feeLines, ['зөөвөр', 'transport', 'татан'])
  const miscFeePattern = feeSumByPatterns(feeLines, ['т/хөлс', 'хөлсөөр', 'hop'])

  const categorized =
    meter +
    labor +
    smartCard +
    cardTopUp +
    interest +
    refund +
    issuance +
    technical +
    localSupport +
    transport +
    miscFeePattern
  const extraFromFees = round2(feeLines.reduce((a, l) => a + l.amount, 0))
  const otherG = round2(Math.max(0, extraFromFees - categorized))
  const miscFee = miscFeePattern || round2(Math.max(0, num(r.additionalFeesAmount) - categorized))

  return {
    meter,
    labor,
    smartCard,
    cardTopUp,
    interest,
    otherG,
    refund,
    issuance,
    technical,
    localSupport,
    heat: num(r.heatAmount),
    clean: num(r.cleanAmount),
    base: num(r.baseClean) + num(r.baseDirty),
    dirtyTransport: num(r.dirtyAmount) + transport,
    water: waterUsageFromReading(r),
    miscFee,
    total: num(r.total),
  }
}

export function sumReportValues(
  a: AccountingReportValues,
  b: AccountingReportValues
): AccountingReportValues {
  const keys = Object.keys(a) as (keyof AccountingReportValues)[]
  const out = { ...a }
  for (const k of keys) {
    out[k] = round2(a[k] + b[k])
  }
  return out
}

const ZERO_VALUES: AccountingReportValues = {
  meter: 0,
  labor: 0,
  smartCard: 0,
  cardTopUp: 0,
  interest: 0,
  otherG: 0,
  refund: 0,
  issuance: 0,
  technical: 0,
  localSupport: 0,
  heat: 0,
  clean: 0,
  base: 0,
  dirtyTransport: 0,
  water: 0,
  miscFee: 0,
  total: 0,
}

export type MeterReportRow = {
  organizationId: string
  organizationName: string
  meterNumber: string
  values: AccountingReportValues
}

/** Тоолуур бүр (заалт бүр) нэг мөр — grid-тэй ижил тоо. */
export function buildMonthlyAccountingReportByMeter(
  readings: MonthlyAccountingReportSourceRow[],
  definitions: AdditionalFeeDefinitionRow[],
  selectionsByMeterKey: Map<string, AdditionalFeeSelectionRow[]>
): MeterReportRow[] {
  const rows: MeterReportRow[] = []
  for (const r of readings) {
    const key = `${r.meterId}|${r.year}|${r.month}`
    const sels = selectionsByMeterKey.get(key) ?? []
    const feeLines = buildFeeLinesForMeter(definitions, sels)
    const values = computeReadingReportValues(r, feeLines)
    rows.push({
      organizationId: r.organizationId,
      organizationName: r.organizationName || '',
      meterNumber: r.meterNumber?.trim() || '',
      values,
    })
  }
  return rows.sort((a, b) => {
    const byOrg = a.organizationName.localeCompare(b.organizationName, 'mn')
    if (byOrg !== 0) return byOrg
    return a.meterNumber.localeCompare(b.meterNumber, 'mn', { numeric: true })
  })
}

export type MonthlyAccountingTableView = {
  period: string
  headers: string[]
  summaryLabel: string
  summaryCells: number[]
  footerLabel: string
  footerCells: number[]
  rows: Array<{ label: string; cells: number[] }>
}

/** UI хүснэгт (Excel-тэй ижил багана, мөр) */
export function buildMonthlyAccountingTableView(
  year: number,
  month: number,
  meterRows: MeterReportRow[]
): MonthlyAccountingTableView {
  let grandTotal = { ...ZERO_VALUES }
  for (const row of meterRows) {
    grandTotal = sumReportValues(grandTotal, row.values)
  }
  const totals = valuesToArray(grandTotal)
  return {
    period: `${year}.${String(month).padStart(2, '0')}`,
    headers: [...MONTHLY_ACCOUNTING_REPORT_HEADERS],
    summaryLabel: SUMMARY_ROW_LABEL,
    summaryCells: totals,
    footerLabel: FOOTER_ROW_LABEL,
    footerCells: totals,
    rows: meterRows.map((item) => {
      const label =
        item.meterNumber && item.meterNumber !== '—'
          ? `${item.organizationName} (${item.meterNumber})`
          : item.organizationName
      return { label, cells: valuesToArray(item.values) }
    }),
  }
}

export function valuesToArray(v: AccountingReportValues): number[] {
  return [
    v.meter,
    v.labor,
    v.smartCard,
    v.cardTopUp,
    v.interest,
    v.otherG,
    v.refund,
    v.issuance,
    v.technical,
    v.localSupport,
    v.heat,
    v.clean,
    v.base,
    v.dirtyTransport,
    v.water,
    v.miscFee,
    v.total,
  ]
}

function baseFont(): Partial<ExcelJS.Font> {
  return { name: FONT_NAME, size: FONT_SIZE }
}

function applyBorder(cell: ExcelJS.Cell) {
  cell.border = BORDER_THIN as ExcelJS.Borders
}

function setCell(
  cell: ExcelJS.Cell,
  value: string | number | null | undefined,
  opts: {
    bold?: boolean
    align?: Partial<ExcelJS.Alignment>
    fill?: ExcelJS.Fill
    numFmt?: string
  } = {}
) {
  cell.font = { ...baseFont(), bold: opts.bold ?? false }
  cell.alignment = {
    vertical: 'middle',
    wrapText: false,
    ...opts.align,
  }
  if (opts.fill) cell.fill = opts.fill
  applyBorder(cell)

  if (value === null || value === undefined || value === '') {
    cell.value = null
    return
  }
  if (typeof value === 'number') {
    if (value === 0 && !opts.numFmt) {
      cell.value = null
      return
    }
    cell.value = value
    if (opts.numFmt) cell.numFmt = opts.numFmt
    return
  }
  cell.value = value
}

/** J багана = 10 */
const TECH_COL_INDEX = 10

function writeTotalsRow(
  ws: ExcelJS.Worksheet,
  rowIndex: number,
  label: string,
  totals: AccountingReportValues
) {
  const row = ws.getRow(rowIndex)
  row.height = 14
  setCell(row.getCell(1), label, {
    bold: true,
    align: { horizontal: 'left' },
    fill: FILL_ORG_COL,
  })
  valuesToArray(totals).forEach((n, i) => {
    const col = i + 2
    const cell = row.getCell(col)
    const isTech = col === TECH_COL_INDEX
    setCell(cell, n === 0 ? null : n, {
      bold: true,
      align: { horizontal: 'right' },
      fill: isTech ? FILL_TECH_COL : undefined,
      numFmt: NUM_FMT,
    })
  })
}

export async function buildMonthlyAccountingReportWorkbook(
  year: number,
  month: number,
  meterRows: MeterReportRow[]
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'tooluur'
  const ws = wb.addWorksheet('Тайлан', {
    views: [{ showGridLines: true }],
  })

  const title = `${year}.${String(month).padStart(2, '0')}`
  const colCount = MONTHLY_ACCOUNTING_REPORT_COL_COUNT

  ws.columns = [
    { width: 22 },
    { width: 11 },
    { width: 10 },
    { width: 10 },
    { width: 11 },
    { width: 10 },
    { width: 10 },
    { width: 10 },
    { width: 9 },
    { width: 11 },
    { width: 10 },
    { width: 9 },
    { width: 10 },
    { width: 11 },
    { width: 10 },
    { width: 8 },
    { width: 9 },
    { width: 11 },
  ]

  const titleRow = ws.getRow(1)
  titleRow.height = 14
  for (let c = 1; c <= colCount; c++) {
    const cell = titleRow.getCell(c)
    setCell(cell, null, { align: { horizontal: 'center' } })
  }
  const titleCell = titleRow.getCell(8)
  setCell(titleCell, title, { bold: true, align: { horizontal: 'center' } })
  ws.mergeCells(1, 8, 1, 9)

  const headerRow = ws.getRow(2)
  headerRow.height = 28
  MONTHLY_ACCOUNTING_REPORT_HEADERS.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1)
    const isTech = i + 1 === TECH_COL_INDEX
    setCell(cell, h, {
      bold: true,
      align: { horizontal: 'center', vertical: 'middle', wrapText: isTech },
      fill: isTech ? FILL_TECH_COL : undefined,
    })
  })

  let grandTotal = { ...ZERO_VALUES }
  for (const row of meterRows) {
    grandTotal = sumReportValues(grandTotal, row.values)
  }

  writeTotalsRow(ws, 3, SUMMARY_ROW_LABEL, grandTotal)

  let dataRowIndex = 4
  for (const item of meterRows) {
    const row = ws.getRow(dataRowIndex)
    row.height = 14
    const label =
      item.meterNumber && item.meterNumber !== '—'
        ? `${item.organizationName} (${item.meterNumber})`
        : item.organizationName
    setCell(row.getCell(1), label, {
      align: { horizontal: 'left' },
      fill: FILL_ORG_COL,
    })
    const nums = valuesToArray(item.values)
    nums.forEach((n, i) => {
      const col = i + 2
      const cell = row.getCell(col)
      const isTech = col === TECH_COL_INDEX
      setCell(cell, n === 0 ? null : n, {
        align: { horizontal: 'right' },
        fill: isTech ? FILL_TECH_COL : undefined,
        numFmt: NUM_FMT,
      })
    })
    dataRowIndex++
  }

  const footerRowIndex = dataRowIndex
  writeTotalsRow(ws, footerRowIndex, FOOTER_ROW_LABEL, grandTotal)

  const lastRow = Math.max(3, footerRowIndex)
  const totalRowIndexes = new Set([3, footerRowIndex])
  for (let r = 3; r <= lastRow; r++) {
    const orgCell = ws.getRow(r).getCell(1)
    orgCell.fill = FILL_ORG_COL
    orgCell.font = { ...baseFont(), bold: totalRowIndexes.has(r) }
    orgCell.alignment = { vertical: 'middle', horizontal: 'left' }
  }

  for (let r = 2; r <= lastRow; r++) {
    const techCell = ws.getRow(r).getCell(TECH_COL_INDEX)
    if (r === 2 || techCell.value != null) {
      techCell.fill = FILL_TECH_COL
    }
  }

  ws.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  }

  for (let r = 1; r <= lastRow; r++) {
    const row = ws.getRow(r)
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c)
      if (!cell.font?.name) {
        cell.font = { ...baseFont(), bold: cell.font?.bold ?? false }
      }
      if (!cell.border?.top?.style) {
        applyBorder(cell)
      }
    }
  }

  return wb
}

export async function monthlyAccountingReportToBuffer(
  year: number,
  month: number,
  meterRows: MeterReportRow[]
): Promise<Buffer> {
  const wb = await buildMonthlyAccountingReportWorkbook(year, month, meterRows)
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}
