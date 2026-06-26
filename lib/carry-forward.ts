import { prisma } from '@/lib/prisma'

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

export type CarryReadingRow = {
  organizationId: string
  year: number
  month: number
  total: number
  paidAmount: number
}

export type OpeningBalanceRow = {
  organizationId: string
  year: number
  amount: number
}

/** Сар бүрийн гараар зассан өмнөх үлдэгдэл (billing period). */
export type PeriodCarryOverrideRow = {
  organizationId: string
  year: number
  month: number
  amount: number
}

/** Заалтгүй сард billing period дээр бүртгэсэн төлбөр. */
export type BillingPeriodPaidRow = {
  organizationId: string
  year: number
  month: number
  paidAmount: number
}

export type MultiOrgCarryOptions = {
  openings?: OpeningBalanceRow[]
  periodOverrides?: PeriodCarryOverrideRow[]
  billingPeriodPayments?: BillingPeriodPaidRow[]
}

export type MultiOrgCarryResult = {
  /** `${orgId}|${year}|${month}` → тухайн сарын заалтын өмнөх үлдэгдэл */
  byKey: Map<string, number>
  /** orgId → шүүлтийн (он, сар)-аас өмнөх үлдэгдэл */
  atFilter: Map<string, number>
  /** `${orgId}|${year}` → 4-р сарын хадгалсан өмнөх үлдэгдэл */
  openingByOrgYear: Map<string, number>
}

type ReadingEvent = {
  year: number
  month: number
  total: number
  paid: number
}

/**
 * Олон байгууллагын carry-forward тооцоолол.
 * `OrganizationOpeningBalance.amount` = 4-р сарын grid дээрх «Өмнөх үлдэгдэл» (сөрөг = илүү төлөлт).
 */
