import { NextRequest, NextResponse, after } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { computeMultiOrgCarry } from '@/lib/carry-forward'
import { attachBillingPeriodsToRows, billingPeriodDbSetupHint, scheduleBillingPeriodSnapshots } from '@/lib/billing-period'
import { buildBillingPeriodSnapshot } from '@/lib/billing-snapshot'
import { METER_READING_LIST_SELECT } from '@/lib/meter-reading-list-select'
import { getScopedOrganizationIds, organizationIdInScope } from '@/lib/org-scope'
import {
  type BillingMode,
  applyWaterChargeSplitToWaterRates,
  computeReadingMoney,
  computeReadingMoneySplit,
  effectiveBillingCategory,
  effectiveWaterChargeSplit,
  getHeatTariffRatesForPeriod,
  getWaterTariffRatesForPeriod,
  normalizeBillingMode,
  type WaterTariffRates,
} from '@/lib/meter-reading-calc'

function parseClientHeatUsage(
  data: { heatUsage?: unknown },
  billingMode: BillingMode
): number | undefined {
  const includeHeat = billingMode === 'HEAT' || billingMode === 'WATER_HEAT'
  if (!includeHeat) return undefined
  if (!('heatUsage' in data)) return undefined
  const raw = (data as any).heatUsage
  if (raw === undefined || raw === null || raw === '') return undefined
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.').trim())
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.round(n * 100) / 100
}
import { attachOrgsAndMetersToReadings } from '@/lib/attach-reading-relations'
import { propagateLaterReadingsAfterEndChange } from '@/lib/reading-propagate'
import { ensureOfficeOrganizationId } from '@/lib/readings-office-org'
import {
  attachAdditionalFeesToReadings,
  persistReadingMoneyFields,
  recalculateAndPersistOrgPeriodAdditionalFees,
} from '@/lib/readings-with-additional-fees'
import { syncHeatMeterReadingsForPeriod } from '@/lib/ensure-heat-meter-reading'
import {
  finalizeReadingMoneyForHeatRules,
} from '@/lib/heat-billing-season'
import { TariffPeriodCache } from '@/lib/tariff-period-cache'
import {
  readingNeedsMoneyRecalc,
  recalculateReadingIdsForPeriod,
  recalculateReadingRowMoney,
  type ReadingForTariffRecalc,
  waterUsageFromReading,
} from '@/lib/recalculate-readings-tariff'

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

