import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    const where: any = {}
    if (user.organizationId) {
      where.organizationId = user.organizationId
    } else if (organizationId) {
      where.organizationId = organizationId
    } else {
      const validOrgIds = await prisma.organization.findMany({
        select: { id: true },
      })
      const validOrgIdSet = new Set(validOrgIds.map(org => org.id))
      where.organizationId = { in: Array.from(validOrgIdSet) }
    }

    const meters = await prisma.meter.findMany({
      where,
      select: {
        id: true,
        meterNumber: true,
        organizationId: true,
        year: true,
        organization: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
      orderBy: { meterNumber: 'asc' },
    })

    return NextResponse.json(meters)
  } catch (error: any) {
    console.error('Meters GET error:', error)
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа', details: error.stack },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const data = await request.json()

    const orgId = user.organizationId || data.organizationId
    if (user.organizationId && data.organizationId && data.organizationId !== user.organizationId) {
      return NextResponse.json(
        { error: 'Зөвхөн өөрийн байгууллагад тоолуур нэмэх боломжтой' },
        { status: 403 }
      )
    }

    const currentYear = new Date().getFullYear()
    const year = typeof data.year === 'number' && data.year >= 2000 && data.year <= 2100
      ? data.year
      : currentYear
    const meter = await prisma.meter.create({
      data: {
        meterNumber: data.meterNumber,
        organizationId: orgId,
        year,
      },
    })

    return NextResponse.json(meter)
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

export async function PUT(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const data = await request.json()

    if (!data.id) {
      return NextResponse.json(
        { error: 'Тоолуурын ID шаардлагатай' },
        { status: 400 }
      )
    }

    if (!data.meterNumber || data.meterNumber.trim() === '') {
      return NextResponse.json(
        { error: 'Тоолуурын дугаар оруулна уу' },
        { status: 400 }
      )
    }

    if (user.organizationId) {
      const existing = await prisma.meter.findUnique({
        where: { id: data.id },
        select: { organizationId: true },
      })
      if (!existing || existing.organizationId !== user.organizationId) {
        return NextResponse.json(
          { error: 'Энэ тоолуурыг засах эрхгүй' },
          { status: 403 }
        )
      }
    }

    const currentYear = new Date().getFullYear()
    const year = typeof data.year === 'number' && data.year >= 2000 && data.year <= 2100
      ? data.year
      : currentYear
    const updateData: any = {
      meterNumber: data.meterNumber.trim(),
      organizationId: data.organizationId,
      year,
    }
    if (user.organizationId) updateData.organizationId = user.organizationId
    const meter = await prisma.meter.update({
      where: { id: data.id },
      data: updateData,
    })

    return NextResponse.json(meter)
  } catch (error: any) {
    console.error('Meter update error:', error)
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Энэ дугаартай тоолуур аль хэдийн бүртгэлтэй байна' },
        { status: 400 }
      )
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
        { error: 'Тоолуурын ID шаардлагатай' },
        { status: 400 }
      )
    }

    const meter = await prisma.meter.findUnique({
      where: { id },
      include: {
        readings: { take: 1 },
      },
    })

    if (!meter) {
      return NextResponse.json(
        { error: 'Тоолуур олдсонгүй' },
        { status: 404 }
      )
    }
    if (user.organizationId && meter.organizationId !== user.organizationId) {
      return NextResponse.json(
        { error: 'Энэ тоолуурыг устгах эрхгүй' },
        { status: 403 }
      )
    }
    if (meter.readings.length > 0) {
      return NextResponse.json(
        { error: 'Энэ тоолууртай холбоотой заалт байна. Эхлээд заалтуудыг устгана уу' },
        { status: 400 }
      )
    }

    await prisma.meter.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Meter deletion error:', error)
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа' },
      { status: 500 }
    )
  }
}

