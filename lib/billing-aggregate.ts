/**
 * Төлбөрийн хуудас: нэг харилцагч (байгууллага) дээр тухайн сард
 * олон тоолуур / олон заалт байвал (хувь хүн, ААН, төсөвт байгууллага,
 * зөөврөөр татан зайлуулах гэх мэт) бүх төлбөрийг нэг мөрөнд нэгтгэнэ.
 */

/** 2 ба түүнээс олон заалт байвал нэгтгэнэ (1 тоолуур = 1 мөр) */
const MIN_READINGS_TO_MERGE = 2

export type BillingAggregatableReading = {
  id?: string
  month: number
  year: number
  usage: number
  total: number
  subtotal?: number
  vat?: number
  cleanAmount?: number
  dirtyAmount?: number
  heatAmount?: number
  paidAmount?: number | null
  approved?: boolean
  /** Өмнөх саруудын үлдэгдэл (бүх тоолуурын ижил утгатай — нэгтгэгдсэн мөрөнд адил утга) */
  previousRemaining?: number | null
  smsSentAt?: string | Date | null
  ebarimtStatus?: string | null
  ebarimtBillId?: string | null
  ebarimtLastError?: string | null
  organizationId?: string
  organization?: {
    id: string
    name: string
    code: string | null
    category?: string | null
    phone?: string | null
    users?: { phone: string | null }[]
  }
  meter?: {
    meterNumber: string
    billingMode?: string | null
    waterChargeSplit?: string | null
    billingCategory?: string | null
  }
  meterId?: string
}

function sumNum(rows: BillingAggregatableReading[], pick: (r: BillingAggregatableReading) => number): number {
  return rows.reduce((acc, r) => acc + (Number(pick(r)) || 0), 0)
}

function mergeEbarimtStatus(rows: BillingAggregatableReading[]): {
  ebarimtStatus: string
  ebarimtBillId: string | null
  ebarimtLastError: string | null
} {
  if (rows.some((r) => r.ebarimtStatus === 'FAILED')) {
    const failed = rows.find((r) => r.ebarimtStatus === 'FAILED')
    return {
      ebarimtStatus: 'FAILED',
      ebarimtBillId: failed?.ebarimtBillId ?? null,
      ebarimtLastError: failed?.ebarimtLastError ?? null,
    }
  }
  if (rows.every((r) => r.ebarimtStatus === 'SENT')) {
    const ids = rows.map((r) => r.ebarimtBillId).filter(Boolean)
    return {
      ebarimtStatus: 'SENT',
      ebarimtBillId: ids.length === 1 ? (ids[0] as string) : ids.length > 1 ? `${ids.length} баримт` : null,
      ebarimtLastError: null,
    }
  }
  if (rows.some((r) => r.ebarimtStatus === 'SENT')) {
    return { ebarimtStatus: 'PARTIAL', ebarimtBillId: null, ebarimtLastError: null }
  }
  return { ebarimtStatus: 'PENDING', ebarimtBillId: null, ebarimtLastError: null }
}

function mergeOrgBillingGroup<T extends BillingAggregatableReading>(group: T[]): T & {
  aggregatedReadingIds: string[]
} {
  const first = group[0]
  const orgId = first.organization?.id || first.organizationId || 'x'
  const ids = group.map((r) => r.id).filter((id): id is string => !!id)
  const meterNumbers = [
    ...new Set(group.map((r) => r.meter?.meterNumber?.trim()).filter(Boolean) as string[]),
  ].sort((a, b) => a.localeCompare(b, 'mn'))

  const ebarimt = mergeEbarimtStatus(group)

  return {
    ...first,
    id: `agg-${orgId}-${first.year}-${first.month}`,
    aggregatedReadingIds: ids,
    usage: sumNum(group, (r) => r.usage),
    total: sumNum(group, (r) => r.total),
    subtotal: sumNum(group, (r) => Number(r.subtotal ?? 0)),
    vat: sumNum(group, (r) => Number(r.vat ?? 0)),
    cleanAmount: sumNum(group, (r) => Number(r.cleanAmount ?? 0)),
    dirtyAmount: sumNum(group, (r) => Number(r.dirtyAmount ?? 0)),
    heatAmount: sumNum(group, (r) => Number(r.heatAmount ?? 0)),
    paidAmount: sumNum(group, (r) => Number(r.paidAmount ?? 0)),
    approved: group.every((r) => !!r.approved),
    previousRemaining: Number(group[0]?.previousRemaining ?? 0) || 0,
    smsSentAt: group.find((r) => !!r.smsSentAt)?.smsSentAt ?? null,
    ...ebarimt,
    meter: {
      ...(first.meter ?? { meterNumber: '-' }),
      meterNumber:
        meterNumbers.length <= 3
          ? meterNumbers.join(', ')
          : `${meterNumbers.slice(0, 2).join(', ')} (+${meterNumbers.length - 2})`,
    },
  } as T & { aggregatedReadingIds: string[] }
}

/**
 * Нэг харилцагч + он/сар бүрийн бүх заалтыг нэгтгэнэ.
 * Категори (хувь хүн, ААН, төсөвт байгууллага, татан зайлуулах г.м) хамаарахгүй.
 */
export function aggregateBillingReadingsByOrganization<T extends BillingAggregatableReading>(
  readings: T[]
): Array<T & { aggregatedReadingIds?: string[] }> {
  const byOrgPeriod = new Map<string, T[]>()

  for (const r of readings) {
    const orgId = (r.organization?.id || r.organizationId || '').trim()
    if (!orgId) continue
    const key = `${orgId}:${r.year}:${r.month}`
    const list = byOrgPeriod.get(key) ?? []
    list.push(r)
    byOrgPeriod.set(key, list)
  }

  const merged: Array<T & { aggregatedReadingIds?: string[] }> = []

  for (const group of byOrgPeriod.values()) {
    if (group.length >= MIN_READINGS_TO_MERGE) {
      merged.push(mergeOrgBillingGroup(group))
    } else {
      for (const r of group) {
        merged.push(r)
      }
    }
  }

  return merged.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year
    if (a.month !== b.month) return b.month - a.month
    return String(a.organization?.name ?? '').localeCompare(String(b.organization?.name ?? ''), 'mn')
  })
}

export function readingIdsForBillingRow(row: {
  id?: string
  aggregatedReadingIds?: string[]
}): string[] {
  if (row.aggregatedReadingIds?.length) return row.aggregatedReadingIds
  if (row.id) {
    const s = String(row.id)
    // 'agg-...' нэгтгэсэн мөр, 'phantom-...' заалтгүй (carry only) мөр — DB-д заалтын ID биш.
    if (!s.startsWith('agg-') && !s.startsWith('phantom-')) return [row.id]
  }
  return []
}
