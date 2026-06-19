import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { seedAccountantDefaults } from '@/lib/seed-accountant-defaults'

async function resolveExistingOrganizationId(orgId: string | null | undefined): Promise<string | null> {
  if (!orgId || !/^[a-f\d]{24}$/i.test(orgId)) return null
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true },
  })
  return org?.id ?? null
}

/** Нягтлан/захиралын token дээр албан organizationId хоосон бол үүсгээд холбоно. */
export async function ensureOfficeOrganizationId(user: {
  userId: string
  organizationId?: string | null
  email?: string
  name?: string
}): Promise<string | null> {
  const fromToken = await resolveExistingOrganizationId(user.organizationId)
  if (fromToken) return fromToken
  const dbUser = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { id: true, email: true, name: true, organizationId: true, role: true },
  })
  const fromDb = await resolveExistingOrganizationId(dbUser?.organizationId)
  if (fromDb) return fromDb
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
  await seedAccountantDefaults(org.id, user.userId)
  return org.id
}
