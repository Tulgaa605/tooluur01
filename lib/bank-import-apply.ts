import { prisma } from '@/lib/prisma'
import { attachOrgsAndMetersToReadings } from '@/lib/attach-reading-relations'
import { organizationIdInScope } from '@/lib/org-scope'
import { Role } from '@/lib/role'
import {
  extractPaymentCodesFromText,
  type BankStatementParsedRow,
} from '@/lib/bank-statement-excel'

const EPS = 0.009

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

export type BankImportApplied = {
  readingId: string
  code?: string
  meterNumber?: string
  added: number
  newPaid: number
  total: number
  rowIndex: number
}

export type BankImportSkipped = {
  rowIndex: number
  reason: string
  description: string
}

export type BankImportResult = {
  year: number
  month: number
  bankRowsParsed: number
  applied: BankImportApplied[]
  skipped: BankImportSkipped[]
}

type ScopedUser = {
  userId: string
  role: string
  organizationId?: string | null
}

export async function applyBankPaymentRows(
  year: number,
  month: number,
  bankRows: BankStatementParsedRow[],
  user: ScopedUser,
  officeOrgId: string | null
): Promise<BankImportResult> {
  const scopedUser = { ...user, organizationId: officeOrgId ?? user.organizationId }

  const readings = await prisma.meterReading.findMany({
    where: { year, month },
  })

  const meters = await prisma.meter.findMany({
    where: { id: { in: [...new Set(readings.map((r) => r.meterId).filter(Boolean))] } },
    select: { id: true, meterNumber: true },
  })
  const meterNumberById = new Map(meters.map((m) => [m.id, m.meterNumber]))

  const inScope: typeof readings = []
  for (const r of readings) {
    const createdByMe =
      (r as { createdByUserId?: string | null }).createdByUserId != null &&
      String((r as { createdByUserId?: string | null }).createdByUserId) === String(user.userId)
    const ok =
      createdByMe || (await organizationIdInScope(scopedUser as Parameters<typeof organizationIdInScope>[0], r.organizationId))
    if (ok) inScope.push(r)
  }

  const byRef = new Map<string, (typeof readings)[0]>()
  const byMeter = new Map<string, (typeof readings)[0]>()
  for (const r of inScope) {
    const ref = String((r as { paymentReference?: string | null }).paymentReference ?? '').trim()
    if (ref.length === 6 && /^\d{6}$/.test(ref) && !byRef.has(ref)) {
      byRef.set(ref, r)
    }
    const mn = String(meterNumberById.get(r.meterId) ?? '').trim()
    if (mn) {
      const key = mn.toLowerCase()
      if (!byMeter.has(key)) byMeter.set(key, r)
    }
  }

  const applied: BankImportApplied[] = []
  const skipped: BankImportSkipped[] = []

  const findByMeter = (hint: string): (typeof readings)[0] | undefined => {
    const h = hint.trim().toLowerCase()
    if (!h) return undefined
    if (byMeter.has(h)) return byMeter.get(h)
    for (const [mn, rec] of byMeter) {
      if (mn.includes(h) || h.includes(mn)) return rec
    }
    return undefined
  }

  for (const br of bankRows) {
    const tried: string[] = []
    let target: (typeof readings)[0] | undefined
    let matchedCode: string | undefined
    let matchedMeter: string | undefined

    const meterHint = String((br as { meterNumber?: string }).meterNumber ?? '').trim()
    if (meterHint) {
      target = findByMeter(meterHint)
      if (target) matchedMeter = meterHint
      else tried.push(`тоолуур «${meterHint}» олдсонгүй`)
    }

    if (!target) {
      const codes = extractPaymentCodesFromText(br.description)
      for (const code of codes) {
        const existing = byRef.get(code)
        if (existing) {
          target = existing
          matchedCode = code
          break
        }
      }
      if (!target && codes.length > 0) {
        tried.push(...codes.map((c) => `${c}: заалт олдсонгүй`))
      }
    }

    if (!target) {
      skipped.push({
        rowIndex: br.rowIndex,
        reason: tried.length ? tried.join('; ') : 'Тоолуур эсвэл таних код олдсонгүй',
        description: br.description.slice(0, 200),
      })
      continue
    }

    const createdByMe =
      (target as { createdByUserId?: string | null }).createdByUserId != null &&
      String((target as { createdByUserId?: string | null }).createdByUserId) === String(user.userId)
    if (
      (String(user.role) === Role.ACCOUNTANT || String(user.role) === Role.MANAGER) &&
      !createdByMe &&
      !(await organizationIdInScope(scopedUser as Parameters<typeof organizationIdInScope>[0], target.organizationId))
    ) {
      skipped.push({
        rowIndex: br.rowIndex,
        reason: 'Эрхгүй',
        description: br.description.slice(0, 200),
      })
      continue
    }

    const total = roundMoney(Number((target as { total?: number }).total ?? 0) || 0)
    const currentPaid = roundMoney(Number((target as { paidAmount?: number | null }).paidAmount ?? 0) || 0)
    const add = roundMoney(br.amount)
    let newPaid = roundMoney(currentPaid + add)
    if (newPaid > total) newPaid = total

    if (newPaid <= currentPaid + EPS) {
      skipped.push({
        rowIndex: br.rowIndex,
        reason: 'Нэмэхгүй (бүрэн төлөгдсөн эсвэл 0)',
        description: br.description.slice(0, 200),
      })
      continue
    }

    const approved = total > 0 ? total - newPaid <= EPS : newPaid <= EPS

    const updated = await prisma.meterReading.update({
      where: { id: target.id },
      data: {
        paidAmount: newPaid,
        approved,
        approvedAt: approved ? new Date() : null,
        approvedBy: approved ? String(user.userId) : null,
        updatedByUserId: user.userId,
      },
    })

    if (matchedCode) byRef.set(matchedCode, updated as typeof target)
    const mn = String(meterNumberById.get(target.meterId) ?? '').trim().toLowerCase()
    if (mn) byMeter.set(mn, updated as typeof target)

    applied.push({
      readingId: target.id,
      code: matchedCode,
      meterNumber: matchedMeter,
      added: roundMoney(newPaid - currentPaid),
      newPaid,
      total,
      rowIndex: br.rowIndex,
    })
  }

  return {
    year,
    month,
    bankRowsParsed: bankRows.length,
    applied,
    skipped,
  }
}
