import { NextRequest, NextResponse, after } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { getScopedOrganizationIds } from '@/lib/org-scope'
import { type BillingMode, normalizeBillingMode } from '@/lib/meter-reading-calc'
import { propagateLaterReadingsAfterEndChange } from '@/lib/reading-propagate'
import { ensureOfficeOrganizationId } from '@/lib/readings-office-org'
import { recalculateOrgIdsForPeriod } from '@/lib/recalculate-readings-tariff'

function endReadingChanged(before: unknown, after: unknown): boolean {
  const a = Number(before)
  const b = Number(after)
  if (!Number.isFinite(a) && !Number.isFinite(b)) return String(before) !== String(after)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true
  return Math.abs(a - b) > 1e-6
}

function parseClientHeatUsage(
  data: { heatUsage?: unknown },
  billingMode: BillingMode
): number | undefined {
  const includeHeat = billingMode === 'HEAT' || billingMode === 'WATER_HEAT'
  if (!includeHeat) return undefined
  if (!('heatUsage' in data)) return undefined
  const raw = (data as { heatUsage?: unknown }).heatUsage
  if (raw === undefined || raw === null || raw === '') return undefined
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.').trim())
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.round(n * 100) / 100
}

const ZERO_MONEY = {
  baseClean: 0,
  baseDirty: 0,
  cleanPerM3: 0,
  dirtyPerM3: 0,
  cleanAmount: 0,
  dirtyAmount: 0,
  heatBase: 0,
  heatPerM3: 0,
  heatPerM2: 0,
  heatAmount: 0,
  subtotal: 0,
  vat: 0,
  total: 0,
} as const

type BatchItem = {
  id?: string
  meterId: string
  month: number
  year: number
  startValue: number
  endValue: number
  heatUsage?: number
}

function parseItems(body: unknown): BatchItem[] | null {
  if (!body || typeof body !== 'object') return null
  const raw = (body as { items?: unknown }).items
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: BatchItem[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') return null
    const o = row as Record<string, unknown>
    const meterId = typeof o.meterId === 'string' ? o.meterId : ''
    const month = Number(o.month)
    const year = Number(o.year)
    const startValue = Number(o.startValue ?? 0)
    const endValue = Number(o.endValue ?? 0)
    if (!meterId || !Number.isFinite(month) || !Number.isFinite(year)) return null
    const id = typeof o.id === 'string' && o.id ? o.id : undefined
    const heatUsage = o.heatUsage !== undefined && o.heatUsage !== null ? Number(o.heatUsage) : undefined
    out.push({
      id,
      meterId,
      month: Math.trunc(month),
      year: Math.trunc(year),
      startValue,
      endValue,
      heatUsage: Number.isFinite(heatUsage!) ? heatUsage : undefined,
    })
  }
  return out
}

type PropagateTask = {
  meterId: string
  billingMode: BillingMode
  waterChargeSplit?: string | null
  afterYear: number
  afterMonth: number
  carriedEnd: number
}

async function claimCustomerOrgIfNeeded(office: string, customerOrgId: string): Promise<void> {
  if (customerOrgId === office) return
  const org = await prisma.organization.findUnique({
    where: { id: customerOrgId },
    select: { id: true, managedByOrganizationId: true },
  })
  if (!org) throw new Error('Байгууллага олдсонгүй')
  if (org.managedByOrganizationId == null) {
    await prisma.organization.update({
      where: { id: org.id },
      data: { managedByOrganizationId: office },
    })
  } else if (org.managedByOrganizationId !== office) {
    throw new Error('Энэ байгууллагын заалт оруулах эрхгүй')
  }
}

/**
 * Заалт оруулах modal-оос олон мөрийг нэг HTTP + нэг сервер ачаалалтай хадгална.
 * Тоолуур бүрийн дагуулалтыг төгсгөлд нь зэрэгцээ ажиллуулна.
 */
