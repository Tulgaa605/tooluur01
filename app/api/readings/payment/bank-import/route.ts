import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { Role } from '@/lib/role'
import { ensureOfficeOrganizationId } from '@/lib/readings-office-org'
import { applyBankPaymentRows } from '@/lib/bank-import-apply'
import { parseBankStatementRowsFromExcel } from '@/lib/bank-statement-excel'

export const runtime = 'nodejs'

function parseYearMonth(yRaw: string, mRaw: string): { year: number; month: number } | null {
  const year = yRaw ? parseInt(yRaw, 10) : NaN
  const month = mRaw ? parseInt(mRaw, 10) : NaN
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null
  if (!Number.isFinite(month) || month < 1 || month > 12) return null
  return { year, month }
}

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const officeOrgId = await ensureOfficeOrganizationId(user)
    const contentType = request.headers.get('content-type') ?? ''

    let year = NaN
    let month = NaN
    let bankRows: ReturnType<typeof parseBankStatementRowsFromExcel> = []

    if (contentType.includes('application/json')) {
      const data = await request.json()
      const ym = parseYearMonth(String(data.year ?? ''), String(data.month ?? ''))
      if (!ym) {
        return NextResponse.json({ error: 'Он, сар зөв сонгоно уу' }, { status: 400 })
      }
      year = ym.year
      month = ym.month

      const rawRows = Array.isArray(data.rows) ? data.rows : []
      bankRows = rawRows
        .map((r: Record<string, unknown>, i: number) => {
          const amount = Number(r.amount ?? 0)
          const description = String(r.description ?? '').trim()
          const meterNumber = String(r.meterNumber ?? '').trim()
          return {
            rowIndex: Number(r.rowIndex ?? i + 1) || i + 1,
            amount: Math.round(Math.abs(amount) * 100) / 100,
            description: description || '(утга хоосон)',
            ...(meterNumber ? { meterNumber } : {}),
          }
        })
        .filter(
          (r: { amount: number; description: string; meterNumber?: string }) =>
            r.amount > 0 && (r.description || r.meterNumber)
        )
    } else {
      const form = await request.formData()
      const file = form.get('file')
      if (!file || !(file instanceof Blob)) {
        return NextResponse.json({ error: 'Excel файл сонгоно уу' }, { status: 400 })
      }

      const ym = parseYearMonth(String(form.get('year') ?? ''), String(form.get('month') ?? ''))
      if (!ym) {
        return NextResponse.json({ error: 'Он, сар зөв сонгоно уу' }, { status: 400 })
      }
      year = ym.year
      month = ym.month

      const buf = await file.arrayBuffer()
      bankRows = parseBankStatementRowsFromExcel(buf)
    }

    if (bankRows.length === 0) {
      return NextResponse.json(
        {
          error:
            'Тохирох мөр алга. Дүн, гүйлгээний утга (болон тоолуур) бөглөнө үү.',
        },
        { status: 400 }
      )
    }

    const result = await applyBankPaymentRows(year, month, bankRows, user, officeOrgId)

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'Forbidden')) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error('bank-import:', error)
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
