import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { attachOrgsAndMetersToReadings } from '@/lib/attach-reading-relations'
import { getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import {
  applyWaterChargeSplitToWaterRates,
  computeReadingMoney,
  computeReadingMoneySplit,
  effectiveWaterChargeSplit,
  getHeatTariffRatesForPeriod,
  getWaterTariffRatesForPeriod,
  normalizeBillingMode,
  type BillingMode,
  type WaterTariffRates,
} from '@/lib/meter-reading-calc'
import { getScopedOrganizationIds } from '@/lib/org-scope'
import { ensureOfficeOrganizationId } from '@/lib/readings-office-org'
import { Role } from '@/lib/role'
import type { TokenPayload } from '@/lib/auth'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

/** BillingContent.tsx-тай ижил */
const PAY_EPS = 0.009

function roundMoneyLocal(n: number): number {
  return Math.round(n * 100) / 100
}

function effectivePaid(paidStored: unknown): number {
  return roundMoneyLocal(Number(paidStored ?? 0) || 0)
}

function remainingBalance(total: unknown, paidStored: unknown): number {
  const t = Number(total ?? 0) || 0
  return Math.max(0, roundMoneyLocal(t - effectivePaid(paidStored)))
}

function isPaidInFull(total: unknown, paidStored: unknown): boolean {
  return remainingBalance(total, paidStored) <= PAY_EPS
}

function collectCustomerPhones(org: {
  phone?: string | null
  users?: { phone: string | null }[]
}): string {
  const set = new Set<string>()
  const p = org?.phone?.trim()
  if (p) set.add(p)
  org?.users?.forEach((u) => {
    const up = u?.phone?.trim()
    if (up) set.add(up)
  })
  return Array.from(set).join(', ') || '—'
}

function paymentStatusLabel(total: number, paidStoredRaw: unknown): string {
  if (remainingBalance(total, paidStoredRaw) <= PAY_EPS) return 'Бүрэн төлөгдсөн'
  if (effectivePaid(paidStoredRaw) > PAY_EPS) return 'Хэсэгчлэн төлөгдсөн'
  return 'Хүлээгдэж буй'
}

function waterUsageFromReading(r: { startValue?: unknown; endValue?: unknown; usage?: unknown }): number {
  const s = Number(r.startValue ?? 0)
  const e = Number(r.endValue ?? 0)
  const diff = e > s ? e - s : 0
  if (diff > 0) return diff
  const u = Number(r.usage ?? 0)
  return Number.isFinite(u) && u >= 0 ? u : 0
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

function ulaanbaatarYearMonth(ref: Date = new Date()): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ulaanbaatar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ref)
  const y = Number(parts.find((p) => p.type === 'year')?.value)
  const m = Number(parts.find((p) => p.type === 'month')?.value)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  }
  return { year: y, month: m }
}

function tokensMatch(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}

type ScopeResult =
  | { orgIds: string[]; auth: 'jwt'; user: TokenPayload }
  | { orgIds: string[]; auth: 'export_token' }

async function resolveOrganizationScope(request: NextRequest): Promise<ScopeResult | NextResponse> {
  const user = getAuthUser(request)
  const role = String(user?.role ?? '')
  if (user && (role === Role.ACCOUNTANT || role === Role.MANAGER)) {
    const officeOrgId = await ensureOfficeOrganizationId(user)
    const scoped = await getScopedOrganizationIds({
      ...user,
      organizationId: officeOrgId ?? user.organizationId,
    })
    if (scoped.length === 0) {
      return NextResponse.json({ error: 'Харах хамрах хүрээ хоосон' }, { status: 403 })
    }
    return { orgIds: scoped, auth: 'jwt', user }
  }

  const { searchParams } = new URL(request.url)
  const qToken = searchParams.get('token')?.trim() ?? ''
  const envToken = (process.env.PAYMENT_LIST_EXPORT_TOKEN ?? '').trim()
  const officeId = (process.env.PAYMENT_LIST_EXPORT_OFFICE_ORG_ID ?? '').trim()

  if (!envToken) {
    return NextResponse.json(
      {
        error: 'Гадаад хандагчийн API идэвхгүй. PAYMENT_LIST_EXPORT_TOKEN тохируулна уу.',
      },
      { status: 503 }
    )
  }
  if (!tokensMatch(qToken, envToken)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!/^[a-f\d]{24}$/i.test(officeId)) {
    return NextResponse.json(
      {
        error:
          'Сервер тохиргоо дутуу: PAYMENT_LIST_EXPORT_OFFICE_ORG_ID (24 тэмдэгтийн ObjectId) заавал.',
      },
      { status: 503 }
    )
  }

  const synthetic: TokenPayload = {
    userId: '000000000000000000000000',
    email: 'export@local',
    role: Role.MANAGER,
    organizationId: officeId,
  }
  const scoped = await getScopedOrganizationIds(synthetic)
  if (scoped.length === 0) {
    return NextResponse.json({ error: 'Export scope хоосон' }, { status: 403 })
  }
  return { orgIds: scoped, auth: 'export_token' }
}

