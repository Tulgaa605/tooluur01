import { normalizeBillingMode } from '@/lib/meter-reading-calc-core'

/** Дулааны төлбөр тооцохгүй зуны сарууд (5–9-р сар). */
export const HEAT_OFF_SEASON_MONTHS = [5, 6, 7, 8, 9] as const

export function isHeatOffSeasonMonth(month: number): boolean {
  const m = Math.trunc(month)
  return (HEAT_OFF_SEASON_MONTHS as readonly number[]).includes(m)
}

/** «Зөвхөн дулаан» тоолуур: зуны сард заалт харагдана, төлбөр 0. */
export function isHeatOnlyZeroBillingMonth(
  billingMode: string | null | undefined,
  month: number
): boolean {
  return normalizeBillingMode(billingMode) === 'HEAT' && isHeatOffSeasonMonth(month)
}

/** Бодолтын үр дүнгээр хадгалах 0 дүн (heatUsage хадгална). */
export const HEAT_OFF_SEASON_MONEY = {
  baseClean: 0,
  baseDirty: 0,
  cleanPerM3: 0,
  dirtyPerM3: 0,
  heatBase: 0,
  heatPerM3: 0,
  heatPerM2: 0,
  cleanAmount: 0,
  dirtyAmount: 0,
  heatAmount: 0,
  subtotal: 0,
  vat: 0,
  total: 0,
} as const
