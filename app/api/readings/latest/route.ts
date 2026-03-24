import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { getScopedOrganizationIds } from '@/lib/org-scope'

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER, Role.USER])

    if (!user) {
      throw new Error('Unauthorized')
    }

    const where: any = {}
    const scoped = await getScopedOrganizationIds(user)
    if (scoped.length === 0) {
      return NextResponse.json([])
    }
    where.organizationId = { in: scoped }

    // Pull readings ordered by newest, then pick first per meter in code.
    const readings = await prisma.meterReading.findMany({
      where,
      include: {
        meter: {
          select: {
            id: true,
            meterNumber: true,
            organizationId: true,
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
      orderBy: [
        { year: 'desc' },
        { month: 'desc' },
        { updatedAt: 'desc' },
      ],
    })

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

