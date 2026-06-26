import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/carry-forward'
import type { BillingPeriodGridSnapshot } from '@/lib/billing-snapshot'
import { aggregateBillingPeriodSnapshots } from '@/lib/billing-snapshot'
import { withPrismaWriteRetry } from '@/lib/prisma-write-retry'

export type BillingPeriodKey = {
  organizationId: string
  year: number
  month: number
}

export function billingPeriodMapKey(key: BillingPeriodKey): string {
  return `${key.organizationId}|${key.year}|${key.month}`
}

export async function ensureOrganizationBillingPeriod(
  key: BillingPeriodKey,
  userId?: string | null
) {
  const organizationId = String(key.organizationId ?? '').trim()
  const year = Number(key.year)
  const month = Number(key.month)
  if (!organizationId || !Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error('billing period key буруу')
  }

  return withPrismaWriteRetry(() =>
    prisma.organizationBillingPeriod.upsert({
      where: {
        organizationId_year_month: { organizationId, year, month },
      },
      create: {
        organizationId,
        year,
        month,
        createdByUserId: userId ?? null,
        updatedByUserId: userId ?? null,
      },
      update: {
        updatedByUserId: userId ?? undefined,
      },
    })
  )
}

/** Олон (org, он, сар) хослолд billing period олно; байхгүйг createMany-аар үүсгэнэ (уншилтын hot path). */
export async function ensureBillingPeriodsForKeys(
  keys: BillingPeriodKey[],
  userId?: string | null,
  preloaded?: Array<{
    id: string
    organizationId: string
    year: number
    month: number
    paidAmount: number | null
    previousRemainingOverride: number | null
    previousRemainingManual: boolean | null
  }>
): Promise<
  Map<
    string,
    {
      id: string
      paidAmount: number
      previousRemainingOverride: number | null
      previousRemainingManual: boolean
    }
  >
> {
  const unique = new Map<string, BillingPeriodKey>()
  for (const k of keys) {
    const organizationId = String(k.organizationId ?? '').trim()
    if (!organizationId) continue
    const year = Number(k.year)
    const month = Number(k.month)
    if (!Number.isInteger(year) || !Number.isInteger(month)) continue
    unique.set(billingPeriodMapKey({ organizationId, year, month }), {
      organizationId,
      year,
      month,
    })
  }

  const out = new Map<
    string,
    {
      id: string
      paidAmount: number
      previousRemainingOverride: number | null
      previousRemainingManual: boolean
    }
  >()
  if (unique.size === 0) return out

  const preloadedByKey = new Map<
    string,
    {
      id: string
      organizationId: string
      year: number
      month: number
      paidAmount: number | null
      previousRemainingOverride: number | null
      previousRemainingManual: boolean | null
    }
  >()
  for (const row of preloaded ?? []) {
    preloadedByKey.set(
      billingPeriodMapKey({
        organizationId: row.organizationId,
        year: row.year,
        month: row.month,
      }),
      row
    )
  }

  const missingKeys: BillingPeriodKey[] = []
  for (const [key, periodKey] of unique) {
    const row = preloadedByKey.get(key)
    if (row) {
      out.set(key, {
        id: row.id,
        paidAmount: roundMoney(Number(row.paidAmount) || 0),
        previousRemainingOverride:
          row.previousRemainingOverride == null
            ? null
            : roundMoney(Number(row.previousRemainingOverride)),
        previousRemainingManual: Boolean(row.previousRemainingManual),
      })
    } else {
      missingKeys.push(periodKey)
    }
  }

  if (missingKeys.length > 0) {
    const found = await prisma.organizationBillingPeriod.findMany({
      where: {
        OR: missingKeys.map((k) => ({
          organizationId: k.organizationId,
          year: k.year,
          month: k.month,
        })),
      },
      select: {
        id: true,
        organizationId: true,
        year: true,
        month: true,
        paidAmount: true,
        previousRemainingOverride: true,
        previousRemainingManual: true,
      },
    })

    const stillMissing: BillingPeriodKey[] = []
    for (const periodKey of missingKeys) {
      const key = billingPeriodMapKey(periodKey)
      const row = found.find(
        (r) =>
          r.organizationId === periodKey.organizationId &&
          r.year === periodKey.year &&
          r.month === periodKey.month
      )
      if (row) {
        out.set(key, {
          id: row.id,
          paidAmount: roundMoney(Number(row.paidAmount) || 0),
          previousRemainingOverride:
            row.previousRemainingOverride == null
              ? null
              : roundMoney(Number(row.previousRemainingOverride)),
          previousRemainingManual: Boolean(row.previousRemainingManual),
        })
      } else {
        stillMissing.push(periodKey)
      }
    }

    if (stillMissing.length > 0) {
      await prisma.organizationBillingPeriod.createMany({
        data: stillMissing.map((k) => ({
          organizationId: k.organizationId,
          year: k.year,
          month: k.month,
          createdByUserId: userId ?? null,
          updatedByUserId: userId ?? null,
        })),
      })
      const created = await prisma.organizationBillingPeriod.findMany({
        where: {
          OR: stillMissing.map((k) => ({
            organizationId: k.organizationId,
            year: k.year,
            month: k.month,
          })),
        },
        select: {
          id: true,
          organizationId: true,
          year: true,
          month: true,
          paidAmount: true,
          previousRemainingOverride: true,
          previousRemainingManual: true,
        },
      })
      for (const row of created) {
        out.set(billingPeriodMapKey(row), {
          id: row.id,
          paidAmount: roundMoney(Number(row.paidAmount) || 0),
          previousRemainingOverride:
            row.previousRemainingOverride == null
              ? null
              : roundMoney(Number(row.previousRemainingOverride)),
          previousRemainingManual: Boolean(row.previousRemainingManual),
        })
      }
    }
  }

  return out
}

