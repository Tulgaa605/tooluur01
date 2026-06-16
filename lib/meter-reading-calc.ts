import { prisma } from '@/lib/prisma'
import {
  type BillingMode,
  type HeatTariffRates,
  applyManualHeatAmountToMoney,
  applyWaterChargeSplitToWaterRates,
  computeReadingMoneySplit,
  computeReadingMoney,
  effectiveBillingCategory,
  effectiveWaterChargeSplit,
  normalizeBillingMode,
  type ReadingMoneySnapshot,
  type WaterChargeSplit,
  type WaterTariffRates,
} from '@/lib/meter-reading-calc-core'
import { heatDefaultsForCategory, orgMonthlyHeatTariffIsEmpty } from '@/lib/heat-tariff-defaults'
import {
  findCategoryTariffForCustomer,
  type CategoryTariffLookup,
} from '@/lib/category-tariff-scope'

/** Байгууллагын сарын тариф дээр ₮/м³ 0 байвал төрлийн тарифаас нөхнө (зөрүү × тариф). */
function applyCategoryPerM3Fallback(
  rates: WaterTariffRates,
  catRow: CategoryTariffLookup | null
): WaterTariffRates {
  if (!catRow) return rates
  let cleanPerM3 = Number(rates.cleanPerM3) || 0
  let dirtyPerM3 = Number(rates.dirtyPerM3) || 0
  const catClean = Number(catRow.cleanPerM3) || 0
  const catDirty = Number(catRow.dirtyPerM3) || 0
  if (cleanPerM3 <= 0 && catClean > 0) cleanPerM3 = catClean
  if (dirtyPerM3 <= 0 && catDirty > 0) dirtyPerM3 = catDirty
  return { ...rates, cleanPerM3, dirtyPerM3 }
}

export type { BillingMode, HeatTariffRates, ReadingMoneySnapshot, WaterChargeSplit, WaterTariffRates }
export {
  applyManualHeatAmountToMoney,
  applyWaterChargeSplitToWaterRates,
  computeReadingMoney,
  computeReadingMoneySplit,
  effectiveBillingCategory,
  effectiveWaterChargeSplit,
  normalizeBillingMode,
}