function endReadingChanged(before: unknown, after: unknown): boolean {
  const a = Number(before)
  const b = Number(after)
  if (!Number.isFinite(a) && !Number.isFinite(b)) return String(before) !== String(after)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true
  return Math.abs(a - b) > 1e-6
}

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const officeOrgId = await ensureOfficeOrganizationId(user)
    const data = await request.json()

    // Get meter to find organization
    const meter = await prisma.meter.findUnique({
      where: { id: data.meterId },
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

    if (!meter) {
      return NextResponse.json({ error: 'Тоолуур олдсонгүй' }, { status: 404 })
    }

    // Нягтлан: зөвхөн өөрийн алба + өөрийн бүртгэсэн харилцагч (managedByOrganizationId)-ын дээр заалт оруулна.
    const office = officeOrgId ?? user.organizationId
    if (!office) {
      return NextResponse.json({ error: 'Энэ байгууллагын заалт оруулах эрхгүй' }, { status: 403 })
    }
    if (meter.organizationId !== office) {
      const org = await prisma.organization.findUnique({
        where: { id: meter.organizationId },
        select: { id: true, managedByOrganizationId: true },
      })
      if (!org) {
        return NextResponse.json({ error: 'Энэ байгууллагын заалт оруулах эрхгүй' }, { status: 403 })
      }
      if (org.managedByOrganizationId == null) {
        // Эзэнгүй байгууллагыг тухайн алба анх удаа заалт оруулах үед claim хийнэ.
        await prisma.organization.update({
          where: { id: org.id },
          data: { managedByOrganizationId: office },
        })
      } else if (org.managedByOrganizationId !== office) {
        return NextResponse.json({ error: 'Энэ байгууллагын заалт оруулах эрхгүй' }, { status: 403 })
      }
    }

    const billingMode = normalizeBillingMode(meter.billingMode)
    const waterUsage = data.endValue - data.startValue
    // Дулааны хэрэглээ:
    // - Клиентээс heatUsage ирвэл түүнийг ашиглана
    // - Ирэхгүй бол тоолуурын defaultHeatUsage (м³/м²)-ийг ашиглана
    // - WATER_HEAT дээр аль аль нь байхгүй бол усны зөрүүг fallback болгоно
    const meterDefaultHeat =
      Number.isFinite(Number((meter as any).defaultHeatUsage)) && Number((meter as any).defaultHeatUsage) > 0
        ? Math.round(Number((meter as any).defaultHeatUsage) * 100) / 100
        : 0
    const clientHeat = parseClientHeatUsage(data, billingMode)
    const heatUsage =
      billingMode === 'WATER_HEAT'
        ? (clientHeat ?? (meterDefaultHeat > 0 ? meterDefaultHeat : waterUsage > 0 ? waterUsage : 0))
        : (clientHeat ?? (meterDefaultHeat > 0 ? meterDefaultHeat : 0))
    const usage = billingMode === 'HEAT' ? heatUsage : waterUsage
    if (waterUsage < 0) {
      return NextResponse.json(
        { error: 'Эцсийн заалт эхний заалтаас их байх ёстой' },
        { status: 400 }
      )
    }

    const orgForCategory = await prisma.organization.findUnique({
      where: { id: meter.organizationId },
      select: { category: true },
    })
    const orgCategory = effectiveBillingCategory(meter.billingCategory, orgForCategory?.category)

    const pipeMm =
      meter.pipeDiameterMm != null &&
      Number.isFinite(Number(meter.pipeDiameterMm)) &&
      Number(meter.pipeDiameterMm) > 0
        ? Math.trunc(Number(meter.pipeDiameterMm))
        : null
    const [waterTariffRaw, heatTariff] = await Promise.all([
      getWaterTariffRatesForPeriod(meter.organizationId, data.year, data.month, {
        pipeDiameterMm: pipeMm,
        billingCategory: meter.billingCategory,
      }),
      getHeatTariffRatesForPeriod(meter.organizationId, data.year, data.month, {
        billingCategory: meter.billingCategory,
      }),
    ])
    const waterTariff = waterTariffAdjustedForMeter(waterTariffRaw, billingMode, meter.waterChargeSplit)
    const rawMoney =
      billingMode === 'WATER_HEAT'
        ? computeReadingMoneySplit(waterUsage, heatUsage, orgCategory, billingMode, waterTariff, heatTariff)
        : computeReadingMoney(usage, orgCategory, billingMode, waterTariff, heatTariff)
    const finalMoney = finalizeReadingMoneyForHeatRules(billingMode, data.month, null, rawMoney)
    const {
      baseClean,
      baseDirty,
      cleanPerM3,
      dirtyPerM3,
      heatBase,
      heatPerM3,
      heatPerM2,
      cleanAmount,
      dirtyAmount,
      heatAmount,
      subtotal,
      vat,
      total,
    } = finalMoney

    // Check if reading already exists
    const existing = await prisma.meterReading.findUnique({
      where: {
        meterId_month_year: {
          meterId: data.meterId,
          month: data.month,
          year: data.year,
        },
      },
    })

    if (existing) {
      // Давхар оруулах үед error өгөхийн оронд тухайн сарын заалтыг шинэчилнэ.
      // (UI талд «хадгалах» дарахад идемпотент байж, хэрэглэгч алдаа харахгүй.)
      const updated = await prisma.meterReading.update({
        where: { id: existing.id },
        data: {
          startValue: data.startValue,
          endValue: data.endValue,
          heatUsage,
          usage,
          baseClean,
          baseDirty,
          cleanPerM3,
          dirtyPerM3,
          cleanAmount,
          dirtyAmount,
          heatBase,
          heatPerM3,
          heatPerM2,
          heatAmount,
          subtotal,
          vat,
          total,
          updatedByUserId: user.userId,
        },
      })
      const endChanged = endReadingChanged(existing.endValue, data.endValue)
      if (endChanged) {
        await propagateLaterReadingsAfterEndChange({
          meterId: data.meterId,
          billingMode,
          waterChargeSplit: meter.waterChargeSplit,
          afterYear: Number(data.year),
          afterMonth: Number(data.month),
          carriedEnd: Number(data.endValue) || 0,
          updatedByUserId: user.userId,
        })
      }
      const [withRel] = await attachOrgsAndMetersToReadings([updated])
      return NextResponse.json({ ...withRel, _updatedExisting: true })
    }

    const reading = await prisma.meterReading.create({
      data: {
        meterId: data.meterId,
        organizationId: meter.organizationId,
        month: data.month,
        year: data.year,
        startValue: data.startValue,
        endValue: data.endValue,
        heatUsage,
        usage,
        baseClean,
        baseDirty,
        cleanPerM3,
        dirtyPerM3,
        cleanAmount,
        dirtyAmount,
        heatBase,
        heatPerM3,
        heatPerM2,
        heatAmount,
        subtotal,
        vat,
        total,
        createdBy: user.userId,
        createdByUserId: user.userId,
      },
    })

    // Шинэ сар анх хадгалагдсан ч дараагийн (жишээ нь 4-р) сарын эхний заалтыг дагуулна.
    await propagateLaterReadingsAfterEndChange({
      meterId: data.meterId,
      billingMode,
      waterChargeSplit: meter.waterChargeSplit,
      afterYear: Number(data.year),
      afterMonth: Number(data.month),
      carriedEnd: Number(data.endValue) || 0,
      updatedByUserId: user.userId,
    })

    return NextResponse.json(reading)
  } catch (error: any) {
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const authedUser = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER, Role.USER])
    if (!authedUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const user = authedUser
    const { searchParams } = new URL(request.url)

    // USER: өөрийн байгууллага. Нягтлан/захирал: өөрийн алба + бүртгэсэн харилцагч (аль алины заалт харагдана).
    let where: any = {}
    const roleStr = String(user.role)
    let scopedOrgIds: string[] = []
    let officeOrgIdForScope: string | null = null
    if (roleStr === Role.USER) {
      if (!user.organizationId) return NextResponse.json([])
      where.organizationId = user.organizationId
      scopedOrgIds = [user.organizationId]
    } else if (roleStr === Role.ACCOUNTANT || roleStr === Role.MANAGER) {
      // Зарим staff token дээр organizationId хоосон байж болно → GET дээр ч автоматаар сэргээнэ.
      officeOrgIdForScope = await ensureOfficeOrganizationId(user)
      scopedOrgIds = await getScopedOrganizationIds({
        ...user,
        organizationId: officeOrgIdForScope ?? user.organizationId,
      })
      if (scopedOrgIds.length === 0) return NextResponse.json([])
      // Scope-д таарах байгууллагуудын заалт + өмнө нь энэ хэрэглэгч өөрөө нэмсэн заалтуудыг алдахгүй.
      where.OR = [
        { organizationId: { in: scopedOrgIds } },
        { createdByUserId: user.userId },
      ]
    }

    const month = searchParams.get('month')
    if (month) {
      where.month = parseInt(month)
    }

    const year = searchParams.get('year')
    if (year) {
      where.year = parseInt(year)
    }
    
    const organizationId = searchParams.get('organizationId')
    if (organizationId) {
      // USER үед where.organizationId нь аль хэдийн string байна; энэ тохиолдолд зөвхөн өөрийнхөө ID таарсан үед үр дүнтэй.
      if (typeof where.organizationId === 'string') {
        if (where.organizationId !== organizationId) return NextResponse.json([])
      } else {
        where.organizationId = organizationId
      }
    }

    const limitParam = Number(searchParams.get('limit') || 0)
    const take = Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.trunc(limitParam), 5000)
      : undefined

    const shouldRecalculate = searchParams.get('recalculate') === '1'
    const withCarry = searchParams.get('withCarry') === '1'
    const isBillingPage = searchParams.get('billing') === '1'
    const filterYearNum = year ? parseInt(year, 10) : null
    const filterMonthNum = month ? parseInt(month, 10) : null

    // «Зөвхөн дулаан» тоолуур: modal-аар оруулахгүйгээр үндсэн grid-д гарахын тулд заалт автоматаар үүсгэнэ.
    if (
      searchParams.get('ensureHeatReadings') === '1' &&
      searchParams.get('skipHeatSync') !== '1'
    ) {
      const syncYear = year ? parseInt(year, 10) : new Date().getFullYear()
      const syncMonth = month ? parseInt(month, 10) : new Date().getMonth() + 1
      if (
        Number.isFinite(syncYear) &&
        Number.isFinite(syncMonth) &&
        syncMonth >= 1 &&
        syncMonth <= 12
      ) {
        try {
          await syncHeatMeterReadingsForPeriod(user, syncYear, syncMonth, {
            orgIds: scopedOrgIds,
            officeOrgId: officeOrgIdForScope,
          })
        } catch (e) {
          console.error('syncHeatMeterReadingsForPeriod:', e)
        }
      }
    }

    type CarryData = {
      byKey: Map<string, number>
      atFilter: Map<string, number>
      openingByOrgYear: Map<string, number>
      orgIds: string[]
      billingPeriods: Array<{
        id: string
        organizationId: string
        year: number
        month: number
        paidAmount: number | null
        previousRemainingOverride: number | null
        previousRemainingManual: boolean | null
      }>
    }

    async function computeCarry(
      filterYear: number | null,
      filterMonth: number | null
    ): Promise<CarryData> {
      let carryScopeOrgIds = [...scopedOrgIds]
      if (carryScopeOrgIds.length === 0) {
        return {
          byKey: new Map(),
          atFilter: new Map(),
          openingByOrgYear: new Map(),
          orgIds: [],
          billingPeriods: [],
        }
      }

      const carryReadingWhere: {
        organizationId: { in: string[] }
        OR?: Array<
          | { year: { lt: number } }
          | { year: number; month: { lte: number } }
        >
      } = { organizationId: { in: carryScopeOrgIds } }
      if (filterYear != null && filterMonth != null) {
        carryReadingWhere.OR = [
          { year: { lt: filterYear } },
          { year: filterYear, month: { lte: filterMonth } },
        ]
      }

      const [allReadings, allOpenings, allBillingPeriods] = await Promise.all([
        prisma.meterReading.findMany({
          where: carryReadingWhere,
          select: {
            organizationId: true,
            year: true,
            month: true,
            total: true,
            paidAmount: true,
          },
        }),
        prisma.organizationOpeningBalance.findMany({
          where: { organizationId: { in: carryScopeOrgIds } },
          select: { organizationId: true, year: true, amount: true },
        }),
        prisma.organizationBillingPeriod.findMany({
          where: { organizationId: { in: carryScopeOrgIds } },
          select: {
            id: true,
            organizationId: true,
            year: true,
            month: true,
            previousRemainingOverride: true,
            previousRemainingManual: true,
            paidAmount: true,
          },
        }),
      ])

      const periodOverrides = allBillingPeriods
        .filter((bp) => bp.previousRemainingOverride != null && bp.month === 4)
        .map((bp) => ({
          organizationId: bp.organizationId,
          year: bp.year,
          month: bp.month,
          amount: Number(bp.previousRemainingOverride) || 0,
        }))

      const billingPeriodPayments = allBillingPeriods
        .filter((bp) => Number(bp.paidAmount) > 0)
        .map((bp) => ({
          organizationId: bp.organizationId,
          year: bp.year,
          month: bp.month,
          paidAmount: Number(bp.paidAmount) || 0,
        }))

      const carry = computeMultiOrgCarry(
        allReadings.map((r) => ({
          organizationId: r.organizationId,
          year: r.year,
          month: r.month,
          total: Number(r.total) || 0,
          paidAmount: Number(r.paidAmount) || 0,
        })),
        filterYear,
        filterMonth,
        {
          openings: allOpenings.map((o) => ({
            organizationId: o.organizationId,
            year: o.year,
            amount: Number(o.amount) || 0,
          })),
          periodOverrides,
          billingPeriodPayments,
        }
      )

      return { ...carry, orgIds: carryScopeOrgIds, billingPeriods: allBillingPeriods }
    }

    const carryPromise =
      withCarry && filterYearNum != null && filterMonthNum != null
        ? computeCarry(filterYearNum, filterMonthNum)
        : null

    const [rawReadings, carryDataPre] = await Promise.all([
      prisma.meterReading.findMany({
        where,
        select: METER_READING_LIST_SELECT,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        ...(take ? { take } : {}),
      }),
      carryPromise ?? Promise.resolve(null),
    ])
    const readings = await attachOrgsAndMetersToReadings(rawReadings)

    function attachCarry<T extends { organizationId: string; year: number; month: number }>(
      rows: T[],
      map: Map<string, number>
    ): Array<T & { previousRemaining: number }> {
      return rows.map((r) => ({
        ...r,
        previousRemaining: map.get(`${r.organizationId}|${r.year}|${r.month}`) ?? 0,
      }))
    }

    async function withBillingPeriodIds<T extends Record<string, unknown>>(
      rows: T[],
      billingPeriods?: CarryData['billingPeriods']
    ) {
      try {
        const attached = await attachBillingPeriodsToRows(
          rows.map((r) => ({
            ...r,
            organizationId: String(r.organizationId ?? ''),
            year: Number(r.year),
            month: Number(r.month),
            id: r.id != null ? String(r.id) : undefined,
            paidAmount: r.paidAmount as number | null | undefined,
            previousRemaining: r.previousRemaining as number | null | undefined,
            readingIds: Array.isArray(r.readingIds) ? (r.readingIds as string[]) : undefined,
            isPhantom:
              Boolean(r.isPhantom) || String(r.id ?? '').startsWith('phantom-'),
          })),
          user.userId,
          billingPeriods
        )
        if (isBillingPage) {
          scheduleBillingPeriodSnapshots(
            attached
              .map((r) => buildBillingPeriodSnapshot(r))
              .filter((s): s is NonNullable<typeof s> => s != null),
            user.userId,
            after
          )
        }
        return attached
      } catch (err: unknown) {
        const hint = billingPeriodDbSetupHint(err)
        if (hint) {
          throw new Error(hint)
        }
        throw err
      }
    }

    async function finalizeBillingRows<
      T extends { organizationId: string; year: number; month: number },
    >(
      rows: T[],
      carryData: CarryData,
      filterYear: number,
      filterMonth: number,
      existingKeys: Set<string>
    ) {
      const attached = attachCarry(rows, carryData.byKey)
      if (!canPhantom) {
        return withBillingPeriodIds(attached, carryData.billingPeriods)
      }
      const phantoms = await buildPhantomRows(
        carryData,
        filterYear,
        filterMonth,
        existingKeys
      )
      return withBillingPeriodIds(
        [...attached, ...phantoms.map((p) => ({ ...p, isPhantom: true }))],
        carryData.billingPeriods
      )
    }

    /**
     * Шүүсэн (он, сар) дээр заалтгүй ч өмнөх үлдэгдэлтэй харилцагчдад phantom мөр үүсгэнэ.
     * Phantom мөрөнд: total=0, paidAmount=0, previousRemaining=carry, meter='-', usage=0.
     */
    async function buildPhantomRows(
      data: CarryData,
      filterYear: number,
      filterMonth: number,
      existingKeys: Set<string>
    ): Promise<Array<Record<string, unknown>>> {
      const phantomOrgIds = new Set<string>()
      // Шилжүүлэгдэх carry бүхий org-ууд (хуучин үлдэгдэлтэй)
      for (const [orgId, carry] of data.atFilter) {
        if (Math.abs(carry) < 0.005) continue
        const key = `${orgId}|${filterYear}|${filterMonth}`
        if (existingKeys.has(key)) continue
        phantomOrgIds.add(orgId)
      }
      // 4-р сараас хойш filter байгаа бол тухайн жилийн нээлтийн үлдэгдэлтэй org-ыг ч phantom болгоно.
      if (filterMonth >= 4) {
        for (const [k, amount] of data.openingByOrgYear) {
          const [orgId, yStr] = k.split('|')
          if (!orgId || Number(yStr) !== filterYear) continue
          if (Math.abs(amount) < 0.005) continue
          const key = `${orgId}|${filterYear}|${filterMonth}`
          if (existingKeys.has(key)) continue
          phantomOrgIds.add(orgId)
        }
      }
      if (phantomOrgIds.size === 0) return []
      const orgs = await prisma.organization.findMany({
        where: { id: { in: Array.from(phantomOrgIds) } },
        select: {
          id: true,
          name: true,
          code: true,
          category: true,
          phone: true,
          users: { where: { phone: { not: null } }, select: { phone: true } },
        },
      })
      const orgMap = new Map(orgs.map((o) => [o.id, o]))
      const out: Array<Record<string, unknown>> = []
      for (const orgId of phantomOrgIds) {
        const o = orgMap.get(orgId)
        if (!o) continue
        const prior = data.atFilter.get(orgId) ?? 0
        const savedApril = data.openingByOrgYear.get(`${orgId}|${filterYear}`) ?? 0
        const carry =
          filterMonth === 4 && Math.abs(savedApril) >= 0.005
            ? Math.round(savedApril * 100) / 100
            : Math.round(prior * 100) / 100
        out.push({
          id: `phantom-${orgId}-${filterYear}-${filterMonth}`,
          organizationId: orgId,
          organization: {
            id: o.id,
            name: o.name,
            code: o.code,
            category: o.category,
            phone: o.phone,
            users: o.users,
          },
          meterId: '',
          meter: {
            id: '',
            meterNumber: '—',
            billingMode: null,
            organizationId: orgId,
            pipeDiameterMm: null,
            billingCategory: null,
          },
          year: filterYear,
          month: filterMonth,
          startValue: 0,
          endValue: 0,
          usage: 0,
          heatUsage: 0,
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
          paidAmount: 0,
          previousRemaining: carry,
          approved: carry <= 0.005,
          smsSentAt: null,
          ebarimtStatus: 'PENDING',
          createdBy: '',
          createdAt: new Date(0),
          updatedAt: new Date(0),
          isPhantom: true,
        })
      }
      return out
    }

    const canPhantom =
      withCarry && filterYearNum != null && filterMonthNum != null

    // Шинэ/тооцоогүй заалт ирсэн үед тухайн сарыг автоматаар бодож DB-д хадгална.
    const autoRecalc =
      !shouldRecalculate &&
      filterYearNum != null &&
      filterMonthNum != null &&
      readings.some((r) => readingNeedsMoneyRecalc(r))
    const runTariffRecalc = shouldRecalculate || autoRecalc

    // Хурдны үндсэн горим: тарифын мөр дүн + сонгосон нэмэлт төлбөр + НӨАТ.
    if (!runTariffRecalc) {
      const baseReadings = isBillingPage ? readings : await attachAdditionalFeesToReadings(readings)
      if (withCarry && carryDataPre) {
        const carryData = carryDataPre
        if (canPhantom) {
          const existingKeys = new Set(
            rawReadings
              .filter((r) => r.year === filterYearNum && r.month === filterMonthNum)
              .map((r) => `${r.organizationId}|${filterYearNum}|${filterMonthNum}`)
          )
          const withIds = await finalizeBillingRows(
            baseReadings,
            carryData,
            filterYearNum as number,
            filterMonthNum as number,
            existingKeys
          )
          return NextResponse.json(withIds)
        }
        const withIds = await withBillingPeriodIds(
          attachCarry(baseReadings, carryData.byKey),
          carryData.billingPeriods
        )
        return NextResponse.json(withIds)
      }
      return NextResponse.json(baseReadings)
    }

    // Бодолт товч (recalculate=1) эсвэл тооцоогүй шинэ заалт — тарифаар дүнг тооцож DB-д хадгална.
    const periodYear = filterYearNum ?? readings[0]?.year ?? new Date().getFullYear()
    const periodMonth = filterMonthNum ?? readings[0]?.month ?? new Date().getMonth() + 1

    let updatedReadings = readings

    if (shouldRecalculate) {
      const tariffCache = await TariffPeriodCache.build(
        [...new Set(readings.map((r) => r.organizationId))],
        periodYear,
        periodMonth
      )
      updatedReadings = readings.map((r) =>
        recalculateReadingRowMoney(r as ReadingForTariffRecalc, tariffCache)
      ) as typeof readings
      const withExtrasRecalc = await attachAdditionalFeesToReadings(updatedReadings)
      await persistReadingMoneyFields(withExtrasRecalc)
      updatedReadings = withExtrasRecalc as typeof readings
    } else if (autoRecalc) {
      const ids = readings
        .filter((r) => readingNeedsMoneyRecalc(r))
        .map((r) => r.id)
        .filter(Boolean) as string[]
      if (ids.length > 0) {
        const recalculated = await recalculateReadingIdsForPeriod(ids, periodYear, periodMonth)
        const byId = new Map(recalculated.map((r) => [String(r.id), r]))
        updatedReadings = readings.map((r) => {
          if (!r.id) return r
          const u = byId.get(r.id)
          return u ? ({ ...r, ...u } as typeof r) : r
        })
      }
    }

    const withExtras = shouldRecalculate
      ? updatedReadings
      : isBillingPage
        ? updatedReadings
        : await attachAdditionalFeesToReadings(updatedReadings)

    if (withCarry && carryDataPre) {
      const carryData = carryDataPre
      if (canPhantom) {
        const existingKeys = new Set(
          rawReadings
            .filter((r) => r.year === filterYearNum && r.month === filterMonthNum)
            .map((r) => `${r.organizationId}|${filterYearNum}|${filterMonthNum}`)
        )
        const withIds = await finalizeBillingRows(
          withExtras,
          carryData,
          filterYearNum as number,
          filterMonthNum as number,
          existingKeys
        )
        return NextResponse.json(withIds)
      }
      const withIds = await withBillingPeriodIds(
        attachCarry(withExtras, carryData.byKey),
        carryData.billingPeriods
      )
      return NextResponse.json(withIds)
    }
    return NextResponse.json(withExtras)
  } catch (error: any) {
    console.error('Readings GET error:', error)
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа', details: error.stack },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // staff token дээр organizationId хоосон байж болно → scope шалгалтаас өмнө сэргээнэ
    const officeOrgId = await ensureOfficeOrganizationId(user)
    const scopedUser = { ...user, organizationId: officeOrgId ?? user.organizationId }
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Заалтын ID шаардлагатай' },
        { status: 400 }
      )
    }

    const data = await request.json()

    // Get existing reading to get meterId and calculate usage
    const existingReading = await prisma.meterReading.findUnique({
      where: { id },
    })

    if (!existingReading) {
      return NextResponse.json(
        { error: 'Заалт олдсонгүй' },
        { status: 404 }
      )
    }

    if ((existingReading as { smsSentAt?: Date | null }).smsSentAt) {
      return NextResponse.json(
        { error: 'SMS илгээгдсэн тул энэ заалтыг засах боломжгүй' },
        { status: 409 }
      )
    }

    const meterForBilling = await prisma.meter.findUnique({
      where: { id: existingReading.meterId },
      select: {
        billingMode: true,
        defaultHeatUsage: true,
        waterChargeSplit: true,
        pipeDiameterMm: true,
        billingCategory: true,
      },
    })

    if (
      String(user.role) === Role.ACCOUNTANT ||
      String(user.role) === Role.MANAGER
    ) {
      const createdByMe =
        (existingReading as any).createdByUserId != null &&
        String((existingReading as any).createdByUserId) === String(user.userId)
      if (!createdByMe && !(await organizationIdInScope(scopedUser as any, existingReading.organizationId))) {
        return NextResponse.json(
          { error: 'Энэ заалтыг засах эрхгүй' },
          { status: 403 }
        )
      }
    }

    const billingMode = normalizeBillingMode(meterForBilling?.billingMode)
    const waterUsage = data.endValue - data.startValue
    const meterDefaultHeat =
      Number.isFinite(Number((meterForBilling as any)?.defaultHeatUsage)) &&
      Number((meterForBilling as any)?.defaultHeatUsage) > 0
        ? Math.round(Number((meterForBilling as any)?.defaultHeatUsage) * 100) / 100
        : 0
    const clientHeat = parseClientHeatUsage(data, billingMode)
    const existingHeat = Number((existingReading as any)?.heatUsage ?? 0) || 0
    const fallbackHeat = existingHeat > 0 ? existingHeat : meterDefaultHeat > 0 ? meterDefaultHeat : 0
    const heatUsage =
      billingMode === 'WATER_HEAT'
        ? (clientHeat ?? (fallbackHeat > 0 ? fallbackHeat : waterUsage > 0 ? waterUsage : 0))
        : (clientHeat ?? fallbackHeat)
    const usage = billingMode === 'HEAT' ? heatUsage : waterUsage
    if (waterUsage < 0) {
      return NextResponse.json(
        { error: 'Эцсийн заалт эхний заалтаас их байх ёстой' },
        { status: 400 }
      )
    }

    const orgForCategory = await prisma.organization.findUnique({
      where: { id: existingReading.organizationId },
      select: { category: true },
    })
    const orgCategory = effectiveBillingCategory(meterForBilling?.billingCategory, orgForCategory?.category)

    const pipeMmPut =
      meterForBilling?.pipeDiameterMm != null &&
      Number.isFinite(Number(meterForBilling.pipeDiameterMm)) &&
      Number(meterForBilling.pipeDiameterMm) > 0
        ? Math.trunc(Number(meterForBilling.pipeDiameterMm))
        : null
    const [waterTariffRaw, heatTariff] = await Promise.all([
      getWaterTariffRatesForPeriod(existingReading.organizationId, data.year, data.month, {
        pipeDiameterMm: pipeMmPut,
        billingCategory: meterForBilling?.billingCategory,
      }),
      getHeatTariffRatesForPeriod(existingReading.organizationId, data.year, data.month, {
        billingCategory: meterForBilling?.billingCategory,
      }),
    ])
    const waterTariff = waterTariffAdjustedForMeter(
      waterTariffRaw,
      billingMode,
      meterForBilling?.waterChargeSplit
    )
    const existingHeatClosed = (existingReading as { heatClosed?: boolean | null }).heatClosed
    const heatClosedState =
      existingHeatClosed === true ? true : existingHeatClosed === false ? false : null
    const finalMoney = finalizeReadingMoneyForHeatRules(
      billingMode,
      data.month,
      heatClosedState,
      billingMode === 'WATER_HEAT'
        ? computeReadingMoneySplit(waterUsage, heatUsage, orgCategory, billingMode, waterTariff, heatTariff)
        : computeReadingMoney(usage, orgCategory, billingMode, waterTariff, heatTariff)
    )
    const {
      baseClean,
      baseDirty,
      cleanPerM3,
      dirtyPerM3,
      heatBase,
      heatPerM3,
      heatPerM2,
      cleanAmount,
      dirtyAmount,
      heatAmount,
      subtotal,
      vat,
      total,
    } = finalMoney

    const updatedRow = await prisma.meterReading.update({
      where: { id },
      data: {
        month: data.month,
        year: data.year,
        startValue: data.startValue,
        endValue: data.endValue,
        heatUsage,
        usage,
        baseClean,
        baseDirty,
        cleanPerM3,
        dirtyPerM3,
        cleanAmount,
        dirtyAmount,
        heatBase,
        heatPerM3,
        heatPerM2,
        heatAmount,
        subtotal,
        vat,
        total,
        updatedByUserId: user.userId,
      },
    })
    await recalculateAndPersistOrgPeriodAdditionalFees(
      existingReading.organizationId,
      Number(data.year),
      Number(data.month)
    )
    const refreshed = await prisma.meterReading.findUnique({ where: { id } })
    const [reading] = await attachOrgsAndMetersToReadings([refreshed ?? updatedRow])

    // Эцсийн заалт өөрчлөгдвөл ижил тоолуурын бүх дараагийн сарууд (алгассан ч) дагуулалтаар шинэчлэгдэнэ.
    const periodChanged =
      Number(existingReading.year) !== Number(data.year) ||
      Number(existingReading.month) !== Number(data.month)
    const endChanged = endReadingChanged(existingReading.endValue, data.endValue)
    if (!periodChanged && endChanged) {
      await propagateLaterReadingsAfterEndChange({
        meterId: existingReading.meterId,
        billingMode,
        waterChargeSplit: meterForBilling?.waterChargeSplit,
        afterYear: Number(data.year),
        afterMonth: Number(data.month),
        carriedEnd: Number(data.endValue) || 0,
        updatedByUserId: user.userId,
      })
    }

    return NextResponse.json(reading)
  } catch (error: any) {
    console.error('Reading update error:', error)
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const officeOrgId = await ensureOfficeOrganizationId(user)
    const scopedUser = { ...user, organizationId: officeOrgId ?? user.organizationId }
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Заалтын ID шаардлагатай' },
        { status: 400 }
      )
    }
    const reading = await prisma.meterReading.findUnique({
      where: { id },
      select: { organizationId: true },
    })
    if (!reading) {
      return NextResponse.json({ error: 'Заалт олдсонгүй' }, { status: 404 })
    }

    if (
      String(user.role) === Role.ACCOUNTANT ||
      String(user.role) === Role.MANAGER
    ) {
      const createdByMe =
        (reading as any).createdByUserId != null &&
        String((reading as any).createdByUserId) === String(user.userId)
      if (!createdByMe && !(await organizationIdInScope(scopedUser as any, reading.organizationId))) {
        return NextResponse.json(
          { error: 'Энэ заалтыг устгах эрхгүй' },
          { status: 403 }
        )
      }
    }

    await prisma.meterReading.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Reading deletion error:', error)
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа' },
      { status: 500 }
    )
  }
}

