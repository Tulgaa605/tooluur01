import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { organizationIdInScope } from '@/lib/org-scope'
import { sendTextSms } from '@/lib/sms'
import { getDefaultSmsSender } from '@/lib/sms-senders'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER, Role.USER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const data = await request.json()
    const { readingId, fromPhone: fromPhoneRaw } = data
    const fromPhone =
      typeof fromPhoneRaw === 'string' && fromPhoneRaw.trim()
        ? fromPhoneRaw.trim()
        : getDefaultSmsSender()

    if (!readingId) {
      return NextResponse.json(
        { error: 'Заалтын ID шаардлагатай' },
        { status: 400 }
      )
    }

    // Get reading with organization and users
    const reading = await prisma.meterReading.findUnique({
      where: { id: readingId },
      include: {
        organization: {
          select: {
            name: true,
            code: true,
            phone: true,
            email: true,
          },
        },
        meter: {
          select: {
            meterNumber: true,
          },
        },
      },
    })

    if (!reading) {
      return NextResponse.json(
        { error: 'Заалт олдсонгүй' },
        { status: 404 }
      )
    }

    if (!(await organizationIdInScope(user, reading.organizationId))) {
      return NextResponse.json({ error: 'Эрхгүй' }, { status: 403 })
    }

    // Get users from the organization
    const users = await prisma.user.findMany({
      where: {
        organizationId: reading.organizationId,
      },
      select: {
        name: true,
        email: true,
        phone: true,
      },
    })

    // Filter recipients that have phone numbers
    const recipients: Array<{ type: string; name: string; phone: string | null; email: string | null }> = []
    if (reading.organization.phone) {
      recipients.push({
        type: 'organization',
        name: reading.organization.name,
        phone: reading.organization.phone,
        email: reading.organization.email,
      })
    }
    users.forEach(user => {
      if (user.phone) {
        recipients.push({
          type: 'user',
          name: user.name,
          phone: user.phone,
          email: user.email,
        })
      }
    })

    // Generate payment code (simple 6-digit code)
    const paymentCode = Math.floor(100000 + Math.random() * 900000).toString()

    // Create message
    const message = `Төлбөрийн мэдээлэл
Байгууллага: ${reading.organization.name}${reading.organization.code ? ` (${reading.organization.code})` : ''}
Тоолуурын дугаар: ${reading.meter.meterNumber}
Сар: ${reading.year}-${String(reading.month).padStart(2, '0')}
Хэрэглээ: ${reading.usage.toFixed(2)} м³
Нийт төлбөр: ${reading.total.toFixed(2)} ₮
Төлбөрийн код: ${paymentCode}

Энэ кодыг төлбөр төлөхдөө ашиглана уу.`

    const rawPhones = recipients
      .map((r) => r.phone)
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)

    const smsOutcome = await sendTextSms(rawPhones, message, fromPhone)
    const smsOkCount = smsOutcome.results.filter((r) => r.ok).length
    const smsFailCount = smsOutcome.results.filter((r) => !r.ok).length

    return NextResponse.json({
      success: true,
      message: 'Төлбөрийн мэдээлэл илгээгдлээ',
      paymentCode,
      fromPhone,
      messageText: message,
      sms: {
        provider: smsOutcome.mode,
        results: smsOutcome.results,
        sentOk: smsOkCount,
        sentFailed: smsFailCount,
      },
      recipients: recipients,
      sentTo: {
        organization: {
          phone: reading.organization.phone,
          email: reading.organization.email,
        },
        users: users.map(u => ({
          name: u.name,
          phone: u.phone,
          email: u.email,
        })),
      },
    })
  } catch (error: any) {
    console.error('Notification send error:', error)
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа' },
      { status: 500 }
    )
  }
}

