/**
 * Төрлийн дулааны тарифын албан жагсаалтын анхны үнэ (1 м³ / 1 м² тутамд ₮).
 * Seed болон Тариф UI-д ижил утга ашиглана.
 */
export const HEAT_CATEGORY_DEFAULT_RATES: Array<{
  category: 'ORGANIZATION' | 'BUSINESS' | 'HOUSEHOLD'
  labelMn: string
  heatPerM3: number
  heatPerM2: number
}> = [
  { category: 'ORGANIZATION', labelMn: 'Төсөвт байгууллага', heatPerM3: 2035, heatPerM2: 0 },
  { category: 'BUSINESS', labelMn: 'ААН', heatPerM3: 880, heatPerM2: 0 },
  { category: 'HOUSEHOLD', labelMn: 'Айл өрх', heatPerM3: 0, heatPerM2: 506 },
]

export function heatDefaultsForCategory(category: string): { heatPerM3: number; heatPerM2: number } {
  const row = HEAT_CATEGORY_DEFAULT_RATES.find((r) => r.category === category)
  return row ? { heatPerM3: row.heatPerM3, heatPerM2: row.heatPerM2 } : { heatPerM3: 0, heatPerM2: 0 }
}
