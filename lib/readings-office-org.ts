import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'

/** Нягтлан/захиралын token дээр албан organizationId хоосон бол үүсгээд холбоно. */
export async function ensureOfficeOrganizationId(user: {
  userId: string
  organizationId?: string | null
  email?: string
  name?: string
}): Promise<string | null> {
  if (user.organizationId) return user.organizationId
  const dbUser = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { id: true, email: true, name: true, organizationId: true, role: true },
  })
  if (dbUser?.organizationId) return dbUser.organizationId
  const roleStr = String(dbUser?.role ?? '')
  if (roleStr !== Role.ACCOUNTANT && roleStr !== Role.MANAGER) return null
  const currentYear = new Date().getFullYear()
  const orgName = `${(dbUser?.name ?? user.name ?? 'Accountant').trim()} (${(dbUser?.email ?? user.email ?? user.userId).trim()})`
  const org = await prisma.organization.create({
    data: {
      name: orgName,
      category: 'ORGANIZATION',
      baseCleanFee: 0,
      baseDirtyFee: 0,
      year: currentYear,
      createdByUserId: user.userId,
      updatedByUserId: user.userId,
    },
  })
  await prisma.user.update({
    where: { id: user.userId },
    data: { organizationId: org.id },
  })
  return org.id
}
