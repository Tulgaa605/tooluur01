import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { ensureHeatCategoryTariffsInDb } from '../lib/ensure-heat-category-tariffs'

const prisma = new PrismaClient()

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

async function main() {
  console.log('🌱 Seed эхэлж байна...')

  try {
    // Create organizations
    console.log('📁 Байгууллагууд үүсгэж байна...')
    let org1 = await prisma.organization.findFirst({
      where: { name: 'Жишээ Байгууллага 1' },
    })
    if (!org1) {
      org1 = await prisma.organization.create({
        data: {
          name: 'Жишээ Байгууллага 1',
          address: 'Улаанбаатар хот',
          phone: '99112233',
          email: 'org1@example.com',
        },
      })
      console.log('✅ Байгууллага 1 үүсгэгдлээ:', org1.name)
    } else {
      console.log('ℹ️  Байгууллага 1 аль хэдийн байна:', org1.name)
    }

    let org2 = await prisma.organization.findFirst({
      where: { name: 'Жишээ Байгууллага 2' },
    })
    if (!org2) {
      org2 = await prisma.organization.create({
        data: {
          name: 'Жишээ Байгууллага 2',
          address: 'Улаанбаатар хот',
          phone: '99223344',
          email: 'org2@example.com',
        },
      })
      console.log('✅ Байгууллага 2 үүсгэгдлээ:', org2.name)
    } else {
      console.log('ℹ️  Байгууллага 2 аль хэдийн байна:', org2.name)
    }

    // Create meters
    console.log('🔢 Тоолуурууд үүсгэж байна...')
    let meter1 = await prisma.meter.findFirst({
      where: { meterNumber: 'METER-001' },
    })
    if (!meter1) {
      meter1 = await prisma.meter.create({
        data: {
          meterNumber: 'METER-001',
          organizationId: org1.id,
        },
      })
      console.log('✅ Тоолуур 1 үүсгэгдлээ:', meter1.meterNumber)
    } else {
      console.log('ℹ️  Тоолуур 1 аль хэдийн байна:', meter1.meterNumber)
    }

    let meter2 = await prisma.meter.findFirst({
      where: { meterNumber: 'METER-002' },
    })
    if (!meter2) {
      meter2 = await prisma.meter.create({
        data: {
          meterNumber: 'METER-002',
          organizationId: org2.id,
        },
      })
      console.log('✅ Тоолуур 2 үүсгэгдлээ:', meter2.meterNumber)
    } else {
      console.log('ℹ️  Тоолуур 2 аль хэдийн байна:', meter2.meterNumber)
    }

    // Create users
    console.log('👤 Хэрэглэгчид үүсгэж байна...')
    let accountant = await prisma.user.findFirst({
      where: { email: 'accountant@example.com' },
    })
    if (!accountant) {
      accountant = await prisma.user.create({
        data: {
          email: 'accountant@example.com',
          password: await hashPassword('password123'),
          name: 'Нягтлан бүртгэлч',
          role: 'ACCOUNTANT',
        },
      })
      console.log('✅ Нягтлан үүсгэгдлээ:', accountant.email)
    } else {
      console.log('ℹ️  Нягтлан аль хэдийн байна:', accountant.email)
    }

    let manager = await prisma.user.findFirst({
      where: { email: 'manager@example.com' },
    })
    if (!manager) {
      manager = await prisma.user.create({
        data: {
          email: 'manager@example.com',
          password: await hashPassword('password123'),
          name: 'Захирал',
          role: 'MANAGER',
        },
      })
      console.log('✅ Захирал үүсгэгдлээ:', manager.email)
    } else {
      console.log('ℹ️  Захирал аль хэдийн байна:', manager.email)
    }

    let user1 = await prisma.user.findFirst({
      where: { email: 'user1@example.com' },
    })
    if (!user1) {
      user1 = await prisma.user.create({
        data: {
          email: 'user1@example.com',
          password: await hashPassword('password123'),
          name: 'Хэрэглэгч 1',
          role: 'USER',
          organizationId: org1.id,
        },
      })
      console.log('✅ Хэрэглэгч 1 үүсгэгдлээ:', user1.email)
    } else {
      console.log('ℹ️  Хэрэглэгч 1 аль хэдийн байна:', user1.email)
    }

    let user2 = await prisma.user.findFirst({
      where: { email: 'user2@example.com' },
    })
    if (!user2) {
      user2 = await prisma.user.create({
        data: {
          email: 'user2@example.com',
          password: await hashPassword('password123'),
          name: 'Хэрэглэгч 2',
          role: 'USER',
          organizationId: org2.id,
        },
      })
      console.log('✅ Хэрэглэгч 2 үүсгэгдлээ:', user2.email)
    } else {
      console.log('ℹ️  Хэрэглэгч 2 аль хэдийн байна:', user2.email)
    }

    await ensureHeatCategoryTariffsInDb()
    console.log('✅ Төрлийн дулааны тариф (Төсөвт/ААН/Айл өрх) шалгагдлаа')

    console.log('\n🎉 Seed амжилттай дууслаа!')
    console.log('\n📋 Тест бүртгэлүүд:')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('Нягтлан: accountant@example.com / password123')
    console.log('Захирал: manager@example.com / password123')
    console.log('Хэрэглэгч 1: user1@example.com / password123')
    console.log('Хэрэглэгч 2: user2@example.com / password123')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  } catch (error) {
    console.error('❌ Seed алдаа гарлаа:')
    console.error(error)
    throw error
  }
}

main()
  .catch((e) => {
    console.error('💥 Seed алдаа:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

