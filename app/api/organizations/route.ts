import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { generateToken } from '@/lib/auth'
import { applyCategoryTariffsToOrganization } from '@/lib/tariff'
import { getScopedOrganizationIds } from '@/lib/org-scope'

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER, Role.USER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const categoryFilter = searchParams.get('category')
    const customersOnly = searchParams.get('customersOnly') === '1'

    // Нягтлан/захирал: өөрийн албан байгууллага + түүний бүртгэсэн харилцагчид л.
    // Энгийн хэрэглэгч (USER): зөвхөн өөрийн нэг байгууллага.
    const isStaff =
      user.role === Role.ACCOUNTANT || user.role === Role.MANAGER
    const where: {
      id?: { in: string[] }
      category?: string
      managedByOrganizationId?: string
    } = {}
    if (!isStaff) {
      if (!user.organizationId) return NextResponse.json([])
      where.id = { in: [user.organizationId] }
    } else if (customersOnly && user.organizationId) {
      // Заалт оруулах модал зэрэг: зөвхөн бүртгэсэн харилцагч (албан өөрийг оруулахгүй)
      where.managedByOrganizationId = user.organizationId
    } else {
      const scoped = await getScopedOrganizationIds(user)
      if (scoped.length === 0) return NextResponse.json([])
      where.id = { in: scoped }
    }
    if (categoryFilter === 'HOUSEHOLD') {
      where.category = 'HOUSEHOLD'
      // Нягтлан/захирал: зөвхөн энэ албаас бүртгэсэн харилцагч (хувь хүн). Өөрийн албан нэр HOUSEHOLD байсан ч энд бүү ор.
      if (isStaff && user.organizationId) {
        where.managedByOrganizationId = user.organizationId
        // `where.id` дээр getScopedOrganizationIds (raw scope) ашиглаж байж болзошгүй буруу id орохыг арилгахын тулд
        // зөвхөн `managedByOrganizationId`-ээр шүүж үзүүлнэ.
        delete (where as any).id
      }
    }
    const organizations = await prisma.organization.findMany({
      where,
      orderBy: categoryFilter === 'HOUSEHOLD' ? { createdAt: 'desc' } : { name: 'asc' },
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
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER, Role.USER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const data = await request.json()

    if (!data.name || data.name.trim() === '') {
      return NextResponse.json(
        { error: 'Байгууллагын нэр оруулна уу' },
        { status: 400 }
      )
    }

    const currentYear = new Date().getFullYear()

    // Customer category (organization type)
    const allowedCategories = [
      'ORGANIZATION',       // Байгууллага
      'BUSINESS',          // Аж ахуйн нэгж
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

    const tagManagedByOffice =
      (user.role === Role.ACCOUNTANT || user.role === Role.MANAGER) &&
      user.organizationId != null

    const organization = await prisma.organization.create({
      data: {
        name: data.name.trim(),
        ...(data.ovog !== undefined && { ovog: data.ovog?.trim() || null }),
        code: data.code?.trim() || null,
        address: data.address?.trim() || null,
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        connectionNumber: data.connectionNumber?.trim() || null,
        category,
        baseCleanFee,
        baseDirtyFee,
        year: data.year || currentYear,
        ...(tagManagedByOffice ? { managedByOrganizationId: user.organizationId } : {}),
        createdByUserId: user.userId,
        updatedByUserId: user.userId,
      },
    })

    let newToken: string | undefined
    if (user.organizationId == null) {
      await prisma.user.update({
        where: { id: user.userId },
        data: { organizationId: organization.id },
      })
      newToken = generateToken({
        userId: user.userId,
        email: user.email,
        role: user.role as Role,
        organizationId: organization.id,
      })
    }

    // Энэ төрлийн тариф бүртгэлтэй бол байгууллага дээр автоматаар тариф үүсгэнэ
    const tariffsApplied = await applyCategoryTariffsToOrganization(organization.id)

    const response = NextResponse.json({
      ...organization,
      tariffsApplied,
      ...(newToken && { token: newToken }),
    })
    if (newToken) {
      response.cookies.set('token', newToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
      })
    }
    return response
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
    const existingOrg = await prisma.organization.findUnique({
      where: { id: data.id },
      select: { id: true, managedByOrganizationId: true },
    })
    if (!existingOrg) {
      return NextResponse.json({ error: 'Байгууллага олдсонгүй' }, { status: 404 })
    }
    const canEdit =
      existingOrg.id === user.organizationId ||
      existingOrg.managedByOrganizationId === user.organizationId
    if (!canEdit) {
      return NextResponse.json(
        { error: 'Зөвхөн өөрийн эсвэл өөрийн бүртгэсэн байгууллагыг засах боломжтой' },
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
        ...(data.ovog !== undefined ? { ovog: data.ovog?.trim() || null } : {}),
        code: data.code?.trim() || null,
        address: data.address?.trim() || null,
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        connectionNumber: data.connectionNumber?.trim() || null,
        ...(categoryValue ? { category: categoryValue } : {}),
        ...(typeof baseCleanFeeRaw === 'number' ? { baseCleanFee: baseCleanFeeRaw } : {}),
        ...(typeof baseDirtyFeeRaw === 'number' ? { baseDirtyFee: baseDirtyFeeRaw } : {}),
        year: data.year || currentYear,
        updatedByUserId: user.userId,
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

    const canDelete =
      id === user.organizationId ||
      org.managedByOrganizationId === user.organizationId
    if (!canDelete) {
      return NextResponse.json(
        { error: 'Зөвхөн өөрийн эсвэл өөрийн бүртгэсэн байгууллагыг устгах боломжтой' },
        { status: 403 }
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
