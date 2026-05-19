import {
  applyWaterChargeSplitToWaterRates,
  computeReadingMoney,
  computeReadingMoneySplit,
  effectiveBillingCategory,
  effectiveWaterChargeSplit,
  getHeatTariffRatesForPeriod,
  getWaterTariffRatesForPeriod,
  normalizeBillingMode,
  type BillingMode,
  type WaterTariffRates,
} from '@/lib/meter-reading-calc'

export function formatMoney(value: unknown): string {
  const n = Number(value ?? 0)
  const safe = Number.isFinite(n) ? n : 0
  return safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatUsage(value: unknown): string {
  const n = Number(value ?? 0)
  const safe = Number.isFinite(n) ? n : 0
  return safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function roundMoneyLocal(n: number): number {
  return Math.round(n * 100) / 100
}

export const PAY_EPS = 0.009

export function effectivePaid(paidStored: unknown): number {
  return roundMoneyLocal(Number(paidStored ?? 0) || 0)
}

export function remainingBalance(total: unknown, paidStored: unknown): number {
  const t = Number(total ?? 0) || 0
  return Math.max(0, roundMoneyLocal(t - effectivePaid(paidStored)))
}

export function paymentStatusLabel(total: unknown, paidStored: unknown): string {
  const rem = remainingBalance(total, paidStored)
  if (rem <= PAY_EPS) return 'Бүрэн төлөгдсөн'
  if (effectivePaid(paidStored) > PAY_EPS) return 'Хэсэгчлэн төлөгдсөн'
  return 'Хүлээгдэж буй'
}

export function waterUsageFromReading(r: {
  startValue?: unknown
  endValue?: unknown
  usage?: unknown
}): number {
  const s = Number(r.startValue ?? 0)
  const e = Number(r.endValue ?? 0)
  const diff = e > s ? e - s : 0
  if (diff > 0) return diff
  const u = Number(r.usage ?? 0)
  return Number.isFinite(u) && u >= 0 ? u : 0
}

export function waterTariffAdjustedForMeter(
  raw: WaterTariffRates,
  billingMode: BillingMode,
  waterChargeSplit: string | null | undefined
): WaterTariffRates {
  return applyWaterChargeSplitToWaterRates(
    raw,
    effectiveWaterChargeSplit(waterChargeSplit, billingMode)
  )
}

export type ReadingBreakdownLine = {
  readingId: string
  meterNumber: string
  usage: number
  cleanAmount: number
  dirtyAmount: number
  heatAmount: number
  subtotal: number
  vat: number
  total: number
  paid: number
  remaining: number
}

export async function computeReadingBreakdownLine(reading: {
  id: string
  organizationId: string
  year: number
  month: number
  startValue?: unknown
  endValue?: unknown
  usage?: unknown
  heatUsage?: unknown
  paidAmount?: unknown
  meter?: {
    meterNumber: string
    billingMode?: string | null
    waterChargeSplit?: string | null
    pipeDiameterMm?: number | null
    billingCategory?: string | null
  } | null
  organization?: { category?: string | null } | null
}): Promise<ReadingBreakdownLine> {
  const pipeMm =
    reading.meter?.pipeDiameterMm != null &&
    Number.isFinite(Number(reading.meter.pipeDiameterMm)) &&
    Number(reading.meter.pipeDiameterMm) > 0
      ? Math.trunc(Number(reading.meter.pipeDiameterMm))
      : null

  const orgCategory = effectiveBillingCategory(
    reading.meter?.billingCategory,
    reading.organization?.category
  )
  const billingMode = normalizeBillingMode(reading.meter?.billingMode)
  const rawWater = await getWaterTariffRatesForPeriod(
    reading.organizationId,
    reading.year,
    reading.month,
    { pipeDiameterMm: pipeMm, billingCategory: reading.meter?.billingCategory }
  )
  const heat = await getHeatTariffRatesForPeriod(reading.organizationId, reading.year, reading.month, {
    billingCategory: reading.meter?.billingCategory,
  })
  const water = waterTariffAdjustedForMeter(rawWater, billingMode, reading.meter?.waterChargeSplit)

  const waterUsage = waterUsageFromReading(reading)
  const heatUsage = Number(reading.heatUsage ?? 0) || 0
  const usage = billingMode === 'HEAT' ? heatUsage : waterUsage

  const money =
    billingMode === 'WATER_HEAT'
      ? computeReadingMoneySplit(waterUsage, heatUsage, orgCategory, billingMode, water, heat)
      : computeReadingMoney(usage, orgCategory, billingMode, water, heat)

  const total = Number(money.total ?? 0) || 0
  const paid = effectivePaid(reading.paidAmount)

  return {
    readingId: reading.id,
    meterNumber: reading.meter?.meterNumber ?? '-',
    usage,
    cleanAmount: Number(money.cleanAmount ?? 0) || 0,
    dirtyAmount: Number(money.dirtyAmount ?? 0) || 0,
    heatAmount: Number(money.heatAmount ?? 0) || 0,
    subtotal: Number(money.subtotal ?? 0) || 0,
    vat: Number(money.vat ?? 0) || 0,
    total,
    paid,
    remaining: remainingBalance(total, reading.paidAmount),
  }
}
