import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { getScopedOrganizationIds } from '@/lib/org-scope'
import { attachOrgsAndMetersToReadings } from '@/lib/attach-reading-relations'

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

    if (!user) {
      throw new Error('Unauthorized')
    }
    const officeOrgId = await ensureOfficeOrganizationId(user)

    const where: any = {}
    const roleStr = String(user.role)
    if (roleStr === Role.USER) {
      if (!user.organizationId) return NextResponse.json([])
      where.organizationId = user.organizationId
    } else if (roleStr === Role.ACCOUNTANT || roleStr === Role.MANAGER) {
      const scoped = await getScopedOrganizationIds({ ...user, organizationId: officeOrgId ?? user.organizationId })
      if (scoped.length === 0) return NextResponse.json([])
      where.organizationId = { in: scoped }
    } else {
      return NextResponse.json([])
    }

    // Pull readings ordered by newest, then pick first per meter in code.
    const rawReadings = await prisma.meterReading.findMany({
      where,
      orderBy: [
        { year: 'desc' },
        { month: 'desc' },
        { updatedAt: 'desc' },
      ],
    })
    const readings = await attachOrgsAndMetersToReadings(rawReadings)

    const latestByMeter = new Map<string, any>()
    for (const r of readings) {
      const meterId = r.meterId
      if (!meterId) continue
      if (!latestByMeter.has(meterId)) {
        latestByMeter.set(meterId, r)
      }
    }

    return NextResponse.json(Array.from(latestByMeter.values()))
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

