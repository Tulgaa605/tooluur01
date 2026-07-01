import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { getManagedCustomerOrganizationIds } from '@/lib/org-scope'

export const dynamic = 'force-dynamic'

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

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
        currentMonthHeat: 0,
        previousMonthUsage: 0,
        usageChange: 0,
        totalUsage: 0,
        totalHeat: 0,
        currentMonthTotal: 0,
        currentMonthPaid: 0,
        currentMonthRemaining: 0,
        paymentRate: 0,
        totalBilled: 0,
        totalPaid: 0,
        monthlyWater: [],
        monthlyHeat: [],
        monthlyBilled: [],
        monthlyPaid: [],
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

    const periodAgg = await prisma.meterReading.groupBy({
      by: ['year', 'month'],
      where: {
        ...whereClause,
        OR: chartMonths.map(({ year, month }) => ({ year, month })),
      },
      _sum: {
        usage: true,
        heatUsage: true,
        total: true,
        paidAmount: true,
      },
    })

    const periodMap = new Map(
      periodAgg.map((row) => {
        const usage = Number(row._sum.usage ?? 0) || 0
        const heat = Number(row._sum.heatUsage ?? 0) || 0
        const total = roundMoney(Number(row._sum.total ?? 0) || 0)
        const paid = roundMoney(Number(row._sum.paidAmount ?? 0) || 0)
        return [`${row.year}|${row.month}`, { usage, heat, total, paid }]
      })
    )

    const currentPeriod = periodMap.get(`${currentYear}|${currentMonth}`) ?? {
      usage: 0,
      heat: 0,
      total: 0,
      paid: 0,
    }
    const previousPeriod = periodMap.get(`${previousYear}|${previousMonth}`) ?? {
      usage: 0,
      heat: 0,
      total: 0,
      paid: 0,
    }

    const currentMonthUsage = currentPeriod.usage
    const currentMonthHeat = currentPeriod.heat
    const previousMonthUsage = previousPeriod.usage
    const usageChange =
      previousMonthUsage > 0
        ? ((currentMonthUsage - previousMonthUsage) / previousMonthUsage) * 100
        : 0

    const currentMonthTotal = currentPeriod.total
    const currentMonthPaid = currentPeriod.paid
    const currentMonthRemaining = Math.max(0, roundMoney(currentMonthTotal - currentMonthPaid))
    const paymentRate =
      currentMonthTotal > 0 ? (currentMonthPaid / currentMonthTotal) * 100 : 0

    let totalUsage = 0
    let totalHeat = 0
    let totalBilled = 0
    let totalPaid = 0

    const monthlyWater: Array<{ month: string; value: number }> = []
    const monthlyHeat: Array<{ month: string; value: number }> = []
    const monthlyBilled: Array<{ month: string; value: number }> = []
    const monthlyPaid: Array<{ month: string; value: number }> = []

    for (const { year, month, label } of chartMonths) {
      const row = periodMap.get(`${year}|${month}`) ?? { usage: 0, heat: 0, total: 0, paid: 0 }
      totalUsage += row.usage
      totalHeat += row.heat
      totalBilled = roundMoney(totalBilled + row.total)
      totalPaid = roundMoney(totalPaid + row.paid)
      monthlyWater.push({ month: label, value: row.usage })
      monthlyHeat.push({ month: label, value: row.heat })
      monthlyBilled.push({ month: label, value: row.total })
      monthlyPaid.push({ month: label, value: row.paid })
    }

    return NextResponse.json({
      totalUsage,
      totalHeat,
      currentMonthUsage,
      currentMonthHeat,
      previousMonthUsage,
      usageChange,
      currentMonthTotal,
      currentMonthPaid,
      currentMonthRemaining,
      paymentRate,
      totalBilled,
      totalPaid,
      monthlyWater,
      monthlyHeat,
      monthlyBilled,
      monthlyPaid,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    const stack = error instanceof Error ? error.stack : undefined
    console.error('Dashboard API error:', error)
    return NextResponse.json({ error: msg, details: stack }, { status: 500 })
  }
}
