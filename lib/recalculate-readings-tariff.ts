import { prisma } from '@/lib/prisma'
import {
  applyWaterChargeSplitToWaterRates,
  computeReadingMoney,
  computeReadingMoneySplit,
  effectiveBillingCategory,
  effectiveWaterChargeSplit,
  normalizeBillingMode,
  type BillingMode,
  type WaterTariffRates,
} from '@/lib/meter-reading-calc'
import { TariffPeriodCache } from '@/lib/tariff-period-cache'

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

function waterTariffAdjustedForMeter(
  raw: WaterTariffRates,
  billingMode: BillingMode,
  waterChargeSplit: string | null | undefined
): WaterTariffRates {
  return applyWaterChargeSplitToWaterRates(
    raw,
    effectiveWaterChargeSplit(waterChargeSplit, billingMode)
  )
}

export type ReadingForTariffRecalc = {
  id: string
  meterId: string
  organizationId: string
  year: number
  month: number
  startValue?: number
  endValue?: number
  usage?: number
  heatUsage?: number
  meter?: {
    billingMode?: string | null
    pipeDiameterMm?: number | null
    billingCategory?: string | null
    waterChargeSplit?: string | null
  } | null
  organization?: { category?: string | null } | null
}

/** Нэг заалтын мөрийг тухайн сарын тариф + зөрүүгээр дахин тооцно (синхрон). */
export function recalculateReadingRowMoney<T extends ReadingForTariffRecalc>(
  r: T,
  tariffCache: TariffPeriodCache
): T & {
  baseClean: number
  baseDirty: number
  cleanPerM3: number
  dirtyPerM3: number
  heatBase: number
  heatPerM3: number
  heatPerM2: number
  cleanAmount: number
  dirtyAmount: number
  heatAmount: number
  subtotal: number
  vat: number
  total: number
} {
  const m = r.meter
  const pipeMm =
    m?.pipeDiameterMm != null &&
    Number.isFinite(Number(m.pipeDiameterMm)) &&
    Number(m.pipeDiameterMm) > 0
      ? Math.trunc(Number(m.pipeDiameterMm))
      : null
  const orgCategory = effectiveBillingCategory(m?.billingCategory, r.organization?.category)

  const rawWater = tariffCache.getWaterTariffRates(r.organizationId, {
    pipeDiameterMm: pipeMm,
    billingCategory: m?.billingCategory,
  })
  const heat = tariffCache.getHeatTariffRates(r.organizationId, {
    billingCategory: m?.billingCategory,
  })

  const billingMode = normalizeBillingMode(m?.billingMode)
  const water = waterTariffAdjustedForMeter(rawWater, billingMode, m?.waterChargeSplit)
  const waterUsage = waterUsageFromReading(r)
  const heatUsage = Number(r.heatUsage ?? 0) || 0
  const usage = billingMode === 'HEAT' ? heatUsage : waterUsage
  const money =
    billingMode === 'WATER_HEAT'
      ? computeReadingMoneySplit(waterUsage, heatUsage, orgCategory, billingMode, water, heat)
      : computeReadingMoney(usage, orgCategory, billingMode, water, heat)

  return {
    ...r,
    baseClean: money.baseClean,
    baseDirty: money.baseDirty,
    cleanPerM3: money.cleanPerM3,
    dirtyPerM3: money.dirtyPerM3,
    heatBase: money.heatBase,
    heatPerM3: money.heatPerM3,
    heatPerM2: money.heatPerM2,
    cleanAmount: money.cleanAmount,
    dirtyAmount: money.dirtyAmount,
    heatAmount: money.heatAmount,
    subtotal: money.subtotal,
    vat: money.vat,
    total: money.total,
  }
}

const readingInclude = {
  meter: {
    select: {
      billingMode: true,
      pipeDiameterMm: true,
      billingCategory: true,
      waterChargeSplit: true,
    },
  },
  organization: { select: { category: true } },
} as const

async function recalculateRawRows(
  raw: ReadingForTariffRecalc[],
  year: number,
  month: number
): Promise<number> {
  if (raw.length === 0) return 0

  const tariffCache = await TariffPeriodCache.build(
    [...new Set(raw.map((r) => r.organizationId))],
    year,
    month
  )
  const recalculated = raw.map((r) => recalculateReadingRowMoney(r, tariffCache))

  const { persistReadingMoneyFields, attachAdditionalFeesToReadings } = await import(
    '@/lib/readings-with-additional-fees'
  )
  const withExtras = await attachAdditionalFeesToReadings(recalculated)
  await persistReadingMoneyFields(
    withExtras as Parameters<typeof persistReadingMoneyFields>[0]
  )
  return withExtras.length
}

/** Олон байгууллагын нэг сарын заалтыг нэг удаа тарифаар дахин тооцно. */
export async function recalculateOrgIdsForPeriod(
  organizationIds: string[],
  year: number,
  month: number
): Promise<number> {
  const orgIds = [...new Set(organizationIds.filter(Boolean))]
  if (orgIds.length === 0) return 0
  const raw = await prisma.meterReading.findMany({
    where: { organizationId: { in: orgIds }, year, month },
    include: readingInclude,
  })
  return recalculateRawRows(raw, year, month)
}

/** Байгууллагын тухайн сарын бүх заалтыг тарифаар дахин тооцож DB-д хадгална. */
export async function recalculateOrgPeriodReadings(
  organizationId: string,
  year: number,
  month: number
): Promise<number> {
  return recalculateOrgIdsForPeriod([organizationId], year, month)
}
