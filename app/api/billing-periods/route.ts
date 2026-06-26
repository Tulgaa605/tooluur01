import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { Role } from '@/lib/role'
import { prisma } from '@/lib/prisma'
import { roundMoney, normalizeAprilCarrySaveAmount } from '@/lib/carry-forward'
import { ensureOrganizationBillingPeriod, billingPeriodDbSetupHint } from '@/lib/billing-period'
import {
  computeBillingPaymentStatus,
  computeBillingRemaining,
} from '@/lib/billing-snapshot'
import { withPrismaWriteRetry } from '@/lib/prisma-write-retry'

export const runtime = 'nodejs'

/**
 * Төлбөрийн хуудасны мөр засах (тогтвортой billing period ID-аар).
 * Body: { billingPeriodId, previousRemaining?, paidAmount? }
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER, Role.USER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const data = await request.json()
    const billingPeriodId = String(data?.billingPeriodId ?? '').trim()
    if (!/^[a-f\d]{24}$/i.test(billingPeriodId)) {
      return NextResponse.json({ error: 'billingPeriodId буруу' }, { status: 400 })
    }

    const existing = await prisma.organizationBillingPeriod.findUnique({
      where: { id: billingPeriodId },
      select: {
        id: true,
        organizationId: true,
        year: true,
        month: true,
        total: true,
        previousRemainingOverride: true,
        paidAmount: true,
      },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Төлбөрийн мөр олдсонгүй' }, { status: 404 })
    }

    const update: {
      previousRemainingOverride?: number | null
      previousRemainingManual?: boolean
      paidAmount?: number
      remaining?: number
      paymentStatus?: string
      updatedByUserId: string
    } = { updatedByUserId: user.userId }

    if (data?.previousRemaining !== undefined && data?.previousRemaining !== null) {
      if (existing.month !== 4) {
        return NextResponse.json(
          { error: 'Өмнөх үлдэгдлийг зөвхөн 4-р сард засна' },
          { status: 400 }
        )
      }
      if (!Number.isFinite(Number(data.previousRemaining))) {
        return NextResponse.json({ error: 'previousRemaining буруу' }, { status: 400 })
      }
      update.previousRemainingOverride = normalizeAprilCarrySaveAmount(
        Number(data.previousRemaining)
      )
      update.previousRemainingManual = true
    }

    if (data?.paidAmount !== undefined && data?.paidAmount !== null) {
      const paid = roundMoney(Math.max(0, Number(data.paidAmount) || 0))
      if (!Number.isFinite(paid)) {
        return NextResponse.json({ error: 'paidAmount буруу' }, { status: 400 })
      }
      update.paidAmount = paid
    }

    const prevForCalc =
      update.previousRemainingOverride !== undefined
        ? Number(update.previousRemainingOverride ?? 0)
        : Number(existing.previousRemainingOverride ?? 0)
    const totalForCalc = Number(existing.total ?? 0)
    const paidForCalc =
      update.paidAmount !== undefined ? update.paidAmount : Number(existing.paidAmount ?? 0)
    update.remaining = computeBillingRemaining(prevForCalc, totalForCalc, paidForCalc)
    update.paymentStatus = computeBillingPaymentStatus(prevForCalc, totalForCalc, paidForCalc)

    const saved = await withPrismaWriteRetry(() =>
      prisma.organizationBillingPeriod.update({
        where: { id: billingPeriodId },
        data: update,
        select: {
          id: true,
          organizationId: true,
          year: true,
          month: true,
          previousRemainingOverride: true,
          previousRemainingManual: true,
          paidAmount: true,
          usage: true,
          total: true,
          remaining: true,
          paymentStatus: true,
          meterNumbers: true,
          ebarimtStatus: true,
          ebarimtBillId: true,
          organizationName: true,
          customerPhones: true,
        },
      })
    )

    // 4-р сарын өмнөх үлдэгдэл — хуучин opening balance-тай нийцүүлнэ.
    if (
      saved.month === 4 &&
      saved.previousRemainingOverride != null &&
      data?.previousRemaining !== undefined
    ) {
      const amount = saved.previousRemainingOverride
      await prisma.organizationOpeningBalance.upsert({
        where: {
          organizationId_year: {
            organizationId: saved.organizationId,
            year: saved.year,
          },
        },
        create: {
          organizationId: saved.organizationId,
          year: saved.year,
          amount,
          createdByUserId: user.userId,
          updatedByUserId: user.userId,
        },
        update: {
          amount,
          updatedByUserId: user.userId,
        },
      })
    }

    return NextResponse.json({ success: true, billingPeriod: saved })
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'Forbidden')) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    const hint = billingPeriodDbSetupHint(error)
    return NextResponse.json({ error: hint ?? msg }, { status: hint ? 503 : 500 })
  }
}

/** billingPeriodId байхгүй үед org+year+month-аар үүсгэнэ. */
export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER, Role.USER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const data = await request.json()
    const organizationId = String(data?.organizationId ?? '').trim()
    const year = Number.parseInt(String(data?.year ?? ''), 10)
    const month = Number.parseInt(String(data?.month ?? ''), 10)
    if (!/^[a-f\d]{24}$/i.test(organizationId)) {
      return NextResponse.json({ error: 'organizationId буруу' }, { status: 400 })
    }
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'year/month буруу' }, { status: 400 })
    }

    const row = await ensureOrganizationBillingPeriod(
      { organizationId, year, month },
      user.userId
    )
    return NextResponse.json({ success: true, billingPeriod: row })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    const hint = billingPeriodDbSetupHint(error)
    return NextResponse.json({ error: hint ?? msg }, { status: hint ? 503 : 500 })
  }
}
