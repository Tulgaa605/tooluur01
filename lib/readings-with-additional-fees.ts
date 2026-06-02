import { prisma } from '@/lib/prisma'
import {
  applyAdditionalFeesForAllOrganizations,
  type AdditionalFeeDefinitionRow,
} from '@/lib/additional-fees-calc'
import {
  loadAdditionalFeeDefinitionsByIds,
  loadAdditionalFeeSelectionsForMeterPeriods,
} from '@/lib/additional-fees-db'

/** НӨАТ-гүй дүн = цэвэр + бохир + дулаан (тарифын суурь). */
export function resetReadingAmountsFromLineItems<
  T extends {
    cleanAmount?: unknown
    dirtyAmount?: unknown
    heatAmount?: unknown
  },
>(r: T): T & { subtotal: number; vat: number; total: number; additionalFeesAmount: number } {
  const subtotal =
    Math.round(
      ((Number(r.cleanAmount) || 0) +
        (Number(r.dirtyAmount) || 0) +
        (Number(r.heatAmount) || 0)) *
        100
    ) / 100
  const vat = Math.round(subtotal * 0.1 * 100) / 100
  const total = Math.round((subtotal + vat) * 100) / 100
  return { ...r, subtotal, vat, total, additionalFeesAmount: 0 }
}

async function loadDefinitionsForSelections(
  selectionsByOrgPeriod: Map<string, { feeDefinitionId: string }[]>
): Promise<AdditionalFeeDefinitionRow[]> {
  const feeIds = new Set<string>()
  for (const sels of selectionsByOrgPeriod.values()) {
    for (const s of sels) feeIds.add(s.feeDefinitionId)
  }
  return loadAdditionalFeeDefinitionsByIds([...feeIds])
}

/**
 * Тарифын мөр дүнгээс нэмэлт төлбөр нэмж, НӨАТ-ыг шинэ subtotal дээр дахин тооцно.
 */
export async function attachAdditionalFeesToReadings<
  T extends {
    organizationId: string
    meterId: string
    year: number
    month: number
    subtotal: number
    vat: number
    total: number
    cleanAmount?: unknown
    dirtyAmount?: unknown
    heatAmount?: unknown
    startValue?: unknown
    endValue?: unknown
    heatUsage?: unknown
    billingMode?: string | null
    meter?: { billingMode?: string | null } | null
    isPhantom?: boolean
  },
>(readings: T[]): Promise<T[]> {
  if (readings.length === 0) return readings

  const tariffBase = readings.map((r) => resetReadingAmountsFromLineItems(r))
  const meterPeriods = [
    ...new Map(
      tariffBase
        .filter((r) => !r.isPhantom)
        .map((r) => [
          `${r.meterId}|${r.year}|${r.month}`,
          { meterId: r.meterId, year: r.year, month: r.month },
        ])
    ).values(),
  ]
  if (meterPeriods.length === 0) return tariffBase

  const selectionsByMeterPeriod = await loadAdditionalFeeSelectionsForMeterPeriods(meterPeriods)
  const definitions = await loadDefinitionsForSelections(selectionsByMeterPeriod)
  return applyAdditionalFeesForAllOrganizations(tariffBase, definitions, selectionsByMeterPeriod)
}

export async function persistReadingMoneyFields(
  readings: Array<{
    id?: string
    isPhantom?: boolean
    subtotal?: number
    vat?: number
    total?: number
    cleanAmount?: number
    dirtyAmount?: number
    heatAmount?: number
    baseClean?: number
    baseDirty?: number
    cleanPerM3?: number
    dirtyPerM3?: number
    heatBase?: number
    heatPerM3?: number
    heatPerM2?: number
    heatUsage?: number
    usage?: number
  }>
): Promise<void> {
  const rows = readings.filter((r) => r.id && !r.isPhantom)
  if (rows.length === 0) return

  await Promise.all(
    rows.map((r) =>
      prisma.meterReading.update({
        where: { id: r.id! },
        data: {
          subtotal: Number(r.subtotal) || 0,
          vat: Number(r.vat) || 0,
          total: Number(r.total) || 0,
          ...(r.cleanAmount != null ? { cleanAmount: Number(r.cleanAmount) || 0 } : {}),
          ...(r.dirtyAmount != null ? { dirtyAmount: Number(r.dirtyAmount) || 0 } : {}),
          ...(r.heatAmount != null ? { heatAmount: Number(r.heatAmount) || 0 } : {}),
          ...(r.baseClean != null ? { baseClean: Number(r.baseClean) || 0 } : {}),
          ...(r.baseDirty != null ? { baseDirty: Number(r.baseDirty) || 0 } : {}),
          ...(r.cleanPerM3 != null ? { cleanPerM3: Number(r.cleanPerM3) || 0 } : {}),
          ...(r.dirtyPerM3 != null ? { dirtyPerM3: Number(r.dirtyPerM3) || 0 } : {}),
          ...(r.heatBase != null ? { heatBase: Number(r.heatBase) || 0 } : {}),
          ...(r.heatPerM3 != null ? { heatPerM3: Number(r.heatPerM3) || 0 } : {}),
          ...(r.heatPerM2 != null ? { heatPerM2: Number(r.heatPerM2) || 0 } : {}),
          ...(r.heatUsage != null ? { heatUsage: Number(r.heatUsage) || 0 } : {}),
          ...(r.usage != null ? { usage: Number(r.usage) || 0 } : {}),
        },
      })
    )
  )
}

/** Нэг байгууллагын тухайн сарын заалтуудыг DB-ээс уншиж, нэмэлт төлбөртэй дүнг хадгална. */
export async function recalculateAndPersistOrgPeriodAdditionalFees(
  organizationId: string,
  year: number,
  month: number
): Promise<void> {
  const raw = await prisma.meterReading.findMany({ where: { organizationId, year, month } })
  if (raw.length === 0) return
  const withFees = await attachAdditionalFeesToReadings(raw)
  await persistReadingMoneyFields(withFees)
}
