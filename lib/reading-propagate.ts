import { prisma } from '@/lib/prisma'
import { type BillingMode } from '@/lib/meter-reading-calc'

function periodSortKey(year: number, month: number): number {
  return year * 100 + month
}

function roundReading(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Хойшхи сар: эхний заалт = өмнөх сарын эцэс.
 * Хойшхи сарын эцэс > тэр эхнээс их байвал эцсийг үлдээнэ.
 * Үгүй бол эхний болон эцсийн заалт ижил болно.
 */
export function nextPeriodStartEnd(
  carriedStart: number,
  existingEnd: number
): { start: number; end: number } {
  const start = roundReading(Number(carriedStart) || 0)
  const end = roundReading(Number(existingEnd) || 0)
  if (end > start + 0.005) return { start, end }
  return { start, end: start }
}

/**
 * Тухайн сарын эцсийн заалт өөрчлөгдсөний дараа ижил тоолуурын бүх ДАРААГИЙХ заалтуудыг
 * (сар алгассан ч) дараалан дагуулж шинэчилнэ.
 *
 * Тариф/мөнгөн тооцоолол ХИЙХГҮЙ — энэ зөвхөн start/end/usage дарааллыг шинэчилнэ.
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
  let carried = roundReading(opts.carriedEnd)

  const all = await prisma.meterReading.findMany({
    where: { meterId },
    select: {
      id: true,
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

  const nowIso = new Date().toISOString()
  const userOid = /^[a-f\d]{24}$/i.test(updatedByUserId) ? { $oid: updatedByUserId } : updatedByUserId
  const mongoUpdates: Record<string, unknown>[] = []

  for (const nextReading of later) {
    const { start: nextStartValue, end: nextEndValue } = nextPeriodStartEnd(
      carried,
      Number(nextReading.endValue ?? 0) || 0
    )
    const nextUsage = Math.max(0, roundReading(nextEndValue - nextStartValue))
    const preservedHeat = Number(nextReading.heatUsage ?? 0) || 0
    const heatForSplit = billingMode === 'WATER' ? 0 : preservedHeat
    const nextHeatStored = billingMode === 'HEAT' || billingMode === 'WATER_HEAT' ? heatForSplit : 0
    const nextUsageStored = billingMode === 'HEAT' ? (preservedHeat > 0 ? preservedHeat : nextUsage) : nextUsage

    mongoUpdates.push({
      q: { _id: { $oid: nextReading.id } },
      u: {
        $set: {
          startValue: nextStartValue,
          endValue: nextEndValue,
          heatUsage: nextHeatStored,
          usage: nextUsageStored,
          updatedByUserId: userOid,
          updatedAt: { $date: nowIso },
        },
      },
      multi: false,
      upsert: false,
    })

    carried = nextEndValue
  }

  if (mongoUpdates.length === 0) return
  await prisma.$runCommandRaw({
    update: 'meter_readings',
    updates: mongoUpdates,
    ordered: true,
  })
}
