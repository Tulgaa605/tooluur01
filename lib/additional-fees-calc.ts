import type { BillingMode } from '@/lib/meter-reading-calc-core'
import { normalizeBillingMode } from '@/lib/meter-reading-calc-core'

export type AdditionalFeeChargeBasis = 'M3' | 'M2' | 'PIECE' | 'AMOUNT'

export type AdditionalFeeDefinitionRow = {
  id: string
  name: string
  chargeBasis: AdditionalFeeChargeBasis
  unitPrice: number
  active?: boolean
  sortOrder?: number
}

export type AdditionalFeeSelectionRow = {
  feeDefinitionId: string
  enabled: boolean
  quantity: number
}

export type AdditionalFeeLine = {
  feeDefinitionId: string
  name: string
  chargeBasis: AdditionalFeeChargeBasis
  quantity: number
  unitPrice: number
  amount: number
}

export type OrgUsageTotals = {
  waterM3: number
  heatM2: number
}

export const ADDITIONAL_FEE_BASIS_LABELS: Record<AdditionalFeeChargeBasis, string> = {
  M3: 'м³',
  M2: 'м²',
  PIECE: 'Тоо ширхэг',
  AMOUNT: 'Мөнгөн дүн',
}

/** Тариф хуудсан дээр нэгжийн үнэ оруулдаг эсэх */
export function additionalFeeUsesUnitPrice(basis: AdditionalFeeChargeBasis): boolean {
  return basis === 'M3' || basis === 'M2' || basis === 'PIECE'
}

/** Нийтийн задаргаа / SMS-д харуулах товч тайлбар */
export function formatAdditionalFeeLineDetail(line: Pick<
  AdditionalFeeLine,
  'chargeBasis' | 'quantity' | 'unitPrice' | 'amount'
>): string {
  if (line.chargeBasis === 'AMOUNT') {
    return line.amount > 0 ? `${line.amount.toLocaleString('en-US')} ₮` : ''
  }
  const qty = Number(line.quantity) || 0
  const unit = Number(line.unitPrice) || 0
  const unitLabel =
    line.chargeBasis === 'M3'
      ? 'м³'
      : line.chargeBasis === 'M2'
        ? 'м²'
        : 'ширхэг'
  return `${qty.toLocaleString('en-US')} ${unitLabel} × ${unit.toLocaleString('en-US')} ₮`
}

export function additionalFeeUnitLabel(basis: AdditionalFeeChargeBasis): string {
  if (basis === 'M3') return 'Нэгжийн үнэ (₮/м³)'
  if (basis === 'M2') return 'Нэгжийн үнэ (₮/м²)'
  if (basis === 'PIECE') return 'Нэгжийн үнэ (₮/ширхэг)'
  return ''
}

export function additionalFeeReadingsInputLabel(basis: AdditionalFeeChargeBasis): string {
  if (basis === 'M3') return 'Тоо (м³)'
  if (basis === 'M2') return 'Тоо (м²)'
  if (basis === 'PIECE') return 'Тоо ширхэг'
  return 'Мөнгөн дүн (₮)'
}

export function parseChargeBasis(raw: unknown): AdditionalFeeChargeBasis | null {
  const s = String(raw ?? '').trim().toUpperCase()
  if (s === 'M3' || s === 'M2' || s === 'PIECE' || s === 'AMOUNT') return s
  if (s === 'TRIP') return 'PIECE'
  if (s === 'FIXED') return 'AMOUNT'
  return null
}

export function waterUsageFromRow(r: {
  startValue?: unknown
  endValue?: unknown
  billingMode?: string | null
  meter?: { billingMode?: string | null } | null
}): number {
  const bm = normalizeBillingMode(r.billingMode ?? r.meter?.billingMode)
  if (bm === 'HEAT') return 0
  const s = Number(r.startValue ?? 0)
  const e = Number(r.endValue ?? 0)
  return e > s ? e - s : 0
}

export function heatQtyFromRow(r: {
  heatUsage?: unknown
  billingMode?: string | null
  meter?: { billingMode?: string | null } | null
}): number {
  const bm = normalizeBillingMode(r.billingMode ?? r.meter?.billingMode)
  if (bm !== 'HEAT' && bm !== 'WATER_HEAT') return 0
  return Math.max(0, Number(r.heatUsage ?? 0) || 0)
}

export function sumOrgUsageTotals(
  rows: Array<{
    startValue?: unknown
    endValue?: unknown
    heatUsage?: unknown
    billingMode?: string | null
    meter?: { billingMode?: string | null } | null
  }>
): OrgUsageTotals {
  let waterM3 = 0
  let heatM2 = 0
  for (const r of rows) {
    waterM3 += waterUsageFromRow(r)
    heatM2 += heatQtyFromRow(r)
  }
  return {
    waterM3: Math.round(waterM3 * 100) / 100,
    heatM2: Math.round(heatM2 * 100) / 100,
  }
}

