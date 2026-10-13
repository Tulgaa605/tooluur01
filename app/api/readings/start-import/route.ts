import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { Role } from '@/lib/role'
import { prisma } from '@/lib/prisma'
import { normalizeBillingMode } from '@/lib/meter-reading-calc-core'
import { parseStartReadingRowsFromExcel, phoneMatchKeys } from '@/lib/excel-start-reading-import'

export const runtime = 'nodejs'

function isWriteConflict(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /write conflict|deadlock|TransientTransactionError|Please retry/i.test(msg)
}

function sameReading(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005
}

async function persistStartValueUpdates(
  updates: { id: string; startValue: number; endValue?: number; usage: number }[],
  userId?: string
): Promise<void> {
  if (updates.length === 0) return

  const nowIso = new Date().toISOString()
  const setUser = userId ? { updatedByUserId: { $oid: userId } } : {}
  const ops = updates.map((u) => ({
    q: { _id: { $oid: u.id } },
    u: {
      $set: {
        startValue: u.startValue,
        usage: u.usage,
        updatedAt: { $date: nowIso },
        ...(u.endValue != null ? { endValue: u.endValue } : {}),
        ...setUser,
      },
    },
    multi: false,
    upsert: false,
  }))

  const CHUNK = 250
  for (let i = 0; i < ops.length; i += CHUNK) {
    const chunk = ops.slice(i, i + CHUNK)
    let lastErr: unknown
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await prisma.$runCommandRaw({
          update: 'meter_readings',
          updates: chunk,
          ordered: false,
        })
        lastErr = null
        break
      } catch (err) {
        lastErr = err
        if (!isWriteConflict(err) || attempt === 3) break
        await new Promise((r) => setTimeout(r, 80 * (attempt + 1)))
      }
    }
    if (lastErr) throw lastErr
  }
}

async function readImportInput(request: NextRequest): Promise<{
  year: number
  month: number
  rows: { rowIndex: number; phone: string; startValue: number; endValue: number | null }[]
}> {
  const ct = request.headers.get('content-type') || ''
  if (ct.includes('multipart/form-data')) {
    const form = await request.formData()
    const year = parseInt(String(form.get('year') ?? ''), 10)
    const month = parseInt(String(form.get('month') ?? ''), 10)
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) {
      return { year, month, rows: [] }
    }
    const buf = await file.arrayBuffer()
    return { year, month, rows: parseStartReadingRowsFromExcel(buf) }
  }

  const body = await request.json().catch(() => null)
  const year = parseInt(String(body?.year ?? ''), 10)
  const month = parseInt(String(body?.month ?? ''), 10)
  const rawRows = Array.isArray(body?.rows) ? body.rows : []
  const rows = rawRows
    .map((r: Record<string, unknown>, i: number) => {
      const endRaw = r.endValue
      const endNum = endRaw == null || endRaw === '' ? NaN : Number(endRaw)
      return {
        rowIndex: Number(r.rowIndex ?? i + 1) || i + 1,
        phone: String(r.phone ?? '').trim(),
        startValue: Math.round(Math.max(0, Number(r.startValue ?? 0)) * 100) / 100,
        endValue: Number.isFinite(endNum) && endNum >= 0 ? Math.round(endNum * 100) / 100 : null,
      }
    })
    .filter((r) => r.phone && Number.isFinite(r.startValue))
  return { year, month, rows }
}

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER, Role.USER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { year, month, rows } = await readImportInput(request)

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'Он буруу' }, { status: 400 })
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Сар буруу' }, { status: 400 })
    }
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Excel-д «Утас» болон «Эхний заалт» багана байх ёстой' },
        { status: 400 }
      )
    }

    const [orgs, readings] = await Promise.all([
      prisma.organization.findMany({
        select: {
          id: true,
          name: true,
          phone: true,
          users: { where: { phone: { not: null } }, select: { phone: true } },
        },
      }),
      prisma.meterReading.findMany({
        where: { year, month },
        select: {
          id: true,
          organizationId: true,
          endValue: true,
          usage: true,
          meterId: true,
          meter: { select: { billingMode: true } },
        },
      }),
    ])

    const idsByPhone = new Map<string, string[]>()
    const addPhoneKeys = (orgId: string, raw: string | null | undefined) => {
      for (const k of phoneMatchKeys(String(raw ?? ''))) {
        const list = idsByPhone.get(k) ?? []
        if (!list.includes(orgId)) list.push(orgId)
        idsByPhone.set(k, list)
      }
    }
    for (const o of orgs) {
      addPhoneKeys(o.id, o.phone)
      for (const u of o.users) addPhoneKeys(o.id, u.phone)
    }

    const readingsByOrg = new Map<string, typeof readings>()
    for (const r of readings) {
      const list = readingsByOrg.get(r.organizationId) ?? []
      list.push(r)
      readingsByOrg.set(r.organizationId, list)
    }

    const skipped: { phone: string; reason: string }[] = []
    const startByOrgId: Record<string, number> = {}
    const endByOrgId: Record<string, number> = {}
    const dbUpdates = new Map<string, { startValue: number; endValue?: number; usage: number }>()
    let applied = 0
    let endUpdated = 0
    const userId = /^[a-f\d]{24}$/i.test(user.userId) ? user.userId : undefined

    for (const row of rows) {
      const matched = new Set<string>()
      for (const k of phoneMatchKeys(row.phone)) {
        for (const id of idsByPhone.get(k) ?? []) matched.add(id)
      }
      const ids = [...matched]
      if (ids.length === 0) {
        skipped.push({ phone: row.phone, reason: 'Утас олдсонгүй' })
        continue
      }
      if (ids.length > 1) {
        skipped.push({ phone: row.phone, reason: 'Ижил утастай хэрэглэгч олон байна' })
        continue
      }
      const orgId = ids[0]
      const targets = readingsByOrg.get(orgId) ?? []
      if (targets.length === 0) {
        skipped.push({
          phone: row.phone,
          reason: `${year}-${String(month).padStart(2, '0')} заалт олдсонгүй`,
        })
        continue
      }

      let orgEndChanged = false
      for (const r of targets) {
        const mode = normalizeBillingMode(r.meter?.billingMode)
        const currentEnd = Math.round((Number(r.endValue ?? 0) || 0) * 100) / 100
        const excelEnd = row.endValue
        const endChanged = excelEnd != null && !sameReading(excelEnd, currentEnd)
        const nextEnd = endChanged ? excelEnd : currentEnd
        const usage =
          mode === 'HEAT'
            ? Number(r.usage ?? 0) || 0
            : Math.max(0, Math.round((nextEnd - row.startValue) * 100) / 100)
        dbUpdates.set(r.id, {
          startValue: row.startValue,
          usage,
          ...(endChanged ? { endValue: nextEnd } : {}),
        })
        if (endChanged) orgEndChanged = true
      }

      startByOrgId[orgId] = row.startValue
      if (orgEndChanged && row.endValue != null) {
        endByOrgId[orgId] = row.endValue
        endUpdated += 1
      }
      applied += 1
    }

    await persistStartValueUpdates([...dbUpdates.entries()].map(([id, v]) => ({ id, ...v })), userId)

    return NextResponse.json({
      success: true,
      year,
      month,
      applied,
      endUpdated,
      skippedCount: skipped.length,
      skipped: skipped.slice(0, 8),
      startByOrgId,
      endByOrgId,
    })
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'Forbidden')) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
