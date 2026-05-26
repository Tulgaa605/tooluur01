import { prisma } from '@/lib/prisma'
import { type BillingMode } from '@/lib/meter-reading-calc'

function periodSortKey(year: number, month: number): number {
  return year * 100 + month
}

/**
 * Тухайн сарын эцсийн заалт өөрчлөгдсөний дараа ижил тоолуурын бүх ДАРААГИЙХ заалтуудыг
 * (сар алгассан ч) дараалан дагуулж шинэчилнэ.
 *
 * Тариф/мөнгөн тооцоолол ХИЙХГҮЙ — энэ зөвхөн `startValue` (хэрэглээний дараалал)-ыг
 * шинэчилнэ. Мөнгөн дүнг (subtotal/vat/total) "Бодолт" товч дарагдах үед нь
 * `GET /api/readings?recalculate=1`-аар тооцож харуулна.
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
  let carried = opts.carriedEnd

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

  for (const nextReading of later) {
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

    const nextHeatStored = billingMode === 'HEAT' || billingMode === 'WATER_HEAT' ? heatForSplit : 0
    const nextUsageStored = billingMode === 'HEAT' ? (preservedHeat > 0 ? preservedHeat : nextUsage) : nextUsage

    await prisma.meterReading.update({
      where: { id: nextReading.id },
      data: {
        startValue: nextStartValue,
        endValue: nextEndValue,
        heatUsage: nextHeatStored,
        usage: nextUsageStored,
        baseClean: 0,
        baseDirty: 0,
        cleanPerM3: 0,
        dirtyPerM3: 0,
        heatBase: 0,
        heatPerM3: 0,
        heatPerM2: 0,
        cleanAmount: 0,
        dirtyAmount: 0,
        heatAmount: 0,
        subtotal: 0,
        vat: 0,
        total: 0,
        updatedByUserId,
      },
    })

    carried = nextEndValue
  }
}
