import { prisma } from '@/lib/prisma'
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
  type HeatTariffRates,
  type WaterTariffRates,
} from '@/lib/meter-reading-calc'

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

type TariffCaches = {
  rawWater: Map<string, WaterTariffRates>
  heat: Map<string, HeatTariffRates>
}

function tariffCacheKey(
  organizationId: string,
  year: number,
  month: number,
  pipeMm: number | null,
  orgCategory: string
): string {
  return `${organizationId}-${year}-${month}-${pipeMm ?? 'org'}|${orgCategory}`
}

export type ReadingForTariffRecalc = {
  id?: string
  organizationId: string
  year: number
  month: number
  startValue?: unknown
  endValue?: unknown
  usage?: unknown
  heatUsage?: unknown
  meter?: {
    billingMode?: string | null
    pipeDiameterMm?: number | null
    billingCategory?: string | null
    waterChargeSplit?: string | null
  } | null
  organization?: { category?: string | null } | null
}

/** Нэг заалтын мөрийг тухайн сарын тариф + зөрүүгээр дахин тооцно. */
export async function recalculateReadingRowMoney<T extends ReadingForTariffRecalc>(
  r: T,
  caches?: TariffCaches
): Promise<
  T & {
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
  }
> {
  const m = r.meter
  const pipeMm =
    m?.pipeDiameterMm != null &&
    Number.isFinite(Number(m.pipeDiameterMm)) &&
    Number(m.pipeDiameterMm) > 0
      ? Math.trunc(Number(m.pipeDiameterMm))
      : null
  const orgCategory = effectiveBillingCategory(m?.billingCategory, r.organization?.category)
  const cacheKey = tariffCacheKey(r.organizationId, r.year, r.month, pipeMm, orgCategory)

  let rawWater = caches?.rawWater.get(cacheKey)
  if (!rawWater) {
    rawWater = await getWaterTariffRatesForPeriod(r.organizationId, r.year, r.month, {
      pipeDiameterMm: pipeMm,
      billingCategory: m?.billingCategory,
    })
    caches?.rawWater.set(cacheKey, rawWater)
  }

  let heat = caches?.heat.get(cacheKey)
  if (!heat) {
    heat = await getHeatTariffRatesForPeriod(r.organizationId, r.year, r.month, {
      billingCategory: m?.billingCategory,
    })
    caches?.heat.set(cacheKey, heat)
  }

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

/** Байгууллагын тухайн сарын бүх заалтыг тарифаар дахин тооцож DB-д хадгална. */
export async function recalculateOrgPeriodReadings(
  organizationId: string,
  year: number,
  month: number
): Promise<number> {
  const raw = await prisma.meterReading.findMany({
    where: { organizationId, year, month },
    include: {
      meter: {
        select: {
          billingMode: true,
          pipeDiameterMm: true,
          billingCategory: true,
          waterChargeSplit: true,
        },
      },
      organization: { select: { category: true } },
    },
  })
  if (raw.length === 0) return 0

  const caches: TariffCaches = { rawWater: new Map(), heat: new Map() }
  const recalculated = await Promise.all(
    raw.map((r) =>
      recalculateReadingRowMoney(
        {
          ...r,
          organizationId: r.organizationId,
          year: r.year,
          month: r.month,
          meter: r.meter,
          organization: r.organization,
        },
        caches
      )
    )
  )

  const { persistReadingMoneyFields } = await import('@/lib/readings-with-additional-fees')
  const { attachAdditionalFeesToReadings } = await import('@/lib/readings-with-additional-fees')

  const withExtras = await attachAdditionalFeesToReadings(recalculated)
  await persistReadingMoneyFields(withExtras)
  return withExtras.length
}
