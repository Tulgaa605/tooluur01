import { heatDefaultsForCategory } from '@/lib/heat-tariff-defaults'
import { normalizeBillingMode } from '@/lib/meter-reading-calc-core'

export type ReadingLike = {
  organizationId?: string
  organization?: { category?: string | null }
  meter?: { billingMode?: string | null }
  billingMode?: string
  heatUsage?: number
  usage?: number
}

export type CategoryTariffLike = {
  category?: string
  heatBaseFee?: number
  heatPerM3?: number
  heatPerM2?: number
}

export function heatQuantityFromReading(r: ReadingLike): number {
  const bm = normalizeBillingMode(r.billingMode ?? r.meter?.billingMode)
  if (bm === 'WATER_HEAT') return Number(r.heatUsage ?? 0) || 0
  if (bm === 'HEAT') return Number(r.heatUsage ?? r.usage ?? 0) || 0
  return 0
}

function heatMoneyForLine(
  orgCategory: string,
  qty: number,
  t: CategoryTariffLike | undefined
): number {
  const base = Number(t?.heatBaseFee ?? 0)
  let perM3 = Number(t?.heatPerM3 ?? 0)
  let perM2 = Number(t?.heatPerM2 ?? 0)
  if (!t) {
    const d = heatDefaultsForCategory(orgCategory)
    perM3 = d.heatPerM3
    perM2 = d.heatPerM2
  }
  const unitRate = orgCategory === 'HOUSEHOLD' ? perM2 : perM3
  return qty * unitRate + base
}

/** Нэг сарын заалтуудаас байгууллага бүрээр дулааны м³/м² нийлбэр ба төрлийн тарифаар тооцсон дүн. */
export function aggregateHeatByOrganizationId(
  readings: ReadingLike[],
  categoryTariffByCategory: Map<string, CategoryTariffLike>
): Map<string, { qtySum: number; moneySum: number }> {
  const out = new Map<string, { qtySum: number; moneySum: number }>()
  for (const r of readings) {
    const orgId = r.organizationId
    if (!orgId) continue
    const bm = normalizeBillingMode(r.billingMode ?? r.meter?.billingMode)
    if (bm !== 'HEAT' && bm !== 'WATER_HEAT') continue
    const qty = heatQuantityFromReading(r)
    const cat = String(r.organization?.category ?? 'HOUSEHOLD')
    const t = categoryTariffByCategory.get(cat)
    const money = heatMoneyForLine(cat, qty, t)
    const prev = out.get(orgId) ?? { qtySum: 0, moneySum: 0 }
    out.set(orgId, { qtySum: prev.qtySum + qty, moneySum: prev.moneySum + money })
  }
  return out
}
