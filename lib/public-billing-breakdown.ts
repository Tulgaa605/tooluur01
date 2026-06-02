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
import {
  computeOrganizationAdditionalFees,
  formatAdditionalFeeLineDetail,
  sumOrgUsageTotals,
  type AdditionalFeeLine,
} from '@/lib/additional-fees-calc'
import { loadAdditionalFeeDefinitionsByIds } from '@/lib/additional-fees-db'
import { prisma } from '@/lib/prisma'

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

export type AdditionalFeeDisplayLine = {
  name: string
  detail: string
  amount: number
}

export type OrgAdditionalFeesBreakdown = {
  lines: AdditionalFeeDisplayLine[]
  extraSubtotal: number
  extraVat: number
  extraTotal: number
}

function additionalFeeLinesToDisplay(lines: AdditionalFeeLine[]): AdditionalFeeDisplayLine[] {
  return lines.map((l) => ({
    name: l.name,
    detail: formatAdditionalFeeLineDetail(l),
    amount: l.amount,
  }))
}

/** Сонгосон бусад нэмэлт төлбөрүүдийг нэр, дүнгээр нь буцаана (НӨАТ орсон нийт дүн тусад). */
export async function loadOrgAdditionalFeesBreakdown(
  organizationId: string,
  year: number,
  month: number,
  readings: Parameters<typeof sumOrgUsageTotals>[0]
): Promise<OrgAdditionalFeesBreakdown> {
  const empty: OrgAdditionalFeesBreakdown = {
    lines: [],
    extraSubtotal: 0,
    extraVat: 0,
    extraTotal: 0,
  }

  const meterIds = [
    ...new Set(
      readings
        .map((r: any) => String(r?.meterId ?? r?.meter?.id ?? '').trim())
        .filter(Boolean)
    ),
  ]
  if (meterIds.length === 0) return empty

  const selections = await prisma.meterAdditionalFeeSelection.findMany({
    where: { meterId: { in: meterIds }, year, month, enabled: true },
    select: { meterId: true, feeDefinitionId: true, enabled: true, quantity: true },
  })
  if (selections.length === 0) return empty

  const definitions = await loadAdditionalFeeDefinitionsByIds(
    selections.map((s: { feeDefinitionId: string }) => s.feeDefinitionId)
  )
  if (definitions.length === 0) return empty

  const selsByMeter = new Map<string, typeof selections>()
  for (const s of selections) {
    const k = String(s.meterId)
    const list = selsByMeter.get(k) ?? []
    list.push(s)
    selsByMeter.set(k, list)
  }

  const meterNumberById = new Map(
    readings
      .map((r: any) => [String(r?.meterId ?? r?.meter?.id ?? ''), String(r?.meter?.meterNumber ?? '')] as const)
      .filter((x) => x[0] && x[1])
  )

  let extraSubtotal = 0
  const displayLines: AdditionalFeeDisplayLine[] = []
  for (const [meterId, sels] of selsByMeter) {
    const meterReadings = readings.filter((r: any) => String(r?.meterId ?? r?.meter?.id ?? '') === meterId)
    const usage = sumOrgUsageTotals(meterReadings)
    const { lines, extraSubtotal: sub } = computeOrganizationAdditionalFees(
      definitions,
      sels.map((s: { feeDefinitionId: string; enabled: boolean; quantity: unknown }) => ({
        feeDefinitionId: s.feeDefinitionId,
        enabled: s.enabled,
        quantity: Number(s.quantity) || 0,
      })),
      usage
    )
    if (sub > 0) {
      extraSubtotal = roundMoneyLocal(extraSubtotal + sub)
      const meterNo = meterNumberById.get(meterId) ?? ''
      for (const l of lines) {
        displayLines.push({
          name: meterNo ? `${meterNo} — ${l.name}` : l.name,
          detail: formatAdditionalFeeLineDetail(l),
          amount: l.amount,
        })
      }
    }
  }
  const extraVat = roundMoneyLocal(extraSubtotal * 0.1)
  const extraTotal = roundMoneyLocal(extraSubtotal + extraVat)
  return {
    lines: displayLines,
    extraSubtotal,
    extraVat,
    extraTotal,
  }
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
  subtotal?: unknown
  vat?: unknown
  total?: unknown
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

  const storedSubtotal = Number(reading.subtotal ?? NaN)
  const storedVat = Number(reading.vat ?? NaN)
  const storedTotal = Number(reading.total ?? NaN)
  const useStored =
    Number.isFinite(storedSubtotal) &&
    Number.isFinite(storedVat) &&
    Number.isFinite(storedTotal) &&
    storedTotal >= 0

  return {
    readingId: reading.id,
    meterNumber: reading.meter?.meterNumber ?? '-',
    usage,
    cleanAmount: Number(money.cleanAmount ?? 0) || 0,
    dirtyAmount: Number(money.dirtyAmount ?? 0) || 0,
    heatAmount: Number(money.heatAmount ?? 0) || 0,
    subtotal: useStored ? storedSubtotal : Number(money.subtotal ?? 0) || 0,
    vat: useStored ? storedVat : Number(money.vat ?? 0) || 0,
    total: useStored ? storedTotal : total,
    paid,
    remaining: remainingBalance(useStored ? storedTotal : total, reading.paidAmount),
  }
}