export function computeAdditionalFeeLineAmount(
  def: Pick<AdditionalFeeDefinitionRow, 'chargeBasis' | 'unitPrice'>,
  selection: Pick<AdditionalFeeSelectionRow, 'quantity'>,
  usage: OrgUsageTotals
): { quantity: number; amount: number } {
  const unitPrice = Math.max(0, Number(def.unitPrice) || 0)
  const basis = parseChargeBasis(def.chargeBasis)
  if (!basis) return { quantity: 0, amount: 0 }

  const qty = Math.max(0, Number(selection.quantity) || 0)

  // М³, м², тоо ширхэг: сарын заалтад оруулсан тоо × тарифын нэгжийн үнэ
  if (basis === 'AMOUNT') {
    const amount = Math.round(qty * 100) / 100
    return { quantity: amount, amount }
  }

  const amount = Math.round(qty * unitPrice * 100) / 100
  return { quantity: Math.round(qty * 100) / 100, amount }
}

export function computeOrganizationAdditionalFees(
  definitions: AdditionalFeeDefinitionRow[],
  selections: AdditionalFeeSelectionRow[],
  usage: OrgUsageTotals
): { lines: AdditionalFeeLine[]; extraSubtotal: number } {
  const defById = new Map(definitions.filter((d) => d.active !== false).map((d) => [d.id, d]))
  const lines: AdditionalFeeLine[] = []
  for (const sel of selections) {
    if (!sel.enabled) continue
    const def = defById.get(sel.feeDefinitionId)
    if (!def) continue
    const basis = parseChargeBasis(def.chargeBasis)
    if (!basis) continue
    const { quantity, amount } = computeAdditionalFeeLineAmount(def, sel, usage)
    const lineAmount = amount
    if (lineAmount <= 0) continue
    lines.push({
      feeDefinitionId: def.id,
      name: def.name,
      chargeBasis: basis,
      quantity,
      unitPrice: Math.max(0, Number(def.unitPrice) || 0),
      amount: lineAmount,
    })
  }
  const extraSubtotal = Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100
  return { lines, extraSubtotal }
}

/** Нэмэлт төлбөрийг байгууллагын заалтууд дээр жингээр хуваарилна, дараа нь НӨАТ тооцно. */
export function applyAdditionalFeesToOrgReadings<T extends {
  organizationId: string
  year: number
  month: number
  subtotal: number
  vat: number
  total: number
  additionalFeesAmount?: number
}>(
  readings: T[],
  extraSubtotal: number
): T[] {
  if (extraSubtotal <= 0 || readings.length === 0) return readings
  const baseSum = readings.reduce((a, r) => a + (Number(r.subtotal) || 0), 0)
  const weights =
    baseSum > 0
      ? readings.map((r) => (Number(r.subtotal) || 0) / baseSum)
      : readings.map(() => 1 / readings.length)

  return readings.map((r, i) => {
    const share = Math.round(extraSubtotal * weights[i] * 100) / 100
    const subtotal = Math.round(((Number(r.subtotal) || 0) + share) * 100) / 100
    const vat = Math.round(subtotal * 0.1 * 100) / 100
    const total = Math.round((subtotal + vat) * 100) / 100
    return { ...r, additionalFeesAmount: share, subtotal, vat, total }
  })
}

export function applyAdditionalFeesForAllOrganizations<
  T extends {
    organizationId: string
    meterId: string
    year: number
    month: number
    subtotal: number
    vat: number
    total: number
    startValue?: unknown
    endValue?: unknown
    heatUsage?: unknown
    billingMode?: string | null
    meter?: { billingMode?: string | null } | null
  },
>(
  readings: T[],
  definitions: AdditionalFeeDefinitionRow[],
  selectionsByOrgPeriod: Map<string, AdditionalFeeSelectionRow[]>
): T[] {
  // Now additional fees are selected per meter. Group by (meterId, year, month)
  const byKey = new Map<string, T[]>()
  for (const r of readings) {
    const k = `${r.meterId}|${r.year}|${r.month}`
    const list = byKey.get(k) ?? []
    list.push(r)
    byKey.set(k, list)
  }

  const out: T[] = []
  for (const [, group] of byKey) {
    const first = group[0]
    const sk = `${first.meterId}|${first.year}|${first.month}`
    const sels = selectionsByOrgPeriod.get(sk) ?? []
    const usage = sumOrgUsageTotals(group)
    const { extraSubtotal } = computeOrganizationAdditionalFees(definitions, sels, usage)
    out.push(...applyAdditionalFeesToOrgReadings(group, extraSubtotal))
  }
  return out
}
