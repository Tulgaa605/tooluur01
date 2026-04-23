import { prisma } from '@/lib/prisma'
import {
  type BillingMode,
  applyWaterChargeSplitToWaterRates,
  computeReadingMoney,
  computeReadingMoneySplit,
  effectiveWaterChargeSplit,
  getHeatTariffRatesForPeriod,
  getWaterTariffRatesForPeriod,
  type WaterTariffRates,
} from '@/lib/meter-reading-calc'

function periodSortKey(year: number, month: number): number {
  return year * 100 + month
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

/**
 * Тухайн сарын эцсийн заалт өөрчлөгдсөний дараа ижил тоолуурын бүх ДАРААГИЙХ заалтуудыг
 * (сар алгассан ч) дараалан дагуулж шинэчилнө.
 * Тариф / байгууллагын category-г кэшлэж олон сарын дагуулалтыг хурдан болгоно.
 */
export async function propagateLaterReadingsAfterEndChange(opts: {
  meterId: string
  billingMode: BillingMode
  waterChargeSplit?: string | null
  afterYear: number
  afterMonth: number
  carriedEnd: number
  updatedByUserId: string
}) {
  const { meterId, billingMode, afterYear, afterMonth, updatedByUserId } = opts
  const split = opts.waterChargeSplit
  let carried = opts.carriedEnd

  const all = await prisma.meterReading.findMany({
    where: { meterId },
    select: {
      id: true,
      organizationId: true,
      year: true,
      month: true,
      startValue: true,
      endValue: true,
      usage: true,
      heatUsage: true,
    },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  })

  const anchor = periodSortKey(afterYear, afterMonth)
  const later = all.filter((r) => periodSortKey(r.year, r.month) > anchor)
  if (later.length === 0) return

  const waterTariffCache = new Map<string, Awaited<ReturnType<typeof getWaterTariffRatesForPeriod>>>()
  const heatTariffCache = new Map<string, Awaited<ReturnType<typeof getHeatTariffRatesForPeriod>>>()
  const orgCategoryCache = new Map<string, string>()

  const waterCached = async (organizationId: string, year: number, month: number) => {
    const k = `${organizationId}|${year}|${month}`
    let v = waterTariffCache.get(k)
    if (!v) {
      v = await getWaterTariffRatesForPeriod(organizationId, year, month)
      waterTariffCache.set(k, v)
    }
    return v
  }
  const heatCached = async (organizationId: string, year: number, month: number) => {
    const k = `${organizationId}|${year}|${month}`
    let v = heatTariffCache.get(k)
    if (!v) {
      v = await getHeatTariffRatesForPeriod(organizationId, year, month)
      heatTariffCache.set(k, v)
    }
    return v
  }
  const orgCatCached = async (organizationId: string) => {
    if (orgCategoryCache.has(organizationId)) return orgCategoryCache.get(organizationId)!
    const o = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { category: true },
    })
    const c = o?.category ?? 'HOUSEHOLD'
    orgCategoryCache.set(organizationId, c)
    return c
  }

  for (const nextReading of later) {
    const nextPeriod = { year: nextReading.year, month: nextReading.month }
    const nextStartValue = carried
    const prevStart = Number(nextReading.startValue ?? 0)
    const preservedEnd = Number(nextReading.endValue ?? 0)
    const onlyUpdateStart = preservedEnd !== prevStart

    let nextEndValue: number
    if (onlyUpdateStart) {
      nextEndValue = preservedEnd
      if (nextEndValue < nextStartValue) nextEndValue = nextStartValue
    } else {
      nextEndValue = nextStartValue
    }
    const nextUsage = nextEndValue - nextStartValue

    const preservedHeat = Number(nextReading.heatUsage ?? 0) || 0
    const heatForSplit = billingMode === 'WATER' ? 0 : preservedHeat

    const [nextWaterRaw, nextHeat] = await Promise.all([
      waterCached(nextReading.organizationId, nextPeriod.year, nextPeriod.month),
      heatCached(nextReading.organizationId, nextPeriod.year, nextPeriod.month),
    ])
    const nextWater = waterTariffAdjustedForMeter(nextWaterRaw, billingMode, split)
    const orgCategory = await orgCatCached(nextReading.organizationId)

    const usageForMoney =
      billingMode === 'HEAT'
        ? preservedHeat > 0
          ? preservedHeat
          : nextUsage
        : nextUsage

    const nextMoney =
      billingMode === 'WATER_HEAT'
        ? computeReadingMoneySplit(
            nextUsage,
            heatForSplit,
            orgCategory,
            billingMode,
            nextWater,
            nextHeat
          )
        : computeReadingMoney(usageForMoney, orgCategory, billingMode, nextWater, nextHeat)

    const nextHeatStored = billingMode === 'HEAT' || billingMode === 'WATER_HEAT' ? heatForSplit : 0
    const nextUsageStored = billingMode === 'HEAT' ? usageForMoney : nextUsage

    await prisma.meterReading.update({
      where: { id: nextReading.id },
      data: {
        startValue: nextStartValue,
        endValue: nextEndValue,
        heatUsage: nextHeatStored,
        usage: nextUsageStored,
        baseClean: nextMoney.baseClean,
        baseDirty: nextMoney.baseDirty,
        cleanPerM3: nextMoney.cleanPerM3,
        dirtyPerM3: nextMoney.dirtyPerM3,
        heatBase: nextMoney.heatBase,
        heatPerM3: nextMoney.heatPerM3,
        heatPerM2: nextMoney.heatPerM2,
        cleanAmount: nextMoney.cleanAmount,
        dirtyAmount: nextMoney.dirtyAmount,
        heatAmount: nextMoney.heatAmount,
        subtotal: nextMoney.subtotal,
        vat: nextMoney.vat,
        total: nextMoney.total,
        updatedByUserId,
      },
    })

    carried = nextEndValue
  }
}
