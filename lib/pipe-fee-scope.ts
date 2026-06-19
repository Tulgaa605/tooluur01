import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { getCategoryTariffOwnerOrgIdForCustomer } from '@/lib/category-tariff-scope'

/** Харилцагч эсвэл албан байгууллагын pipe fee аль нягтлангийн албанд хамаарах вэ. */
export async function getPipeFeeOwnerOrganizationId(
  organizationId: string
): Promise<string | null> {
  const fromCustomer = await getCategoryTariffOwnerOrgIdForCustomer(organizationId)
  if (fromCustomer) return fromCustomer

  const accountant = await prisma.user.findFirst({
    where: { organizationId, role: Role.ACCOUNTANT },
    select: { organizationId: true },
  })
  return accountant?.organizationId ?? null
}

export type OfficePipeFeeRow = {
  diameterMm: number
  baseCleanFee: number
  baseDirtyFee: number
}

export async function findOfficePipeFee(
  officeOrganizationId: string,
  diameterMm: number
): Promise<OfficePipeFeeRow | null> {
  const row = await prisma.officePipeFee.findUnique({
    where: {
      officeOrganizationId_diameterMm: {
        officeOrganizationId,
        diameterMm,
      },
    },
    select: { diameterMm: true, baseCleanFee: true, baseDirtyFee: true },
  })
  if (!row) return null
  return {
    diameterMm: row.diameterMm,
    baseCleanFee: row.baseCleanFee ?? 0,
    baseDirtyFee: row.baseDirtyFee ?? 0,
  }
}

export async function findPipeFeeForOrganization(
  organizationId: string,
  diameterMm: number
): Promise<OfficePipeFeeRow | null> {
  const ownerId = await getPipeFeeOwnerOrganizationId(organizationId)
  if (!ownerId) return null
  return findOfficePipeFee(ownerId, diameterMm)
}

export async function listOfficePipeFees(
  officeOrganizationId: string
): Promise<Array<OfficePipeFeeRow & { id: string }>> {
  const rows = await prisma.officePipeFee.findMany({
    where: { officeOrganizationId },
    orderBy: { diameterMm: 'asc' },
    select: {
      id: true,
      diameterMm: true,
      baseCleanFee: true,
      baseDirtyFee: true,
    },
  })
  return rows.map((r) => ({
    id: r.id,
    diameterMm: r.diameterMm,
    baseCleanFee: r.baseCleanFee ?? 0,
    baseDirtyFee: r.baseDirtyFee ?? 0,
  }))
}
