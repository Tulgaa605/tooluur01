import { normalizeBillingMode } from '@/lib/meter-reading-calc-core'
import type { ReadingMoneySnapshot } from '@/lib/meter-reading-calc-core'

/** Дулааны төлбөр тооцохгүй зуны сарууд (5–9-р сар). */
export const HEAT_OFF_SEASON_MONTHS = [5, 6, 7, 8, 9] as const

export function isHeatOffSeasonMonth(month: number): boolean {
  const m = Math.trunc(month)
  return (HEAT_OFF_SEASON_MONTHS as readonly number[]).includes(m)
}

export function readingHasHeatBilling(billingMode: string | null | undefined): boolean {
  const m = normalizeBillingMode(billingMode)
  return m === 'HEAT' || m === 'WATER_HEAT'
}

/** heatClosed: true=хаасан, false=нээсэн (үргэлж бодно), null/undefined=анхдагч */
export type HeatClosedState = boolean | null | undefined

export function isHeatManuallyClosed(heatClosed: HeatClosedState): boolean {
  return heatClosed === true
}

export function isHeatExplicitlyOpen(heatClosed: HeatClosedState): boolean {
  return heatClosed === false
}

/**
 * Дулааны төлбөр 0 болгох эсэх:
 * - true: гараар хаасан → үргэлж 0
 * - false: гараар нээсэн → үргэлж бодно (5–9 сарыг давна)
 * - null: анхдагч → зөвхөн 5–9-р сард автомат 0
 */
export function isHeatBillingSuppressed(
  billingMode: string | null | undefined,
  month: number,
  heatClosed?: HeatClosedState
): boolean {
  if (!readingHasHeatBilling(billingMode)) return false
  if (heatClosed === true) return true
  if (heatClosed === false) return false
  return isHeatOffSeasonMonth(month)
}

/** UI: зуны анхдагч 0 (гарын нээлт/хаалт хийгээгүй). */
export function isHeatDefaultOffSeason(
  billingMode: string | null | undefined,
  month: number,
  heatClosed?: HeatClosedState
): boolean {
  if (!readingHasHeatBilling(billingMode)) return false
  if (heatClosed === true || heatClosed === false) return false
  return isHeatOffSeasonMonth(month)
}

/** «Зөвхөн дулаан» тоолуур: дулаан хаагдсан эсвэл зуны анхдагч сард бүх дүн 0. */
export function isHeatOnlyZeroBillingMonth(
  billingMode: string | null | undefined,
  month: number,
  heatClosed?: HeatClosedState
): boolean {
  return (
    normalizeBillingMode(billingMode) === 'HEAT' &&
    isHeatBillingSuppressed(billingMode, month, heatClosed)
  )
}

/** Дараагийн heatClosed утга (toggle). */
export function nextHeatClosedAfterToggle(
  current: HeatClosedState,
  month: number
): boolean {
  if (current === true) return false
  if (current === false) return true
  return isHeatOffSeasonMonth(month) ? false : true
}

/** Ус+дулаан: зөвхөн дулааны хэсгийг 0 болгоно. */
export function zeroHeatPortionFromMoney(money: ReadingMoneySnapshot): ReadingMoneySnapshot {
  const subtotal = Math.round((money.cleanAmount + money.dirtyAmount) * 100) / 100
  const vat = Math.round(subtotal * 0.1 * 100) / 100
  const total = Math.round((subtotal + vat) * 100) / 100
  return {
    ...money,
    heatBase: 0,
    heatPerM3: 0,
    heatPerM2: 0,
    heatAmount: 0,
    subtotal,
    vat,
    total,
  }
}

/** Бодолтын дараах мөнгөн дүнг дулааны дүрмээр эцэслэнэ. */
export function finalizeReadingMoneyForHeatRules(
  billingMode: string | null | undefined,
  month: number,
  heatClosed: HeatClosedState,
  money: ReadingMoneySnapshot
): ReadingMoneySnapshot {
  if (!isHeatBillingSuppressed(billingMode, month, heatClosed)) return money
  const mode = normalizeBillingMode(billingMode)
  if (mode === 'HEAT') {
    return { ...money, ...HEAT_OFF_SEASON_MONEY }
  }
  if (mode === 'WATER_HEAT') {
    return zeroHeatPortionFromMoney(money)
  }
  return money
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
