export type BillingMode = 'WATER' | 'HEAT' | 'WATER_HEAT'

export function normalizeBillingMode(v: string | null | undefined): BillingMode {
  const s = String(v ?? 'WATER').trim().toUpperCase()
  if (s === 'HEAT' || s === 'WATER_HEAT') return s as BillingMode
  return 'WATER'
}

export type WaterTariffRates = {
  baseClean: number
  baseDirty: number
  cleanPerM3: number
  dirtyPerM3: number
}

export type HeatTariffRates = {
  heatBase: number
  heatPerM3: number
  heatPerM2: number
}

function pickHeatUnitRate(orgCategory: string, heatPerM3: number, heatPerM2: number): number {
  const cat = String(orgCategory ?? '').toUpperCase()
  const perM3 = Number(heatPerM3) || 0
  const perM2 = Number(heatPerM2) || 0
  // Default rule:
  // - HOUSEHOLD: ₮/м²
  // - Others: ₮/м³
  // But in real data sometimes only one of the rates is filled (the other is 0),
  // so we fall back to the non-zero rate automatically.
  if (cat === 'HOUSEHOLD') {
    if (perM2 > 0) return perM2
    if (perM3 > 0) return perM3
    return 0
  }
  if (perM3 > 0) return perM3
  if (perM2 > 0) return perM2
  return 0
}

export type ReadingMoneySnapshot = WaterTariffRates &
  HeatTariffRates & {
    cleanAmount: number
    dirtyAmount: number
    heatAmount: number
    subtotal: number
    vat: number
    total: number
  }

export function computeReadingMoney(
  usage: number,
  orgCategory: string,
  billingMode: BillingMode,
  water: WaterTariffRates,
  heat: HeatTariffRates
): ReadingMoneySnapshot {
  const includeWater = billingMode === 'WATER' || billingMode === 'WATER_HEAT'
  const includeHeat = billingMode === 'HEAT' || billingMode === 'WATER_HEAT'

  let baseClean = 0
  let baseDirty = 0
  let cleanPerM3 = 0
  let dirtyPerM3 = 0
  let cleanAmount = 0
  let dirtyAmount = 0

  if (includeWater) {
    baseClean = water.baseClean
    baseDirty = water.baseDirty
    cleanPerM3 = water.cleanPerM3
    dirtyPerM3 = water.dirtyPerM3
    cleanAmount = usage * cleanPerM3 + baseClean
    dirtyAmount = usage * dirtyPerM3 + baseDirty
  }

  let heatBase = 0
  let heatPerM3 = 0
  let heatPerM2 = 0
  let heatAmount = 0
  if (includeHeat) {
    heatBase = heat.heatBase
    heatPerM3 = heat.heatPerM3
    heatPerM2 = heat.heatPerM2
    const unitRate = pickHeatUnitRate(orgCategory, heatPerM3, heatPerM2)
    heatAmount = usage * unitRate + heatBase
  }

  const subtotal = cleanAmount + dirtyAmount + heatAmount
  const vat = subtotal * 0.1
  const total = subtotal + vat

  return {
    baseClean,
    baseDirty,
    cleanPerM3,
    dirtyPerM3,
    heatBase,
    heatPerM3,
    heatPerM2,
    cleanAmount,
    dirtyAmount,
    heatAmount,
    subtotal,
    vat,
    total,
  }
}

/**
 * Ус болон дулааны хэрэглээг тусад нь тооцно.
 * - WATER: waterUsage ашиглана
 * - HEAT: heatUsage ашиглана
 * - WATER_HEAT: waterUsage + heatUsage тус тусдаа
 */
export function computeReadingMoneySplit(
  waterUsage: number,
  heatUsage: number,
  orgCategory: string,
  billingMode: BillingMode,
  water: WaterTariffRates,
  heat: HeatTariffRates
): ReadingMoneySnapshot {
  const includeWater = billingMode === 'WATER' || billingMode === 'WATER_HEAT'
  const includeHeat = billingMode === 'HEAT' || billingMode === 'WATER_HEAT'

  const w = Math.max(0, waterUsage || 0)
  const h = Math.max(0, heatUsage || 0)

  let baseClean = 0
  let baseDirty = 0
  let cleanPerM3 = 0
  let dirtyPerM3 = 0
  let cleanAmount = 0
  let dirtyAmount = 0

  if (includeWater) {
    baseClean = water.baseClean
    baseDirty = water.baseDirty
    cleanPerM3 = water.cleanPerM3
    dirtyPerM3 = water.dirtyPerM3
    cleanAmount = w * cleanPerM3 + baseClean
    dirtyAmount = w * dirtyPerM3 + baseDirty
  }

  let heatBase = 0
  let heatPerM3 = 0
  let heatPerM2 = 0
  let heatAmount = 0
  if (includeHeat) {
    heatBase = heat.heatBase
    heatPerM3 = heat.heatPerM3
    heatPerM2 = heat.heatPerM2
    const unitRate = pickHeatUnitRate(orgCategory, heatPerM3, heatPerM2)
    heatAmount = h * unitRate + heatBase
  }

  const subtotal = cleanAmount + dirtyAmount + heatAmount
  const vat = subtotal * 0.1
  const total = subtotal + vat

  return {
    baseClean,
    baseDirty,
    cleanPerM3,
    dirtyPerM3,
    heatBase,
    heatPerM3,
    heatPerM2,
    cleanAmount,
    dirtyAmount,
    heatAmount,
    subtotal,
    vat,
    total,
  }
}

/** Хэрэглэгчийн оруулсан дулааны дүнгээр нийт, НӨАТ-ыг дахин тооцно. */
export function applyManualHeatAmountToMoney(
  money: ReadingMoneySnapshot,
  manualHeat: number
): ReadingMoneySnapshot {
  const heatAmount = Math.max(0, manualHeat)
  const subtotal = money.cleanAmount + money.dirtyAmount + heatAmount
  const vat = subtotal * 0.1
  const total = subtotal + vat
  return { ...money, heatAmount, subtotal, vat, total }
}
