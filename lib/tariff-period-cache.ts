import { prisma } from '@/lib/prisma'
import { heatDefaultsForCategory, orgMonthlyHeatTariffIsEmpty } from '@/lib/heat-tariff-defaults'
import {
  effectiveBillingCategory,
  type HeatTariffRates,
  type WaterTariffRates,
} from '@/lib/meter-reading-calc-core'
import type { CategoryTariffLookup } from '@/lib/category-tariff-scope'

type OrgRow = {
  id: string
  category: string | null
  connectionNumber: string | null
  baseCleanFee: number | null
  baseDirtyFee: number | null
  managedByOrganizationId: string | null
}

type OrgTariffRow = {
  organizationId: string
  baseCleanFee: number
  baseDirtyFee: number
  cleanPerM3: number
  dirtyPerM3: number
  heatBaseFee: number
  heatPerM3: number
  heatPerM2: number
}

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

function resolvePipeDiameter(
  org: OrgRow,
  pipeDiameterMm?: number | null
): number {
  if (
    pipeDiameterMm != null &&
    Number.isFinite(Number(pipeDiameterMm)) &&
    Number(pipeDiameterMm) > 0
  ) {
    return Math.trunc(Number(pipeDiameterMm))
  }
  if (org.connectionNumber) {
    const d = parseInt(String(org.connectionNumber).trim(), 10)
    if (!Number.isNaN(d)) return d
  }
  return NaN
}

/**
 * Нэг (он, сар)-д олон байгууллагын тарифыг 4–5 query-оор ачаалж,
 * заалт бүрт дахин DB рүү орохгүй.
 */
export class TariffPeriodCache {
  private readonly orgById = new Map<string, OrgRow>()
  private readonly orgTariffByOrgId = new Map<string, OrgTariffRow>()
  private readonly categoryByOwnerCat = new Map<string, CategoryTariffLookup>()
  private readonly pipeByDiam = new Map<number, { baseCleanFee: number; baseDirtyFee: number }>()

  private constructor() {}

  static async build(
    organizationIds: string[],
    year: number,
    month: number
  ): Promise<TariffPeriodCache> {
    const cache = new TariffPeriodCache()
    const orgIds = [...new Set(organizationIds.filter(Boolean))]
    if (orgIds.length === 0) return cache

    const [orgs, orgTariffs, pipeFees] = await Promise.all([
      prisma.organization.findMany({
        where: { id: { in: orgIds } },
        select: {
          id: true,
          category: true,
          connectionNumber: true,
          baseCleanFee: true,
          baseDirtyFee: true,
          managedByOrganizationId: true,
        },
      }),
      prisma.organizationTariff.findMany({
        where: { organizationId: { in: orgIds }, year, month },
        select: {
          organizationId: true,
          baseCleanFee: true,
          baseDirtyFee: true,
          cleanPerM3: true,
          dirtyPerM3: true,
          heatBaseFee: true,
          heatPerM3: true,
          heatPerM2: true,
        },
      }),
      prisma.pipeFee.findMany({
        select: { diameterMm: true, baseCleanFee: true, baseDirtyFee: true },
      }),
    ])

    for (const o of orgs) cache.orgById.set(o.id, o)
    for (const t of orgTariffs) {
      cache.orgTariffByOrgId.set(t.organizationId, {
        organizationId: t.organizationId,
        baseCleanFee: t.baseCleanFee ?? 0,
        baseDirtyFee: t.baseDirtyFee ?? 0,
        cleanPerM3: t.cleanPerM3 ?? 0,
        dirtyPerM3: t.dirtyPerM3 ?? 0,
        heatBaseFee: t.heatBaseFee ?? 0,
        heatPerM3: t.heatPerM3 ?? 0,
        heatPerM2: t.heatPerM2 ?? 0,
      })
    }
    for (const p of pipeFees) {
      cache.pipeByDiam.set(p.diameterMm, {
        baseCleanFee: p.baseCleanFee ?? 0,
        baseDirtyFee: p.baseDirtyFee ?? 0,
      })
    }

    const ownerIds = [
      ...new Set(
        orgs.map((o) => o.managedByOrganizationId).filter((id): id is string => !!id)
      ),
    ]
    if (ownerIds.length > 0) {
      const catRows = await prisma.categoryTariff.findMany({
        where: { ownerOrganizationId: { in: ownerIds } },
        select: {
          category: true,
          ownerOrganizationId: true,
          baseCleanFee: true,
          baseDirtyFee: true,
          cleanPerM3: true,
          dirtyPerM3: true,
          heatBaseFee: true,
          heatPerM3: true,
          heatPerM2: true,
        },
      })
      for (const c of catRows) {
        cache.categoryByOwnerCat.set(`${c.ownerOrganizationId}|${c.category}`, c)
      }
    }

    return cache
  }