function isObjectId24(s: string): boolean {
  return /^[a-f\d]{24}$/i.test(s)
}

/**
 * `/api/readings` GET-тэй ижил хамрах хүрээ: нягтлан/захиралд
 * `organizationId in scope` **эсвэл** өөрийн `createdByUserId`-тай заалт орно.
 * (Зөвхөн scope-оор шүүвэл албанаас гадуурх өөрийн бүртгэл алдагдана.)
 */
function buildMeterReadingWhere(
  scope: ScopeResult,
  year: number,
  month: number,
  createdByUserId?: string
): Prisma.MeterReadingWhereInput {
  const scopeOr: Prisma.MeterReadingWhereInput[] =
    scope.auth === 'jwt'
      ? [
          { organizationId: { in: scope.orgIds } },
          { createdByUserId: scope.user.userId },
        ]
      : [{ organizationId: { in: scope.orgIds } }]

  const base: Prisma.MeterReadingWhereInput = {
    year,
    month,
    OR: scopeOr,
  }

  if (!createdByUserId) {
    return base
  }

  return {
    AND: [
      base,
      {
        OR: [{ createdByUserId: createdByUserId }, { createdBy: createdByUserId }],
      },
    ],
  }
}

/**
 * Төлбөрийн жагсаалт (заалтууд) — тухайн сарын дүнг тарифаар дахин тооцоолно.
 *
 * - Нягтлан / захирал: ижил JWT (`Authorization: Bearer …` эсвэл cookie) ашиглана.
 * - Гадаад хүн: `.env` дээр `PAYMENT_LIST_EXPORT_TOKEN`, `PAYMENT_LIST_EXPORT_OFFICE_ORG_ID`
 *   тохируулсны дараа `?token=…` дамжуулна. `year`/`month` байхгүй бол Улаанбаатарын өнөөдрийн сар/он.
 *
 * Query:
 * - `tab=all|unpaid|paid` — төлбөрийн хуудсын табтай ижил шүүлт (анхдагч `all`).
 * - `format=full|billing|summary` — `summary` зөвхөн: он, сар, хэрэглээ, нийт дүн, төлсөн дүн, тоолуурын дугаар.
 *   `billing` — төлбөрийн хуудсын үндсэн талбарууд. Анхдагч `full`.
 * - `createdByUserId=<ObjectId>` — зөвхөн тэр хэрэглэгчийн бүртгэсэн заалт (`createdByUserId` эсвэл `createdBy`).
 *   Нягтлан (`ACCOUNTANT`) зөвхөн өөрийн ID дамжуулж болно; захирал (`MANAGER`) бүх нягтлангийн ID.
 */
