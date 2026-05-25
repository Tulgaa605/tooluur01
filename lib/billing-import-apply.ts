import { prisma } from '@/lib/prisma'
import { getScopedOrganizationIds } from '@/lib/org-scope'
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

/**
 * Excel-ээс олон мөрийг нэг дамжлагаар шинэчилнэ.
 * - Бүх мета өгөгдлийг (org, meter, reading) урьдчилж нэг удаа авна
 * - Update-уудыг параллель ажиллуулна (мөн нэг бүрчлэн дуудлахгүй)
 */
export async function applyBillingExcelRows(
  rows: BillingExcelImportRow[],
  user: ScopedUser,
  officeOrgId: string | null
): Promise<BillingImportResult> {
  const applied: BillingImportApplied[] = []
  const skipped: BillingImportSkipped[] = []

  if (rows.length === 0) {
    return { rowsParsed: 0, applied, skipped }
  }

  // 1. Хэрэглэгчийн scope нэг удаа
  const scopedUser = { ...user, organizationId: officeOrgId ?? user.organizationId }
  const scopeIds = new Set(
    await getScopedOrganizationIds(scopedUser as Parameters<typeof getScopedOrganizationIds>[0])
  )
  // Хэрэв scope хоосон бол (USER role officeOrg-гүй г.м.) шалгалтыг алгасахгүй
  const enforceScope = scopeIds.size > 0

  // 2. Бүх байгууллага нэг удаа
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

  // 3. Импортын мөрөөс байгууллагуудыг шийдэх
  type Resolved = {
    br: BillingExcelImportRow
    orgId?: string
    meterHint: string
    desc: string
  }

  const resolved: Resolved[] = rows.map((br) => {
    const code = String(br.organizationCode ?? '').trim().toLowerCase()
    const name = String(br.organizationName ?? '').trim().toLowerCase()
    let orgId: string | undefined
    if (code && orgByCode.has(code)) orgId = orgByCode.get(code)
    else if (name && orgByName.has(name)) orgId = orgByName.get(name)
    const meterHint = String(br.meterNumber ?? '').trim()
    const desc = [br.organizationName, br.organizationCode, meterHint].filter(Boolean).join(' / ')
    return { br, orgId, meterHint, desc }
  })

  // 4. Бүх хамаарах байгууллагын тоолуурыг нэг удаа
  const orgIds = Array.from(
    new Set(resolved.map((r) => r.orgId).filter((id): id is string => Boolean(id)))
  )

  type MeterMini = { id: string; meterNumber: string; organizationId: string }
  const meters: MeterMini[] = orgIds.length
    ? await prisma.meter.findMany({
        where: { organizationId: { in: orgIds } },
        select: { id: true, meterNumber: true, organizationId: true },
      })
    : []

  const metersByOrg = new Map<string, MeterMini[]>()
  for (const m of meters) {
    const list = metersByOrg.get(m.organizationId) ?? []
    list.push(m)
    metersByOrg.set(m.organizationId, list)
  }

  // 5. Импортын мөр бүрт meter тулгана
  type ResolvedFull = Resolved & { meterId?: string; year: number; month: number }
  const resolvedWithMeter: ResolvedFull[] = resolved.map((r) => {
    const yearMonth = { year: r.br.year, month: r.br.month }
    if (!r.orgId) return { ...r, ...yearMonth }
    const list = metersByOrg.get(r.orgId) ?? []
    let meterId: string | undefined
    if (r.meterHint) {
      const h = r.meterHint.toLowerCase()
      const exact = list.find((x) => String(x.meterNumber).trim().toLowerCase() === h)
      if (exact) meterId = exact.id
      else {
        const partial = list.find((x) => {
          const mn = String(x.meterNumber).trim().toLowerCase()
          return mn.includes(h) || h.includes(mn)
        })
        if (partial) meterId = partial.id
      }
    } else if (list.length === 1) {
      meterId = list[0].id
    }
    return { ...r, meterId, ...yearMonth }
  })

  // 6. Бүх хамаарах заалтуудыг нэг удаа
  const readingFilters = resolvedWithMeter
    .filter((r) => r.orgId && r.meterId)
    .map((r) => ({
      organizationId: r.orgId!,
      meterId: r.meterId!,
      year: r.year,
      month: r.month,
    }))

  type ReadingMini = {
    id: string
    organizationId: string
    meterId: string
    year: number
    month: number
    total: number | null
    paidAmount: number | null
  }

  const readings: ReadingMini[] =
    readingFilters.length > 0
      ? ((await prisma.meterReading.findMany({
          where: { OR: readingFilters },
          select: {
            id: true,
            organizationId: true,
            meterId: true,
            year: true,
            month: true,
            total: true,
            paidAmount: true,
          },
        })) as unknown as ReadingMini[])
      : []

  const readingKey = (orgId: string, meterId: string, y: number, m: number) =>
    `${orgId}|${meterId}|${y}|${m}`
  const readingMap = new Map<string, ReadingMini>()
  for (const r of readings) {
    readingMap.set(readingKey(r.organizationId, r.meterId, r.year, r.month), r)
  }

  // 7. Update-уудыг бэлдэх
  type Update = {
    id: string
    newPaid: number
    approved: boolean
    approvedAt: Date | null
    approvedBy: string | null
    rowIndex: number
    meterNumber?: string
    organizationName?: string
    total: number
  }

  const updates: Update[] = []

  for (const r of resolvedWithMeter) {
    const { br, orgId, meterId, desc, meterHint } = r
    if (!orgId) {
      skipped.push({ rowIndex: br.rowIndex, reason: 'Байгууллага олдсонгүй', description: desc.slice(0, 200) })
      continue
    }
    if (enforceScope && !scopeIds.has(orgId)) {
      skipped.push({ rowIndex: br.rowIndex, reason: 'Эрхгүй', description: desc.slice(0, 200) })
      continue
    }
    if (!meterId) {
      skipped.push({
        rowIndex: br.rowIndex,
        reason: meterHint ? `Тоолуур «${meterHint}» олдсонгүй` : 'Тоолуур заавал',
        description: desc.slice(0, 200),
      })
      continue
    }
    const reading = readingMap.get(readingKey(orgId, meterId, br.year, br.month))
    if (!reading) {
      skipped.push({
        rowIndex: br.rowIndex,
        reason: `${br.year}-${String(br.month).padStart(2, '0')} заалт олдсонгүй`,
        description: desc.slice(0, 200),
      })
      continue
    }

    const total = roundMoney(Number(reading.total ?? 0) || 0)
    const prevPaid = roundMoney(Number(reading.paidAmount ?? 0) || 0)
    const incoming = roundMoney(Math.max(0, br.paidAmount))
    const newPaid = roundMoney(prevPaid + incoming)
    const approved = total > 0 ? total - newPaid <= EPS : newPaid > 0

    updates.push({
      id: reading.id,
      newPaid,
      approved,
      approvedAt: approved ? new Date() : null,
      approvedBy: approved ? String(user.userId) : null,
      rowIndex: br.rowIndex,
      meterNumber: meterHint || undefined,
      organizationName: br.organizationName || undefined,
      total,
    })
  }

  // 8. Update-уудыг параллель ажиллуулах
  await Promise.all(
    updates.map((u) =>
      prisma.meterReading.update({
        where: { id: u.id },
        data: {
          paidAmount: u.newPaid,
          approved: u.approved,
          approvedAt: u.approvedAt,
          approvedBy: u.approvedBy,
          updatedByUserId: user.userId,
        },
      })
    )
  )

  for (const u of updates) {
    applied.push({
      readingId: u.id,
      meterNumber: u.meterNumber,
      organizationName: u.organizationName,
      paidAmount: u.newPaid,
      total: u.total,
      rowIndex: u.rowIndex,
    })
  }

  return {
    rowsParsed: rows.length,
    applied,
    skipped,
  }
}
