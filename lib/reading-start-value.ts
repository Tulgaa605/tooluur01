import { prisma } from '@/lib/prisma'

/** Mongo/Prisma тоог энгийн number болгоно. */
export function toPlainReadingNumber(v: unknown): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'bigint') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.$numberDecimal === 'string') return toPlainReadingNumber(o.$numberDecimal)
    if (typeof o.$numberDouble === 'string') return toPlainReadingNumber(o.$numberDouble)
    if (typeof o.$numberInt === 'string') return toPlainReadingNumber(o.$numberInt)
    if (typeof o.$numberLong === 'string') return toPlainReadingNumber(o.$numberLong)
    if (typeof o.toNumber === 'function') {
      try {
        const n = (o as { toNumber: () => number }).toNumber()
        return Number.isFinite(n) ? n : 0
      } catch {
        /* ignore */
      }
    }
    if (typeof o.low === 'number' && Number.isFinite(o.low)) return o.low
  }
  const n = parseFloat(String(v).replace(',', '.').trim())
  return Number.isFinite(n) ? n : 0
}

function periodKey(year: number, month: number): number {
  return year * 100 + month
}

function previousCalendarMonth(year: number, month: number): { year: number; month: number } {
  if (month <= 1) return { year: year - 1, month: 12 }
  return { year, month: month - 1 }
}

/**
 * Эхний заалт 0 байвал өмнөх сарын (4-р сар бол 3-р сар) эцсийн заалтыг тавина.
 * Өмнөх сар олдохгүй бол түүнээс өмнөх хамгийн сүүлийн эцсийн заалт.
 */
export async function fillZeroStartFromPreviousEnd<
  T extends {
    id?: string
    meterId?: string | null
    year: number
    month: number
    startValue?: unknown
    endValue?: unknown
  },
>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows

  const normalized = rows.map((r) => ({
    ...r,
    startValue: toPlainReadingNumber(r.startValue),
    endValue: toPlainReadingNumber(r.endValue),
  }))

  const needFill = normalized.filter(
    (r) =>
      Math.abs(Number(r.startValue) || 0) < 1e-9 &&
      typeof r.meterId === 'string' &&
      /^[a-f\d]{24}$/i.test(r.meterId)
  )
  if (needFill.length === 0) return normalized

  const meterIds = [...new Set(needFill.map((r) => String(r.meterId)))]
  const prevPeriods = new Map<string, { year: number; month: number }>()
  for (const r of needFill) {
    const p = previousCalendarMonth(r.year, r.month)
    prevPeriods.set(`${p.year}|${p.month}`, p)
  }

  const [directPrev, allPrev] = await Promise.all([
    prisma.meterReading.findMany({
      where: {
        meterId: { in: meterIds },
        OR: [...prevPeriods.values()].map((p) => ({ year: p.year, month: p.month })),
      },
      select: { meterId: true, year: true, month: true, endValue: true },
    }),
    prisma.meterReading.findMany({
      where: { meterId: { in: meterIds } },
      select: { meterId: true, year: true, month: true, endValue: true },
    }),
  ])

  const exactPrev = new Map<string, number>()
  for (const p of directPrev) {
    const end = toPlainReadingNumber(p.endValue)
    exactPrev.set(`${p.meterId}|${p.year}|${p.month}`, end)
  }

  const history = new Map<string, { year: number; month: number; endValue: number }[]>()
  for (const p of allPrev) {
    const list = history.get(p.meterId) ?? []
    list.push({
      year: p.year,
      month: p.month,
      endValue: toPlainReadingNumber(p.endValue),
    })
    history.set(p.meterId, list)
  }

  const persist: { id: string; startValue: number }[] = []

  const filled = normalized.map((r) => {
    if (Math.abs(Number(r.startValue) || 0) >= 1e-9) return r
    const meterId = String(r.meterId ?? '')
    const cal = previousCalendarMonth(r.year, r.month)
    let start = exactPrev.get(`${meterId}|${cal.year}|${cal.month}`) ?? 0

    if (!(start > 0)) {
      const list = history.get(meterId) ?? []
      const key = periodKey(r.year, r.month)
      const prev = list
        .filter((p) => periodKey(p.year, p.month) < key && p.endValue > 0)
        .sort((a, b) => periodKey(b.year, b.month) - periodKey(a.year, a.month))[0]
      start = prev?.endValue ?? 0
    }

    if (!(start > 0)) return r
    const next = { ...r, startValue: start }
    if (r.id && /^[a-f\d]{24}$/i.test(String(r.id))) {
      persist.push({ id: String(r.id), startValue: start })
    }
    return next
  })

  if (persist.length > 0) {
    await Promise.all(
      persist.map((p) =>
        prisma.meterReading.update({
          where: { id: p.id },
          data: { startValue: p.startValue },
        })
      )
    )
  }

  return filled
}
