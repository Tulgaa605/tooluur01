import type { TokenPayload } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { getScopedOrganizationIds } from '@/lib/org-scope'
import { ensureOfficeOrganizationId } from '@/lib/readings-office-org'
import {
  computeReadingMoney,
  effectiveBillingCategory,
  getHeatTariffRatesForPeriod,
  getWaterTariffRatesForPeriod,
  normalizeBillingMode,
} from '@/lib/meter-reading-calc'
import { getCategoryTariffOwnerOrgIdForCustomer } from '@/lib/category-tariff-scope'
import { ensureHeatCategoryTariffsInDb } from '@/lib/ensure-heat-category-tariffs'
import { recalculateReadingIdsForPeriod } from '@/lib/recalculate-readings-tariff'

/** Заалт оруулах modal-аас хадгалахтай ижил — дүнг «Бодолт» тооцоолно. */
const ZERO_MONEY = {
  baseClean: 0,
  baseDirty: 0,
  cleanPerM3: 0,
  dirtyPerM3: 0,
  cleanAmount: 0,
  dirtyAmount: 0,
  heatBase: 0,
  heatPerM3: 0,
  heatPerM2: 0,
  heatAmount: 0,
  subtotal: 0,
  vat: 0,
  total: 0,
} as const

export type HeatMeterSnapshot = {
  id: string
  organizationId: string
  billingMode: string
  defaultHeatUsage: number | null
  waterChargeSplit: string | null
  pipeDiameterMm: number | null
  billingCategory: string | null
}

/**
 * «Зөвхөн дулаан» тоолуур: тухайн (он, сар)-д заалт байхгүй бол defaultHeatUsage-аар мөр үүсгэнэ.
 * Мөнгөн дүн 0 — сарын заалтын үндсэн grid + «Бодолт» → төлбөр.
 */
export async function ensureHeatMeterReadingForPeriod(
  meter: HeatMeterSnapshot,
  userId: string,
  period: { year: number; month: number },
  opts?: { skipCategorySeed?: boolean }
): Promise<string | null> {
  const billingMode = normalizeBillingMode(meter.billingMode)
  if (billingMode !== 'HEAT') return null

  const heatUsage = Math.round(Number(meter.defaultHeatUsage ?? 0) * 100) / 100
  if (!Number.isFinite(heatUsage) || heatUsage <= 0) return null

  const year = Math.trunc(period.year)
  const month = Math.trunc(period.month)
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null

  const existing = await prisma.meterReading.findUnique({
    where: {
      meterId_month_year: {
        meterId: meter.id,
        month,
        year,
      },
    },
    select: { id: true },
  })
  if (existing) return null

  if (!opts?.skipCategorySeed) {
    const ownerOrgId = meter.organizationId
      ? await getCategoryTariffOwnerOrgIdForCustomer(meter.organizationId)
      : null
    if (ownerOrgId) await ensureHeatCategoryTariffsInDb(ownerOrgId)
  }

  const created = await prisma.meterReading.create({
    data: {
      meterId: meter.id,
      organizationId: meter.organizationId,
      month,
      year,
      startValue: 0,
      endValue: 0,
      heatUsage,
      usage: heatUsage,
      ...ZERO_MONEY,
      createdBy: userId,
      createdByUserId: userId,
      updatedByUserId: userId,
    },
    select: { id: true },
  })
  return created.id
}

/** Одоогийн календарийн сар */
export async function ensureHeatMeterReadingForCurrentPeriod(
  meter: HeatMeterSnapshot,
  userId: string
): Promise<boolean> {
  const now = new Date()
  const id = await ensureHeatMeterReadingForPeriod(meter, userId, {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  })
  return id != null
}

/** Тухайн оны 1–12 сард заалт байхгүй бол үүсгэнэ. */
export async function ensureHeatMeterReadingsForYear(
  meter: HeatMeterSnapshot,
  userId: string,
  year: number
): Promise<number> {
  const y = Math.trunc(year)
  if (y < 2000 || y > 2100) return 0
  const WAVE = 6
  let created = 0
  for (let start = 1; start <= 12; start += WAVE) {
    const months = Array.from({ length: Math.min(WAVE, 12 - start + 1) }, (_, i) => start + i)
    const results = await Promise.all(
      months.map((month) =>
        ensureHeatMeterReadingForPeriod(meter, userId, { year: y, month }, { skipCategorySeed: true })
      )
    )
    created += results.filter((id): id is string => typeof id === 'string' && id.length > 0).length
  }
  return created
}