/** Төлбөрийн grid-ийн бүх баганыг DB-д snapshot болгон хадгална (дараалалтай + retry). */
function snapshotNeedsUpdate(
  existing: {
    usage: number | null
    total: number | null
    paidAmount: number | null
    remaining: number | null
    paymentStatus: string | null
    meterNumbers: string | null
    ebarimtStatus: string | null
    ebarimtBillId: string | null
    organizationName: string | null
    customerPhones: string | null
    previousRemainingOverride: number | null
    previousRemainingManual: boolean | null
  },
  data: {
    usage: number
    total: number
    paidAmount: number
    remaining: number
    paymentStatus: string
    meterNumbers: string | null
    ebarimtStatus: string
    ebarimtBillId: string | null
    organizationName: string | null
    customerPhones: string | null
    previousRemainingOverride?: number
  }
): boolean {
  const eq = (a: number, b: number) => Math.abs(a - b) < 0.005
  const eqStr = (a: string | null | undefined, b: string | null | undefined) =>
    String(a ?? '') === String(b ?? '')

  if (!eq(Number(existing.usage ?? 0), data.usage)) return true
  if (!eq(Number(existing.total ?? 0), data.total)) return true
  if (!eq(Number(existing.paidAmount ?? 0), data.paidAmount)) return true
  if (!eq(Number(existing.remaining ?? 0), data.remaining)) return true
  if (!eqStr(existing.paymentStatus, data.paymentStatus)) return true
  if (!eqStr(existing.meterNumbers, data.meterNumbers)) return true
  if (!eqStr(existing.ebarimtStatus, data.ebarimtStatus)) return true
  if (!eqStr(existing.ebarimtBillId, data.ebarimtBillId)) return true
  if (!eqStr(existing.organizationName, data.organizationName)) return true
  if (!eqStr(existing.customerPhones, data.customerPhones)) return true
  if (
    data.previousRemainingOverride !== undefined &&
    !existing.previousRemainingManual &&
    !eq(Number(existing.previousRemainingOverride ?? 0), data.previousRemainingOverride)
  ) {
    return true
  }
  return false
}

export async function persistBillingPeriodSnapshots(
  rows: BillingPeriodGridSnapshot[],
  userId?: string | null
): Promise<void> {
  const byId = new Map<string, BillingPeriodGridSnapshot>()
  for (const row of rows) {
    const id = String(row.billingPeriodId ?? '').trim()
    if (!/^[a-f\d]{24}$/i.test(id)) continue
    byId.set(id, row)
  }
  if (byId.size === 0) return

  const existingRows = await prisma.organizationBillingPeriod.findMany({
    where: { id: { in: [...byId.keys()] } },
    select: {
      id: true,
      previousRemainingManual: true,
      previousRemainingOverride: true,
      usage: true,
      total: true,
      paidAmount: true,
      remaining: true,
      paymentStatus: true,
      meterNumbers: true,
      ebarimtStatus: true,
      ebarimtBillId: true,
      organizationName: true,
      customerPhones: true,
    },
  })
  const existingById = new Map(existingRows.map((row) => [row.id, row]))

  for (const [id, row] of byId) {
    const existing = existingById.get(id)
    if (!existing) continue

    const data: {
      usage: number
      total: number
      remaining: number
      paymentStatus: string
      meterNumbers: string | null
      ebarimtStatus: string
      ebarimtBillId: string | null
      organizationName: string | null
      customerPhones: string | null
      paidAmount: number
      previousRemainingOverride?: number
      updatedByUserId?: string
    } = {
      usage: roundMoney(row.usage),
      total: roundMoney(row.total),
      remaining: roundMoney(row.remaining),
      paymentStatus: row.paymentStatus,
      meterNumbers: row.meterNumbers || null,
      ebarimtStatus: row.ebarimtStatus || 'PENDING',
      ebarimtBillId: row.ebarimtBillId,
      organizationName: row.organizationName || null,
      customerPhones: row.customerPhones || null,
      paidAmount: roundMoney(row.paidAmount),
      updatedByUserId: userId ?? undefined,
    }

    if (!existing.previousRemainingManual) {
      data.previousRemainingOverride = roundMoney(row.previousRemaining)
    }

    if (!snapshotNeedsUpdate(existing, data)) continue

    await withPrismaWriteRetry(() =>
      prisma.organizationBillingPeriod.update({
        where: { id },
        data,
      })
    )
  }
}

