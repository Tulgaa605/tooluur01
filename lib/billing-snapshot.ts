import { roundMoney } from '@/lib/carry-forward'

const PAY_EPS = 0.009

export function computeBillingRemaining(
  previousRemaining: number,
  total: number,
  paidAmount: number
): number {
  return Math.max(
    0,
    roundMoney(
      roundMoney(previousRemaining) + roundMoney(total) - roundMoney(paidAmount)
    )
  )
}

export function computeBillingPaymentStatus(
  previousRemaining: number,
  total: number,
  paidAmount: number
): string {
  const remaining = computeBillingRemaining(previousRemaining, total, paidAmount)
  if (remaining <= PAY_EPS) return 'Бүрэн төлөгдсөн'
  if (roundMoney(paidAmount) > PAY_EPS) return 'Хэсэгчлэн төлөгдсөн'
  return 'Хүлээгдэж буй'
}

type OrgPhoneSource = {
  phone?: string | null
  users?: { phone?: string | null }[]
} | null | undefined

export function collectCustomerPhonesForSnapshot(org: OrgPhoneSource): string {
  if (!org) return ''
  const phones = new Set<string>()
  const orgPhone = String(org.phone ?? '').trim()
  if (orgPhone) phones.add(orgPhone)
  for (const u of org.users ?? []) {
    const p = String(u?.phone ?? '').trim()
    if (p) phones.add(p)
  }
  return [...phones].join(', ')
}

export type BillingPeriodGridSnapshot = {
  billingPeriodId: string
  previousRemaining: number
  paidAmount: number
  usage: number
  total: number
  remaining: number
  paymentStatus: string
  meterNumbers: string
  ebarimtStatus: string
  ebarimtBillId: string | null
  organizationName: string
  customerPhones: string
}

export function aggregateBillingPeriodSnapshots(
  rows: BillingPeriodGridSnapshot[]
): BillingPeriodGridSnapshot[] {
  const byId = new Map<string, BillingPeriodGridSnapshot>()
  for (const row of rows) {
    const cur = byId.get(row.billingPeriodId)
    if (!cur) {
      byId.set(row.billingPeriodId, { ...row })
      continue
    }
    const usage = roundMoney(cur.usage + row.usage)
    const total = roundMoney(cur.total + row.total)
    const paidAmount = roundMoney(cur.paidAmount + row.paidAmount)
    const previousRemaining = roundMoney(cur.previousRemaining)
    const meters = new Set<string>()
    for (const part of `${cur.meterNumbers},${row.meterNumbers}`.split(',')) {
      const m = part.trim()
      if (m && m !== '-') meters.add(m)
    }
    const ebarimtRank = (s: string) =>
      s === 'FAILED' ? 4 : s === 'PARTIAL' ? 3 : s === 'SENT' ? 2 : 1
    const ebarimtStatus =
      ebarimtRank(row.ebarimtStatus) > ebarimtRank(cur.ebarimtStatus)
        ? row.ebarimtStatus
        : cur.ebarimtStatus

    byId.set(row.billingPeriodId, {
      ...cur,
      usage,
      total,
      paidAmount,
      previousRemaining,
      remaining: computeBillingRemaining(previousRemaining, total, paidAmount),
      paymentStatus: computeBillingPaymentStatus(previousRemaining, total, paidAmount),
      meterNumbers: meters.size > 0 ? [...meters].join(', ') : '-',
      ebarimtStatus,
      ebarimtBillId: row.ebarimtBillId ?? cur.ebarimtBillId,
      organizationName: cur.organizationName || row.organizationName,
      customerPhones: cur.customerPhones || row.customerPhones,
    })
  }
  return [...byId.values()]
}

export function buildBillingPeriodSnapshot(row: {
  billingPeriodId?: string
  id?: string
  previousRemaining?: number | null
  paidAmount?: number | null
  usage?: number | null
  total?: number | null
  ebarimtStatus?: string | null
  ebarimtBillId?: string | null
  meter?: { meterNumber?: string | null } | null
  organization?: { name?: string | null; phone?: string | null; users?: { phone?: string | null }[] } | null
}): BillingPeriodGridSnapshot | null {
  const billingPeriodId = String(row.billingPeriodId ?? row.id ?? '').trim()
  if (!/^[a-f\d]{24}$/i.test(billingPeriodId)) return null

  const previousRemaining = roundMoney(Number(row.previousRemaining ?? 0) || 0)
  const paidAmount = roundMoney(Number(row.paidAmount ?? 0) || 0)
  const total = roundMoney(Number(row.total ?? 0) || 0)
  const usage = roundMoney(Number(row.usage ?? 0) || 0)

  return {
    billingPeriodId,
    previousRemaining,
    paidAmount,
    usage,
    total,
    remaining: computeBillingRemaining(previousRemaining, total, paidAmount),
    paymentStatus: computeBillingPaymentStatus(previousRemaining, total, paidAmount),
    meterNumbers: String(row.meter?.meterNumber ?? '-').trim() || '-',
    ebarimtStatus: String(row.ebarimtStatus ?? 'PENDING').trim() || 'PENDING',
    ebarimtBillId: row.ebarimtBillId ? String(row.ebarimtBillId) : null,
    organizationName: String(row.organization?.name ?? '-').trim() || '-',
    customerPhones: collectCustomerPhonesForSnapshot(row.organization),
  }
}
