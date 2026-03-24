import { prisma } from '@/lib/prisma'
import { TokenPayload } from '@/lib/auth'
import { Role } from '@/lib/role'

/** Нягтлан/захирал: өөрийн албан байгууллага + түүний бүртгэсэн харилцагчдын organization id. Бусад эрх: зөвхөн өөрийн нэг id. */
export async function getScopedOrganizationIds(user: TokenPayload): Promise<string[]> {
  if (!user.organizationId) return []
  const r = String(user.role)
  if (r !== Role.ACCOUNTANT && r !== Role.MANAGER) {
    return [user.organizationId]
  }
  const managed = await prisma.organization.findMany({
    where: { managedByOrganizationId: user.organizationId },
    select: { id: true },
  })
  return [user.organizationId, ...managed.map((o) => o.id)]
}

export async function organizationIdInScope(
  user: TokenPayload,
  organizationId: string
): Promise<boolean> {
  const ids = await getScopedOrganizationIds(user)
  return ids.includes(organizationId)
}