export async function GET(request: NextRequest) {
  try {
    const scope = await resolveOrganizationScope(request)
    if (scope instanceof NextResponse) return scope

    const { searchParams } = new URL(request.url)
    const yearRaw = searchParams.get('year')?.trim()
    const monthRaw = searchParams.get('month')?.trim()

    let year: number
    let month: number
    if (yearRaw && monthRaw) {
      year = parseInt(yearRaw, 10)
      month = parseInt(monthRaw, 10)
      if (!Number.isFinite(year) || year < 2000 || year > 2100) {
        return NextResponse.json({ error: 'Он зөв биш' }, { status: 400 })
      }
      if (!Number.isFinite(month) || month < 1 || month > 12) {
        return NextResponse.json({ error: 'Сар зөв биш' }, { status: 400 })
      }
    } else {
      ;({ year, month } = ulaanbaatarYearMonth())
    }

    const tabRaw = (searchParams.get('tab') ?? 'all').trim().toLowerCase()
    const tab: 'all' | 'unpaid' | 'paid' =
      tabRaw === 'unpaid' || tabRaw === 'paid' || tabRaw === 'all' ? tabRaw : 'all'

    const formatRaw = (searchParams.get('format') ?? 'full').trim().toLowerCase()
    const format: 'full' | 'billing' | 'summary' =
      formatRaw === 'billing' ? 'billing' : formatRaw === 'summary' ? 'summary' : 'full'

    const byAccountantRaw = searchParams.get('createdByUserId')?.trim() ?? ''
    let createdByUserId: string | undefined
    if (byAccountantRaw) {
      if (!isObjectId24(byAccountantRaw)) {
        return NextResponse.json(
          { error: 'createdByUserId нь 24 тэмдэгтийн Mongo ObjectId байх ёстой' },
          { status: 400 }
        )
      }
      if (scope.auth === 'jwt' && String(scope.user.role) === Role.ACCOUNTANT) {
        if (byAccountantRaw !== scope.user.userId) {
          return NextResponse.json(
            { error: 'Нягтлан зөвхөн өөрийн createdByUserId-аар шүүж болно' },
            { status: 403 }
          )
        }
      }
      createdByUserId = byAccountantRaw
    }

    const rawReadings = await prisma.meterReading.findMany({
      where: buildMeterReadingWhere(scope, year, month, createdByUserId),
      orderBy: [{ organizationId: 'asc' }, { meterId: 'asc' }],
    })
    const readings = await attachOrgsAndMetersToReadings(rawReadings)

    const rawWaterCache = new Map<string, Awaited<ReturnType<typeof getWaterTariffRatesForPeriod>>>()
    const heatOnlyCache = new Map<string, Awaited<ReturnType<typeof getHeatTariffRatesForPeriod>>>()

    const items = await Promise.all(
      readings.map(async (r) => {
        const m = (r as { meter?: { pipeDiameterMm?: number | null } }).meter
        const pipeMm =
          m?.pipeDiameterMm != null &&
          Number.isFinite(Number(m.pipeDiameterMm)) &&
          Number(m.pipeDiameterMm) > 0
            ? Math.trunc(Number(m.pipeDiameterMm))
            : null
        const cacheKey = `${r.organizationId}-${r.year}-${r.month}-${pipeMm ?? 'org'}`
        let rawWater = rawWaterCache.get(cacheKey)
        if (!rawWater) {
          rawWater = await getWaterTariffRatesForPeriod(r.organizationId, r.year, r.month, {
            pipeDiameterMm: pipeMm,
          })
          rawWaterCache.set(cacheKey, rawWater)
        }
        let heat = heatOnlyCache.get(cacheKey)
        if (!heat) {
          heat = await getHeatTariffRatesForPeriod(r.organizationId, r.year, r.month)
          heatOnlyCache.set(cacheKey, heat)
        }
        const orgCategory = (r as any).organization?.category ?? 'HOUSEHOLD'
        const billingMode = normalizeBillingMode((r as any).meter?.billingMode)
        const water = waterTariffAdjustedForMeter(
          rawWater,
          billingMode,
          (r as any).meter?.waterChargeSplit
        )
        const waterUsage = waterUsageFromReading(r)
        const heatUsage = Number((r as any).heatUsage ?? 0) || 0
        const usage = billingMode === 'HEAT' ? heatUsage : waterUsage
        const money =
          billingMode === 'WATER_HEAT'
            ? computeReadingMoneySplit(waterUsage, heatUsage, orgCategory, billingMode, water, heat)
            : computeReadingMoney(usage, orgCategory, billingMode, water, heat)
        return {
          ...r,
          baseClean: money.baseClean,
          baseDirty: money.baseDirty,
          cleanPerM3: money.cleanPerM3,
          dirtyPerM3: money.dirtyPerM3,
          heatBase: money.heatBase,
          heatPerM3: money.heatPerM3,
          heatPerM2: money.heatPerM2,
          cleanAmount: money.cleanAmount,
          dirtyAmount: money.dirtyAmount,
          heatAmount: money.heatAmount,
          subtotal: money.subtotal,
          vat: money.vat,
          total: money.total,
        }
      })
    )

    let rows = [...items].sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year
      if (a.month !== b.month) return b.month - a.month
      const na = String((a as { organization?: { name?: string } }).organization?.name ?? '')
      const nb = String((b as { organization?: { name?: string } }).organization?.name ?? '')
      const orgCmp = na.localeCompare(nb)
      if (orgCmp !== 0) return orgCmp
      const ma = String((a as { meter?: { meterNumber?: string } }).meter?.meterNumber ?? '')
      const mb = String((b as { meter?: { meterNumber?: string } }).meter?.meterNumber ?? '')
      return ma.localeCompare(mb)
    })

    const tabCounts = {
      all: rows.length,
      unpaid: rows.filter((r) => !isPaidInFull(r.total, r.paidAmount)).length,
      paid: rows.filter((r) => isPaidInFull(r.total, r.paidAmount)).length,
    }

    if (tab === 'unpaid') {
      rows = rows.filter((r) => !isPaidInFull(r.total, r.paidAmount))
    } else if (tab === 'paid') {
      rows = rows.filter((r) => isPaidInFull(r.total, r.paidAmount))
    }

    const footerTotals = rows.reduce(
      (acc, r) => {
        acc.usage += Number(r.usage ?? 0) || 0
        acc.total += Number(r.total ?? 0) || 0
        acc.paid += effectivePaid(r.paidAmount)
        acc.remaining += remainingBalance(r.total, r.paidAmount)
        return acc
      },
      { usage: 0, total: 0, paid: 0, remaining: 0 }
    )

    const payloadItems =
      format === 'summary'
        ? rows.map((r) => ({
            year: r.year,
            month: r.month,
            usage: Number(r.usage ?? 0) || 0,
            total: Number(r.total ?? 0) || 0,
            paidAmount: effectivePaid(r.paidAmount),
            meterNumber: String((r as { meter?: { meterNumber?: string } }).meter?.meterNumber ?? ''),
          }))
        : format === 'billing'
          ? rows.map((r) => {
              const org = (
                r as {
                  organization?: {
                    name?: string
                    code?: string | null
                    phone?: string | null
                    users?: { phone: string | null }[]
                  }
                }
              ).organization
              const total = Number(r.total ?? 0) || 0
              const paid = effectivePaid(r.paidAmount)
              return {
                id: r.id,
                year: r.year,
                month: r.month,
                organizationId: r.organizationId,
                organizationName: org?.name ?? '-',
                organizationCode: org?.code ?? null,
                customerPhones: org ? collectCustomerPhones(org) : '—',
                meterNumber: String((r as { meter?: { meterNumber?: string } }).meter?.meterNumber ?? '-'),
                usage: Number(r.usage ?? 0) || 0,
                total,
                paidAmount: paid,
                remaining: remainingBalance(r.total, r.paidAmount),
                paymentStatus: paymentStatusLabel(total, r.paidAmount),
                paymentReference:
                  r.paymentReference != null && String(r.paymentReference).trim() !== ''
                    ? String(r.paymentReference).trim()
                    : null,
                approved: !!(r as { approved?: boolean }).approved,
                ebarimtStatus: (r as { ebarimtStatus?: string | null }).ebarimtStatus ?? 'PENDING',
                ebarimtBillId: (r as { ebarimtBillId?: string | null }).ebarimtBillId ?? null,
              }
            })
          : rows

    const { origin } = new URL(request.url)
    const path = '/api/exports/payment-list'
    const urlExample =
      scope.auth === 'export_token'
        ? `${origin}${path}?token=…&year=${year}&month=${month}&format=billing&tab=unpaid`
        : `${origin}${path}?year=${year}&month=${month}&format=billing&tab=unpaid`

    return NextResponse.json({
      meta:
        format === 'summary'
          ? {
              year,
              month,
              format: 'summary' as const,
              tab,
              rowCount: payloadItems.length,
              tabCounts,
              ...(createdByUserId ? { createdByUserId } : {}),
            }
          : {
              timezone: 'Asia/Ulaanbaatar',
              year,
              month,
              tab,
              format,
              ...(createdByUserId ? { createdByUserId } : {}),
              tabCounts,
              footerTotals,
              generatedAt: new Date().toISOString(),
              auth: scope.auth,
              hint:
                'Зөвхөн он/сар/хэрэглээ/нийт/төлсөн/тоолуур: ?format=summary. Төлбөрийн хуудас: ?format=billing&tab=unpaid. Нягтлан: &createdByUserId=',
              urlExample,
            },

      items: payloadItems,
    })
  } catch (e: any) {
    console.error('payment-list export:', e)
    return NextResponse.json({ error: e?.message || 'Алдаа гарлаа' }, { status: 500 })
  }
}
