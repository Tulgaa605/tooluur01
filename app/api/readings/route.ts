import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'

function extractMongoBatch(result: any): any[] {
  if (!result) return []
  const cursor = result.cursor
  if (cursor?.firstBatch && Array.isArray(cursor.firstBatch)) return cursor.firstBatch
  if (cursor?.nextBatch && Array.isArray(cursor.nextBatch)) return cursor.nextBatch
  return []
}

/** Байгууллагын тухайн сарын тарифын утгыг олно (organization tariff эсвэл төрлийн тариф). */
async function getTariffRatesForPeriod(
  organizationId: string,
  year: number,
  month: number
): Promise<{ baseClean: number; baseDirty: number; cleanPerM3: number; dirtyPerM3: number }> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { category: true },
  })
  if (!org) return { baseClean: 0, baseDirty: 0, cleanPerM3: 0, dirtyPerM3: 0 }

  const orgTariff = await prisma.organizationTariff.findUnique({
    where: { organizationId_year_month: { organizationId, year, month } },
    select: { baseCleanFee: true, baseDirtyFee: true, cleanPerM3: true, dirtyPerM3: true },
  })
  if (orgTariff) {
    return {
      baseClean: orgTariff.baseCleanFee ?? 0,
      baseDirty: orgTariff.baseDirtyFee ?? 0,
      cleanPerM3: orgTariff.cleanPerM3 ?? 0,
      dirtyPerM3: orgTariff.dirtyPerM3 ?? 0,
    }
  }

  const catFind = await prisma.$runCommandRaw({
    find: 'category_tariffs',
    filter: { category: org.category },
    limit: 1,
  } as any)
  const catDocs = extractMongoBatch(catFind) as { baseCleanFee?: number; baseDirtyFee?: number; cleanPerM3?: number; dirtyPerM3?: number }[]
  if (catDocs.length > 0) {
    const d = catDocs[0]
    return {
      baseClean: d.baseCleanFee ?? 0,
      baseDirty: d.baseDirtyFee ?? 0,
      cleanPerM3: d.cleanPerM3 ?? 0,
      dirtyPerM3: d.dirtyPerM3 ?? 0,
    }
  }
  return { baseClean: 0, baseDirty: 0, cleanPerM3: 0, dirtyPerM3: 0 }
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
    if (user.organizationId && meter.organizationId !== user.organizationId) {
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

    const cleanAmount = usage * data.cleanPerM3 + data.baseClean
    const dirtyAmount = usage * data.dirtyPerM3 + data.baseDirty
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
        baseClean: data.baseClean,
        baseDirty: data.baseDirty,
        cleanPerM3: data.cleanPerM3,
        dirtyPerM3: data.dirtyPerM3,
        cleanAmount,
        dirtyAmount,
        subtotal,
        vat,
        total,
        createdBy: user.userId,
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

    let where: any = {}

    if (user.role === Role.USER && user.organizationId) {
      where.organizationId = user.organizationId
    } else if ((user.role === Role.ACCOUNTANT || user.role === Role.MANAGER) && user.organizationId) {
      where.organizationId = user.organizationId
    } else {
      const organizationId = searchParams.get('organizationId')
      if (organizationId && (user.role === Role.ACCOUNTANT || user.role === Role.MANAGER)) {
        where.organizationId = organizationId
      }
    }
    // Note: We don't filter by { not: null } here because Prisma MongoDB doesn't support it
    // Instead, we filter out null organizations in code after fetching

    const month = searchParams.get('month')
    if (month) {
      where.month = parseInt(month)
    }

    const year = searchParams.get('year')
    if (year) {
      where.year = parseInt(year)
    }
    
    // Get all readings - use raw query to handle null organizations
    // First, get all organization IDs that exist
    const validOrgIds = await prisma.organization.findMany({
      select: { id: true },
    })
    const validOrgIdSet = new Set(validOrgIds.map(org => org.id))
    
    // Add filter to only get readings with valid organizationId
    if (Object.keys(where).length === 0 || !where.organizationId) {
      where.organizationId = { in: Array.from(validOrgIdSet) }
    } else if (typeof where.organizationId === 'string') {
      // If specific organizationId is requested, verify it exists
      if (!validOrgIdSet.has(where.organizationId)) {
        return NextResponse.json([])
      }
    }
    
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
          },
        },
      },
      orderBy: [
        { year: 'desc' },
        { month: 'desc' },
      ],
    })

    // Одоогийн тарифаар дүнг дахин тооцоолж буцаана (зөрүү × ₮/м³ + суурь)
    const result = await Promise.all(
      readings.map(async (r) => {
        const tariff = await getTariffRatesForPeriod(r.organizationId, r.year, r.month)
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
    if (user.organizationId && existingReading.organizationId !== user.organizationId) {
      return NextResponse.json(
        { error: 'Энэ заалтыг засах эрхгүй' },
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
    if (reading && user.organizationId && reading.organizationId !== user.organizationId) {
      return NextResponse.json(
        { error: 'Энэ заалтыг устгах эрхгүй' },
        { status: 403 }
      )
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

