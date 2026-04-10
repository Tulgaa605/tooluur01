import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { getScopedOrganizationIds } from '@/lib/org-scope'

type OrgMini = { id: string; name: string; code: string | null }

function parseWaterChargeSplit(raw: unknown, billingMode: string): string | null {
  const bm = String(billingMode || 'WATER').toUpperCase()
  if (bm !== 'WATER' && bm !== 'WATER_HEAT') return null
  const s = String(raw ?? 'BOTH').trim().toUpperCase()
  if (s === 'CLEAN_ONLY' || s === 'DIRTY_ONLY') return s
  return 'BOTH'
}

async function ensureOfficeOrganizationId(user: { userId: string; organizationId?: string | null; email?: string; name?: string }) {
  if (user.organizationId) return user.organizationId
  const dbUser = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { id: true, email: true, name: true, organizationId: true },
  })
  if (dbUser?.organizationId) return dbUser.organizationId

  // Хуучин staff бүртгэлд organizationId хоосон байж болно. Энэ үед албан байгууллага үүсгээд холбоно.
  const currentYear = new Date().getFullYear()
  const orgName = `${(dbUser?.name ?? user.name ?? 'Accountant').trim()} (${(dbUser?.email ?? user.email ?? user.userId).trim()})`
  const org = await prisma.organization.create({
    data: {
      name: orgName,
      category: 'ORGANIZATION',
      baseCleanFee: 0,
      baseDirtyFee: 0,
      year: currentYear,
      createdByUserId: user.userId,
      updatedByUserId: user.userId,
    },
  })
  await prisma.user.update({
    where: { id: user.userId },
    data: { organizationId: org.id },
  })
  return org.id
}

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
    // staff token дээр organizationId хоосон байвал автоматаар сэргээнэ
    const officeOrgId = await ensureOfficeOrganizationId(user)
    // Нягтлан/захирал: зөвхөн өөрийн алба + өөрийн бүртгэсэн харилцагчдын тоолуурыг харна.
    const scoped = await getScopedOrganizationIds({ ...user, organizationId: officeOrgId })
    if (scoped.length === 0) return NextResponse.json([])
    // Өмнө нь энэ хэрэглэгч өөрөө нэмсэн тоолуур (createdByUserId) байвал scope-оос үл хамааран харуулна.
    // Ингэснээр өмнө нэмсэн боловч байгууллагын managedBy холбоос дутуу үед ч “алгахгүй”.
    const where: any = {
      OR: [
        { organizationId: { in: scoped } },
        { createdByUserId: user.userId },
      ],
    }

    const rawMeters = await prisma.meter.findMany({
      where,
      select: {
        id: true,
        meterNumber: true,
        organizationId: true,
        year: true,
        billingMode: true,
        serviceStatus: true,
        defaultHeatUsage: true,
        waterChargeSplit: true,
        createdByUserId: true,
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
    const officeOrgId = await ensureOfficeOrganizationId(user)
    const data = await request.json()

    const requested =
      data.organizationId != null && String(data.organizationId).trim() !== ''
        ? String(data.organizationId).trim()
        : user.organizationId
    if (!requested) {
      return NextResponse.json({ error: 'Байгууллага сонгоно уу' }, { status: 400 })
    }
    const orgId = requested

    // Scope: өөрийн алба + өөрийн бүртгэсэн харилцагч.
    // Хэрэв байгууллага эзэнгүй (managedByOrganizationId=null) бол тухайн алба анх тоолуур нэмэхэд "өөрийн" болгож бүртгэнэ.
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, managedByOrganizationId: true },
    })
    if (!org) return NextResponse.json({ error: 'Байгууллага олдсонгүй' }, { status: 400 })
    const canUse =
      (officeOrgId && org.id === officeOrgId) ||
      (officeOrgId && org.managedByOrganizationId === officeOrgId)
    if (!canUse) {
      if (officeOrgId && org.managedByOrganizationId == null) {
        await prisma.organization.update({
          where: { id: orgId },
          data: { managedByOrganizationId: officeOrgId },
        })
      } else {
        return NextResponse.json({ error: 'Энэ байгууллагад тоолуур бүртгэх эрхгүй' }, { status: 403 })
      }
    }

    // org existence already checked above

    const rawMeterNumber =
      typeof data.meterNumber === 'string' ? data.meterNumber.trim() : String(data.meterNumber ?? '').trim()
    if (!rawMeterNumber) {
      return NextResponse.json({ error: 'Тоолуурын дугаар заавал оруулна уу' }, { status: 400 })
    }
    const meterNumber = rawMeterNumber

    const currentYear = new Date().getFullYear()
    const year = typeof data.year === 'number' && data.year >= 2000 && data.year <= 2100
      ? data.year
      : currentYear
    const rawStatus =
      typeof data.serviceStatus === 'string' ? data.serviceStatus.trim().toUpperCase() : 'NORMAL'
    const serviceStatus =
      rawStatus === 'DAMAGED' || rawStatus === 'REPLACED' ? rawStatus : 'NORMAL'
    const rawBilling =
      typeof data.billingMode === 'string' ? data.billingMode.trim().toUpperCase() : 'WATER'
    const billingMode =
      rawBilling === 'HEAT' || rawBilling === 'WATER_HEAT' ? rawBilling : 'WATER'

    let defaultHeatUsage: number | null = null
    if (billingMode === 'HEAT' || billingMode === 'WATER_HEAT') {
      const rawH =
        typeof (data as any).defaultHeatUsage === 'number'
          ? (data as any).defaultHeatUsage
          : parseFloat(String((data as any).defaultHeatUsage ?? '').replace(',', '.').trim())
      if (!Number.isFinite(rawH) || rawH <= 0) {
        return NextResponse.json(
          { error: 'Дулаан / Ус+дулаан тоолуурт м³/м² заавал оруулна уу (0-ээс их)' },
          { status: 400 }
        )
      }
      defaultHeatUsage = Math.round(rawH * 100) / 100
    }

    const waterChargeSplit =
      billingMode === 'HEAT' ? null : parseWaterChargeSplit((data as any).waterChargeSplit, billingMode)

    const meter = await prisma.meter.create({
      data: {
        meterNumber,
        organizationId: orgId,
        year,
        billingMode,
        serviceStatus,
        defaultHeatUsage:
          billingMode === 'HEAT' || billingMode === 'WATER_HEAT' ? defaultHeatUsage : null,
        waterChargeSplit,
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
    const officeOrgId = await ensureOfficeOrganizationId(user)
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
      select: {
        organizationId: true,
        billingMode: true,
        defaultHeatUsage: true,
        waterChargeSplit: true,
        createdByUserId: true,
      },
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
      const scoped = await getScopedOrganizationIds({ ...user, organizationId: officeOrgId })
      const createdByMe = existing.createdByUserId != null && String(existing.createdByUserId) === String(user.userId)
      if (!scoped.includes(existing.organizationId) && !createdByMe) {
        return NextResponse.json({ error: 'Энэ тоолуурыг засах эрхгүй' }, { status: 403 })
      }
      if (data.organizationId != null && String(data.organizationId).trim() !== '') {
        const candidate = String(data.organizationId).trim()
        // Шилжүүлэх эрх:
        // - Ерөнхийдөө зөвхөн scope-д байгаа байгууллага руу
        // - Гэхдээ өөрөө нэмсэн тоолуур дээр эзэнгүй (managedBy=null) байгууллагыг автоматаар claim хийж шилжүүлэхийг зөвшөөрнө
        if (!scoped.includes(candidate)) {
          if (!createdByMe) {
            return NextResponse.json({ error: 'Энэ байгууллагад шилжүүлэх эрхгүй' }, { status: 403 })
          }
          const org = await prisma.organization.findUnique({
            where: { id: candidate },
            select: { id: true, managedByOrganizationId: true },
          })
          if (!org) {
            return NextResponse.json({ error: 'Байгууллага олдсонгүй' }, { status: 400 })
          }
          // officeOrgId нь ensureOfficeOrganizationId-аас ирдэг тул хоосон биш байх ёстой
          if (org.managedByOrganizationId == null && officeOrgId) {
            await prisma.organization.update({
              where: { id: candidate },
              data: { managedByOrganizationId: officeOrgId },
            })
          } else if (org.managedByOrganizationId !== officeOrgId) {
            return NextResponse.json({ error: 'Энэ байгууллагад шилжүүлэх эрхгүй' }, { status: 403 })
          }
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

    const rawBilling =
      typeof data.billingMode === 'string' ? data.billingMode.trim().toUpperCase() : undefined
    const billingMode =
      rawBilling === 'HEAT' || rawBilling === 'WATER_HEAT'
        ? rawBilling
        : rawBilling === 'WATER'
          ? 'WATER'
          : undefined

    const nextBilling = String(billingMode ?? existing.billingMode ?? 'WATER').toUpperCase()

    let defaultHeatUsageOut: number | null = null
    if (nextBilling === 'WATER') {
      defaultHeatUsageOut = null
    } else if (nextBilling === 'HEAT' || nextBilling === 'WATER_HEAT') {
      const bodyHas =
        (data as any).defaultHeatUsage !== undefined &&
        String((data as any).defaultHeatUsage).trim() !== ''
      if (bodyHas) {
        const rawH =
          typeof (data as any).defaultHeatUsage === 'number'
            ? (data as any).defaultHeatUsage
            : parseFloat(String((data as any).defaultHeatUsage ?? '').replace(',', '.').trim())
        if (!Number.isFinite(rawH) || rawH <= 0) {
          return NextResponse.json(
            { error: 'м³/м² 0-ээс их утгатай байх ёстой' },
            { status: 400 }
          )
        }
        defaultHeatUsageOut = Math.round(rawH * 100) / 100
      } else {
        const ex = Number(existing.defaultHeatUsage ?? 0)
        if (ex > 0) defaultHeatUsageOut = Math.round(ex * 100) / 100
        else {
          return NextResponse.json(
            { error: 'Дулаан / Ус+дулаан тоолуурт м³/м² заавал оруулна уу' },
            { status: 400 }
          )
        }
      }
    }

    let nextWaterChargeSplit: string | null | undefined = undefined
    if (nextBilling === 'HEAT') {
      nextWaterChargeSplit = null
    } else if ((data as any).waterChargeSplit !== undefined) {
      nextWaterChargeSplit = parseWaterChargeSplit((data as any).waterChargeSplit, nextBilling)
    } else if (
      billingMode !== undefined &&
      String(existing.billingMode ?? '').toUpperCase() === 'HEAT' &&
      (nextBilling === 'WATER' || nextBilling === 'WATER_HEAT')
    ) {
      nextWaterChargeSplit = 'BOTH'
    }

    const meter = await prisma.meter.update({
      where: { id: data.id },
      data: {
        meterNumber: data.meterNumber.trim(),
        organizationId: nextOrgId,
        year,
        ...(serviceStatus !== undefined ? { serviceStatus } : {}),
        ...(billingMode !== undefined ? { billingMode } : {}),
        defaultHeatUsage: defaultHeatUsageOut,
        ...(nextWaterChargeSplit !== undefined ? { waterChargeSplit: nextWaterChargeSplit } : {}),
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
    const officeOrgId = await ensureOfficeOrganizationId(user)
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

    const scoped = await getScopedOrganizationIds({ ...user, organizationId: officeOrgId })
    const createdByMe = meter.createdByUserId != null && String(meter.createdByUserId) === String(user.userId)
    if (!scoped.includes(meter.organizationId) && !createdByMe) {
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

