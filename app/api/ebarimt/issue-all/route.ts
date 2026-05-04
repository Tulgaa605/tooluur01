import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { Role } from '@/lib/role'
import { prisma } from '@/lib/prisma'
import { getScopedOrganizationIds } from '@/lib/org-scope'
import { issueEbarimtBill } from '@/lib/ebarimt-client'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const year = Number(body?.year)
    const month = Number(body?.month)
    const force = body?.force === true
    const maxRows = Math.min(Math.max(Number(body?.limit) || 500, 1), 1000)

    const scopedOrgIds = await getScopedOrganizationIds(user)
    if (scopedOrgIds.length === 0) {
      return NextResponse.json({ success: true, total: 0, sent: 0, failed: 0, skipped: 0, results: [] })
    }

    const where: any = {
      organizationId: { in: scopedOrgIds },
    }
    if (Number.isFinite(year) && year > 0) where.year = Math.trunc(year)
    if (Number.isFinite(month) && month >= 1 && month <= 12) where.month = Math.trunc(month)

    const rows = await prisma.meterReading.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: {
        organization: { select: { name: true, code: true } },
        meter: { select: { meterNumber: true } },
      },
      take: maxRows,
    })

    const results: Array<{ readingId: string; ok: boolean; skipped?: boolean; error?: string }> = []
    for (const reading of rows) {
      const status = String((reading as any).ebarimtStatus || '')
      if (!force && status === 'SENT') {
        results.push({ readingId: reading.id, ok: true, skipped: true })
        continue
      }
      try {
        const billNo = `${reading.year}${String(reading.month).padStart(2, '0')}-${reading.meterId.slice(-6)}-${reading.id.slice(-6)}`
        const issued = await issueEbarimtBill({
          amount: Number(reading.total ?? 0),
          customerName: reading.organization?.name || 'Customer',
          customerTin: reading.organization?.code || null,
          description: `${reading.year}-${String(reading.month).padStart(2, '0')} / ${reading.meter?.meterNumber || '-'}`,
          billNo,
        })
        await prisma.meterReading.update({
          where: { id: reading.id },
          data: {
            ebarimtStatus: 'SENT',
            ebarimtSentAt: new Date(),
            ebarimtBillId: issued.billId,
            ebarimtQrData: issued.qrData,
            ebarimtLotteryCode: issued.lotteryCode,
            ebarimtLastError: null,
          } as any,
        })
        results.push({ readingId: reading.id, ok: true })
      } catch (error: any) {
        await prisma.meterReading
          .update({
            where: { id: reading.id },
            data: {
              ebarimtStatus: 'FAILED',
              ebarimtLastError: error?.message ? String(error.message) : 'Issue failed',
            } as any,
          })
          .catch(() => {})
        results.push({ readingId: reading.id, ok: false, error: error?.message || 'Issue failed' })
      }
    }

    const sent = results.filter((r) => r.ok && !r.skipped).length
    const skipped = results.filter((r) => r.skipped).length
    const failed = results.filter((r) => !r.ok).length

    return NextResponse.json({
      success: true,
      total: rows.length,
      sent,
      failed,
      skipped,
      results,
    })
  } catch (error: any) {
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
  }
}
