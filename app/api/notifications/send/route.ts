import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { organizationIdInScope } from '@/lib/org-scope'

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    const data = await request.json()
    const { readingId } = data

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

    // TODO: Integrate with SMS service (e.g., Twilio, local SMS gateway)
    // TODO: Integrate with Email service (e.g., SendGrid, Nodemailer)
    
    // For now, just return the message and code
    // In production, you would send SMS to organization.phone and user phones
    // and send email to organization.email and user emails
    
    // Example SMS sending (you need to implement actual SMS service):
    // for (const recipient of recipients) {
    //   if (recipient.phone) {
    //     await sendSMS(recipient.phone, message)
    //   }
    // }

    return NextResponse.json({
      success: true,
      message: 'Төлбөрийн мэдээлэл илгээгдлээ',
      paymentCode,
      messageText: message,
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

