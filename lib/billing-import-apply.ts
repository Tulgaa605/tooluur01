import { prisma } from '@/lib/prisma'
import { organizationIdInScope } from '@/lib/org-scope'
import type { BillingExcelImportRow } from '@/lib/billing-export-excel'

const EPS = 0.009

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

export type BillingImportApplied = {
  readingId: string
  meterNumber?: string
  organizationName?: string
  paidAmount: number
  total: number
  rowIndex: number
}

export type BillingImportSkipped = {
  rowIndex: number
  reason: string
  description: string
}

export type BillingImportResult = {
  rowsParsed: number
  applied: BillingImportApplied[]
  skipped: BillingImportSkipped[]
}

type ScopedUser = {
  userId: string
  role: string
  organizationId?: string | null
}

export async function applyBillingExcelRows(
  rows: BillingExcelImportRow[],
  user: ScopedUser,
  officeOrgId: string | null
): Promise<BillingImportResult> {
  const scopedUser = { ...user, organizationId: officeOrgId ?? user.organizationId }
  const applied: BillingImportApplied[] = []
  const skipped: BillingImportSkipped[] = []

  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, code: true },
  })
  const orgByCode = new Map<string, string>()
  const orgByName = new Map<string, string>()
  for (const o of orgs) {
    const code = String(o.code ?? '').trim().toLowerCase()
    const name = String(o.name ?? '').trim().toLowerCase()
    if (code) orgByCode.set(code, o.id)
    if (name) orgByName.set(name, o.id)
  }

  for (const br of rows) {
    let orgId: string | undefined
    const code = String(br.organizationCode ?? '').trim().toLowerCase()
    const name = String(br.organizationName ?? '').trim().toLowerCase()
    if (code && orgByCode.has(code)) orgId = orgByCode.get(code)
    else if (name && orgByName.has(name)) orgId = orgByName.get(name)

    const meterHint = String(br.meterNumber ?? '').trim()
    const desc = [br.organizationName, br.organizationCode, meterHint].filter(Boolean).join(' / ')

    if (!orgId) {
      skipped.push({
        rowIndex: br.rowIndex,
        reason: 'Байгууллага олдсонгүй',
        description: desc.slice(0, 200),
      })
      continue
    }

    if (!(await organizationIdInScope(scopedUser as Parameters<typeof organizationIdInScope>[0], orgId))) {
      skipped.push({
        rowIndex: br.rowIndex,
        reason: 'Эрхгүй',
        description: desc.slice(0, 200),
      })
      continue
    }

    const meters = await prisma.meter.findMany({
      where: { organizationId: orgId },
      select: { id: true, meterNumber: true },
    })

    let meterId: string | undefined
    if (meterHint) {
      const h = meterHint.toLowerCase()
      const m = meters.find((x) => String(x.meterNumber).trim().toLowerCase() === h)
      if (m) meterId = m.id
      else {
        const partial = meters.find((x) => {
          const mn = String(x.meterNumber).trim().toLowerCase()
          return mn.includes(h) || h.includes(mn)
        })
        if (partial) meterId = partial.id
      }
    } else if (meters.length === 1) {
      meterId = meters[0].id
    }

    if (!meterId) {
      skipped.push({
        rowIndex: br.rowIndex,
        reason: meterHint ? `Тоолуур «${meterHint}» олдсонгүй` : 'Тоолуур заавал',
        description: desc.slice(0, 200),
      })
      continue
    }

    const reading = await prisma.meterReading.findFirst({
      where: {
        organizationId: orgId,
        meterId,
        year: br.year,
        month: br.month,
      },
    })

    if (!reading) {
      skipped.push({
        rowIndex: br.rowIndex,
        reason: `${br.year}-${String(br.month).padStart(2, '0')} заалт олдсонгүй`,
        description: desc.slice(0, 200),
      })
      continue
    }

    const total = roundMoney(Number((reading as { total?: number }).total ?? 0) || 0)
    let newPaid = roundMoney(br.paidAmount)
    if (newPaid > total) newPaid = total

    const approved = total > 0 ? total - newPaid <= EPS : newPaid <= EPS

    await prisma.meterReading.update({
      where: { id: reading.id },
      data: {
        paidAmount: newPaid,
        approved,
        approvedAt: approved ? new Date() : null,
        approvedBy: approved ? String(user.userId) : null,
        updatedByUserId: user.userId,
      },
    })

    applied.push({
      readingId: reading.id,
      meterNumber: meterHint || undefined,
      organizationName: br.organizationName || undefined,
      paidAmount: newPaid,
      total,
      rowIndex: br.rowIndex,
    })
  }

  return {
    rowsParsed: rows.length,
    applied,
    skipped,
  }
}
