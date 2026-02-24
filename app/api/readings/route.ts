import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'

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

    // USER can only see their own organization
    if (user.role === Role.USER && user.organizationId) {
      where.organizationId = user.organizationId
    }

    const organizationId = searchParams.get('organizationId')
    if (organizationId && (user.role === Role.ACCOUNTANT || user.role === Role.MANAGER)) {
      where.organizationId = organizationId
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

    return NextResponse.json(readings)
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

    const usage = data.endValue - data.startValue
    if (usage < 0) {
      return NextResponse.json(
        { error: 'Эцсийн заалт эхний заалтаас их байх ёстой' },
        { status: 400 }
      )
    }

    // Get meter to get cleanPerM3 and dirtyPerM3 (or use existing values)
    const cleanPerM3 = existingReading.cleanPerM3 || 0
    const dirtyPerM3 = existingReading.dirtyPerM3 || 0

    const cleanAmount = usage * cleanPerM3 + (data.baseClean || 0)
    const dirtyAmount = usage * dirtyPerM3 + (data.baseDirty || 0)
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
        baseClean: data.baseClean || 0,
        baseDirty: data.baseDirty || 0,
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
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Заалтын ID шаардлагатай' },
        { status: 400 }
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

