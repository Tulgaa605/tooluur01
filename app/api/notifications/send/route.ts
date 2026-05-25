import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { organizationIdInScope } from '@/lib/org-scope'
import { sendTextSms } from '@/lib/sms'
import { resolveEffectiveSmsSender } from '@/lib/sms-senders'
import {
  computeReadingBreakdownLine,
  waterUsageFromReading,
} from '@/lib/public-billing-breakdown'
import { normalizeBillingMode } from '@/lib/meter-reading-calc-core'
import { buildSmsMessage } from '@/lib/sms-message'

export const runtime = 'nodejs'

function resolvePublicOrigin(request: NextRequest): string {
  const configured = (process.env.APP_PUBLIC_ORIGIN ?? '').trim()
  if (configured) return configured.replace(/\/+$/, '')

  const xfHost = (request.headers.get('x-forwarded-host') ?? '').trim()
  const xfProto = (request.headers.get('x-forwarded-proto') ?? '').trim()
  if (xfHost) {
    const proto = xfProto || 'https'
    return `${proto}://${xfHost}`.replace(/\/+$/, '')
  }

  return new URL(request.url).origin.replace(/\/+$/, '')
}

function formatUsageM3(usage: number): string {
  const n = Number(usage)
  if (!Number.isFinite(n) || n < 0) return '0.00'
  return n.toFixed(2)
}

