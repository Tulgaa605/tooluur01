import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const user = getAuthUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if Prisma client is properly initialized
    if (!prisma) {
      throw new Error('Prisma client not initialized')
    }

    const now = new Date()
    const currentMonth = now.getMonth() + 1
    const currentYear = now.getFullYear()
    const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1
    const previousYear = currentMonth === 1 ? currentYear - 1 : currentYear

    let whereClause: any = {}
    if (user.role === Role.USER && user.organizationId) {
      whereClause.organizationId = user.organizationId
    } else if ((user.role === Role.ACCOUNTANT || user.role === Role.MANAGER) && user.organizationId) {
      whereClause.organizationId = user.organizationId
    }

    // Get current month usage
    const currentMonthReadings = await prisma.meterReading.findMany({
      where: {
        ...whereClause,
        month: currentMonth,
        year: currentYear,
      },
    })

    // Get previous month usage
    const previousMonthReadings = await prisma.meterReading.findMany({
      where: {
        ...whereClause,
        month: previousMonth,
        year: previousYear,
      },
    })

    const currentMonthUsage = currentMonthReadings.reduce(
      (sum, r) => sum + r.usage,
      0
    )
    const previousMonthUsage = previousMonthReadings.reduce(
      (sum, r) => sum + r.usage,
      0
    )

    const usageChange =
      previousMonthUsage > 0
        ? ((currentMonthUsage - previousMonthUsage) / previousMonthUsage) * 100
        : 0

    // Get all readings for total
    const allReadings = await prisma.meterReading.findMany({
      where: whereClause,
    })
    const totalUsage = allReadings.reduce((sum, r) => sum + r.usage, 0)

    // Monthly data for chart (last 12 months)
    const monthlyData = []
    for (let i = 11; i >= 0; i--) {
      const date = new Date(currentYear, currentMonth - 1 - i, 1)
      const month = date.getMonth() + 1
      const year = date.getFullYear()
      const monthName = `${year}-${String(month).padStart(2, '0')}`

      const monthReadings = await prisma.meterReading.findMany({
        where: {
          ...whereClause,
          month,
          year,
        },
      })

      const usage = monthReadings.reduce((sum, r) => sum + r.usage, 0)
      monthlyData.push({ month: monthName, usage })
    }

    let topOrganizations: Array<{ name: string; usage: number }> = []
    if (user.role === Role.MANAGER) {
      try {
        const topWhere: any = {
          month: currentMonth,
          year: currentYear,
        }
        if (user.organizationId) topWhere.organizationId = user.organizationId
        const orgUsage = await prisma.meterReading.groupBy({
          by: ['organizationId'],
          where: topWhere,
          _sum: {
            usage: true,
          },
        })

        if (orgUsage.length > 0) {
          const orgs = await prisma.organization.findMany({
            where: {
              id: {
                in: orgUsage.map((o) => o.organizationId),
              },
            },
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
      } catch (orgError: any) {
        console.error('Error fetching top organizations:', orgError)
        // Continue without top organizations if there's an error
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
  } catch (error: any) {
    console.error('Dashboard API error:', error)
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа', details: error.stack },
      { status: 500 }
    )
  }
}

