import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { getScopedOrganizationIds } from '@/lib/org-scope'

type OrgMini = { id: string; name: string; code: string | null }

async function attachOrganizationsToMeters<T extends { organizationId: string }>(
  rows: T[]
): Promise<Array<T & { organization: OrgMini }>> {
  const ids = [...new Set(rows.map((r) => r.organizationId).filter(Boolean))]
  const orgs =
    ids.length === 0
      ? []
      : await prisma.organization.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, code: true },
        })
  const byId = new Map<string, OrgMini>(orgs.map((o) => [o.id, o]))
  const missing: OrgMini = { id: '', name: '(Байгууллага олдсонгүй)', code: null }
  return rows.map((m) => ({
    ...m,
    organization: byId.get(m.organizationId) ?? { ...missing, id: m.organizationId },
  }))
}

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // Нягтлан/захирал: зөвхөн өөрийн алба + өөрийн бүртгэсэн харилцагчдын тоолуурыг харна.
    const scoped = await getScopedOrganizationIds(user)
    if (scoped.length === 0) return NextResponse.json([])
    const where: any = { organizationId: { in: scoped } }

    const rawMeters = await prisma.meter.findMany({
      where,
      select: {
        id: true,
        meterNumber: true,
        organizationId: true,
        year: true,
        serviceStatus: true,
      },
      orderBy: { meterNumber: 'asc' },
    })

    const meters = await attachOrganizationsToMeters(rawMeters)
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

    const requested =
      data.organizationId != null && String(data.organizationId).trim() !== ''
        ? String(data.organizationId).trim()
        : user.organizationId
    if (!requested) {
      return NextResponse.json({ error: 'Байгууллага сонгоно уу' }, { status: 400 })
    }
    const orgId = requested

    const scoped = await getScopedOrganizationIds(user)
    if (!scoped.includes(orgId)) {
      return NextResponse.json({ error: 'Энэ байгууллагад тоолуур бүртгэх эрхгүй' }, { status: 403 })
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
    const rawStatus =
      typeof data.serviceStatus === 'string' ? data.serviceStatus.trim().toUpperCase() : 'NORMAL'
    const serviceStatus =
      rawStatus === 'DAMAGED' || rawStatus === 'REPLACED' ? rawStatus : 'NORMAL'
    const meter = await prisma.meter.create({
      data: {
        meterNumber,
        organizationId: orgId,
        year,
        serviceStatus,
        createdByUserId: user.userId,
        updatedByUserId: user.userId,
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
    if (String(user.role) === Role.ACCOUNTANT || String(user.role) === Role.MANAGER) {
      const scoped = await getScopedOrganizationIds(user)
      if (!scoped.includes(existing.organizationId)) {
        return NextResponse.json({ error: 'Энэ тоолуурыг засах эрхгүй' }, { status: 403 })
      }
      if (data.organizationId != null && String(data.organizationId).trim() !== '') {
        const candidate = String(data.organizationId).trim()
        if (!scoped.includes(candidate)) {
          return NextResponse.json({ error: 'Энэ байгууллагад шилжүүлэх эрхгүй' }, { status: 403 })
        }
        nextOrgId = candidate
      }
    }

    const rawStatus =
      typeof data.serviceStatus === 'string' ? data.serviceStatus.trim().toUpperCase() : undefined
    const serviceStatus =
      rawStatus === 'DAMAGED' || rawStatus === 'REPLACED'
        ? rawStatus
        : rawStatus === 'NORMAL'
          ? 'NORMAL'
          : undefined

    const meter = await prisma.meter.update({
      where: { id: data.id },
      data: {
        meterNumber: data.meterNumber.trim(),
        organizationId: nextOrgId,
        year,
        ...(serviceStatus !== undefined ? { serviceStatus } : {}),
        updatedByUserId: user.userId,
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

    const scoped = await getScopedOrganizationIds(user)
    if (!scoped.includes(meter.organizationId)) {
      return NextResponse.json({ error: 'Энэ тоолуурыг устгах эрхгүй' }, { status: 403 })
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

