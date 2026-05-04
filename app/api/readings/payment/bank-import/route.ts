import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { organizationIdInScope } from '@/lib/org-scope'
import { ensureOfficeOrganizationId } from '@/lib/readings-office-org'
import { attachOrgsAndMetersToReadings } from '@/lib/attach-reading-relations'
import {
  extractPaymentCodesFromText,
  parseBankStatementRowsFromExcel,
} from '@/lib/bank-statement-excel'

export const runtime = 'nodejs'

const EPS = 0.009

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const officeOrgId = await ensureOfficeOrganizationId(user)
    const scopedUser = { ...user, organizationId: officeOrgId ?? user.organizationId }

    const form = await request.formData()
    const file = form.get('file')
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'Excel файл сонгоно уу' }, { status: 400 })
    }

    const yRaw = String(form.get('year') ?? '').trim()
    const mRaw = String(form.get('month') ?? '').trim()
    const year = yRaw ? parseInt(yRaw, 10) : NaN
    const month = mRaw ? parseInt(mRaw, 10) : NaN
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'Он зөв сонгоно уу' }, { status: 400 })
    }
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Сар зөв сонгоно уу' }, { status: 400 })
    }

    const buf = await file.arrayBuffer()
    const bankRows = parseBankStatementRowsFromExcel(buf)
    if (bankRows.length === 0) {
      return NextResponse.json(
        { error: 'Excel-д тохирох мөр олдсонгүй. «Дүн/Утга» баганатай эсвэл мөр бүрт дүн + утга байгаа эсэхийг шалгана уу.' },
        { status: 400 }
      )
    }

    const readings = await prisma.meterReading.findMany({
      where: { year, month },
    })

    const inScope: typeof readings = []
    for (const r of readings) {
      const createdByMe =
        (r as any).createdByUserId != null &&
        String((r as any).createdByUserId) === String(user.userId)
      const ok =
        createdByMe || (await organizationIdInScope(scopedUser as any, r.organizationId))
      if (ok) inScope.push(r)
    }

    const byRef = new Map<string, (typeof readings)[0]>()
    for (const r of inScope) {
      const ref = String((r as any).paymentReference ?? '').trim()
      if (ref.length === 6 && /^\d{6}$/.test(ref) && !byRef.has(ref)) {
        byRef.set(ref, r)
      }
    }

    type Applied = {
      readingId: string
      code: string
      added: number
      newPaid: number
      total: number
      rowIndex: number
    }
    type Skipped = { rowIndex: number; reason: string; description: string }
    const applied: Applied[] = []
    const skipped: Skipped[] = []

    for (const br of bankRows) {
      const codes = extractPaymentCodesFromText(br.description)
      if (codes.length === 0) {
        skipped.push({
          rowIndex: br.rowIndex,
          reason:
            '6 оронтой төлбөрийн код олдсонгүй (SMS-ээр илгээсэн кодыг гүйлгээний утгад оруулна)',
          description: br.description.slice(0, 200),
        })
        continue
      }

      const tried: string[] = []
      let appliedThis = false

      for (const code of codes) {
        const existing = byRef.get(code)
        if (!existing) {
          tried.push(`${code}: заалт олдсонгүй (SMS илгээж код үүсгэнэ)`)
          continue
        }

        const createdByMe =
          (existing as any).createdByUserId != null &&
          String((existing as any).createdByUserId) === String(user.userId)
        if (
          (String(user.role) === Role.ACCOUNTANT || String(user.role) === Role.MANAGER) &&
          !createdByMe &&
          !(await organizationIdInScope(scopedUser as any, existing.organizationId))
        ) {
          tried.push(`${code}: эрхгүй`)
          continue
        }

        const total = roundMoney(Number((existing as any).total ?? 0) || 0)
        const currentPaid = roundMoney(Number((existing as any).paidAmount ?? 0) || 0)
        const add = roundMoney(br.amount)
        let newPaid = roundMoney(currentPaid + add)
        if (newPaid > total) newPaid = total

        if (newPaid <= currentPaid + EPS) {
          tried.push(`${code}: нэмэхгүй (бүрэн төлөгдсөн эсвэл 0)`)
          continue
        }

        const approved = total > 0 ? total - newPaid <= EPS : newPaid <= EPS

        const updated = await prisma.meterReading.update({
          where: { id: existing.id },
          data: {
            paidAmount: newPaid,
            approved,
            approvedAt: approved ? new Date() : null,
            approvedBy: approved ? String(user.userId) : null,
            updatedByUserId: user.userId,
          },
        })

        byRef.set(code, updated as any)
        applied.push({
          readingId: existing.id,
          code,
          added: roundMoney(newPaid - currentPaid),
          newPaid,
          total,
          rowIndex: br.rowIndex,
        })
        appliedThis = true
        break
      }

      if (!appliedThis) {
        skipped.push({
          rowIndex: br.rowIndex,
          reason: tried.length ? tried.join('; ') : 'Код тааралгүй',
          description: br.description.slice(0, 200),
        })
      }
    }

    const updatedIds = [...new Set(applied.map((a) => a.readingId))]
    const refreshed =
      updatedIds.length === 0
        ? []
        : await prisma.meterReading.findMany({ where: { id: { in: updatedIds } } })
    const withRel = await attachOrgsAndMetersToReadings(refreshed)

    return NextResponse.json({
      success: true,
      year,
      month,
      bankRowsParsed: bankRows.length,
      applied,
      skipped,
      readings: withRel,
    })
  } catch (error: any) {
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error('bank-import:', error)
    return NextResponse.json({ error: error.message || 'Алдаа гарлаа' }, { status: 500 })
  }
}
