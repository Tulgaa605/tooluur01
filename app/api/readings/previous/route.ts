import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const meterId = searchParams.get('meterId')
    const month = parseInt(searchParams.get('month') || '1')
    const year = parseInt(searchParams.get('year') || '2026')

    if (!meterId) {
      return NextResponse.json({ error: 'Тоолуурын ID шаардлагатай' }, { status: 400 })
    }
    if (user.organizationId) {
      const meter = await prisma.meter.findUnique({
        where: { id: meterId },
        select: { organizationId: true },
      })
      if (!meter || meter.organizationId !== user.organizationId) {
        return NextResponse.json({ error: 'Эрх байхгүй' }, { status: 403 })
      }
    }

    // Calculate previous month
    let prevMonth = month - 1
    let prevYear = year
    if (prevMonth === 0) {
      prevMonth = 12
      prevYear = year - 1
    }

    // Find previous month's reading
    const previousReading = await prisma.meterReading.findUnique({
      where: {
        meterId_month_year: {
          meterId,
          month: prevMonth,
          year: prevYear,
        },
      },
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

