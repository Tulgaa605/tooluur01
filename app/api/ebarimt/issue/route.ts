import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { Role } from '@/lib/role'
import { prisma } from '@/lib/prisma'
import { organizationIdInScope } from '@/lib/org-scope'
import { issueEbarimtBill } from '@/lib/ebarimt-client'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  let readingId = ''
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    readingId = typeof body?.readingId === 'string' ? body.readingId : ''
    const force = body?.force === true
    if (!readingId) {
      return NextResponse.json({ error: 'readingId is required' }, { status: 400 })
    }

    const reading = await prisma.meterReading.findUnique({
      where: { id: readingId },
      include: {
        organization: { select: { name: true, code: true } },
        meter: { select: { meterNumber: true } },
      },
    })
    if (!reading) return NextResponse.json({ error: 'Reading not found' }, { status: 404 })

    if (!(await organizationIdInScope(user, reading.organizationId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const status = String((reading as any).ebarimtStatus || '')
    if (!force && status === 'SENT') {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: 'Already sent',
        readingId,
        ebarimt: {
          status: (reading as any).ebarimtStatus,
          sentAt: (reading as any).ebarimtSentAt,
          billId: (reading as any).ebarimtBillId,
          qrData: (reading as any).ebarimtQrData,
          lotteryCode: (reading as any).ebarimtLotteryCode,
        },
      })
    }

    const amount = Number(reading.total ?? 0)
    const billNo = `${reading.year}${String(reading.month).padStart(2, '0')}-${reading.meterId.slice(-6)}-${reading.id.slice(-6)}`
    const result = await issueEbarimtBill({
      amount,
      customerName: reading.organization?.name || 'Customer',
      customerTin: reading.organization?.code || null,
      description: `${reading.year}-${String(reading.month).padStart(2, '0')} / ${reading.meter?.meterNumber || '-'}`,
      billNo,
    })

    const updated = await prisma.meterReading.update({
      where: { id: readingId },
      data: {
        ebarimtStatus: 'SENT',
        ebarimtSentAt: new Date(),
        ebarimtBillId: result.billId,
        ebarimtQrData: result.qrData,
        ebarimtLotteryCode: result.lotteryCode,
        ebarimtLastError: null,
      } as any,
    })

    return NextResponse.json({
      success: true,
      readingId,
      ebarimt: {
        status: (updated as any).ebarimtStatus,
        sentAt: (updated as any).ebarimtSentAt,
        billId: (updated as any).ebarimtBillId,
        qrData: (updated as any).ebarimtQrData,
        lotteryCode: (updated as any).ebarimtLotteryCode,
      },
    })
  } catch (error: any) {
    if (readingId) {
      await prisma.meterReading
        .update({
          where: { id: readingId },
          data: {
            ebarimtStatus: 'FAILED',
            ebarimtLastError: error?.message ? String(error.message) : 'Issue failed',
          } as any,
        })
        .catch(() => {})
    }
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 })
  }
}
