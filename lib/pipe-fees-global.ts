import { prisma } from '@/lib/prisma'

// Глобал (алба бүрт хуулж ашиглах) шугамын стандарт суурь хураамжийн хүснэгт.
const STANDARD_PIPE_FEES: Array<{ diameterMm: number; baseFee: number }> = [
  { diameterMm: 15, baseFee: 1000 },
  { diameterMm: 20, baseFee: 1200 },
  { diameterMm: 25, baseFee: 1800 },
  { diameterMm: 32, baseFee: 2700 },
  { diameterMm: 40, baseFee: 4000 },
  { diameterMm: 50, baseFee: 6400 },
  { diameterMm: 65, baseFee: 7900 },
  { diameterMm: 80, baseFee: 10500 },
  { diameterMm: 100, baseFee: 15280 },
  { diameterMm: 125, baseFee: 18500 },
  { diameterMm: 150, baseFee: 25200 },
  { diameterMm: 200, baseFee: 31200 },
  { diameterMm: 250, baseFee: 43000 },
  { diameterMm: 300, baseFee: 59800 },
  { diameterMm: 400, baseFee: 76800 },
]

/**
 * `pipe_fees` хүснэгтэд стандарт мөрүүдийг нэг удаа нөхнө.
 * Хэрэглэгчийн өмнө нь зассан (0 биш) утгуудыг давхар дарж бичихгүй.
 */
export async function ensureGlobalStandardPipeFees() {
  const existing = await prisma.pipeFee.findMany({
    select: { diameterMm: true, baseCleanFee: true, baseDirtyFee: true },
  })

  const existingByDiameter = new Map<number, { baseCleanFee: number; baseDirtyFee: number }>(
    existing.map((e) => [e.diameterMm, { baseCleanFee: e.baseCleanFee ?? 0, baseDirtyFee: e.baseDirtyFee ?? 0 }])
  )

  const toCreate = STANDARD_PIPE_FEES.filter((f) => !existingByDiameter.has(f.diameterMm))
  const toUpdate = STANDARD_PIPE_FEES.filter((f) => {
    const ex = existingByDiameter.get(f.diameterMm)
    if (!ex) return false
    // 0/анхдагч утгуудыг л стандарт утгаар нөхнө
    return (ex.baseCleanFee ?? 0) === 0 && (ex.baseDirtyFee ?? 0) === 0
  })

  await Promise.all([
    ...toCreate.map((f) =>
      prisma.pipeFee.create({
        data: {
          diameterMm: f.diameterMm,
          baseCleanFee: f.baseFee,
          baseDirtyFee: f.baseFee,
        },
      })
    ),
    ...toUpdate.map((f) =>
      prisma.pipeFee.update({
        where: { diameterMm: f.diameterMm },
        data: {
          baseCleanFee: f.baseFee,
          baseDirtyFee: f.baseFee,
        },
      })
    ),
  ])
}

