import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { Role } from '@/lib/role'
import { prisma } from '@/lib/prisma'
import { organizationIdInScope } from '@/lib/org-scope'

export const runtime = 'nodejs'

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Жилийн нээлтийн үлдэгдэл (4-р сараас үйлчилнэ).
 * Body: { organizationId: string, year: number, amount: number }
 * Upsert: (organizationId, year) → amount.
 */
export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const data = await request.json()
    const organizationId = String(data?.organizationId ?? '').trim()
    if (!/^[a-f\d]{24}$/i.test(organizationId)) {
      return NextResponse.json({ error: 'organizationId буруу' }, { status: 400 })
    }
    const year = Number.parseInt(String(data?.year ?? ''), 10)
    if (!Number.isInteger(year) || year < 2000 || year > 9999) {
      return NextResponse.json({ error: 'year буруу' }, { status: 400 })
    }
    const amountRaw = Number(data?.amount ?? 0)
    if (!Number.isFinite(amountRaw)) {
      return NextResponse.json({ error: 'amount буруу' }, { status: 400 })
    }
    const amount = roundMoney(Math.max(0, amountRaw))

    if (!(await organizationIdInScope(user, organizationId))) {
      return NextResponse.json({ error: 'Эрхгүй' }, { status: 403 })
    }

    const saved = await prisma.organizationOpeningBalance.upsert({
      where: { organizationId_year: { organizationId, year } },
      create: {
        organizationId,
        year,
        amount,
        createdByUserId: user.userId,
        updatedByUserId: user.userId,
      },
      update: {
        amount,
        updatedByUserId: user.userId,
      },
      select: { id: true, organizationId: true, year: true, amount: true },
    })

    return NextResponse.json({ success: true, openingBalance: saved })
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'Forbidden')) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
