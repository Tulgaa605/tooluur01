import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { organizationIdInScope } from '@/lib/org-scope'
import { ensureOfficeOrganizationId } from '@/lib/readings-office-org'
import { normalizeBillingMode } from '@/lib/meter-reading-calc'
import { readingHasHeatBilling, nextHeatClosedAfterToggle } from '@/lib/heat-billing-season'
import { recalculateReadingIdsForPeriod } from '@/lib/recalculate-readings-tariff'
import { attachOrgsAndMetersToReadings } from '@/lib/attach-reading-relations'

export const dynamic = 'force-dynamic'

async function canEditReading(
  user: { userId: string; role: string; organizationId?: string | null },
  organizationId: string,
  createdByUserId?: string | null
): Promise<boolean> {
  const roleStr = String(user.role)
  if (roleStr === Role.USER) {
    return user.organizationId === organizationId
  }
  if (roleStr === Role.ACCOUNTANT || roleStr === Role.MANAGER) {
    const officeOrgId = await ensureOfficeOrganizationId(user as Parameters<typeof ensureOfficeOrganizationId>[0])
    const scopedUser = {
      ...user,
      organizationId: officeOrgId ?? user.organizationId,
    } as Parameters<typeof organizationIdInScope>[0]
    if (await organizationIdInScope(scopedUser, organizationId)) return true
    return createdByUserId != null && String(createdByUserId) === String(user.userId)
  }
  return false
}

/** Сарын заалт: хэрэглэгчийн нэр дээр дарж дулаан хаах/нээх. */
export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER, Role.USER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const readingId =
      body && typeof body === 'object' && typeof (body as { readingId?: unknown }).readingId === 'string'
        ? (body as { readingId: string }).readingId.trim()
        : ''
    if (!readingId) {
      return NextResponse.json({ error: 'readingId шаардлагатай' }, { status: 400 })
    }

    const reading = await prisma.meterReading.findUnique({
      where: { id: readingId },
      include: {
        meter: {
          select: {
            id: true,
            meterNumber: true,
            billingMode: true,
            waterChargeSplit: true,
            pipeDiameterMm: true,
            billingCategory: true,
          },
        },
      },
    })
    if (!reading) {
      return NextResponse.json({ error: 'Заалт олдсонгүй' }, { status: 404 })
    }

    if (reading.smsSentAt) {
      return NextResponse.json(
        { error: 'SMS илгээгдсэн заалтын дулааны тохиргоог өөрчлөх боломжгүй' },
        { status: 400 }
      )
    }

    const billingMode = normalizeBillingMode(reading.meter?.billingMode)
    if (!readingHasHeatBilling(billingMode)) {
      return NextResponse.json({ error: 'Энэ мөр дулаантай тоолуур биш байна' }, { status: 400 })
    }

    const allowed = await canEditReading(
      user,
      reading.organizationId,
      (reading as { createdByUserId?: string | null }).createdByUserId
    )
    if (!allowed) {
      return NextResponse.json({ error: 'Энэ заалтыг засах эрхгүй' }, { status: 403 })
    }

    const currentClosed = (reading as { heatClosed?: boolean | null }).heatClosed ?? null
    const nextHeatClosed = nextHeatClosedAfterToggle(currentClosed, Number(reading.month))
    await prisma.meterReading.update({
      where: { id: readingId },
      data: { heatClosed: nextHeatClosed },
    })

    const recalculated = await recalculateReadingIdsForPeriod(
      [readingId],
      Number(reading.year),
      Number(reading.month)
    )
    const row = recalculated[0]
    if (row) {
      const withRelations = await attachOrgsAndMetersToReadings([row])
      return NextResponse.json({
        ok: true,
        heatClosed: nextHeatClosed,
        reading: withRelations[0] ?? row,
      })
    }

    return NextResponse.json({ ok: true, heatClosed: nextHeatClosed })
  } catch (error: unknown) {
    console.error('readings/heat-toggle error:', error)
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    if (msg === 'Unauthorized' || msg === 'Forbidden') {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
