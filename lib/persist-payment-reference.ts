import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const OBJECT_ID_RX = /^[a-f0-9]{24}$/i

/**
 * Заалт дээр төлбөрийн код хадгална.
 * Prisma client хуучин (`paymentReference` таньдаггүй) үед Mongo `update` командаар нөхнө.
 */
export async function persistPaymentReference(
  readingId: string,
  paymentCode: string
): Promise<void> {
  const id = readingId.trim()
  const code = paymentCode.trim()
  if (!OBJECT_ID_RX.test(id)) throw new Error('Буруу заалтын ID')
  if (!/^\d{6}$/.test(code)) throw new Error('Буруу төлбөрийн код')

  try {
    await prisma.meterReading.update({
      where: { id },
      data: { paymentReference: code },
    })
  } catch (e: unknown) {
    const isValidation =
      e instanceof Prisma.PrismaClientValidationError &&
      e.message.includes('paymentReference')
    if (!isValidation) throw e

    await prisma.$runCommandRaw({
      update: 'meter_readings',
      updates: [
        {
          q: { _id: { $oid: id } },
          u: { $set: { paymentReference: code } },
          multi: false,
          upsert: false,
        },
      ],
    })
  }
}
