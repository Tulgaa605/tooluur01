import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'

function parseNumberOrDefault(value: any, defaultValue: number) {
  if (typeof value === 'number') return value
  if (value == null || value === '') return defaultValue
  const n = parseFloat(String(value))
  return Number.isFinite(n) ? n : defaultValue
}

function validateMonthYear(month: number, year: number) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 'Сар 1-12 хооронд бүхэл тоо байх ёстой'
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return 'Он зөв утгатай байх ёстой'
  return null
}

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')
    const year = searchParams.get('year') ? parseInt(searchParams.get('year') as string, 10) : undefined

    const where: any = {}
    if (organizationId) where.organizationId = organizationId
    if (year) where.year = year

    const tariffs = await prisma.organizationTariff.findMany({
      where,
      include: {
        organization: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { updatedAt: 'desc' }],
    })

    return NextResponse.json(tariffs)
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

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const data = await request.json()

    const organizationId = data.organizationId as string
    const month = parseInt(String(data.month), 10)
    const year = parseInt(String(data.year), 10)
    const validationError = validateMonthYear(month, year)
    if (!organizationId) {
      return NextResponse.json({ error: 'Байгууллага шаардлагатай' }, { status: 400 })
    }
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const baseCleanFee = parseNumberOrDefault(data.baseCleanFee, 0)
    const baseDirtyFee = parseNumberOrDefault(data.baseDirtyFee, 0)
    const cleanPerM3 = parseNumberOrDefault(data.cleanPerM3, 0)
    const dirtyPerM3 = parseNumberOrDefault(data.dirtyPerM3, 0)

    if (baseCleanFee < 0 || baseDirtyFee < 0 || cleanPerM3 < 0 || dirtyPerM3 < 0) {
      return NextResponse.json(
        { error: 'Тарифын утгууд сөрөг байж болохгүй' },
        { status: 400 }
      )
    }

    const tariff = await prisma.organizationTariff.create({
      data: {
        organizationId,
        month,
        year,
        baseCleanFee,
        baseDirtyFee,
        cleanPerM3,
        dirtyPerM3,
      },
      include: {
        organization: { select: { id: true, name: true, code: true } },
      },
    })

    return NextResponse.json(tariff)
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Энэ байгууллага дээр энэ сарын тариф аль хэдийн бүртгэлтэй байна' },
        { status: 400 }
      )
    }
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
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const data = await request.json()
    if (!data.id) {
      return NextResponse.json({ error: 'Tariff ID шаардлагатай' }, { status: 400 })
    }

    const patch: any = {}
    if (data.baseCleanFee !== undefined) patch.baseCleanFee = parseNumberOrDefault(data.baseCleanFee, 0)
    if (data.baseDirtyFee !== undefined) patch.baseDirtyFee = parseNumberOrDefault(data.baseDirtyFee, 0)
    if (data.cleanPerM3 !== undefined) patch.cleanPerM3 = parseNumberOrDefault(data.cleanPerM3, 0)
    if (data.dirtyPerM3 !== undefined) patch.dirtyPerM3 = parseNumberOrDefault(data.dirtyPerM3, 0)

    const negatives = ['baseCleanFee', 'baseDirtyFee', 'cleanPerM3', 'dirtyPerM3'].some(
      (k) => typeof patch[k] === 'number' && patch[k] < 0
    )
    if (negatives) {
      return NextResponse.json(
        { error: 'Тарифын утгууд сөрөг байж болохгүй' },
        { status: 400 }
      )
    }

    const updated = await prisma.organizationTariff.update({
      where: { id: data.id },
      data: patch,
      include: {
        organization: { select: { id: true, name: true, code: true } },
      },
    })

    return NextResponse.json(updated)
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

export async function DELETE(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Tariff ID шаардлагатай' }, { status: 400 })

    await prisma.organizationTariff.delete({ where: { id } })
    return NextResponse.json({ success: true })
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

