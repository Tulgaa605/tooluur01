import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { getScopedOrganizationIds } from '@/lib/org-scope'
import { attachOrgsAndMetersToReadings } from '@/lib/attach-reading-relations'
import { ensureOfficeOrganizationId } from '@/lib/readings-office-org'
import type { Prisma } from '@prisma/client'

function parsePeriods(body: unknown): Array<{ year: number; month: number }> | null {
  if (!body || typeof body !== 'object') return null
  const p = (body as { periods?: unknown }).periods
  if (!Array.isArray(p) || p.length === 0) return null
  const out: Array<{ year: number; month: number }> = []
  for (const item of p) {
    if (!item || typeof item !== 'object') return null
    const y = Number((item as { year?: unknown }).year)
    const m = Number((item as { month?: unknown }).month)
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null
    out.push({ year: Math.trunc(y), month: Math.trunc(m) })
  }
  return out
}

/**
 * Заалт оруулах modal: олон сарын GET-ийг нэг DB ачаалал + (заавал биш) өмнөх эцсийн заалтын нэг find.
 */
export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER, Role.USER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const periods = parsePeriods(body)
    if (!periods) {
      return NextResponse.json({ error: 'periods массив шаардлагатай' }, { status: 400 })
    }

    const anchorYear = Number((body as { anchorYear?: unknown })?.anchorYear)
    const anchorMonth = Number((body as { anchorMonth?: unknown })?.anchorMonth)
    if (!Number.isFinite(anchorYear) || !Number.isFinite(anchorMonth) || anchorMonth < 1 || anchorMonth > 12) {
      return NextResponse.json({ error: 'anchorYear, anchorMonth зөв оруулна уу' }, { status: 400 })
    }

    const rawMeterIds = (body as { meterIds?: unknown }).meterIds
    const meterIds = Array.isArray(rawMeterIds)
      ? rawMeterIds.map((x) => String(x)).filter((id) => /^[a-f\d]{24}$/i.test(id))
      : []

    let scopeWhere: Prisma.MeterReadingWhereInput = {}
    const roleStr = String(user.role)
    let scopedOrgIds: string[] = []
    if (roleStr === Role.USER) {
      if (!user.organizationId) return NextResponse.json({ byKey: {}, carryEndByMeterId: {} })
      scopeWhere.organizationId = user.organizationId
      scopedOrgIds = [user.organizationId]
    } else if (roleStr === Role.ACCOUNTANT || roleStr === Role.MANAGER) {
      const officeOrgId = await ensureOfficeOrganizationId(user)
      scopedOrgIds = await getScopedOrganizationIds({
        ...user,
        organizationId: officeOrgId ?? user.organizationId,
      })
      if (scopedOrgIds.length === 0) return NextResponse.json({ byKey: {}, carryEndByMeterId: {} })
      scopeWhere.OR = [
        { organizationId: { in: scopedOrgIds } },
        { createdByUserId: user.userId },
      ]
    }

    const keySet = new Map<string, { year: number; month: number }>()
    for (const p of periods) {
      keySet.set(`${p.year}-${p.month}`, p)
      const pm = p.month === 1 ? 12 : p.month - 1
      const py = p.month === 1 ? p.year - 1 : p.year
      keySet.set(`${py}-${pm}`, { year: py, month: pm })
    }
    const uniquePeriods = [...keySet.values()]
    const monthOr: Prisma.MeterReadingWhereInput[] = uniquePeriods.map((p) => ({
      AND: [{ year: p.year }, { month: p.month }],
    }))

    const rawReadings = await prisma.meterReading.findMany({
      where: {
        AND: [scopeWhere, { OR: monthOr }],
      },
    })

    const readings = await attachOrgsAndMetersToReadings(rawReadings)

    const byKey: Record<string, typeof readings> = {}
    for (const r of readings) {
      const k = `${r.year}-${r.month}`
      if (!byKey[k]) byKey[k] = []
      byKey[k].push(r)
    }

    const prevMonth = anchorMonth === 1 ? 12 : anchorMonth - 1
    const prevYear = anchorMonth === 1 ? anchorYear - 1 : anchorYear
    const firstPrevKey = `${prevYear}-${prevMonth}`

    const firstPrevList = byKey[firstPrevKey] ?? []
    const hasPrevForMeter = new Set(firstPrevList.map((r) => r.meterId).filter(Boolean))

    const carryEndByMeterId: Record<string, number> = {}

    const metersNeeding = meterIds.filter((id) => !hasPrevForMeter.has(id))
    if (metersNeeding.length > 0 && scopedOrgIds.length > 0) {
      const allowedMeters = await prisma.meter.findMany({
        where: {
          id: { in: metersNeeding },
          organizationId: { in: scopedOrgIds },
        },
        select: { id: true },
      })
      const allowedIds = new Set(allowedMeters.map((m) => m.id))
      const filteredNeeding = metersNeeding.filter((id) => allowedIds.has(id))

      if (filteredNeeding.length > 0) {
        const prior = await prisma.meterReading.findMany({
          where: {
            meterId: { in: filteredNeeding },
            OR: [{ year: { lt: anchorYear } }, { year: anchorYear, month: { lt: anchorMonth } }],
          },
          select: { meterId: true, year: true, month: true, endValue: true },
        })
        const best = new Map<string, { score: number; end: number }>()
        for (const r of prior) {
          const score = r.year * 100 + r.month
          const cur = best.get(r.meterId)
          if (!cur || score > cur.score) best.set(r.meterId, { score, end: r.endValue })
        }
        for (const [id, v] of best) carryEndByMeterId[id] = v.end
      }
    }

    return NextResponse.json({
      byKey,
      carryEndByMeterId,
      firstPrevKey,
      firstPrevYear: prevYear,
      firstPrevMonth: prevMonth,
    })
  } catch (error: any) {
    console.error('readings/modal-data POST error:', error)
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json({ error: error.message || 'Алдаа гарлаа' }, { status: 500 })
  }
}
