import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { Role } from '@/lib/role'
import { prisma } from '@/lib/prisma'
import { normalizeAprilCarrySaveAmount } from '@/lib/carry-forward'
import { ensureOrganizationBillingPeriod } from '@/lib/billing-period'
import {
  computeBillingPaymentStatus,
  computeBillingRemaining,
} from '@/lib/billing-snapshot'
import { withPrismaWriteRetry } from '@/lib/prisma-write-retry'

export const runtime = 'nodejs'


export async function POST(request: NextRequest) {
  try {
    // Billing дээрх нээлтийн үлдэгдэл оруулах: нэвтэрсэн хэн ч оруулж болно.
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER, Role.USER])
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
    // Grid дээр оруулсан «Өмнөх үлдэгдэл» дүнг шууд хадгална.
    const amount = normalizeAprilCarrySaveAmount(amountRaw)

    const bp = await ensureOrganizationBillingPeriod(
      { organizationId, year, month: 4 },
      user.userId
    )
    const totalForCalc = Number(bp.total ?? 0)
    const paidForCalc = Number(bp.paidAmount ?? 0)
    await withPrismaWriteRetry(() =>
      prisma.organizationBillingPeriod.update({
        where: { id: bp.id },
        data: {
          previousRemainingOverride: amount,
          previousRemainingManual: true,
          remaining: computeBillingRemaining(amount, totalForCalc, paidForCalc),
          paymentStatus: computeBillingPaymentStatus(amount, totalForCalc, paidForCalc),
          updatedByUserId: user.userId,
        },
      })
    )

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

    return NextResponse.json({
      success: true,
      openingBalance: saved,
      billingPeriodId: bp.id,
    })
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'Forbidden')) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
