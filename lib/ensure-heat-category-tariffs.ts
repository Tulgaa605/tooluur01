import { prisma } from './prisma'
import { HEAT_CATEGORY_DEFAULT_RATES } from './heat-tariff-defaults'

/**
 * Төрлийн тарифын мөрүүдэд дулааны үнэ бүгд 0 байвал албан жагсаалтын үнийг автоматаар бичнэ.
 * Зөвхөн тухайн нягтлангийн албан байгууллагын (ownerOrganizationId) мөрүүдэд.
 */
export async function ensureHeatCategoryTariffsInDb(ownerOrganizationId: string): Promise<void> {
  if (!ownerOrganizationId) return
  for (const h of HEAT_CATEGORY_DEFAULT_RATES) {
    const existing = await prisma.categoryTariff.findUnique({
      where: {
        category_ownerOrganizationId: {
          category: h.category,
          ownerOrganizationId,
        },
      },
      select: {
        category: true,
        baseCleanFee: true,
        baseDirtyFee: true,
        cleanPerM3: true,
        dirtyPerM3: true,
        heatBaseFee: true,
        heatPerM3: true,
        heatPerM2: true,
      },
    })

    if (!existing) {
      await prisma.categoryTariff.create({
        data: {
          category: h.category,
          ownerOrganizationId,
          baseCleanFee: 0,
          baseDirtyFee: 0,
          cleanPerM3: 0,
          dirtyPerM3: 0,
          heatBaseFee: 0,
          heatPerM3: h.heatPerM3,
          heatPerM2: h.heatPerM2,
        },
      })
      continue
    }

    const heatAllZero =
      (existing.heatBaseFee ?? 0) === 0 &&
      (existing.heatPerM3 ?? 0) === 0 &&
      (existing.heatPerM2 ?? 0) === 0

    // `update()` нь баримтыг DateTime болгож дахин уншина; хуучин DB-д createdAt string байвал алдаа гарна.
    if (heatAllZero) {
      await prisma.categoryTariff.updateMany({
        where: { category: h.category, ownerOrganizationId },
        data: {
          heatPerM3: h.heatPerM3,
          heatPerM2: h.heatPerM2,
        },
      })
    }
  }
}
