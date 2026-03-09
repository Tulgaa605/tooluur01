import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { applyCategoryTariffsToOrganization } from '@/lib/tariff'

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const where: { id?: string } = {}
    if (user.organizationId) {
      where.id = user.organizationId
    }
    const organizations = await prisma.organization.findMany({
      where: Object.keys(where).length ? where : undefined,
      orderBy: { name: 'asc' },
    })

    return NextResponse.json(organizations)
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
    if (user.organizationId) {
      return NextResponse.json(
        { error: 'Зөвхөн нэг байгууллагад хамаарах хэрэглэгч шинэ байгууллага үүсгэх боломжгүй' },
        { status: 403 }
      )
    }

    if (!data.name || data.name.trim() === '') {
      return NextResponse.json(
        { error: 'Байгууллагын нэр оруулна уу' },
        { status: 400 }
      )
    }

    const currentYear = new Date().getFullYear()

    // Customer category (organization type)
    const allowedCategories = [
      'HOUSEHOLD',          // Хувь хүн
      'ORGANIZATION',       // Байгууллага
      'BUSINESS',           // Аж ахуйн нэгж
      'TRANSPORT_DISPOSAL', // Зөөврөөр татан зайлуулах
      'TRANSPORT_RECEPTION',// Зөөврүүд хүлээн авах
      'WATER_POINT',        // Ус түгээх байр
    ] as const
    const category =
      typeof data.category === 'string' && allowedCategories.includes(data.category)
        ? data.category
        : 'HOUSEHOLD'
    const baseCleanFee =
      typeof data.baseCleanFee === 'number'
        ? data.baseCleanFee
        : Number.isFinite(parseFloat(String(data.baseCleanFee)))
          ? parseFloat(String(data.baseCleanFee))
          : 0
    const baseDirtyFee =
      typeof data.baseDirtyFee === 'number'
        ? data.baseDirtyFee
        : Number.isFinite(parseFloat(String(data.baseDirtyFee)))
          ? parseFloat(String(data.baseDirtyFee))
          : 0

    if (baseCleanFee < 0 || baseDirtyFee < 0) {
      return NextResponse.json(
        { error: 'Суурь хураамж сөрөг утгатай байж болохгүй' },
        { status: 400 }
      )
    }

    const organization = await prisma.organization.create({
      data: {
        name: data.name.trim(),
        code: data.code?.trim() || null,
        address: data.address?.trim() || null,
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        connectionNumber: data.connectionNumber?.trim() || null,
        category,
        baseCleanFee,
        baseDirtyFee,
        year: data.year || currentYear,
      },
    })

    // Энэ төрлийн тариф бүртгэлтэй бол байгууллага дээр автоматаар тариф үүсгэнэ
    const tariffsApplied = await applyCategoryTariffsToOrganization(organization.id)

    return NextResponse.json({
      ...organization,
      tariffsApplied,
    })
  } catch (error: any) {
    console.error('Organization creation error:', error)
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    // Handle Prisma unique constraint error
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Энэ нэртэй байгууллага аль хэдийн бүртгэлтэй байна' },
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
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const data = await request.json()

    if (!data.id) {
      return NextResponse.json(
        { error: 'Байгууллагын ID шаардлагатай' },
        { status: 400 }
      )
    }
    if (user.organizationId && data.id !== user.organizationId) {
      return NextResponse.json(
        { error: 'Зөвхөн өөрийн байгууллагыг засах боломжтой' },
        { status: 403 }
      )
    }

    if (!data.name || data.name.trim() === '') {
      return NextResponse.json(
        { error: 'Байгууллагын нэр оруулна уу' },
        { status: 400 }
      )
    }

    const currentYear = new Date().getFullYear()

    const allowedCategories = [
      'HOUSEHOLD',
      'ORGANIZATION',
      'BUSINESS',
      'TRANSPORT_DISPOSAL',
      'TRANSPORT_RECEPTION',
      'WATER_POINT',
    ] as const
    const categoryValue =
      typeof data.category === 'string' && allowedCategories.includes(data.category)
        ? data.category
        : undefined
    const baseCleanFeeRaw =
      typeof data.baseCleanFee === 'number'
        ? data.baseCleanFee
        : data.baseCleanFee != null && data.baseCleanFee !== ''
          ? parseFloat(String(data.baseCleanFee))
          : undefined
    const baseDirtyFeeRaw =
      typeof data.baseDirtyFee === 'number'
        ? data.baseDirtyFee
        : data.baseDirtyFee != null && data.baseDirtyFee !== ''
          ? parseFloat(String(data.baseDirtyFee))
          : undefined

    if (
      (typeof baseCleanFeeRaw === 'number' && !Number.isFinite(baseCleanFeeRaw)) ||
      (typeof baseDirtyFeeRaw === 'number' && !Number.isFinite(baseDirtyFeeRaw))
    ) {
      return NextResponse.json(
        { error: 'Суурь хураамж тоон утга байх ёстой' },
        { status: 400 }
      )
    }

    if (
      (typeof baseCleanFeeRaw === 'number' && baseCleanFeeRaw < 0) ||
      (typeof baseDirtyFeeRaw === 'number' && baseDirtyFeeRaw < 0)
    ) {
      return NextResponse.json(
        { error: 'Суурь хураамж сөрөг утгатай байж болохгүй' },
        { status: 400 }
      )
    }

    const organization = await prisma.organization.update({
      where: { id: data.id },
      data: {
        name: data.name.trim(),
        code: data.code?.trim() || null,
        address: data.address?.trim() || null,
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        connectionNumber: data.connectionNumber?.trim() || null,
        ...(categoryValue ? { category: categoryValue } : {}),
        ...(typeof baseCleanFeeRaw === 'number' ? { baseCleanFee: baseCleanFeeRaw } : {}),
        ...(typeof baseDirtyFeeRaw === 'number' ? { baseDirtyFee: baseDirtyFeeRaw } : {}),
        year: data.year || currentYear,
      },
    })

    return NextResponse.json(organization)
  } catch (error: any) {
    console.error('Organization update error:', error)
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Энэ нэртэй байгууллага аль хэдийн бүртгэлтэй байна' },
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
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Байгууллагын ID шаардлагатай' },
        { status: 400 }
      )
    }
    if (user.organizationId && id !== user.organizationId) {
      return NextResponse.json(
        { error: 'Зөвхөн өөрийн байгууллагыг устгах боломжтой' },
        { status: 403 }
      )
    }

    // Check if organization has related data
    const org = await prisma.organization.findUnique({
      where: { id },
      include: {
        users: { take: 1 },
        meters: { take: 1 },
        readings: { take: 1 },
      },
    })

    if (!org) {
      return NextResponse.json(
        { error: 'Байгууллага олдсонгүй' },
        { status: 404 }
      )
    }

    if (org.users.length > 0 || org.meters.length > 0 || org.readings.length > 0) {
      return NextResponse.json(
        { error: 'Энэ байгууллагатай холбоотой хэрэглэгч, тоолуур эсвэл заалт байна. Эхлээд тэдгээрийг устгана уу' },
        { status: 400 }
      )
    }

    await prisma.organization.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Organization deletion error:', error)
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа' },
      { status: 500 }
    )
  }
}