/** Усны тариф: шугамын голч, байгууллагын сарын тариф, төрлийн тариф эсвэл байгууллагын суурь. */
export async function getWaterTariffRatesForPeriod(
  organizationId: string,
  year: number,
  month: number,
  opts?: { pipeDiameterMm?: number | null; billingCategory?: string | null }
): Promise<WaterTariffRates> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { category: true, connectionNumber: true, baseCleanFee: true, baseDirtyFee: true },
  })
  if (!org) return { baseClean: 0, baseDirty: 0, cleanPerM3: 0, dirtyPerM3: 0 }

  const categoryForTariffs = effectiveBillingCategory(opts?.billingCategory, org.category)
  const catRow = await findCategoryTariffForCustomer(organizationId, categoryForTariffs)
  // Тоолуурт өөрийн billingCategory тогтоосон бол түүний тариф (CategoryTariff)-аар тооцно;
  // байгууллагын сарын тариф (OrganizationTariff) уг тоолуурт хамаарахгүй.
  const meterCategoryOverride =
    opts?.billingCategory != null && String(opts.billingCategory).trim().length > 0

  let baseClean = 0
  let baseDirty = 0
  let cleanPerM3 = 0
  let dirtyPerM3 = 0

  let pipeDiam = NaN
  const fromMeter =
    opts?.pipeDiameterMm != null &&
    Number.isFinite(Number(opts.pipeDiameterMm)) &&
    Number(opts.pipeDiameterMm) > 0
  if (fromMeter) {
    pipeDiam = Math.trunc(Number(opts.pipeDiameterMm))
  } else if (org.connectionNumber) {
    pipeDiam = parseInt(String(org.connectionNumber).trim(), 10)
  }
  if (!Number.isNaN(pipeDiam)) {
    const pipeFee = await prisma.pipeFee.findUnique({
      where: { diameterMm: pipeDiam },
      select: { baseCleanFee: true, baseDirtyFee: true },
    })
    if (pipeFee) {
      baseClean = pipeFee.baseCleanFee ?? 0
      baseDirty = pipeFee.baseDirtyFee ?? 0
    }
  }

  if (!meterCategoryOverride) {
    const orgTariff = await prisma.organizationTariff.findUnique({
      where: { organizationId_year_month: { organizationId, year, month } },
      select: { baseCleanFee: true, baseDirtyFee: true, cleanPerM3: true, dirtyPerM3: true },
    })
    if (orgTariff) {
      if (Number.isNaN(pipeDiam)) {
        baseClean = orgTariff.baseCleanFee ?? 0
        baseDirty = orgTariff.baseDirtyFee ?? 0
      }
      cleanPerM3 = orgTariff.cleanPerM3 ?? 0
      dirtyPerM3 = orgTariff.dirtyPerM3 ?? 0
      return applyCategoryPerM3Fallback(
        { baseClean, baseDirty, cleanPerM3, dirtyPerM3 },
        catRow
      )
    }
  }

  if (catRow) {
    if (Number.isNaN(pipeDiam)) {
      baseClean = catRow.baseCleanFee ?? 0
      baseDirty = catRow.baseDirtyFee ?? 0
    }
    cleanPerM3 = catRow.cleanPerM3 ?? 0
    dirtyPerM3 = catRow.dirtyPerM3 ?? 0
    return applyCategoryPerM3Fallback(
      { baseClean, baseDirty, cleanPerM3, dirtyPerM3 },
      catRow
    )
  }

  if (Number.isNaN(pipeDiam)) {
    baseClean = org.baseCleanFee ?? 0
    baseDirty = org.baseDirtyFee ?? 0
  }
  return applyCategoryPerM3Fallback(
    { baseClean, baseDirty, cleanPerM3, dirtyPerM3 },
    catRow
  )
}

/** Дулааны тариф: байгууллагын сарын тариф эсвэл төрлийн тариф. */
export async function getHeatTariffRatesForPeriod(
  organizationId: string,
  year: number,
  month: number,
  opts?: { billingCategory?: string | null }
): Promise<HeatTariffRates> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { category: true },
  })
  if (!org) return { heatBase: 0, heatPerM3: 0, heatPerM2: 0 }

  const categoryForTariffs = effectiveBillingCategory(opts?.billingCategory, org.category)
  // Тоолуурт өөрийн billingCategory тогтоосон бол сонгосон төрлийн тарифыг шууд ашиглана.
  const meterCategoryOverride =
    opts?.billingCategory != null && String(opts.billingCategory).trim().length > 0

  if (!meterCategoryOverride) {
    const orgTariff = await prisma.organizationTariff.findUnique({
      where: { organizationId_year_month: { organizationId, year, month } },
      select: { heatBaseFee: true, heatPerM3: true, heatPerM2: true },
    })
    if (orgTariff && !orgMonthlyHeatTariffIsEmpty(orgTariff)) {
      return {
        heatBase: orgTariff.heatBaseFee ?? 0,
        heatPerM3: orgTariff.heatPerM3 ?? 0,
        heatPerM2: orgTariff.heatPerM2 ?? 0,
      }
    }
  }

  const catRow = await findCategoryTariffForCustomer(organizationId, categoryForTariffs)
  if (catRow && !orgMonthlyHeatTariffIsEmpty(catRow)) {
    return {
      heatBase: catRow.heatBaseFee ?? 0,
      heatPerM3: catRow.heatPerM3 ?? 0,
      heatPerM2: catRow.heatPerM2 ?? 0,
    }
  }

  // Fallback: төрлийн тариф DB-д байхгүй (эсвэл seed хийгдээгүй) үед албан default үнэ ашиглана.
  const d = heatDefaultsForCategory(String(categoryForTariffs ?? ''))
  return { heatBase: 0, heatPerM3: d.heatPerM3 ?? 0, heatPerM2: d.heatPerM2 ?? 0 }
}
