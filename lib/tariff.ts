import { prisma } from '@/lib/prisma'

function extractMongoBatch(result: any): any[] {
  if (!result) return []
  const cursor = result.cursor
  if (cursor?.firstBatch && Array.isArray(cursor.firstBatch)) return cursor.firstBatch
  if (cursor?.nextBatch && Array.isArray(cursor.nextBatch)) return cursor.nextBatch
  return []
}

type CategoryTariffDoc = {
  category: string
  year: number
  month: number
  baseCleanFee?: number
  baseDirtyFee?: number
  cleanPerM3?: number
  dirtyPerM3?: number
}
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

  const catFind = await prisma.$runCommandRaw({
    find: 'category_tariffs',
    filter: { category: org.category },
    sort: { year: -1, month: -1 },
    limit: 24,
  } as any)
  const catDocs = extractMongoBatch(catFind) as CategoryTariffDoc[]
  if (catDocs.length === 0) return 0

  const pipeBase = getBaseFromPipe(org.connectionNumber)
  let created = 0

  for (const d of catDocs) {
    const year = d.year
    const month = d.month
    const baseCleanFee = pipeBase ? pipeBase.baseCleanFee : (d.baseCleanFee ?? 0)
    const baseDirtyFee = pipeBase ? pipeBase.baseDirtyFee : (d.baseDirtyFee ?? 0)
    const cleanPerM3 = d.cleanPerM3 ?? 0
    const dirtyPerM3 = d.dirtyPerM3 ?? 0

    const existing = await prisma.organizationTariff.findUnique({
      where: { organizationId_year_month: { organizationId, year, month } },
      select: { id: true },
    })
    if (existing) continue

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
    created += 1
  }

  return created
}
