import { prisma } from '@/lib/prisma'

export type OrgForReading = {
  id: string
  name: string
  code: string | null
  category: string | null
  phone: string | null
  users: { phone: string | null }[]
}

export type MeterForReading = {
  id: string
  meterNumber: string
  billingMode: string | null
  organizationId?: string
}

/**
 * FK-д таарах organization/meter үгүй (устгагдсан) үед Prisma nested include
 * "Inconsistent query result" өгдөг тул уншилтыг тусад нь нэгтгэнэ.
 */
export async function attachOrgsAndMetersToReadings<
  T extends { organizationId: string; meterId: string },
>(rows: T[]): Promise<Array<T & { organization: OrgForReading; meter: MeterForReading }>> {
  if (rows.length === 0) return []

  const orgIds = [...new Set(rows.map((r) => r.organizationId).filter(Boolean))]
  const meterIds = [...new Set(rows.map((r) => r.meterId).filter(Boolean))]

  const [orgs, meters] = await Promise.all([
    orgIds.length === 0
      ? []
      : prisma.organization.findMany({
          where: { id: { in: orgIds } },
          select: {
            id: true,
            name: true,
            code: true,
            category: true,
            phone: true,
            users: {
              where: { phone: { not: null } },
              select: { phone: true },
            },
          },
        }),
    meterIds.length === 0
      ? []
      : prisma.meter.findMany({
          where: { id: { in: meterIds } },
          select: { id: true, meterNumber: true, billingMode: true, organizationId: true },
        }),
  ])

  const orgById = new Map(orgs.map((o) => [o.id, o]))
  const meterById = new Map(meters.map((m) => [m.id, m]))

  return rows.map((r) => {
    const o = orgById.get(r.organizationId)
    const m = meterById.get(r.meterId)
    return {
      ...r,
      organization:
        o ??
        ({
          id: r.organizationId,
          name: '(Байгууллага олдсонгүй)',
          code: null,
          category: null,
          phone: null,
          users: [],
        } satisfies OrgForReading),
      meter:
        m ??
        ({
          id: r.meterId,
          meterNumber: '(Тоолуур олдсонгүй)',
          billingMode: null,
          organizationId: r.organizationId,
        } satisfies MeterForReading),
    }
  })
}
