import { prisma } from '@/lib/prisma'
import { TokenPayload } from '@/lib/auth'
import { Role } from '@/lib/role'

function extractMongoFindBatch(result: unknown): { _id?: unknown }[] {
  if (!result || typeof result !== 'object') return []
  const r = result as { cursor?: { firstBatch?: unknown[]; nextBatch?: unknown[] } }
  if (r.cursor?.firstBatch && Array.isArray(r.cursor.firstBatch)) {
    return r.cursor.firstBatch as { _id?: unknown }[]
  }
  if (r.cursor?.nextBatch && Array.isArray(r.cursor.nextBatch)) {
    return r.cursor.nextBatch as { _id?: unknown }[]
  }
  return []
}

function mongoDocIdToString(doc: { _id?: unknown }): string {
  const id = doc._id
  if (id == null) return ''
  if (typeof id === 'string') return id
  if (
    typeof id === 'object' &&
    id !== null &&
    '$oid' in id &&
    typeof (id as { $oid: string }).$oid === 'string'
  ) {
    return (id as { $oid: string }).$oid
  }
  return String(id)
}

/**
 * Албан байгууллагаар удирдуулсан харилцагчдын id.
 * `prisma.organization.findMany({ where: { managedByOrganizationId } })` нь зарим орчинд
 * (хуучин prisma generate, буруу workspace-ийн node_modules) validation алдаа өгдөг тул
 * raw MongoDB find ашиглана — ижил өгөгдөл, Prisma client-ийн schema-тай үл хамаарна.
 */
async function findManagedChildOrganizationIds(officeOrgId: string): Promise<string[]> {
  try {
    if (!/^[a-f\d]{24}$/i.test(officeOrgId)) return []
    const raw = await prisma.$runCommandRaw({
      find: 'organizations',
      filter: {
        managedByOrganizationId: { $oid: officeOrgId },
      },
      projection: { _id: 1 },
      limit: 5000,
    } as any)
    const batch = extractMongoFindBatch(raw)
    return batch.map(mongoDocIdToString).filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Нягтлан/захирал: зөвхөн энэ албаас бүртгэсэн харилцагчдын байгууллагын id (албан өөрийн id орохгүй).
 * Заалт, тоолуурын жагсаалтад «өөрийн албан»-ыг хасахад хэрэглэнэ.
 */
export async function getManagedCustomerOrganizationIds(
  user: TokenPayload
): Promise<string[]> {
  if (!user.organizationId) return []
  const r = String(user.role)
  if (r !== Role.ACCOUNTANT && r !== Role.MANAGER) return []
  return findManagedChildOrganizationIds(user.organizationId)
}

/** Нягтлан/захирал: өөрийн албан байгууллага + түүний бүртгэсэн харилцагчдын organization id. Бусад эрх: зөвхөн өөрийн нэг id. */
export async function getScopedOrganizationIds(user: TokenPayload): Promise<string[]> {
  if (!user.organizationId) return []
  const r = String(user.role)
  if (r !== Role.ACCOUNTANT && r !== Role.MANAGER) {
    return [user.organizationId]
  }
  const managed = await findManagedChildOrganizationIds(user.organizationId)
  return [user.organizationId, ...managed]
}

export async function organizationIdInScope(
  user: TokenPayload,
  organizationId: string
): Promise<boolean> {
  const ids = await getScopedOrganizationIds(user)
  return ids.includes(organizationId)
}
