import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { getScopedOrganizationIds } from '@/lib/org-scope'

type OrgMini = { id: string; name: string; code: string | null }

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

    // UI дээр хоосон орхивол 1-с эхэлсэн дарааллын дараагийн дугаарыг автоматаар олгоно.
    const nextSequentialMeterNumber = async (): Promise<string> => {
      // Тоолуурууд хуудсан дээр (GET) харагддаг scope-оос хамгийн их тоон дугаарыг олно.
      const scoped = await getScopedOrganizationIds({ ...user, organizationId: officeOrgId })
      const where: any =
        scoped.length === 0
          ? { createdByUserId: user.userId }
          : {
              OR: [
                { organizationId: { in: scoped } },
                { createdByUserId: user.userId },
              ],
            }
      const meters = await prisma.meter.findMany({
        where,
        select: { meterNumber: true },
        take: 20000,
      })
      let maxN = 0
      for (const m of meters) {
        const s = String(m.meterNumber ?? '').trim()
        if (!/^[0-9]+$/.test(s)) continue
        const n = Number(s)
        if (Number.isFinite(n) && n > maxN) maxN = n
      }
      return String(maxN + 1)
    }

    const meterNumber = rawMeterNumber || (await nextSequentialMeterNumber())

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
    // Давхардсан тохиолдолд (P2002) дараагийн дугаараар retry хийнэ (автоматаар олгосон үед).
    let meter = null as any
    const shouldAutoAssign = !rawMeterNumber
    for (let attempt = 0; attempt < (shouldAutoAssign ? 25 : 1); attempt++) {
      const candidate = attempt === 0 ? meterNumber : String(Number(meterNumber) + attempt)
      try {
        meter = await prisma.meter.create({
          data: {
            meterNumber: candidate,
            organizationId: orgId,
            year,
            billingMode,
            serviceStatus,
            createdByUserId: user.userId,
            updatedByUserId: user.userId,
          },
        })
        break
      } catch (e: any) {
        if (e?.code === 'P2002' && shouldAutoAssign) continue
        throw e
      }
    }
    if (!meter) {
      return NextResponse.json({ error: 'Тоолуурын дугаар олгоход алдаа гарлаа' }, { status: 500 })
    }

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
      const scoped = await getScopedOrganizationIds({ ...user, organizationId: officeOrgId })
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

    const rawBilling =
      typeof data.billingMode === 'string' ? data.billingMode.trim().toUpperCase() : undefined
    const billingMode =
      rawBilling === 'HEAT' || rawBilling === 'WATER_HEAT'
        ? rawBilling
        : rawBilling === 'WATER'
          ? 'WATER'
          : undefined

    const meter = await prisma.meter.update({
      where: { id: data.id },
      data: {
        meterNumber: data.meterNumber.trim(),
        organizationId: nextOrgId,
        year,
        ...(serviceStatus !== undefined ? { serviceStatus } : {}),
        ...(billingMode !== undefined ? { billingMode } : {}),
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

