import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.MANAGER])
    const { searchParams } = new URL(request.url)
    const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()))

    // Monthly data
    const monthlyData = []
    for (let month = 1; month <= 12; month++) {
      const readings = await prisma.meterReading.findMany({
        where: {
          month,
          year,
        },
      })

      const usage = readings.reduce((sum, r) => sum + r.usage, 0)
      const total = readings.reduce((sum, r) => sum + r.total, 0)
      monthlyData.push({
        month: `${year}-${String(month).padStart(2, '0')}`,
        usage,
        total,
      })
    }

    // Organization data
    const orgUsage = await prisma.meterReading.groupBy({
      by: ['organizationId'],
      where: {
        year,
      },
      _sum: {
        usage: true,
        total: true,
      },
    })

    const orgs = await prisma.organization.findMany({
      where: {
        id: {
          in: orgUsage.map((o) => o.organizationId),
        },
      },
    })

    const organizationData = orgUsage
      .map((o) => {
        const org = orgs.find((org) => org.id === o.organizationId)
        return {
          name: org?.name || 'Unknown',
          usage: o._sum.usage || 0,
          total: o._sum.total || 0,
        }
      })
      .sort((a, b) => b.usage - a.usage)

    return NextResponse.json({
      monthlyData,
      organizationData,
    })
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

