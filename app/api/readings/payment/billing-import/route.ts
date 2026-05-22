import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { Role } from '@/lib/role'
import { ensureOfficeOrganizationId } from '@/lib/readings-office-org'
import { applyBillingExcelRows } from '@/lib/billing-import-apply'
import {
  parseBillingExportExcel,
  type BillingExcelImportRow,
} from '@/lib/billing-export-excel'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const officeOrgId = await ensureOfficeOrganizationId(user)
    const contentType = request.headers.get('content-type') ?? ''

    let rows: BillingExcelImportRow[] = []

    if (contentType.includes('application/json')) {
      const data = await request.json()
      const rawRows = Array.isArray(data.rows) ? data.rows : []
      rows = rawRows
        .map((r: Record<string, unknown>, i: number): BillingExcelImportRow => {
          const year = parseInt(String(r.year ?? ''), 10)
          const month = parseInt(String(r.month ?? ''), 10)
          const paidAmount = Number(r.paidAmount ?? 0)
          return {
            rowIndex: Number(r.rowIndex ?? i + 1) || i + 1,
            year,
            month,
            organizationName: String(r.organizationName ?? '').trim(),
            organizationCode: String(r.organizationCode ?? '').trim(),
            meterNumber: String(r.meterNumber ?? '').trim(),
            paidAmount: Math.round(Math.abs(paidAmount) * 100) / 100,
          }
        })
        .filter(
          (r: BillingExcelImportRow) =>
            r.year >= 2000 &&
            r.year <= 2100 &&
            r.month >= 1 &&
            r.month <= 12 &&
            r.paidAmount >= 0 &&
            (r.meterNumber || r.organizationName || r.organizationCode)
        )
    } else {
      const form = await request.formData()
      const file = form.get('file')
      if (!file || !(file instanceof Blob)) {
        return NextResponse.json({ error: 'Excel файл сонгоно уу' }, { status: 400 })
      }
      const buf = await file.arrayBuffer()
      const parsed = parseBillingExportExcel(buf)
      if (parsed.error) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      rows = parsed.rows
    }

    if (rows.length === 0) {
      return NextResponse.json(
        {
          error:
            'Тохирох мөр алга. Төлбөрийн хуудаснаас татсан Excel (Он, Сар, Байгууллага, Код, Тоолуур, …) ашиглана уу.',
        },
        { status: 400 }
      )
    }

    const result = await applyBillingExcelRows(rows, user, officeOrgId)

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'Forbidden')) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error('billing-import:', error)
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
