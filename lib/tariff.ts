import { prisma } from '@/lib/prisma'

type CategoryTariffDoc = {
  category?: string
  baseCleanFee?: number
  baseDirtyFee?: number
  cleanPerM3?: number
  dirtyPerM3?: number
}

/** Шинэ байгууллага үүсгэхэд тухайн төрлийн одоогийн тариф байвал тухайн сарын organization tariff үүсгэнэ. */
export async function applyCategoryTariffsToOrganization(organizationId: string): Promise<number> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { category: true, connectionNumber: true },
  })
  if (!org) return 0

  const pipeFees = await prisma.pipeFee.findMany({ orderBy: { diameterMm: 'asc' } })
  const getBaseFromPipe = (connectionNumber: string | null) => {
    if (!connectionNumber) return null
    const diam = parseInt(String(connectionNumber).trim(), 10)
    if (Number.isNaN(diam)) return null
    const pipe = pipeFees.find((p) => p.diameterMm === diam)
    return pipe ? { baseCleanFee: pipe.baseCleanFee, baseDirtyFee: pipe.baseDirtyFee } : null
  }

  const catRow = await prisma.categoryTariff.findUnique({
    where: { category: org.category },
    select: {
      baseCleanFee: true,
      baseDirtyFee: true,
      cleanPerM3: true,
      dirtyPerM3: true,
    },
  })
  const catDocs: CategoryTariffDoc[] = catRow
    ? [
        {
          baseCleanFee: catRow.baseCleanFee,
          baseDirtyFee: catRow.baseDirtyFee,
          cleanPerM3: catRow.cleanPerM3,
          dirtyPerM3: catRow.dirtyPerM3,
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
    // Category tariff байхгүй үед тухайн category-н хамгийн сүүлийн organization тарифыг fallback болгож авна.
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
    }
  }

  const pipeBase = getBaseFromPipe(org.connectionNumber)
  const baseCleanFee = pipeBase ? pipeBase.baseCleanFee : (d.baseCleanFee ?? 0)
  const baseDirtyFee = pipeBase ? pipeBase.baseDirtyFee : (d.baseDirtyFee ?? 0)
  const cleanPerM3 = d.cleanPerM3 ?? 0
  const dirtyPerM3 = d.dirtyPerM3 ?? 0

  await prisma.organizationTariff.create({
    data: {
      organizationId,
      month,
      year,
      baseCleanFee,
      baseDirtyFee,
      cleanPerM3,
      dirtyPerM3,
    },
  })
  return 1
}
