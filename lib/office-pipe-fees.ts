import { prisma } from '@/lib/prisma'
import { ensureGlobalStandardPipeFees } from '@/lib/pipe-fees-global'

/** Алба анх удаа нэвтрэхэд глобал `pipe_fees`-ээс хуулбар үүсгэнэ */
export async function ensureOfficePipeFeesCloned(officeOrganizationId: string) {
  const n = await prisma.officePipeFee.count({ where: { officeOrganizationId } })
  if (n > 0) return
  await ensureGlobalStandardPipeFees()
  const globalFees = await prisma.pipeFee.findMany({ orderBy: { diameterMm: 'asc' } })
  if (globalFees.length === 0) return
  await prisma.officePipeFee.createMany({
    data: globalFees.map((p) => ({
      officeOrganizationId,
      diameterMm: p.diameterMm,
      baseCleanFee: p.baseCleanFee ?? 0,
      baseDirtyFee: p.baseDirtyFee ?? 0,
    })),
  })
}

export type PipeBasePair = { baseCleanFee: number; baseDirtyFee: number }

const officeDiamKey = (officeId: string, diam: number) => `${officeId}:${diam}`

/**
 * Олон байгууллагын шугамын суурийг хурдан олох (төрлийн тариф тараах гэх мэт).
 * Албын `office_pipe_fees` байвал түүнийг, үгүй бол глобал `pipe_fees`.
 */
export function buildPipeBaseResolver(
  orgs: Array<{ connectionNumber: string | null; managedByOrganizationId: string | null }>,
  globalFees: Array<{ diameterMm: number; baseCleanFee: number; baseDirtyFee: number }>,
  officeFees: Array<{
    officeOrganizationId: string
    diameterMm: number
    baseCleanFee: number
    baseDirtyFee: number
  }>
): (connectionNumber: string | null, managedByOrganizationId: string | null) => PipeBasePair | null {
  const globalByDiam = new Map(globalFees.map((p) => [p.diameterMm, p]))
  const officeMap = new Map<string, PipeBasePair>()
  for (const r of officeFees) {
    officeMap.set(officeDiamKey(r.officeOrganizationId, r.diameterMm), {
      baseCleanFee: r.baseCleanFee ?? 0,
      baseDirtyFee: r.baseDirtyFee ?? 0,
    })
  }

  return (connectionNumber: string | null, managedByOrganizationId: string | null) => {
    if (!connectionNumber) return null
    const diam = parseInt(String(connectionNumber).trim(), 10)
    if (Number.isNaN(diam)) return null
    if (managedByOrganizationId) {
      const o = officeMap.get(officeDiamKey(managedByOrganizationId, diam))
      if (o) return o
    }
    const g = globalByDiam.get(diam)
    if (!g) return null
    return { baseCleanFee: g.baseCleanFee ?? 0, baseDirtyFee: g.baseDirtyFee ?? 0 }
  }
}

export async function loadPipeBaseResolverForOrgs(
  orgs: Array<{ connectionNumber: string | null; managedByOrganizationId: string | null }>
) {
  const globalFees = await prisma.pipeFee.findMany({ orderBy: { diameterMm: 'asc' } })
  const officeIds = [...new Set(orgs.map((o) => o.managedByOrganizationId).filter(Boolean))] as string[]
  const officeFees =
    officeIds.length > 0
      ? await prisma.officePipeFee.findMany({
          where: { officeOrganizationId: { in: officeIds } },
        })
      : []
  return buildPipeBaseResolver(orgs, globalFees, officeFees)
}