function buildBreakdownUrl(
  publicOrigin: string,
  exportToken: string,
  input: { organizationId: string; year: number; month: number; singleReadingId?: string; multi: boolean }
): string | null {
  if (!exportToken) return null
  const enc = encodeURIComponent(exportToken)
  if (input.multi) {
    const q = new URLSearchParams({
      year: String(input.year),
      month: String(input.month),
    })
    return `${publicOrigin}/${enc}/piv/org/${encodeURIComponent(input.organizationId)}?${q.toString()}`
  }
  if (input.singleReadingId) {
    return `${publicOrigin}/${enc}/piv/${encodeURIComponent(input.singleReadingId)}`
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER, Role.USER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const data = await request.json()
    const { readingId, readingIds: readingIdsRaw, fromPhone: fromPhoneRaw } = data
    const fromPhone = resolveEffectiveSmsSender(
      typeof fromPhoneRaw === 'string' ? fromPhoneRaw : undefined
    )

    const readingIds: string[] = Array.isArray(readingIdsRaw)
      ? readingIdsRaw.map((id: unknown) => String(id ?? '').trim()).filter((id) => /^[a-f\d]{24}$/i.test(id))
      : typeof readingId === 'string' && /^[a-f\d]{24}$/i.test(readingId.trim())
        ? [readingId.trim()]
        : []

    // Phantom горим: заалтгүй харилцагчид зөвхөн өмнөх үлдэгдлийн SMS илгээнэ.
    const phantomData = data?.phantom as
      | { organizationId?: string; year?: number; month?: number }
      | undefined
    const phantomOrgId =
      phantomData && typeof phantomData.organizationId === 'string'
        ? phantomData.organizationId.trim()
        : ''
    const phantomYear =
      phantomData && Number.isFinite(Number(phantomData.year))
        ? Math.trunc(Number(phantomData.year))
        : 0
    const phantomMonth =
      phantomData && Number.isFinite(Number(phantomData.month))
        ? Math.trunc(Number(phantomData.month))
        : 0
    const isPhantomMode =
      readingIds.length === 0 &&
      /^[a-f\d]{24}$/i.test(phantomOrgId) &&
      phantomYear > 0 &&
      phantomMonth >= 1 &&
      phantomMonth <= 12

    if (readingIds.length === 0 && !isPhantomMode) {
      return NextResponse.json({ error: 'Заалтын ID шаардлагатай' }, { status: 400 })
    }

    if (isPhantomMode) {
      return await handlePhantomSend({
        request,
        user,
        organizationId: phantomOrgId,
        year: phantomYear,
        month: phantomMonth,
        fromPhone,
      })
    }

    const readings = await prisma.meterReading.findMany({
      where: { id: { in: readingIds } },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            code: true,
            phone: true,
            email: true,
            category: true,
          },
        },
        meter: {
          select: {
            meterNumber: true,
            billingMode: true,
            waterChargeSplit: true,
            pipeDiameterMm: true,
            billingCategory: true,
          },
        },
      },
    })

    if (readings.length === 0) {
      return NextResponse.json({ error: 'Заалт олдсонгүй' }, { status: 404 })
    }

    const orgId = readings[0].organizationId
    const year = readings[0].year
    const month = readings[0].month

    for (const r of readings) {
      if (r.organizationId !== orgId || r.year !== year || r.month !== month) {
        return NextResponse.json(
          { error: 'Нэгтгэсэн илгээлтэд зөвхөн нэг харилцагч, нэг сарын заалтууд байх ёстой' },
          { status: 400 }
        )
      }
      if (!(await organizationIdInScope(user, r.organizationId))) {
        return NextResponse.json({ error: 'Эрхгүй' }, { status: 403 })
      }
    }

    const users = await prisma.user.findMany({
      where: { organizationId: orgId },
      select: { name: true, email: true, phone: true },
    })

    const org = readings[0].organization
    const recipients: Array<{ type: string; name: string; phone: string | null; email: string | null }> = []
    if (org.phone) {
      recipients.push({
        type: 'organization',
        name: org.name,
        phone: org.phone,
        email: org.email,
      })
    }
    users.forEach((u) => {
      if (u.phone) {
        recipients.push({
          type: 'user',
          name: u.name,
          phone: u.phone,
          email: u.email,
        })
      }
    })

    const lines = await Promise.all(readings.map((r) => computeReadingBreakdownLine(r)))
    const totalSum = lines.reduce((a, l) => a + l.total, 0)
    const meterLines = readings.map((r, i) => {
      const line = lines[i]
      const bm = normalizeBillingMode(r.meter?.billingMode)
      if (bm === 'HEAT') {
        return {
          meterNumber: line.meterNumber,
          usage: line.usage,
          usageLabel: `${formatUsageM3(line.usage)} дулаан`,
        }
      }
      const water = waterUsageFromReading(r)
      return { meterNumber: line.meterNumber, usage: water }
    })

    const exportToken = (process.env.PAYMENT_LIST_EXPORT_TOKEN ?? '').trim()
    const publicOrigin = resolvePublicOrigin(request)
    const multi = readings.length > 1
    const breakdownUrl = buildBreakdownUrl(publicOrigin, exportToken, {
      organizationId: orgId,
      year,
      month,
      singleReadingId: multi ? undefined : readings[0].id,
      multi,
    })

    // Өмнөх үлдэгдэл: Σ(total − paidAmount) where (y, m) < (year, month) for this org
    const priorReadings = await prisma.meterReading.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { year: { lt: year } },
          { year, month: { lt: month } },
        ],
      },
      select: { total: true, paidAmount: true },
    })
    const previousRemainingRaw = priorReadings.reduce(
      (acc, r) => acc + (Number(r.total) || 0) - (Number(r.paidAmount) || 0),
      0
    )
    const previousRemaining = Math.round(previousRemainingRaw * 100) / 100

    const messageText = buildSmsMessage({
      organizationName: org.name,
      organizationCode: org.code,
      meterLines,
      total: totalSum,
      previousRemaining,
      breakdownUrl,
    })

    const rawPhones = recipients
      .map((r) => r.phone)
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)

    const smsOutcome = await sendTextSms(rawPhones, messageText, fromPhone)
    const smsOkCount = smsOutcome.results.filter((r) => r.ok).length
    const smsFailCount = smsOutcome.results.filter((r) => !r.ok).length

    // SMS илгээх үйлдлийг бүртгэснээр заалтуудыг түгжинэ (заалт/төлбөр засагдахаа болино).
    // SMS провайдер тохируулагдаагүй байсан ч хэрэглэгчийн зориудаар дарсныг тэмдэглэнэ.
    const sentAt = new Date()
    await prisma.meterReading.updateMany({
      where: { id: { in: readingIds } },
      data: { smsSentAt: sentAt },
    })

    return NextResponse.json({
      success: true,
      message: 'Төлбөрийн мэдээлэл илгээгдлээ',
      fromPhone,
      messageText,
      breakdownUrl,
      sms: {
        provider: smsOutcome.mode,
        results: smsOutcome.results,
        sentOk: smsOkCount,
        sentFailed: smsFailCount,
      },
      recipients,
      sentTo: {
        organization: {
          phone: org.phone,
          email: org.email,
        },
        users: users.map((u) => ({
          name: u.name,
          phone: u.phone,
          email: u.email,
        })),
      },
    })
  } catch (error: unknown) {
    console.error('Notification send error:', error)
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    if (msg === 'Unauthorized' || msg === 'Forbidden') {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

type PhantomCtx = {
  request: NextRequest
  user: { userId: string; organizationId?: string | null }
  organizationId: string
  year: number
  month: number
  fromPhone: string
}

/**
 * Phantom илгээлт: тухайн (org, year, month) дээр заалт байхгүй ч өмнөх саруудаас
 * carry-forward үлдэгдэлтэй харилцагч руу зөвхөн "Өмнөх үлдэгдэл"-ийн SMS илгээнэ.
 */
async function handlePhantomSend(ctx: PhantomCtx): Promise<NextResponse> {
  const { organizationId, year, month, fromPhone } = ctx
  if (!(await organizationIdInScope(ctx.user as never, organizationId))) {
    return NextResponse.json({ error: 'Эрхгүй' }, { status: 403 })
  }

  // Өмнөх үлдэгдлийг тооцоолно: Σ(total − paidAmount) where (y, m) < (year, month)
  const prior = await prisma.meterReading.findMany({
    where: {
      organizationId,
      OR: [
        { year: { lt: year } },
        { year, month: { lt: month } },
      ],
    },
    select: { total: true, paidAmount: true },
  })
  const carry = prior.reduce(
    (acc, r) => acc + (Number(r.total) || 0) - (Number(r.paidAmount) || 0),
    0
  )
  const roundedCarry = Math.round(carry * 100) / 100
  if (roundedCarry <= 0.005) {
    return NextResponse.json(
      { error: 'Өмнөх үлдэгдэл алга байна — илгээх мэдээлэл алга.' },
      { status: 400 }
    )
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, code: true, phone: true, email: true },
  })
  if (!org) {
    return NextResponse.json({ error: 'Байгууллага олдсонгүй' }, { status: 404 })
  }

  const users = await prisma.user.findMany({
    where: { organizationId },
    select: { name: true, email: true, phone: true },
  })

  const recipients: Array<{ type: string; name: string; phone: string | null; email: string | null }> = []
  if (org.phone) {
    recipients.push({ type: 'organization', name: org.name, phone: org.phone, email: org.email })
  }
  users.forEach((u) => {
    if (u.phone) recipients.push({ type: 'user', name: u.name, phone: u.phone, email: u.email })
  })

  const exportToken = (process.env.PAYMENT_LIST_EXPORT_TOKEN ?? '').trim()
  const publicOrigin = resolvePublicOrigin(ctx.request)
  const breakdownUrl = exportToken
    ? `${publicOrigin}/${encodeURIComponent(exportToken)}/piv/org/${encodeURIComponent(
        organizationId
      )}?${new URLSearchParams({ year: String(year), month: String(month) }).toString()}`
    : null

  // Phantom мөрөнд тоолуурын заалт байхгүй тул meterLines хоосон + previousRemaining=carry.
  const messageText = buildSmsMessage({
    organizationName: org.name,
    organizationCode: org.code,
    meterLines: [],
    total: 0,
    previousRemaining: roundedCarry,
    breakdownUrl,
  })

  const rawPhones = recipients
    .map((r) => r.phone)
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
  const smsOutcome = await sendTextSms(rawPhones, messageText, fromPhone)
  const smsOkCount = smsOutcome.results.filter((r) => r.ok).length
  const smsFailCount = smsOutcome.results.filter((r) => !r.ok).length

  return NextResponse.json({
    success: true,
    message: 'Өмнөх үлдэгдлийн мэдээлэл илгээгдлээ',
    fromPhone,
    messageText,
    breakdownUrl,
    sms: {
      provider: smsOutcome.mode,
      results: smsOutcome.results,
      sentOk: smsOkCount,
      sentFailed: smsFailCount,
    },
    recipients,
    phantom: { organizationId, year, month, previousRemaining: roundedCarry },
  })
}
