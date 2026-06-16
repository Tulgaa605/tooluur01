import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { Role } from '@/lib/role'
import { getScopedOrganizationIds } from '@/lib/org-scope'
import { ensureOfficeOrganizationId } from '@/lib/readings-office-org'
import { recalculateMeterReadingsWhere } from '@/lib/recalculate-readings-tariff'
import type { Prisma } from '@prisma/client'

function parsePeriod(body: unknown): { year: number; month: number } | null {
  if (!body || typeof body !== 'object') return null
  const y = Number((body as { year?: unknown }).year)
  const m = Number((body as { month?: unknown }).month)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12 || y < 2000 || y > 2100) {
    return null
  }
  return { year: Math.trunc(y), month: Math.trunc(m) }
}

/**
 * «Бодолт» товч: зөвхөн тухайн сарын заалтыг тарифаар тооцож DB-д хадгална.
 * GET ?recalculate=1-ээс хөнгөн (дулаан sync, carry, phantom, бүх сарын жагсаалтгүй).
 */
export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER, Role.USER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const period = parsePeriod(body)
    if (!period) {
      return NextResponse.json({ error: 'year, month зөв оруулна уу' }, { status: 400 })
    }

    const { year, month } = period
    let scopeWhere: Prisma.MeterReadingWhereInput = {}
    const roleStr = String(user.role)

    if (roleStr === Role.USER) {
      if (!user.organizationId) return NextResponse.json({ ok: true, saved: 0, rows: [] })
      scopeWhere.organizationId = user.organizationId
    } else if (roleStr === Role.ACCOUNTANT || roleStr === Role.MANAGER) {
      const officeOrgId = await ensureOfficeOrganizationId(user)
      const scopedOrgIds = await getScopedOrganizationIds({
        ...user,
        organizationId: officeOrgId ?? user.organizationId,
      })
      if (scopedOrgIds.length === 0) return NextResponse.json({ ok: true, saved: 0, rows: [] })
      scopeWhere.OR = [
        { organizationId: { in: scopedOrgIds } },
        { createdByUserId: user.userId },
      ]
    } else {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rows = await recalculateMeterReadingsWhere(scopeWhere, year, month)

    return NextResponse.json({ ok: true, saved: rows.length, rows })
  } catch (error: unknown) {
    console.error('readings/recalculate POST error:', error)
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    if (msg === 'Unauthorized' || msg === 'Forbidden') {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
