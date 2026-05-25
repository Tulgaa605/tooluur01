import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { Role } from '@/lib/role'
import { prisma } from '@/lib/prisma'
import { getScopedOrganizationIds } from '@/lib/org-scope'
import { ensureOfficeOrganizationId } from '@/lib/readings-office-org'

export const runtime = 'nodejs'

/**
 * Excel импортын grid-д тоолуурын дугаараар автоматаар бөглөх мэдээлэл.
 * GET /api/meters/lookup → [{ meterNumber, organizationName, organizationCode, customerPhone }]
 */
export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const officeOrgId = await ensureOfficeOrganizationId(user)
    const scoped = await getScopedOrganizationIds({ ...user, organizationId: officeOrgId })
    if (scoped.length === 0) return NextResponse.json([])

    const meters = await prisma.meter.findMany({
      where: { organizationId: { in: scoped } },
      select: {
        meterNumber: true,
        organizationId: true,
      },
    })

    const orgIds = [...new Set(meters.map((m) => m.organizationId))]
    const orgs = await prisma.organization.findMany({
      where: { id: { in: orgIds } },
      select: {
        id: true,
        name: true,
        code: true,
        phone: true,
        users: { select: { phone: true } },
      },
    })

    const orgById = new Map(orgs.map((o) => [o.id, o]))

    const out = meters.map((m) => {
      const org = orgById.get(m.organizationId)
      const phones = new Set<string>()
      if (org?.phone?.trim()) phones.add(org.phone.trim())
      org?.users?.forEach((u) => {
        if (u.phone?.trim()) phones.add(u.phone.trim())
      })
      return {
        meterNumber: String(m.meterNumber ?? '').trim(),
        organizationName: org?.name ?? '',
        organizationCode: org?.code ?? '',
        customerPhone: Array.from(phones).join(', '),
      }
    })

    return NextResponse.json(out)
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'Forbidden')) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
