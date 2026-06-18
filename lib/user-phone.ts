import { prisma } from '@/lib/prisma'
import { normalizeRegisterPhone } from '@/lib/register-phone-verification'

export function normalizeUserPhone(input: string): string | null {
  return normalizeRegisterPhone(input)
}

/** Нэг утас = нэг хэрэглэгч */
export async function assertUserPhoneAvailable(
  phone: string,
  excludeUserId?: string
): Promise<void> {
  const normalized = normalizeUserPhone(phone)
  if (!normalized) {
    throw new Error('Утасны дугаар буруу байна')
  }

  const existing = await prisma.user.findFirst({
    where: {
      phone: normalized,
      ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
    },
    select: { id: true },
  })
  if (existing) {
    throw new Error('Энэ утасны дугаартай хэрэглэгч аль хэдийн бүртгэлтэй байна')
  }
}
