import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { organizationIdInScope } from '@/lib/org-scope'

async function ensureOfficeOrganizationId(user: { userId: string; organizationId?: string | null; email?: string; name?: string }) {
  if (user.organizationId) return user.organizationId
  const dbUser = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { id: true, email: true, name: true, organizationId: true, role: true },
  })
  if (dbUser?.organizationId) return dbUser.organizationId
  const roleStr = String(dbUser?.role ?? '')
  if (roleStr !== Role.ACCOUNTANT && roleStr !== Role.MANAGER) return null
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

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER, Role.USER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const officeOrgId = await ensureOfficeOrganizationId(user)
    const { searchParams } = new URL(request.url)
    const meterId = searchParams.get('meterId')
    const month = parseInt(searchParams.get('month') || '1')
    const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10)

    if (!meterId) {
      return NextResponse.json({ error: 'Тоолуурын ID шаардлагатай' }, { status: 400 })
    }
    if (
      String(user.role) === Role.USER ||
      String(user.role) === Role.ACCOUNTANT ||
      String(user.role) === Role.MANAGER
    ) {
      const meter = await prisma.meter.findUnique({
        where: { id: meterId },
        select: { organizationId: true },
      })
      if (!meter) return NextResponse.json({ error: 'Эрх байхгүй' }, { status: 403 })
      // /api/readings POST-той ижил: office + managedBy дээр л зөвшөөрнө (эзэнгүйг claim хийнэ)
      const office = officeOrgId ?? user.organizationId
      if (!office) return NextResponse.json({ error: 'Эрх байхгүй' }, { status: 403 })
      if (meter.organizationId !== office) {
        const org = await prisma.organization.findUnique({
          where: { id: meter.organizationId },
          select: { id: true, managedByOrganizationId: true },
        })
        if (!org) return NextResponse.json({ error: 'Эрх байхгүй' }, { status: 403 })
        if (org.managedByOrganizationId == null) {
          await prisma.organization.update({
            where: { id: org.id },
            data: { managedByOrganizationId: office },
          })
        } else if (org.managedByOrganizationId !== office) {
          return NextResponse.json({ error: 'Эрх байхгүй' }, { status: 403 })
        }
      }
    }

    // Өгөгдсөн (year,month)-оос өмнөх хамгийн сүүлийн заалтыг олно.
    // (өмнөх сар заавал байх албагүй — сар алгассан тохиолдлыг дэмжинэ)
    const previousReading = await prisma.meterReading.findFirst({
      where: {
        meterId,
        OR: [
          { year: { lt: year } },
          { year, month: { lt: month } },
        ],
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    })

    if (previousReading) {
      return NextResponse.json({ endValue: previousReading.endValue })
    }

    // If no previous reading, check if this is the first reading
    const anyReading = await prisma.meterReading.findFirst({
      where: { meterId },
      orderBy: [
        { year: 'asc' },
        { month: 'asc' },
      ],
    })

    if (!anyReading) {
      // This is the first reading, return 0 or allow manual entry
      return NextResponse.json({ endValue: null, isFirst: true })
    }

    return NextResponse.json({ endValue: null })
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