/** API хариу буцаасны дараа Next.js `after()`-аар snapshot хадгална. */
export function scheduleBillingPeriodSnapshots(
  rows: BillingPeriodGridSnapshot[],
  userId: string | null | undefined,
  scheduleAfter: (fn: () => void | Promise<void>) => void
): void {
  const aggregated = aggregateBillingPeriodSnapshots(rows)
  if (aggregated.length === 0) return
  scheduleAfter(async () => {
    try {
      await persistBillingPeriodSnapshots(aggregated, userId)
    } catch (err) {
      console.warn('[billing] snapshot persist failed:', err)
    }
  })
}

export function billingPeriodDbSetupHint(error: unknown): string | null {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  if (
    /Cannot read properties of undefined \(reading '[^']+'\)/i.test(msg) &&
    /organizationBillingPeriod/i.test(msg)
  ) {
    return (
      'Prisma client хуучин байна (organization_billing_periods). ' +
      'Терминал: npx prisma generate && npm run build && pm2 restart water-billing-system'
    )
  }
  if (/Unknown model.*OrganizationBillingPeriod/i.test(msg)) {
    return (
      'Prisma schema шинэчлэгдсэн ч client/build хуучин байна. ' +
      'Терминал: npx prisma generate && npm run build && pm2 restart water-billing-system'
    )
  }
  if (/organization_billing_periods.*(does not exist|not found)/i.test(msg)) {
    return 'organization_billing_periods collection байхгүй. Терминал: npx prisma db push'
  }
  return null
}

export type BillingPeriodAttachRow = {
  id?: string
  organizationId: string
  year: number
  month: number
  paidAmount?: number | null
  previousRemaining?: number | null
  readingIds?: string[]
  isPhantom?: boolean
}

/** API хариунд тогтвортой billing period ID хавсаргана. */
export async function attachBillingPeriodsToRows<T extends BillingPeriodAttachRow>(
  rows: T[],
  userId?: string | null,
  preloadedBillingPeriods?: Array<{
    id: string
    organizationId: string
    year: number
    month: number
    paidAmount: number | null
    previousRemainingOverride: number | null
    previousRemainingManual: boolean | null
  }>
): Promise<Array<T & { billingPeriodId: string; readingIds: string[] }>> {
  if (rows.length === 0) return []

  const periodMap = await ensureBillingPeriodsForKeys(
    rows.map((r) => ({
      organizationId: r.organizationId,
      year: Number(r.year),
      month: Number(r.month),
    })),
    userId,
    preloadedBillingPeriods
  )

  return rows.map((r) => {
    const key = billingPeriodMapKey({
      organizationId: r.organizationId,
      year: Number(r.year),
      month: Number(r.month),
    })
    const bp = periodMap.get(key)
    const billingPeriodId = bp?.id ?? String(r.id ?? '')
    const isPhantom = Boolean(r.isPhantom) || String(r.id ?? '').startsWith('phantom-')
    const rawId = String(r.id ?? '')
    const meterReadingId =
      !isPhantom &&
      /^[a-f\d]{24}$/i.test(rawId) &&
      rawId !== billingPeriodId
        ? rawId
        : undefined
    const existingReadingIds = Array.isArray(r.readingIds) ? r.readingIds : []
    const readingIds =
      existingReadingIds.length > 0
        ? existingReadingIds
        : meterReadingId
          ? [meterReadingId]
          : []

    const paidFromReadings = roundMoney(Number(r.paidAmount ?? 0) || 0)
    const paidAmount = isPhantom
      ? roundMoney(Number(bp?.paidAmount ?? paidFromReadings) || 0)
      : paidFromReadings

    const prevComputed = Number(r.previousRemaining ?? 0)
    const previousRemaining =
      bp?.previousRemainingManual &&
      bp?.previousRemainingOverride != null &&
      Number(r.month) === 4
        ? bp.previousRemainingOverride
        : Number.isFinite(prevComputed)
          ? roundMoney(prevComputed)
          : 0

    return {
      ...r,
      id: billingPeriodId,
      billingPeriodId,
      readingIds,
      paidAmount,
      previousRemaining,
    }
  })
}