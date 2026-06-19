import { prisma } from '@/lib/prisma'
import { STANDARD_OFFICE_PIPE_FEES, shouldRefreshOfficePipeFee } from '@/lib/default-pipe-fees'
import { allDefaultCategoryTariffRows } from '@/lib/water-tariff-defaults'

/**
 * Шинэ нягтлангийн албан байгууллагад төрлийн тариф (ус/бохир/дулаан) анхдагчаар үүсгэнэ.
 * Аль хэдийн байгаа мөрүүдийг дахин дарж бичихгүй.
 */
export async function ensureDefaultCategoryTariffsInDb(
  ownerOrganizationId: string,
  userId?: string
): Promise<void> {
  if (!ownerOrganizationId) return

  for (const row of allDefaultCategoryTariffRows()) {
    const existing = await prisma.categoryTariff.findUnique({
      where: {
        category_ownerOrganizationId: {
          category: row.category,
          ownerOrganizationId,
        },
      },
      select: {
        cleanPerM3: true,
        dirtyPerM3: true,
        heatPerM3: true,
        heatPerM2: true,
      },
    })

    if (!existing) {
      await prisma.categoryTariff.create({
        data: {
          category: row.category,
          ownerOrganizationId,
          baseCleanFee: row.baseCleanFee,
          baseDirtyFee: row.baseDirtyFee,
          cleanPerM3: row.cleanPerM3,
          dirtyPerM3: row.dirtyPerM3,
          heatBaseFee: row.heatBaseFee,
          heatPerM3: row.heatPerM3,
          heatPerM2: row.heatPerM2,
          ...(userId
            ? { createdByUserId: userId, updatedByUserId: userId }
            : {}),
        },
      })
      continue
    }

    const waterAllZero =
      (existing.cleanPerM3 ?? 0) === 0 && (existing.dirtyPerM3 ?? 0) === 0
    const heatAllZero =
      (existing.heatPerM3 ?? 0) === 0 && (existing.heatPerM2 ?? 0) === 0

    if (waterAllZero || heatAllZero) {
      await prisma.categoryTariff.updateMany({
        where: { category: row.category, ownerOrganizationId },
        data: {
          ...(waterAllZero
            ? { cleanPerM3: row.cleanPerM3, dirtyPerM3: row.dirtyPerM3 }
            : {}),
          ...(heatAllZero
            ? { heatPerM3: row.heatPerM3, heatPerM2: row.heatPerM2 }
            : {}),
          ...(userId ? { updatedByUserId: userId } : {}),
        },
      })
    }
  }
}

/**
 * Оролтын шугамын голчийн суурь хураамж — нягтлан бүрт тусад нь (OfficePipeFee).
 */
export async function ensureDefaultOfficePipeFeesInDb(
  officeOrganizationId: string,
  userId?: string
): Promise<void> {
  if (!officeOrganizationId) return

  const existing = await prisma.officePipeFee.findMany({
    where: { officeOrganizationId },
    select: { diameterMm: true, baseCleanFee: true, baseDirtyFee: true },
  })
  const byDiam = new Map(
    existing.map((e) => [
      e.diameterMm,
      { baseCleanFee: e.baseCleanFee ?? 0, baseDirtyFee: e.baseDirtyFee ?? 0 },
    ])
  )

  const toCreate = STANDARD_OFFICE_PIPE_FEES.filter((f) => !byDiam.has(f.diameterMm))
  const toUpdate = STANDARD_OFFICE_PIPE_FEES.filter((f) => {
    const ex = byDiam.get(f.diameterMm)
    if (!ex) return false
    return shouldRefreshOfficePipeFee(f, ex)
  })

  await Promise.all([
    ...toCreate.map((f) =>
      prisma.officePipeFee.create({
        data: {
          officeOrganizationId,
          diameterMm: f.diameterMm,
          baseCleanFee: f.baseCleanFee,
          baseDirtyFee: f.baseDirtyFee,
          ...(userId
            ? { createdByUserId: userId, updatedByUserId: userId }
            : {}),
        },
      })
    ),
    ...toUpdate.map((f) =>
      prisma.officePipeFee.updateMany({
        where: { officeOrganizationId, diameterMm: f.diameterMm },
        data: {
          baseCleanFee: f.baseCleanFee,
          baseDirtyFee: f.baseDirtyFee,
          ...(userId ? { updatedByUserId: userId } : {}),
        },
      })
    ),
  ])
}

/** Бүртгэл / албан байгууллага үүсэхэд бүх анхдагч тохиргоог нэг дор үүсгэнэ. */
export async function seedAccountantDefaults(
  officeOrganizationId: string,
  userId?: string
): Promise<void> {
  await ensureDefaultCategoryTariffsInDb(officeOrganizationId, userId)
  await ensureDefaultOfficePipeFeesInDb(officeOrganizationId, userId)
}
