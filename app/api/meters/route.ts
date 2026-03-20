import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const filterOrgId = searchParams.get('organizationId')

    const where: any = {}
    // ACCOUNTANT: зөвхөн өөрийн байгууллага
    if (String(user.role) === Role.ACCOUNTANT) {
      if (!user.organizationId) return NextResponse.json([])
      where.organizationId = user.organizationId
    } else if (filterOrgId) {
      // MANAGER: зөвхөн шүүлтээр (organizationId) харах
      where.organizationId = filterOrgId
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

    const orgId =
      String(user.role) === Role.ACCOUNTANT
        ? user.organizationId
        : data.organizationId != null && String(data.organizationId).trim() !== ''
          ? String(data.organizationId).trim()
          : user.organizationId
    if (!orgId) {
      return NextResponse.json({ error: 'Байгууллага сонгоно уу' }, { status: 400 })
    }

    const orgExists = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    })
    if (!orgExists) {
      return NextResponse.json({ error: 'Байгууллага олдсонгүй' }, { status: 400 })
    }

    const meterNumber =
      typeof data.meterNumber === 'string' ? data.meterNumber.trim() : String(data.meterNumber ?? '').trim()
    if (!meterNumber) {
      return NextResponse.json({ error: 'Тоолуурын дугаар оруулна уу' }, { status: 400 })
    }

    const currentYear = new Date().getFullYear()
    const year = typeof data.year === 'number' && data.year >= 2000 && data.year <= 2100
      ? data.year
      : currentYear
    const meter = await prisma.meter.create({
      data: {
        meterNumber,
        organizationId: orgId,
        year,
      },
    })

    return NextResponse.json(meter)
  } catch (error: any) {
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

    const existing = await prisma.meter.findUnique({
      where: { id: data.id },
      select: { organizationId: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Тоолуур олдсонгүй' }, { status: 404 })
    }

    const currentYear = new Date().getFullYear()
    const year = typeof data.year === 'number' && data.year >= 2000 && data.year <= 2100
      ? data.year
      : currentYear

    let nextOrgId = existing.organizationId
    if (String(user.role) === Role.ACCOUNTANT) {
      if (!user.organizationId || existing.organizationId !== user.organizationId) {
        return NextResponse.json({ error: 'Энэ тоолуурыг засах эрхгүй' }, { status: 403 })
      }
      nextOrgId = user.organizationId
    } else if (data.organizationId != null && String(data.organizationId).trim() !== '') {
      nextOrgId = String(data.organizationId).trim()
      const orgExists = await prisma.organization.findUnique({
        where: { id: nextOrgId },
        select: { id: true },
      })
      if (!orgExists) {
        return NextResponse.json({ error: 'Байгууллага олдсонгүй' }, { status: 400 })
      }
    }

    const meter = await prisma.meter.update({
      where: { id: data.id },
      data: {
        meterNumber: data.meterNumber.trim(),
        organizationId: nextOrgId,
        year,
      },
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

    if (String(user.role) === Role.ACCOUNTANT) {
      if (!user.organizationId || meter.organizationId !== user.organizationId) {
        return NextResponse.json({ error: 'Энэ тоолуурыг устгах эрхгүй' }, { status: 403 })
      }
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