  private categoryForOrg(
    organizationId: string,
    billingCategory?: string | null
  ): CategoryTariffLookup | null {
    const org = this.orgById.get(organizationId)
    if (!org?.managedByOrganizationId) return null
    const cat = effectiveBillingCategory(billingCategory, org.category)
    return this.categoryByOwnerCat.get(`${org.managedByOrganizationId}|${cat}`) ?? null
  }

  getWaterTariffRates(
    organizationId: string,
    opts?: { pipeDiameterMm?: number | null; billingCategory?: string | null }
  ): WaterTariffRates {
    const org = this.orgById.get(organizationId)
    if (!org) return { baseClean: 0, baseDirty: 0, cleanPerM3: 0, dirtyPerM3: 0 }

    const catRow = this.categoryForOrg(organizationId, opts?.billingCategory)
    const meterCategoryOverride =
      opts?.billingCategory != null && String(opts.billingCategory).trim().length > 0

    let baseClean = 0
    let baseDirty = 0
    let cleanPerM3 = 0
    let dirtyPerM3 = 0

    const pipeDiam = resolvePipeDiameter(org, opts?.pipeDiameterMm)
    if (!Number.isNaN(pipeDiam)) {
      const pipeFee = this.pipeByDiam.get(pipeDiam)
      if (pipeFee) {
        baseClean = pipeFee.baseCleanFee
        baseDirty = pipeFee.baseDirtyFee
      }
    }

    if (!meterCategoryOverride) {
      const orgTariff = this.orgTariffByOrgId.get(organizationId)
      if (orgTariff) {
        if (Number.isNaN(pipeDiam)) {
          baseClean = orgTariff.baseCleanFee
          baseDirty = orgTariff.baseDirtyFee
        }
        cleanPerM3 = orgTariff.cleanPerM3
        dirtyPerM3 = orgTariff.dirtyPerM3
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

  getHeatTariffRates(
    organizationId: string,
    opts?: { billingCategory?: string | null }
  ): HeatTariffRates {
    const org = this.orgById.get(organizationId)
    if (!org) return { heatBase: 0, heatPerM3: 0, heatPerM2: 0 }

    const categoryForTariffs = effectiveBillingCategory(opts?.billingCategory, org.category)
    const meterCategoryOverride =
      opts?.billingCategory != null && String(opts.billingCategory).trim().length > 0

    if (!meterCategoryOverride) {
      const orgTariff = this.orgTariffByOrgId.get(organizationId)
      if (orgTariff && !orgMonthlyHeatTariffIsEmpty(orgTariff)) {
        return {
          heatBase: orgTariff.heatBaseFee,
          heatPerM3: orgTariff.heatPerM3,
          heatPerM2: orgTariff.heatPerM2,
        }
      }
    }

    const catRow = this.categoryForOrg(organizationId, opts?.billingCategory)
    if (catRow && !orgMonthlyHeatTariffIsEmpty(catRow)) {
      return {
        heatBase: catRow.heatBaseFee ?? 0,
        heatPerM3: catRow.heatPerM3 ?? 0,
        heatPerM2: catRow.heatPerM2 ?? 0,
      }
    }

    const d = heatDefaultsForCategory(String(categoryForTariffs ?? ''))
    return { heatBase: 0, heatPerM3: d.heatPerM3 ?? 0, heatPerM2: d.heatPerM2 ?? 0 }
  }
}
