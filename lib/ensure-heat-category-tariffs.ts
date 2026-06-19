import { ensureDefaultCategoryTariffsInDb } from '@/lib/seed-accountant-defaults'

/**
 * @deprecated ensureDefaultCategoryTariffsInDb ашиглана — ус/бохир/дулааны анхдагч бүгдийг нэг дор шалгана.
 */
export async function ensureHeatCategoryTariffsInDb(ownerOrganizationId: string): Promise<void> {
  await ensureDefaultCategoryTariffsInDb(ownerOrganizationId)
}
