import { prisma } from '@/lib/prisma'
import { findCategoryTariffForCustomer } from '@/lib/category-tariff-scope'
import { findPipeFeeForOrganization } from '@/lib/pipe-fee-scope'

type CategoryTariffDoc = {
  category?: string
  baseCleanFee?: number
  baseDirtyFee?: number
  cleanPerM3?: number
  dirtyPerM3?: number
  heatBaseFee?: number
  heatPerM3?: number
  heatPerM2?: number
}

/** Шинэ байгууллага үүсгэхэд тухайн төрлийн одоогийн тариф байвал тухайн сарын organization tariff үүсгэнэ. */
export async function applyCategoryTariffsToOrganization(organizationId: string): Promise<number> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { category: true, connectionNumber: true },
  })
  if (!org) return 0

  const pipeFees = org.connectionNumber
    ? await (async () => {
        const diam = parseInt(String(org.connectionNumber).trim(), 10)
        if (Number.isNaN(diam)) return null
        return findPipeFeeForOrganization(organizationId, diam)
      })()
    : null
  const getBaseFromPipe = () => {
    if (!pipeFees) return null
    return { baseCleanFee: pipeFees.baseCleanFee, baseDirtyFee: pipeFees.baseDirtyFee }
  }

  const catRow = await findCategoryTariffForCustomer(organizationId, org.category)
  const catDocs: CategoryTariffDoc[] = catRow
    ? [
        {
          baseCleanFee: catRow.baseCleanFee ?? 0,
          baseDirtyFee: catRow.baseDirtyFee ?? 0,
          cleanPerM3: catRow.cleanPerM3 ?? 0,
          dirtyPerM3: catRow.dirtyPerM3 ?? 0,
          heatBaseFee: catRow.heatBaseFee ?? 0,
          heatPerM3: catRow.heatPerM3 ?? 0,
          heatPerM2: catRow.heatPerM2 ?? 0,
        },
      ]
    : []
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const existing = await prisma.organizationTariff.findUnique({
    where: { organizationId_year_month: { organizationId, year, month } },
    select: { id: true },
  })
  if (existing) return 0

  let d = catDocs[0] as CategoryTariffDoc | undefined
  if (!d) {
    const orgsInCategory = await prisma.organization.findMany({
      where: { category: org.category },
      select: { id: true },
      take: 5000,
    })
    const orgIds = orgsInCategory.map((o) => o.id)
    if (orgIds.length > 0) {
      const latest = await prisma.organizationTariff.findFirst({
        where: { organizationId: { in: orgIds } },
        orderBy: [{ year: 'desc' }, { month: 'desc' }, { updatedAt: 'desc' }],
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
      if (latest) {
        d = latest
      }
    }
  }

  if (!d) {
    d = {
      category: org.category,
      baseCleanFee: 0,
      baseDirtyFee: 0,
      cleanPerM3: 0,
      dirtyPerM3: 0,
      heatBaseFee: 0,
      heatPerM3: 0,
      heatPerM2: 0,
    }
  }

  const pipeBase = getBaseFromPipe()
  const baseCleanFee = pipeBase ? pipeBase.baseCleanFee : (d.baseCleanFee ?? 0)
  const baseDirtyFee = pipeBase ? pipeBase.baseDirtyFee : (d.baseDirtyFee ?? 0)
  const cleanPerM3 = d.cleanPerM3 ?? 0
  const dirtyPerM3 = d.dirtyPerM3 ?? 0
  const heatBaseFee = d.heatBaseFee ?? 0
  const heatPerM3 = d.heatPerM3 ?? 0
  const heatPerM2 = d.heatPerM2 ?? 0

  await prisma.organizationTariff.create({
    data: {
      organizationId,
      month,
      year,
      baseCleanFee,
      baseDirtyFee,
      cleanPerM3,
      dirtyPerM3,
      heatBaseFee,
      heatPerM3,
      heatPerM2,
    },
  })
  return 1
}