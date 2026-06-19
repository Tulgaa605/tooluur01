import type { TokenPayload } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'

/** Нягтлан бүрийн албан байгууллагын ID (төрлийн тарифын эзэн). */
export async function getAccountantOwnerOrganizationId(
  user: Pick<TokenPayload, 'userId' | 'organizationId'>
): Promise<string | null> {
  if (user.organizationId) return user.organizationId
  const dbUser = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { organizationId: true },
  })
  return dbUser?.organizationId ?? null
}

/**
 * Харилцагчийн заалт/тариф тооцоололд аль нягтлангийн төрлийн тариф ашиглах вэ.
 * managedByOrganizationId → үүсгэсэн нягтлан/захирал → өөрөө албан байгууллага.
 */
export async function resolveCategoryTariffOwnerOrganizationId(
  organizationId: string
): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { managedByOrganizationId: true, createdByUserId: true },
  })
  if (!org) return null
  if (org.managedByOrganizationId) return org.managedByOrganizationId

  if (org.createdByUserId) {
    const creator = await prisma.user.findUnique({
      where: { id: org.createdByUserId },
      select: { organizationId: true, role: true },
    })
    if (
      creator?.organizationId &&
      (creator.role === Role.ACCOUNTANT || creator.role === Role.MANAGER)
    ) {
      return creator.organizationId
    }
  }

  const staff = await prisma.user.findFirst({
    where: {
      organizationId,
      role: { in: [Role.ACCOUNTANT, Role.MANAGER] },
    },
    select: { organizationId: true },
  })
  return staff?.organizationId ?? null
}

/** @deprecated resolveCategoryTariffOwnerOrganizationId ашиглана */
export async function getCategoryTariffOwnerOrgIdForCustomer(
  organizationId: string
): Promise<string | null> {
  return resolveCategoryTariffOwnerOrganizationId(organizationId)
}

export type CategoryTariffLookup = {
  baseCleanFee?: number | null
  baseDirtyFee?: number | null
  cleanPerM3?: number | null
  dirtyPerM3?: number | null
  heatBaseFee?: number | null
  heatPerM3?: number | null
  heatPerM2?: number | null
}

export async function findCategoryTariffForCustomer(
  organizationId: string,
  category: string
): Promise<CategoryTariffLookup | null> {
  const ownerOrganizationId = await resolveCategoryTariffOwnerOrganizationId(organizationId)
  if (!ownerOrganizationId) return null
  return prisma.categoryTariff.findUnique({
    where: {
      category_ownerOrganizationId: {
        category,
        ownerOrganizationId,
      },
    },
    select: {
      baseCleanFee: true,
      baseDirtyFee: true,
      cleanPerM3: true,
      dirtyPerM3: true,
      heatBaseFee: true,
      heatPerM3: true,
      heatPerM2: true,
    },
  })
}
