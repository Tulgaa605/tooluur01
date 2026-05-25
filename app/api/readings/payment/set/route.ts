import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { Role } from '@/lib/role'
import { prisma } from '@/lib/prisma'
import { organizationIdInScope } from '@/lib/org-scope'

export const runtime = 'nodejs'

const EPS = 0.009

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Inline төлбөр засах: readingIds-н нийт төлсөн дүнг `paidAmount` болгож тогтооно.
 * Олон reading бол `total`-н харьцаагаар хувааж, ялгавартай бол эхнийх дээр нь нэмнэ.
 */
export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const data = await request.json()
    const idsRaw: unknown = data?.readingIds
    const ids: string[] = Array.isArray(idsRaw)
      ? idsRaw.map((id) => String(id ?? '').trim()).filter((id) => /^[a-f\d]{24}$/i.test(id))
      : []

    if (ids.length === 0) {
      return NextResponse.json({ error: 'Заалтын ID шаардлагатай' }, { status: 400 })
    }

    const paidAmount = roundMoney(Math.max(0, Number(data?.paidAmount ?? 0)))

    const readings = await prisma.meterReading.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        organizationId: true,
        total: true,
      },
    })

    if (readings.length === 0) {
      return NextResponse.json({ error: 'Заалт олдсонгүй' }, { status: 404 })
    }

    for (const r of readings) {
      if (!(await organizationIdInScope(user, r.organizationId))) {
        return NextResponse.json({ error: 'Эрхгүй' }, { status: 403 })
      }
    }

    // Олон бол нийт total-аар харьцаалан хуваана
    const totals = readings.map((r) => roundMoney(Number(r.total ?? 0) || 0))
    const totalSum = totals.reduce((a, b) => a + b, 0)

    const distribute: Array<{ id: string; paid: number }> = []
    if (readings.length === 1 || totalSum <= EPS) {
      const each = readings.length > 0 ? roundMoney(paidAmount / readings.length) : 0
      let remainder = roundMoney(paidAmount - each * readings.length)
      readings.forEach((r, i) => {
        const p = i === 0 ? roundMoney(each + remainder) : each
        distribute.push({ id: r.id, paid: p })
      })
    } else {
      let allocated = 0
      readings.forEach((r, i) => {
        if (i === readings.length - 1) {
          distribute.push({ id: r.id, paid: roundMoney(paidAmount - allocated) })
        } else {
          const share = roundMoney((paidAmount * totals[i]) / totalSum)
          allocated = roundMoney(allocated + share)
          distribute.push({ id: r.id, paid: share })
        }
      })
    }

    const updates = distribute.map((d) => {
      const target = readings.find((r) => r.id === d.id)
      const total = roundMoney(Number(target?.total ?? 0) || 0)
      const approved = total > 0 ? total - d.paid <= EPS : d.paid > 0
      return { ...d, approved, total }
    })

    await Promise.all(
      updates.map((u) =>
        prisma.meterReading.update({
          where: { id: u.id },
          data: {
            paidAmount: u.paid,
            approved: u.approved,
            approvedAt: u.approved ? new Date() : null,
            approvedBy: u.approved ? String(user.userId) : null,
            updatedByUserId: user.userId,
          },
        })
      )
    )

    return NextResponse.json({ success: true, updated: updates.length })
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'Forbidden')) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