export function computeMultiOrgCarry(
  readings: CarryReadingRow[],
  filterYear: number | null,
  filterMonth: number | null,
  options: MultiOrgCarryOptions = {}
): MultiOrgCarryResult {
  const openings = options.openings ?? []
  const periodOverrides = options.periodOverrides ?? []
  const billingPeriodPayments = options.billingPeriodPayments ?? []
  const byKey = new Map<string, number>()
  const atFilter = new Map<string, number>()
  const openingByOrgYear = new Map<string, number>()

  const aprilOverrideByOrg = new Map<string, Map<number, number>>()
  for (const o of openings) {
    const amount = roundMoney(Number(o.amount) || 0)
    if (Math.abs(amount) < 0.005) continue
    const map = aprilOverrideByOrg.get(o.organizationId) ?? new Map<number, number>()
    map.set(o.year, amount)
    aprilOverrideByOrg.set(o.organizationId, map)
    openingByOrgYear.set(`${o.organizationId}|${o.year}`, amount)
  }

  const periodOverrideByKey = new Map<string, number>()
  for (const o of periodOverrides) {
    const amount = roundMoney(Number(o.amount) || 0)
    periodOverrideByKey.set(`${o.organizationId}|${o.year}|${o.month}`, amount)
  }

  const byOrg = new Map<string, ReadingEvent[]>()
  for (const r of readings) {
    const list = byOrg.get(r.organizationId) ?? []
    list.push({
      year: r.year,
      month: r.month,
      total: Number(r.total) || 0,
      paid: Number(r.paidAmount) || 0,
    })
    byOrg.set(r.organizationId, list)
  }

  // Заалтгүй сарын billing period төлбөр carry-д оруулна.
  for (const p of billingPeriodPayments) {
    const paid = roundMoney(Number(p.paidAmount) || 0)
    if (paid <= 0) continue
    const orgId = p.organizationId
    const list = byOrg.get(orgId) ?? []
    const hasReading = list.some((e) => e.year === p.year && e.month === p.month)
    if (hasReading) continue
    list.push({ year: p.year, month: p.month, total: 0, paid })
    byOrg.set(orgId, list)
  }

  for (const orgId of aprilOverrideByOrg.keys()) {
    if (!byOrg.has(orgId)) byOrg.set(orgId, [])
  }
  for (const o of periodOverrides) {
    if (!byOrg.has(o.organizationId)) byOrg.set(o.organizationId, [])
  }

  const filterSet = filterYear != null && filterMonth != null

  for (const [orgId, list] of byOrg) {
    const overrides = aprilOverrideByOrg.get(orgId) ?? new Map<number, number>()
    const events = [...list].sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year
      return a.month - b.month
    })

    let cumulative = 0
    let prevKey: string | null = null
    let carryBeforeFilter = 0
    let filterCaptured = false

    for (const ev of events) {
      if (
        filterSet &&
        !filterCaptured &&
        ev.year === filterYear &&
        ev.month === filterMonth
      ) {
        carryBeforeFilter = roundMoney(cumulative)
        filterCaptured = true
      }

      const k = `${ev.year}|${ev.month}`
      if (k !== prevKey) {
        const periodKey = `${orgId}|${k}`
        if (periodOverrideByKey.has(periodKey)) {
          cumulative = periodOverrideByKey.get(periodKey)!
        } else if (ev.month === 4 && overrides.has(ev.year)) {
          cumulative = overrides.get(ev.year)!
        }
        byKey.set(`${orgId}|${k}`, roundMoney(cumulative))
        prevKey = k
      }

      cumulative += ev.total - ev.paid
    }

    if (filterSet) {
      if (!filterCaptured) {
        carryBeforeFilter = roundMoney(cumulative)
      }
      // 4-р сар шүүсэн, заалтгүй ч хадгалсан өмнөх үлдэгдэлтэй.
      if (
        filterMonth === 4 &&
        overrides.has(filterYear as number) &&
        !events.some((e) => e.year === filterYear && e.month === 4)
      ) {
        carryBeforeFilter = overrides.get(filterYear as number)!
      }
      const filterPeriodKey = `${orgId}|${filterYear}|${filterMonth}`
      if (periodOverrideByKey.has(filterPeriodKey) && !filterCaptured) {
        carryBeforeFilter = periodOverrideByKey.get(filterPeriodKey)!
      }
      atFilter.set(orgId, carryBeforeFilter)
    }
  }

  return { byKey, atFilter, openingByOrgYear }
}

/**
 * Тухайн (он, сар)-ийн заалтын эхлэх үлдэгдэл (өмнөх үлдэгдэл).
 */
export async function computeOrgCarryBeforePeriod(
  organizationId: string,
  year: number,
  month: number
): Promise<number> {
  const [readings, openingRow] = await Promise.all([
    prisma.meterReading.findMany({
      where: { organizationId },
      select: { year: true, month: true, total: true, paidAmount: true },
    }),
    prisma.organizationOpeningBalance.findUnique({
      where: { organizationId_year: { organizationId, year } },
      select: { amount: true },
    }),
  ])

  const overrideAmount = roundMoney(Number(openingRow?.amount) || 0)

  const { byKey } = computeMultiOrgCarry(
    readings.map((r) => ({
      organizationId,
      year: r.year,
      month: r.month,
      total: Number(r.total) || 0,
      paidAmount: Number(r.paidAmount) || 0,
    })),
    null,
    null,
    {
      openings:
        Math.abs(overrideAmount) >= 0.005
          ? [{ organizationId, year, amount: overrideAmount }]
          : [],
    }
  )

  return byKey.get(`${organizationId}|${year}|${month}`) ?? 0
}

/** 4-р сарын grid-ээс ирсэн дүнг шууд хадгална (сөрөг = илүү төлөлт/хасалт). */
export function normalizeAprilCarrySaveAmount(amountRaw: number): number {
  if (!Number.isFinite(amountRaw)) return 0
  return roundMoney(amountRaw)
}