export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const items = parseItems(body)
    if (!items) {
      return NextResponse.json({ error: 'items массив шаардлагатай' }, { status: 400 })
    }

    // Adminstrative fetches in parallel.
    const officeOrgIdPromise = ensureOfficeOrganizationId(user)
    const roleStr = String(user.role)
    const meterIds = [...new Set(items.map((i) => i.meterId))]
    const metersPromise = prisma.meter.findMany({
      where: { id: { in: meterIds } },
      select: {
        id: true,
        organizationId: true,
        billingMode: true,
        defaultHeatUsage: true,
        waterChargeSplit: true,
        pipeDiameterMm: true,
        billingCategory: true,
      },
    })
    const officeOrgId = await officeOrgIdPromise
    const office = officeOrgId ?? user.organizationId
    if (!office) {
      return NextResponse.json({ error: 'Энэ байгууллагын заалт оруулах эрхгүй' }, { status: 403 })
    }
    const scopedUser = { ...user, organizationId: officeOrgId ?? user.organizationId }
    let scopedOrgIdSet: Set<string> | null = null
    if (roleStr === Role.ACCOUNTANT || roleStr === Role.MANAGER) {
      scopedOrgIdSet = new Set(await getScopedOrganizationIds(scopedUser as any))
    }

    const meters = await metersPromise
    const meterById = new Map(meters.map((m) => [m.id, m]))
    for (const id of meterIds) {
      if (!meterById.has(id)) {
        return NextResponse.json({ error: `Тоолуур олдсонгүй: ${id}` }, { status: 404 })
      }
    }

    // Тоолуурын organization-ийг урьдчилаад зэрэгцүүлэн "claim" хийнэ.
    if (roleStr === Role.ACCOUNTANT) {
      const claimOrgIds = [
        ...new Set(meters.map((m) => m.organizationId).filter((id) => id !== office)),
      ]
      await Promise.all(claimOrgIds.map((orgId) => claimCustomerOrgIfNeeded(office, orgId)))
    }

    const tripleKey = (meterId: string, y: number, m: number) => `${meterId}\t${y}\t${m}`

    const readingIds = [...new Set(items.map((i) => i.id).filter(Boolean) as string[])]
    const readingsById = new Map<string, Awaited<ReturnType<typeof prisma.meterReading.findUnique>> & object>()
    if (readingIds.length > 0) {
      const rows = await prisma.meterReading.findMany({ where: { id: { in: readingIds } } })
      for (const r of rows) readingsById.set(r.id, r)
      for (const id of readingIds) {
        if (!readingsById.has(id)) {
          return NextResponse.json({ error: 'Заалт олдсонгүй' }, { status: 404 })
        }
      }
    }

    const uniqueTriples = new Map<string, { meterId: string; year: number; month: number }>()
    for (const it of items) {
      if (it.id) continue
      const k = tripleKey(it.meterId, it.year, it.month)
      if (!uniqueTriples.has(k)) uniqueTriples.set(k, { meterId: it.meterId, year: it.year, month: it.month })
    }
    const compoundByKey = new Map<string, Awaited<ReturnType<typeof prisma.meterReading.findUnique>> & object>()
    if (uniqueTriples.size > 0) {
      const rows = await prisma.meterReading.findMany({
        where: {
          OR: [...uniqueTriples.values()].map((t) => ({
            AND: [{ meterId: t.meterId }, { year: t.year }, { month: t.month }],
          })),
        },
      })
      for (const r of rows) {
        if (r) compoundByKey.set(tripleKey(r.meterId, r.year, r.month), r)
      }
    }

    const propagateAtEnd = new Map<string, PropagateTask>()

    if (
      items.some((i) => !i.id) &&
      roleStr !== Role.ACCOUNTANT &&
      roleStr !== Role.MANAGER
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Нэг (meterId, year, month) дээр олон item ирвэл сүүлчийнхийг авна
    // (зэрэгцээ ажиллахад unique index дээр давхардахаас сэргийлнэ).
    const dedupedById = new Map<string, BatchItem>()
    const dedupedByKey = new Map<string, BatchItem>()
    const orderedItems: BatchItem[] = []
    for (const it of items) {
      if (it.id) {
        dedupedById.set(it.id, it)
      } else {
        dedupedByKey.set(tripleKey(it.meterId, it.year, it.month), it)
      }
    }
    // Дарааллыг хадгална (анхны эрэмбэ): id-тай эхний орох, тэгээд key-тэй.
    const seenIds = new Set<string>()
    const seenKeys = new Set<string>()
    for (const it of items) {
      if (it.id) {
        if (seenIds.has(it.id)) continue
        seenIds.add(it.id)
        orderedItems.push(dedupedById.get(it.id)!)
      } else {
        const k = tripleKey(it.meterId, it.year, it.month)
        if (seenKeys.has(k)) continue
        seenKeys.add(k)
        orderedItems.push(dedupedByKey.get(k)!)
      }
    }

    type ComputedItem = {
      item: BatchItem
      data: Record<string, unknown>
      mode: 'updateById' | 'updateByKey' | 'create'
      existingId?: string
      propagate?: PropagateTask
    }

    const computed: ComputedItem[] = []

    for (const item of orderedItems) {
      const meter = meterById.get(item.meterId)!
      const billingMode = normalizeBillingMode(meter.billingMode)
      const waterUsage = item.endValue - item.startValue
      if (waterUsage < 0) {
        return NextResponse.json(
          { error: 'Эцсийн заалт эхний заалтаас их байх ёстой' },
          { status: 400 }
        )
      }

      const meterDefaultHeat =
        Number.isFinite(Number((meter as { defaultHeatUsage?: unknown }).defaultHeatUsage)) &&
        Number((meter as { defaultHeatUsage?: unknown }).defaultHeatUsage) > 0
          ? Math.round(Number((meter as { defaultHeatUsage?: unknown }).defaultHeatUsage) * 100) / 100
          : 0

      let existingById: (Awaited<ReturnType<typeof prisma.meterReading.findUnique>> & object) | null = null
      if (item.id) {
        existingById = readingsById.get(item.id) ?? null
        if (!existingById) {
          return NextResponse.json({ error: 'Заалт олдсонгүй' }, { status: 404 })
        }
        if (existingById.meterId !== item.meterId) {
          return NextResponse.json({ error: 'Тоолуур таарахгүй байна' }, { status: 400 })
        }
        if (roleStr === Role.ACCOUNTANT || roleStr === Role.MANAGER) {
          const createdByMe =
            (existingById as { createdByUserId?: string | null }).createdByUserId != null &&
            String((existingById as { createdByUserId?: string | null }).createdByUserId) === String(user.userId)
          const inScope = scopedOrgIdSet?.has(existingById.organizationId) ?? false
          if (!createdByMe && !inScope) {
            return NextResponse.json({ error: 'Энэ заалтыг засах эрхгүй' }, { status: 403 })
          }
        }
      }

      // Зөвхөн хэрэглэгчийн оруулсан утгууд: startValue, endValue, heatUsage, usage.
      // Мөнгөн дүн (baseClean, total, vat, гэх мэт) бүгд 0 болгож хадгална.
      // "Бодолт" товч дарах үед сервер талд recalculate=1-ээр тооцоо хийгдэж дэлгэцэнд гарна.
      let heatUsage: number
      let usage: number
      if (item.id && existingById) {
        const clientHeat = parseClientHeatUsage(item, billingMode)
        const existingHeat = Number((existingById as { heatUsage?: unknown }).heatUsage ?? 0) || 0
        const fallbackHeat = existingHeat > 0 ? existingHeat : meterDefaultHeat > 0 ? meterDefaultHeat : 0
        heatUsage =
          billingMode === 'WATER_HEAT'
            ? (clientHeat ?? (fallbackHeat > 0 ? fallbackHeat : waterUsage > 0 ? waterUsage : 0))
            : (clientHeat ?? fallbackHeat)
        usage = billingMode === 'HEAT' ? heatUsage : waterUsage
      } else {
        const clientHeat = parseClientHeatUsage(item, billingMode)
        heatUsage =
          billingMode === 'WATER_HEAT'
            ? (clientHeat ?? (meterDefaultHeat > 0 ? meterDefaultHeat : waterUsage > 0 ? waterUsage : 0))
            : (clientHeat ?? (meterDefaultHeat > 0 ? meterDefaultHeat : 0))
        usage = billingMode === 'HEAT' ? heatUsage : waterUsage
      }

      if (item.id && existingById) {
        computed.push({
          item,
          mode: 'updateById',
          existingId: item.id,
          data: {
            month: item.month,
            year: item.year,
            startValue: item.startValue,
            endValue: item.endValue,
            heatUsage,
            usage,
            ...ZERO_MONEY,
            updatedByUserId: user.userId,
          },
          propagate:
            Number(existingById.year) === Number(item.year) &&
            Number(existingById.month) === Number(item.month) &&
            endReadingChanged(existingById.endValue, item.endValue)
              ? {
                  meterId: meter.id,
                  billingMode,
                  waterChargeSplit: meter.waterChargeSplit,
                  afterYear: Number(item.year),
                  afterMonth: Number(item.month),
                  carriedEnd: Number(item.endValue) || 0,
                }
              : undefined,
        })
        continue
      }

      const existing =
        compoundByKey.get(tripleKey(item.meterId, item.year, item.month)) ?? null

      if (existing) {
        computed.push({
          item,
          mode: 'updateByKey',
          existingId: existing.id,
          data: {
            startValue: item.startValue,
            endValue: item.endValue,
            heatUsage,
            usage,
            ...ZERO_MONEY,
            updatedByUserId: user.userId,
          },
          propagate: endReadingChanged(existing.endValue, item.endValue)
            ? {
                meterId: meter.id,
                billingMode,
                waterChargeSplit: meter.waterChargeSplit,
                afterYear: Number(item.year),
                afterMonth: Number(item.month),
                carriedEnd: Number(item.endValue) || 0,
              }
            : undefined,
        })
      } else {
        computed.push({
          item,
          mode: 'create',
          data: {
            meterId: item.meterId,
            organizationId: meter.organizationId,
            month: item.month,
            year: item.year,
            startValue: item.startValue,
            endValue: item.endValue,
            heatUsage,
            usage,
            ...ZERO_MONEY,
            createdBy: user.userId,
            createdByUserId: user.userId,
          },
          propagate: {
            meterId: meter.id,
            billingMode,
            waterChargeSplit: meter.waterChargeSplit,
            afterYear: Number(item.year),
            afterMonth: Number(item.month),
            carriedEnd: Number(item.endValue) || 0,
          },
        })
      }
    }

    // Зэрэгцээ долгионоор бичнэ. Wave хэмжээ нь mongo connection pool-той тааруулна.
    const WRITE_WAVE = 32
    const savedRows: Array<Awaited<ReturnType<typeof prisma.meterReading.update>>> = []
    for (let i = 0; i < computed.length; i += WRITE_WAVE) {
      const slice = computed.slice(i, i + WRITE_WAVE)
      const rows = await Promise.all(
        slice.map((c) => {
          if (c.mode === 'updateById' || c.mode === 'updateByKey') {
            return prisma.meterReading.update({
              where: { id: c.existingId! },
              data: c.data,
            })
          }
          return prisma.meterReading.create({ data: c.data as never })
        })
      )
      for (const r of rows) savedRows.push(r)
    }

    // Хадгалсны дараа тухайн сарын тарифаар (төрлийн тариф + зөрүү) дүнг тооцож DB-д бичнэ.
    const periodBuckets = new Map<
      string,
      { year: number; month: number; orgIds: Set<string> }
    >()
    for (const r of savedRows) {
      const year = Number(r.year)
      const month = Number(r.month)
      const k = `${year}|${month}`
      const bucket = periodBuckets.get(k) ?? { year, month, orgIds: new Set<string>() }
      bucket.orgIds.add(r.organizationId)
      periodBuckets.set(k, bucket)
    }
    for (const bucket of periodBuckets.values()) {
      await recalculateOrgIdsForPeriod([...bucket.orgIds], bucket.year, bucket.month)
    }

    const savedIds = savedRows.map((r) => r.id).filter(Boolean) as string[]
    const savedRowsForResponse =
      savedIds.length > 0
        ? await prisma.meterReading.findMany({ where: { id: { in: savedIds } } })
        : savedRows

    // Дагуулах ажлууд: тоолуур бүрд хамгийн сүүлд бичигдсэн item-ын мэдээллийг ашиглана.
    for (const c of computed) {
      if (c.propagate) propagateAtEnd.set(c.propagate.meterId, c.propagate)
    }

    const propTasks = [...propagateAtEnd.values()]
    const uid = user.userId
    if (propTasks.length > 0) {
      after(async () => {
        const PROP_WAVE = 16
        for (let i = 0; i < propTasks.length; i += PROP_WAVE) {
          await Promise.all(
            propTasks.slice(i, i + PROP_WAVE).map((t) =>
              propagateLaterReadingsAfterEndChange({
                ...t,
                updatedByUserId: uid,
              })
            )
          )
        }
      })
    }

    // Хадгалсан мөрүүдэд харагдах organization, meter relation-ыг хавсаргаж буцаана —
    // ингэснээр client тал нь дахин fetchReadings хийлгүй гол хүснэгтэндээ шууд оруулна.
    const savedOrgIds = [...new Set(savedRowsForResponse.map((r) => r.organizationId))]
    const savedMeterIdsAll = [...new Set(savedRowsForResponse.map((r) => r.meterId))]
    const [orgsForResp, metersForResp] = await Promise.all([
      savedOrgIds.length
        ? prisma.organization.findMany({
            where: { id: { in: savedOrgIds } },
            select: {
              id: true,
              name: true,
              code: true,
              category: true,
              phone: true,
              users: { where: { phone: { not: null } }, select: { phone: true } },
            },
          })
        : Promise.resolve([]),
      savedMeterIdsAll.length
        ? prisma.meter.findMany({
            where: { id: { in: savedMeterIdsAll } },
            select: {
              id: true,
              meterNumber: true,
              billingMode: true,
              waterChargeSplit: true,
              pipeDiameterMm: true,
              billingCategory: true,
            },
          })
        : Promise.resolve([]),
    ])
    const orgRespMap = new Map(orgsForResp.map((o) => [o.id, o]))
    const meterRespMap = new Map(metersForResp.map((m) => [m.id, m]))
    const responseRows = savedRowsForResponse.map((r) => ({
      ...r,
      organization: orgRespMap.get(r.organizationId) ?? null,
      meter: meterRespMap.get(r.meterId) ?? null,
    }))

    return NextResponse.json({ ok: true, saved: computed.length, rows: responseRows })
  } catch (error: any) {
    console.error('readings/batch POST error:', error)
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json({ error: error.message || 'Алдаа гарлаа' }, { status: 500 })
  }
}
