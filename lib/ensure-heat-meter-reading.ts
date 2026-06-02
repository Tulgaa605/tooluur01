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
): Promise<boolean> {
  const billingMode = normalizeBillingMode(meter.billingMode)
  if (billingMode !== 'HEAT') return false

  const heatUsage = Math.round(Number(meter.defaultHeatUsage ?? 0) * 100) / 100
  if (!Number.isFinite(heatUsage) || heatUsage <= 0) return false

  const year = Math.trunc(period.year)
  const month = Math.trunc(period.month)
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return false

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
  if (existing) return false

  if (!opts?.skipCategorySeed) {
    const ownerOrgId = meter.organizationId
      ? await getCategoryTariffOwnerOrgIdForCustomer(meter.organizationId)
      : null
    if (ownerOrgId) await ensureHeatCategoryTariffsInDb(ownerOrgId)
  }

  await prisma.meterReading.create({
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
  })
  return true
}

/** Одоогийн календарийн сар */
export async function ensureHeatMeterReadingForCurrentPeriod(
  meter: HeatMeterSnapshot,
  userId: string
): Promise<boolean> {
  const now = new Date()
  return ensureHeatMeterReadingForPeriod(meter, userId, {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  })
}

/**
 * Scope-д багтах бүх «зөвхөн дулаан» тоолуурт тухайн сарын заалт байгаа эсэхийг шалгаж,
 * байхгүй бол автоматаар үүсгэнэ (үндсэн grid-д шууд харагдана).
 */
export async function syncHeatMeterReadingsForPeriod(
  user: TokenPayload,
  year: number,
  month: number
): Promise<number> {
  const roleStr = String(user.role ?? '')
  let orgIds: string[] = []
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
  if (orgIds.length === 0) return 0

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

  const officeOrgId = await ensureOfficeOrganizationId(user)
  if (officeOrgId) await ensureHeatCategoryTariffsInDb(officeOrgId)

  const candidates = heatMeters.filter((m) => {
    const heat = Number(m.defaultHeatUsage ?? 0)
    return Number.isFinite(heat) && heat > 0
  })

  let created = 0
  const WAVE = 24
  for (let i = 0; i < candidates.length; i += WAVE) {
    const slice = candidates.slice(i, i + WAVE)
    const results = await Promise.all(
      slice.map((m) =>
        ensureHeatMeterReadingForPeriod(
          {
            id: m.id,
            organizationId: m.organizationId,
            billingMode: m.billingMode,
            defaultHeatUsage: m.defaultHeatUsage,
            waterChargeSplit: m.waterChargeSplit,
            pipeDiameterMm: m.pipeDiameterMm,
            billingCategory: m.billingCategory,
          },
          user.userId,
          { year, month },
          { skipCategorySeed: true }
        )
      )
    )
    created += results.filter(Boolean).length
  }
  return created
}
