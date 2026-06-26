import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { getManagedCustomerOrganizationIds } from '@/lib/org-scope'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const user = getAuthUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!prisma) {
      throw new Error('Prisma client not initialized')
    }

    const now = new Date()
    const currentMonth = now.getMonth() + 1
    const currentYear = now.getFullYear()
    const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1
    const previousYear = currentMonth === 1 ? currentYear - 1 : currentYear

    const emptyDashboard = () =>
      NextResponse.json({
        currentMonthUsage: 0,
        previousMonthUsage: 0,
        usageChange: 0,
        totalUsage: 0,
        monthlyData: [],
        topOrganizations: [],
        organizationData: [],
      })

    const roleStr = String(user.role)
    let whereClause: { organizationId: string | { in: string[] } }
    if (roleStr === Role.USER) {
      if (!user.organizationId) return emptyDashboard()
      whereClause = { organizationId: user.organizationId }
    } else if (roleStr === Role.ACCOUNTANT || roleStr === Role.MANAGER) {
      const customerIds = await getManagedCustomerOrganizationIds(user)
      if (customerIds.length === 0) return emptyDashboard()
      whereClause = { organizationId: { in: customerIds } }
    } else {
      return emptyDashboard()
    }

    const chartMonths: Array<{ year: number; month: number; label: string }> = []
    for (let i = 11; i >= 0; i--) {
      const date = new Date(currentYear, currentMonth - 1 - i, 1)
      const month = date.getMonth() + 1
      const year = date.getFullYear()
      chartMonths.push({
        year,
        month,
        label: `${year}-${String(month).padStart(2, '0')}`,
      })
    }

    const usageByPeriod = await prisma.meterReading.groupBy({
      by: ['year', 'month'],
      where: {
        ...whereClause,
        OR: chartMonths.map(({ year, month }) => ({ year, month })),
      },
      _sum: { usage: true },
    })

    const usageMap = new Map(
      usageByPeriod.map((row) => [
        `${row.year}|${row.month}`,
        Number(row._sum.usage ?? 0) || 0,
      ])
    )

    const currentMonthUsage = usageMap.get(`${currentYear}|${currentMonth}`) ?? 0
    const previousMonthUsage = usageMap.get(`${previousYear}|${previousMonth}`) ?? 0
    const usageChange =
      previousMonthUsage > 0
        ? ((currentMonthUsage - previousMonthUsage) / previousMonthUsage) * 100
        : 0

    let totalUsage = 0
    const monthlyData = chartMonths.map(({ year, month, label }) => {
      const usage = usageMap.get(`${year}|${month}`) ?? 0
      totalUsage += usage
      return { month: label, usage }
    })

    let topOrganizations: Array<{ name: string; usage: number }> = []
    if (user.role === Role.MANAGER) {
      try {
        const orgUsage = await prisma.meterReading.groupBy({
          by: ['organizationId'],
          where: {
            month: currentMonth,
            year: currentYear,
            ...whereClause,
          },
          _sum: { usage: true },
        })

        if (orgUsage.length > 0) {
          const orgs = await prisma.organization.findMany({
            where: { id: { in: orgUsage.map((o) => o.organizationId) } },
            select: { id: true, name: true },
          })

          topOrganizations = orgUsage
            .map((o) => {
              const org = orgs.find((org) => org.id === o.organizationId)
              return {
                name: org?.name || 'Unknown',
                usage: o._sum.usage || 0,
              }
            })
            .sort((a, b) => b.usage - a.usage)
            .slice(0, 10)
        }
      } catch (orgError: unknown) {
        console.error('Error fetching top organizations:', orgError)
        topOrganizations = []
      }
    }

    return NextResponse.json({
      totalUsage,
      currentMonthUsage,
      previousMonthUsage,
      usageChange,
      monthlyData,
      topOrganizations,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    const stack = error instanceof Error ? error.stack : undefined
    console.error('Dashboard API error:', error)
    return NextResponse.json({ error: msg, details: stack }, { status: 500 })
  }
}
