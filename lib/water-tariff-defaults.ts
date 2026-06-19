import { HEAT_CATEGORY_DEFAULT_RATES, heatDefaultsForCategory } from '@/lib/heat-tariff-defaults'

export type WaterCategoryCode =
  | 'HOUSEHOLD'
  | 'ORGANIZATION'
  | 'BUSINESS'
  | 'WATER_POINT'

/** Шинэ нягтлан бүртгэхэд автоматаар оноогдох ус/бохирын ₮/м³ */
export const WATER_CATEGORY_DEFAULT_RATES: Array<{
  category: WaterCategoryCode
  labelMn: string
  cleanPerM3: number
  dirtyPerM3: number
}> = [
  { category: 'HOUSEHOLD', labelMn: 'Иргэн, Хувь хүн', cleanPerM3: 2900, dirtyPerM3: 2700 },
  { category: 'ORGANIZATION', labelMn: 'Төсөвт байгууллага', cleanPerM3: 8000, dirtyPerM3: 8000 },
  { category: 'WATER_POINT', labelMn: 'Ус түгээх байр', cleanPerM3: 2730, dirtyPerM3: 0 },
  { category: 'BUSINESS', labelMn: 'Аж ахуйн нэгж', cleanPerM3: 6000, dirtyPerM3: 5500 },
]

export function waterDefaultsForCategory(category: string): { cleanPerM3: number; dirtyPerM3: number } {
  const row = WATER_CATEGORY_DEFAULT_RATES.find((r) => r.category === category)
  return row ? { cleanPerM3: row.cleanPerM3, dirtyPerM3: row.dirtyPerM3 } : { cleanPerM3: 0, dirtyPerM3: 0 }
}

export function fullCategoryDefaultsFor(category: string): {
  cleanPerM3: number
  dirtyPerM3: number
  heatPerM3: number
  heatPerM2: number
} {
  const water = waterDefaultsForCategory(category)
  const heat = heatDefaultsForCategory(category)
  return { ...water, ...heat }
}

/** Төрлийн тарифын бүх анхдагч мөрүүд (ус + дулаан) */
export function allDefaultCategoryTariffRows(): Array<{
  category: WaterCategoryCode
  baseCleanFee: number
  baseDirtyFee: number
  cleanPerM3: number
  dirtyPerM3: number
  heatBaseFee: number
  heatPerM3: number
  heatPerM2: number
}> {
  return WATER_CATEGORY_DEFAULT_RATES.map((w) => {
    const heat = HEAT_CATEGORY_DEFAULT_RATES.find((h) => h.category === w.category)
    return {
      category: w.category,
      baseCleanFee: 0,
      baseDirtyFee: 0,
      cleanPerM3: w.cleanPerM3,
      dirtyPerM3: w.dirtyPerM3,
      heatBaseFee: 0,
      heatPerM3: heat?.heatPerM3 ?? 0,
      heatPerM2: heat?.heatPerM2 ?? 0,
    }
  })
}