/** Тухайн тоолуурын тухайн оны бүх заалтыг тарифаар дахин тооцно. */
export async function recalculateHeatMeterReadingsForYear(
  meterId: string,
  year: number
): Promise<void> {
  const readings = await prisma.meterReading.findMany({
    where: { meterId, year: Math.trunc(year) },
    select: { id: true, month: true },
  })
  if (readings.length === 0) return
  const byMonth = new Map<number, string[]>()
  for (const r of readings) {
    const list = byMonth.get(r.month) ?? []
    list.push(r.id)
    byMonth.set(r.month, list)
  }
  await Promise.all(
    [...byMonth.entries()].map(([month, ids]) =>
      recalculateReadingIdsForPeriod(ids, Math.trunc(year), month)
    )
  )
}

/**
 * «Зөвхөн дулаан» тоолуур бүртгэх/шинэчлэхэд тухайн оны 12 сарын заалт үүсгээд бодно.
 */
export async function provisionHeatMeterYear(
  meter: HeatMeterSnapshot,
  userId: string,
  year: number,
  officeOrgId?: string | null
): Promise<void> {
  if (officeOrgId) await ensureHeatCategoryTariffsInDb(officeOrgId)
  const currentYear = new Date().getFullYear()
  const years = new Set([Math.trunc(year), currentYear].filter((y) => y >= 2000 && y <= 2100))
  for (const y of years) {
    await ensureHeatMeterReadingsForYear(meter, userId, y)
    await recalculateHeatMeterReadingsForYear(meter.id, y)
  }
}

/**
 * Scope-д багтах бүх «зөвхөн дулаан» тоолуурт тухайн сарын заалт байгаа эсэхийг шалгаж,
 * байхгүй бол автоматаар үүсгэнэ (үндсэн grid-д шууд харагдана).
 */
export async function syncHeatMeterReadingsForPeriod(
  user: TokenPayload,
  year: number,
  month: number,
  opts?: { orgIds?: string[]; officeOrgId?: string | null }
): Promise<number> {
  const roleStr = String(user.role ?? '')
  let orgIds = opts?.orgIds
  if (!orgIds) {
    if (roleStr === Role.USER) {
      if (!user.organizationId) return 0
      orgIds = [user.organizationId]
    } else if (roleStr === Role.ACCOUNTANT || roleStr === Role.MANAGER) {
      const officeOrgId = await ensureOfficeOrganizationId(user)
      orgIds = await getScopedOrganizationIds({
        ...user,
        organizationId: officeOrgId ?? user.organizationId,
      })
    } else {
      return 0
    }
  }
  if (orgIds.length === 0) return 0

  const y = Math.trunc(year)
  const m = Math.trunc(month)
  if (y < 2000 || y > 2100 || m < 1 || m > 12) return 0

  const heatMeters = await prisma.meter.findMany({
    where: {
      billingMode: 'HEAT',
      serviceStatus: 'NORMAL',
      organizationId: { in: orgIds },
    },
    select: {
      id: true,
      organizationId: true,
      billingMode: true,
      defaultHeatUsage: true,
      waterChargeSplit: true,
      pipeDiameterMm: true,
      billingCategory: true,
    },
  })

  const candidates = heatMeters.filter((meter) => {
    const heat = Number(meter.defaultHeatUsage ?? 0)
    return Number.isFinite(heat) && heat > 0
  })
  if (candidates.length === 0) return 0

  const officeOrgId =
    opts?.officeOrgId !== undefined ? opts.officeOrgId : await ensureOfficeOrganizationId(user)
  if (officeOrgId) await ensureHeatCategoryTariffsInDb(officeOrgId)

  const candidateIds = candidates.map((c) => c.id)
  const existing = await prisma.meterReading.findMany({
    where: {
      meterId: { in: candidateIds },
      year: y,
      month: m,
    },
    select: { meterId: true },
  })
  const haveReading = new Set(existing.map((r) => r.meterId))
  const missing = candidates.filter((c) => !haveReading.has(c.id))
  if (missing.length === 0) return 0

  const createdReadingIds: string[] = []
  const WAVE = 32
  for (let i = 0; i < missing.length; i += WAVE) {
    const slice = missing.slice(i, i + WAVE)
    const rows = await Promise.all(
      slice.map((meter) => {
        const heatUsage = Math.round(Number(meter.defaultHeatUsage ?? 0) * 100) / 100
        return prisma.meterReading.create({
          data: {
            meterId: meter.id,
            organizationId: meter.organizationId,
            month: m,
            year: y,
            startValue: 0,
            endValue: 0,
            heatUsage,
            usage: heatUsage,
            ...ZERO_MONEY,
            createdBy: user.userId,
            createdByUserId: user.userId,
            updatedByUserId: user.userId,
          },
          select: { id: true },
        })
      })
    )
    for (const row of rows) createdReadingIds.push(row.id)
  }

  if (createdReadingIds.length > 0) {
    await recalculateReadingIdsForPeriod(createdReadingIds, y, m)
  }

  return createdReadingIds.length
}
