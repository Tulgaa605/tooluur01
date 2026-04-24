import { NextRequest, NextResponse, after } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { getScopedOrganizationIds } from '@/lib/org-scope'
import {
  type BillingMode,
  applyWaterChargeSplitToWaterRates,
  computeReadingMoney,
  computeReadingMoneySplit,
  effectiveWaterChargeSplit,
  getHeatTariffRatesForPeriod,
  getWaterTariffRatesForPeriod,
  normalizeBillingMode,
  type WaterTariffRates,
} from '@/lib/meter-reading-calc'
import { propagateLaterReadingsAfterEndChange } from '@/lib/reading-propagate'
import { ensureOfficeOrganizationId } from '@/lib/readings-office-org'

function waterTariffAdjustedForMeter(
  raw: WaterTariffRates,
  billingMode: BillingMode,
  waterChargeSplit: string | null | undefined
): WaterTariffRates {
  return applyWaterChargeSplitToWaterRates(
    raw,
    effectiveWaterChargeSplit(waterChargeSplit, billingMode)
  )
}

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

    const officeOrgId = await ensureOfficeOrganizationId(user)
    const office = officeOrgId ?? user.organizationId
    if (!office) {
      return NextResponse.json({ error: 'Энэ байгууллагын заалт оруулах эрхгүй' }, { status: 403 })
    }
    const scopedUser = { ...user, organizationId: officeOrgId ?? user.organizationId }
    const roleStr = String(user.role)
    let scopedOrgIdSet: Set<string> | null = null
    if (roleStr === Role.ACCOUNTANT || roleStr === Role.MANAGER) {
      scopedOrgIdSet = new Set(await getScopedOrganizationIds(scopedUser as any))
    }

    const meterIds = [...new Set(items.map((i) => i.meterId))]
    const meters = await prisma.meter.findMany({
      where: { id: { in: meterIds } },
      select: {
        id: true,
        organizationId: true,
        billingMode: true,
        defaultHeatUsage: true,
        waterChargeSplit: true,
        pipeDiameterMm: true,
      },
    })
    const meterById = new Map(meters.map((m) => [m.id, m]))
    for (const id of meterIds) {
      if (!meterById.has(id)) {
        return NextResponse.json({ error: `Тоолуур олдсонгүй: ${id}` }, { status: 404 })
      }
    }

    const claimedOrgs = new Set<string>()
    if (roleStr === Role.ACCOUNTANT) {
      for (const m of meters) {
        if (m.organizationId === office) continue
        if (claimedOrgs.has(m.organizationId)) continue
        await claimCustomerOrgIfNeeded(office, m.organizationId)
        claimedOrgs.add(m.organizationId)
      }
    }

    const waterTariffCache = new Map<string, Awaited<ReturnType<typeof getWaterTariffRatesForPeriod>>>()
    const heatTariffCache = new Map<string, Awaited<ReturnType<typeof getHeatTariffRatesForPeriod>>>()
    const orgCategoryCache = new Map<string, string>()

    const waterCached = async (
      organizationId: string,
      year: number,
      month: number,
      pipeDiameterMm: number | null | undefined
    ) => {
      const pipeKey =
        pipeDiameterMm != null &&
        Number.isFinite(Number(pipeDiameterMm)) &&
        Number(pipeDiameterMm) > 0
          ? Math.trunc(Number(pipeDiameterMm))
          : 'org'
      const k = `${organizationId}|${year}|${month}|${pipeKey}`
      let v = waterTariffCache.get(k)
      if (!v) {
        v = await getWaterTariffRatesForPeriod(organizationId, year, month, {
          pipeDiameterMm:
            pipeKey === 'org' ? null : pipeKey,
        })
        waterTariffCache.set(k, v)
      }
      return v
    }
    const heatCached = async (organizationId: string, year: number, month: number) => {
      const k = `${organizationId}|${year}|${month}`
      let v = heatTariffCache.get(k)
      if (!v) {
        v = await getHeatTariffRatesForPeriod(organizationId, year, month)
        heatTariffCache.set(k, v)
      }
      return v
    }
    const orgCatCached = async (organizationId: string) => {
      if (orgCategoryCache.has(organizationId)) return orgCategoryCache.get(organizationId)!
      const o = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { category: true },
      })
      const c = o?.category ?? 'HOUSEHOLD'
      orgCategoryCache.set(organizationId, c)
      return c
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

    const periodKeys = new Set<string>()
    for (const it of items) {
      const m = meterById.get(it.meterId)!
      const pipeKey =
        m.pipeDiameterMm != null &&
        Number.isFinite(Number(m.pipeDiameterMm)) &&
        Number(m.pipeDiameterMm) > 0
          ? Math.trunc(Number(m.pipeDiameterMm))
          : 'org'
      periodKeys.add(`${m.organizationId}\t${it.year}\t${it.month}\t${pipeKey}`)
    }
    await Promise.all(
      [...periodKeys].map(async (pk) => {
        const [orgId, ys, ms, pipePart] = pk.split('\t')
        const y = Number(ys)
        const mo = Number(ms)
        const pipeOpt = pipePart === 'org' ? null : Number(pipePart)
        await Promise.all([
          waterCached(orgId, y, mo, pipeOpt),
          heatCached(orgId, y, mo),
          orgCatCached(orgId),
        ])
      })
    )

    const propagateAtEnd = new Map<string, PropagateTask>()

    if (items.some((i) => !i.id) && roleStr !== Role.ACCOUNTANT) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    for (const item of items) {
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

      const orgCategory = await orgCatCached(meter.organizationId)
      const pipeForItem =
        meter.pipeDiameterMm != null &&
        Number.isFinite(Number(meter.pipeDiameterMm)) &&
        Number(meter.pipeDiameterMm) > 0
          ? Math.trunc(Number(meter.pipeDiameterMm))
          : null
      const [waterTariffRaw, heatTariff] = await Promise.all([
        waterCached(meter.organizationId, item.year, item.month, pipeForItem),
        heatCached(meter.organizationId, item.year, item.month),
      ])
      const waterTariff = waterTariffAdjustedForMeter(waterTariffRaw, billingMode, meter.waterChargeSplit)
      const finalMoney =
        billingMode === 'WATER_HEAT'
          ? computeReadingMoneySplit(waterUsage, heatUsage, orgCategory, billingMode, waterTariff, heatTariff)
          : computeReadingMoney(usage, orgCategory, billingMode, waterTariff, heatTariff)

      const money = finalMoney

      if (item.id && existingById) {
        await prisma.meterReading.update({
          where: { id: item.id },
          data: {
            month: item.month,
            year: item.year,
            startValue: item.startValue,
            endValue: item.endValue,
            heatUsage,
            usage,
            baseClean: money.baseClean,
            baseDirty: money.baseDirty,
            cleanPerM3: money.cleanPerM3,
            dirtyPerM3: money.dirtyPerM3,
            cleanAmount: money.cleanAmount,
            dirtyAmount: money.dirtyAmount,
            heatBase: money.heatBase,
            heatPerM3: money.heatPerM3,
            heatPerM2: money.heatPerM2,
            heatAmount: money.heatAmount,
            subtotal: money.subtotal,
            vat: money.vat,
            total: money.total,
            updatedByUserId: user.userId,
          },
        })

        const periodChanged =
          Number(existingById.year) !== Number(item.year) ||
          Number(existingById.month) !== Number(item.month)
        const endChanged = endReadingChanged(existingById.endValue, item.endValue)
        if (!periodChanged && endChanged) {
          propagateAtEnd.set(meter.id, {
            meterId: meter.id,
            billingMode,
            waterChargeSplit: meter.waterChargeSplit,
            afterYear: Number(item.year),
            afterMonth: Number(item.month),
            carriedEnd: Number(item.endValue) || 0,
          })
        }
        continue
      }

      const existing =
        compoundByKey.get(tripleKey(item.meterId, item.year, item.month)) ?? null

      if (existing) {
        await prisma.meterReading.update({
          where: { id: existing.id },
          data: {
            startValue: item.startValue,
            endValue: item.endValue,
            heatUsage,
            usage,
            baseClean: money.baseClean,
            baseDirty: money.baseDirty,
            cleanPerM3: money.cleanPerM3,
            dirtyPerM3: money.dirtyPerM3,
            cleanAmount: money.cleanAmount,
            dirtyAmount: money.dirtyAmount,
            heatBase: money.heatBase,
            heatPerM3: money.heatPerM3,
            heatPerM2: money.heatPerM2,
            heatAmount: money.heatAmount,
            subtotal: money.subtotal,
            vat: money.vat,
            total: money.total,
            updatedByUserId: user.userId,
          },
        })
        const endChanged = endReadingChanged(existing.endValue, item.endValue)
        if (endChanged) {
          propagateAtEnd.set(meter.id, {
            meterId: meter.id,
            billingMode,
            waterChargeSplit: meter.waterChargeSplit,
            afterYear: Number(item.year),
            afterMonth: Number(item.month),
            carriedEnd: Number(item.endValue) || 0,
          })
        }
      } else {
        await prisma.meterReading.create({
          data: {
            meterId: item.meterId,
            organizationId: meter.organizationId,
            month: item.month,
            year: item.year,
            startValue: item.startValue,
            endValue: item.endValue,
            heatUsage,
            usage,
            baseClean: money.baseClean,
            baseDirty: money.baseDirty,
            cleanPerM3: money.cleanPerM3,
            dirtyPerM3: money.dirtyPerM3,
            cleanAmount: money.cleanAmount,
            dirtyAmount: money.dirtyAmount,
            heatBase: money.heatBase,
            heatPerM3: money.heatPerM3,
            heatPerM2: money.heatPerM2,
            heatAmount: money.heatAmount,
            subtotal: money.subtotal,
            vat: money.vat,
            total: money.total,
            createdBy: user.userId,
            createdByUserId: user.userId,
          },
        })
        propagateAtEnd.set(meter.id, {
          meterId: meter.id,
          billingMode,
          waterChargeSplit: meter.waterChargeSplit,
          afterYear: Number(item.year),
          afterMonth: Number(item.month),
          carriedEnd: Number(item.endValue) || 0,
        })
      }
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

    return NextResponse.json({ ok: true, saved: items.length })
  } catch (error: any) {
    console.error('readings/batch POST error:', error)
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json({ error: error.message || 'Алдаа гарлаа' }, { status: 500 })
  }
}
