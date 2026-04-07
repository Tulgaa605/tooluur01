import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { getManagedCustomerOrganizationIds, organizationIdInScope } from '@/lib/org-scope'

function getNextPeriod(year: number, month: number): { year: number; month: number } {
  if (month === 12) return { year: year + 1, month: 1 }
  return { year, month: month + 1 }
}

/** Байгууллагын тухайн сарын тарифын утгыг олно: шугамын голч (PipeFee), organization tariff, төрлийн тариф эсвэл байгууллагын суурь. */
async function getTariffRatesForPeriod(
  organizationId: string,
  year: number,
  month: number
): Promise<{ baseClean: number; baseDirty: number; cleanPerM3: number; dirtyPerM3: number }> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { category: true, connectionNumber: true, baseCleanFee: true, baseDirtyFee: true },
  })
  if (!org) return { baseClean: 0, baseDirty: 0, cleanPerM3: 0, dirtyPerM3: 0 }

  let baseClean = 0
  let baseDirty = 0
  let cleanPerM3 = 0
  let dirtyPerM3 = 0

  const pipeDiam = org.connectionNumber ? parseInt(String(org.connectionNumber).trim(), 10) : NaN
  if (!Number.isNaN(pipeDiam)) {
    const pipeFee = await prisma.pipeFee.findUnique({
      where: { diameterMm: pipeDiam },
      select: { baseCleanFee: true, baseDirtyFee: true },
    })
    if (pipeFee) {
      baseClean = pipeFee.baseCleanFee ?? 0
      baseDirty = pipeFee.baseDirtyFee ?? 0
    }
  }

  const orgTariff = await prisma.organizationTariff.findUnique({
    where: { organizationId_year_month: { organizationId, year, month } },
    select: { baseCleanFee: true, baseDirtyFee: true, cleanPerM3: true, dirtyPerM3: true },
  })
  if (orgTariff) {
    if (Number.isNaN(pipeDiam)) {
      baseClean = orgTariff.baseCleanFee ?? 0
      baseDirty = orgTariff.baseDirtyFee ?? 0
    }
    cleanPerM3 = orgTariff.cleanPerM3 ?? 0
    dirtyPerM3 = orgTariff.dirtyPerM3 ?? 0
    return { baseClean, baseDirty, cleanPerM3, dirtyPerM3 }
  }

  const catRow = await prisma.categoryTariff.findUnique({
    where: { category: org.category },
    select: { baseCleanFee: true, baseDirtyFee: true, cleanPerM3: true, dirtyPerM3: true },
  })
  if (catRow) {
    if (Number.isNaN(pipeDiam)) {
      baseClean = catRow.baseCleanFee ?? 0
      baseDirty = catRow.baseDirtyFee ?? 0
    }
    cleanPerM3 = catRow.cleanPerM3 ?? 0
    dirtyPerM3 = catRow.dirtyPerM3 ?? 0
    return { baseClean, baseDirty, cleanPerM3, dirtyPerM3 }
  }

  if (Number.isNaN(pipeDiam)) {
    baseClean = org.baseCleanFee ?? 0
    baseDirty = org.baseDirtyFee ?? 0
  }
  return { baseClean, baseDirty, cleanPerM3, dirtyPerM3 }
}

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const data = await request.json()

    // Get meter to find organization
    const meter = await prisma.meter.findUnique({
      where: { id: data.meterId },
    })

    if (!meter) {
      return NextResponse.json({ error: 'Тоолуур олдсонгүй' }, { status: 404 })
    }

    // Нягтлан: зөвхөн өөрийн хамрах хүрээнд (албан + бүртгэсэн харилцагч) тоолуур дээр заалт
    if (!(await organizationIdInScope(user, meter.organizationId))) {
      return NextResponse.json(
        { error: 'Энэ байгууллагын заалт оруулах эрхгүй' },
        { status: 403 }
      )
    }

    const usage = data.endValue - data.startValue
    if (usage < 0) {
      return NextResponse.json(
        { error: 'Эцсийн заалт эхний заалтаас их байх ёстой' },
        { status: 400 }
      )
    }

    const tariff = await getTariffRatesForPeriod(meter.organizationId, data.year, data.month)
    const baseClean = tariff.baseClean
    const baseDirty = tariff.baseDirty
    const cleanPerM3 = tariff.cleanPerM3
    const dirtyPerM3 = tariff.dirtyPerM3

    const cleanAmount = usage * cleanPerM3 + baseClean
    const dirtyAmount = usage * dirtyPerM3 + baseDirty
    const subtotal = cleanAmount + dirtyAmount
    const vat = subtotal * 0.1
    const total = subtotal + vat

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
      return NextResponse.json(
        { error: 'Энэ сарын заалт аль хэдийн оруулсан байна' },
        { status: 400 }
      )
    }

    const reading = await prisma.meterReading.create({
      data: {
        meterId: data.meterId,
        organizationId: meter.organizationId,
        month: data.month,
        year: data.year,
        startValue: data.startValue,
        endValue: data.endValue,
        usage,
        baseClean,
        baseDirty,
        cleanPerM3,
        dirtyPerM3,
        cleanAmount,
        dirtyAmount,
        subtotal,
        vat,
        total,
        createdBy: user.userId,
        createdByUserId: user.userId,
      },
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

    // USER: өөрийн байгууллага. Нягтлан/захирал: зөвхөн бүртгэсэн харилцагч (албан өөрийн заалт энд бүү ор).
    let where: any = {}
    const roleStr = String(user.role)
    if (roleStr === Role.USER) {
      if (!user.organizationId) return NextResponse.json([])
      where.organizationId = user.organizationId
    } else if (roleStr === Role.ACCOUNTANT || roleStr === Role.MANAGER) {
      const customerIds = await getManagedCustomerOrganizationIds(user)
      if (customerIds.length === 0) return NextResponse.json([])
      where.organizationId = { in: customerIds }
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

    const readings = await prisma.meterReading.findMany({
      where,
      include: {
        meter: {
          select: {
            meterNumber: true,
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
            code: true,
            phone: true,
            users: {
              where: {
                phone: { not: null },
              },
              select: { phone: true },
            },
          },
        },
      },
      orderBy: [
        { year: 'desc' },
        { month: 'desc' },
      ],
      ...(take ? { take } : {}),
    })

    // Хурдны үндсэн горим: хадгалсан дүнг шууд буцаана.
    if (!shouldRecalculate) {
      return NextResponse.json(readings)
    }

    // Сонголтоор (recalculate=1) тарифаар дүнг дахин тооцоолж буцаана.
    const tariffCache = new Map<string, Awaited<ReturnType<typeof getTariffRatesForPeriod>>>()
    const result = await Promise.all(
      readings.map(async (r) => {
        const cacheKey = `${r.organizationId}-${r.year}-${r.month}`
        let tariff = tariffCache.get(cacheKey)
        if (!tariff) {
          tariff = await getTariffRatesForPeriod(r.organizationId, r.year, r.month)
          tariffCache.set(cacheKey, tariff)
        }
        const usage = r.usage ?? 0
        const cleanAmount = usage * tariff.cleanPerM3 + tariff.baseClean
        const dirtyAmount = usage * tariff.dirtyPerM3 + tariff.baseDirty
        const subtotal = cleanAmount + dirtyAmount
        const vat = subtotal * 0.1
        const total = subtotal + vat
        return {
          ...r,
          baseClean: tariff.baseClean,
          baseDirty: tariff.baseDirty,
          cleanPerM3: tariff.cleanPerM3,
          dirtyPerM3: tariff.dirtyPerM3,
          cleanAmount,
          dirtyAmount,
          subtotal,
          vat,
          total,
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
      include: { meter: true },
    })

    if (!existingReading) {
      return NextResponse.json(
        { error: 'Заалт олдсонгүй' },
        { status: 404 }
      )
    }

    if (
      String(user.role) === Role.ACCOUNTANT ||
      String(user.role) === Role.MANAGER
    ) {
      if (!(await organizationIdInScope(user, existingReading.organizationId))) {
        return NextResponse.json(
          { error: 'Энэ заалтыг засах эрхгүй' },
          { status: 403 }
        )
      }
    }

    const usage = data.endValue - data.startValue
    if (usage < 0) {
      return NextResponse.json(
        { error: 'Эцсийн заалт эхний заалтаас их байх ёстой' },
        { status: 400 }
      )
    }

    // Одоогийн тарифаар дүнг дахин тооцоолно (байгууллагын тариф зөрүүгээр үржигдэнэ)
    const tariff = await getTariffRatesForPeriod(
      existingReading.organizationId,
      data.year,
      data.month
    )
    const baseClean = tariff.baseClean
    const baseDirty = tariff.baseDirty
    const cleanPerM3 = tariff.cleanPerM3
    const dirtyPerM3 = tariff.dirtyPerM3
    const cleanAmount = usage * cleanPerM3 + baseClean
    const dirtyAmount = usage * dirtyPerM3 + baseDirty
    const subtotal = cleanAmount + dirtyAmount
    const vat = subtotal * 0.1
    const total = subtotal + vat

    const reading = await prisma.meterReading.update({
      where: { id },
      data: {
        month: data.month,
        year: data.year,
        startValue: data.startValue,
        endValue: data.endValue,
        usage,
        baseClean,
        baseDirty,
        cleanPerM3,
        dirtyPerM3,
        cleanAmount,
        dirtyAmount,
        subtotal,
        vat,
        total,
        updatedByUserId: user.userId,
      },
      include: {
        meter: {
          select: {
            meterNumber: true,
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    })

    // Өмнөх сарын эцсийн заалт өөрчлөгдвөл дараагийн сарын эхний/эцсийн заалтыг автоматаар дагуулж шинэчилнэ.
    const periodChanged =
      Number(existingReading.year) !== Number(data.year) ||
      Number(existingReading.month) !== Number(data.month)
    const endChanged = Number(existingReading.endValue) !== Number(data.endValue)
    if (!periodChanged && endChanged) {
      const nextPeriod = getNextPeriod(Number(data.year), Number(data.month))
      const nextReading = await prisma.meterReading.findUnique({
        where: {
          meterId_month_year: {
            meterId: existingReading.meterId,
            month: nextPeriod.month,
            year: nextPeriod.year,
          },
        },
        select: { id: true, organizationId: true, startValue: true, endValue: true, usage: true },
      })

      if (nextReading) {
        const nextStartValue = Number(data.endValue) || 0
        // Дараагийн сарын эцсийн заалтыг зөвхөн автоматаар (start=end, usage=0) байсан үед л дагуулж шинэчилнэ.
        // Хэрэглэгч өөрөө эцсийн заалт оруулсан бол хадгалж үлдээнэ.
        const wasAutoFilled =
          Number(nextReading.usage ?? 0) === 0 &&
          Number(nextReading.endValue ?? 0) === Number(nextReading.startValue ?? 0)
        const preservedEnd = Number(nextReading.endValue ?? 0)
        let nextEndValue = wasAutoFilled ? nextStartValue : preservedEnd
        // start нэмэгдсэнээс болж end < start болох эрсдэлийг арилгана.
        if (nextEndValue < nextStartValue) {
          nextEndValue = nextStartValue
        }
        const nextUsage = nextEndValue - nextStartValue
        const nextTariff = await getTariffRatesForPeriod(
          nextReading.organizationId,
          nextPeriod.year,
          nextPeriod.month
        )
        const nextCleanAmount = nextUsage * nextTariff.cleanPerM3 + nextTariff.baseClean
        const nextDirtyAmount = nextUsage * nextTariff.dirtyPerM3 + nextTariff.baseDirty
        const nextSubtotal = nextCleanAmount + nextDirtyAmount
        const nextVat = nextSubtotal * 0.1
        const nextTotal = nextSubtotal + nextVat

        await prisma.meterReading.update({
          where: { id: nextReading.id },
          data: {
            startValue: nextStartValue,
            endValue: nextEndValue,
            usage: nextUsage,
            baseClean: nextTariff.baseClean,
            baseDirty: nextTariff.baseDirty,
            cleanPerM3: nextTariff.cleanPerM3,
            dirtyPerM3: nextTariff.dirtyPerM3,
            cleanAmount: nextCleanAmount,
            dirtyAmount: nextDirtyAmount,
            subtotal: nextSubtotal,
            vat: nextVat,
            total: nextTotal,
            updatedByUserId: user.userId,
          },
        })
      }
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
      if (!(await organizationIdInScope(user, reading.organizationId))) {
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

