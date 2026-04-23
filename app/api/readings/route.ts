import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { getScopedOrganizationIds, organizationIdInScope } from '@/lib/org-scope'
import {
  type BillingMode,
  applyWaterChargeSplitToWaterRates,
  computeReadingMoney,
  computeReadingMoneySplit,
  effectiveWaterChargeSplit,
  getHeatTariffRatesForPeriod,
  getWaterTariffRatesForPeriod,
  normalizeBillingMode,
  type WaterTariffRates,
} from '@/lib/meter-reading-calc'

function waterUsageFromReading(r: { startValue?: unknown; endValue?: unknown; usage?: unknown }): number {
  const s = Number(r.startValue ?? 0)
  const e = Number(r.endValue ?? 0)
  const diff = e > s ? e - s : 0
  if (diff > 0) return diff
  const u = Number(r.usage ?? 0)
  return Number.isFinite(u) && u >= 0 ? u : 0
}

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
    const orgCategory = orgForCategory?.category ?? 'HOUSEHOLD'

    const [waterTariffRaw, heatTariff] = await Promise.all([
      getWaterTariffRatesForPeriod(meter.organizationId, data.year, data.month),
      getHeatTariffRatesForPeriod(meter.organizationId, data.year, data.month),
    ])
    const waterTariff = waterTariffAdjustedForMeter(waterTariffRaw, billingMode, meter.waterChargeSplit)
    const finalMoney =
      billingMode === 'WATER_HEAT'
        ? computeReadingMoneySplit(waterUsage, heatUsage, orgCategory, billingMode, waterTariff, heatTariff)
        : computeReadingMoney(usage, orgCategory, billingMode, waterTariff, heatTariff)
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
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER, Role.USER])
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { searchParams } = new URL(request.url)

    // USER: өөрийн байгууллага. Нягтлан/захирал: өөрийн алба + бүртгэсэн харилцагч (аль алины заалт харагдана).
    let where: any = {}
    const roleStr = String(user.role)
    if (roleStr === Role.USER) {
      if (!user.organizationId) return NextResponse.json([])
      where.organizationId = user.organizationId
    } else if (roleStr === Role.ACCOUNTANT || roleStr === Role.MANAGER) {
      // Зарим staff token дээр organizationId хоосон байж болно → GET дээр ч автоматаар сэргээнэ.
      const officeOrgId = await ensureOfficeOrganizationId(user)
      const scoped = await getScopedOrganizationIds({ ...user, organizationId: officeOrgId ?? user.organizationId })
      if (scoped.length === 0) return NextResponse.json([])
      // Scope-д таарах байгууллагуудын заалт + өмнө нь энэ хэрэглэгч өөрөө нэмсэн заалтуудыг алдахгүй.
      where.OR = [
        { organizationId: { in: scoped } },
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
      ? Math.min(Math.trunc(limitParam), 500)
      : undefined

    const shouldRecalculate = searchParams.get('recalculate') === '1'

    const rawReadings = await prisma.meterReading.findMany({
      where,
      orderBy: [
        { year: 'desc' },
        { month: 'desc' },
      ],
      ...(take ? { take } : {}),
    })
    const readings = await attachOrgsAndMetersToReadings(rawReadings)

    // Хурдны үндсэн горим: хадгалсан дүнг шууд буцаана.
    if (!shouldRecalculate) {
      return NextResponse.json(readings)
    }

    // Сонголтоор (recalculate=1) тарифаар дүнг дахин тооцоолж буцаана.
    const rawWaterCache = new Map<string, Awaited<ReturnType<typeof getWaterTariffRatesForPeriod>>>()
    const heatOnlyCache = new Map<string, Awaited<ReturnType<typeof getHeatTariffRatesForPeriod>>>()
    const result = await Promise.all(
      readings.map(async (r) => {
        const cacheKey = `${r.organizationId}-${r.year}-${r.month}`
        let rawWater = rawWaterCache.get(cacheKey)
        if (!rawWater) {
          rawWater = await getWaterTariffRatesForPeriod(r.organizationId, r.year, r.month)
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

    return NextResponse.json(result)
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

    const meterForBilling = await prisma.meter.findUnique({
      where: { id: existingReading.meterId },
      select: { billingMode: true, defaultHeatUsage: true, waterChargeSplit: true },
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
    const orgCategory = orgForCategory?.category ?? 'HOUSEHOLD'

    const [waterTariffRaw, heatTariff] = await Promise.all([
      getWaterTariffRatesForPeriod(existingReading.organizationId, data.year, data.month),
      getHeatTariffRatesForPeriod(existingReading.organizationId, data.year, data.month),
    ])
    const waterTariff = waterTariffAdjustedForMeter(
      waterTariffRaw,
      billingMode,
      meterForBilling?.waterChargeSplit
    )
    const finalMoney =
      billingMode === 'WATER_HEAT'
        ? computeReadingMoneySplit(waterUsage, heatUsage, orgCategory, billingMode, waterTariff, heatTariff)
        : computeReadingMoney(usage, orgCategory, billingMode, waterTariff, heatTariff)
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
    const [reading] = await attachOrgsAndMetersToReadings([updatedRow])

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

