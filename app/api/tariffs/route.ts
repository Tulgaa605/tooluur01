import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { getScopedOrganizationIds, organizationIdInScope } from '@/lib/org-scope'

function parseNumberOrDefault(value: any, defaultValue: number) {
  if (typeof value === 'number') return value
  if (value == null || value === '') return defaultValue
  const n = parseFloat(String(value))
  return Number.isFinite(n) ? n : defaultValue
}

function validateMonthYear(month: number, year: number) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 'Сар 1-12 хооронд бүхэл тоо байх ёстой'
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return 'Он зөв утгатай байх ёстой'
  return null
}

type CategoryTariffDoc = {
  _id: any
  category: string
  baseCleanFee: number
  baseDirtyFee: number
  cleanPerM3: number
  dirtyPerM3: number
  createdAt?: Date
  updatedAt?: Date
}

function extractMongoBatch(result: any): any[] {
  if (!result) return []
  const cursor = result.cursor
  if (cursor?.firstBatch && Array.isArray(cursor.firstBatch)) return cursor.firstBatch
  if (cursor?.nextBatch && Array.isArray(cursor.nextBatch)) return cursor.nextBatch
  return []
}

async function upsertCategoryTariff(params: {
  category: string
  baseCleanFee: number
  baseDirtyFee: number
  cleanPerM3: number
  dirtyPerM3: number
}) {
  const now = new Date()
  await prisma.$runCommandRaw({
    update: 'category_tariffs',
    updates: [
      {
        q: { category: params.category },
        u: {
          $set: {
            baseCleanFee: params.baseCleanFee,
            baseDirtyFee: params.baseDirtyFee,
            cleanPerM3: params.cleanPerM3,
            dirtyPerM3: params.dirtyPerM3,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    ],
  } as any)
}

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const year = searchParams.get('year') ? parseInt(searchParams.get('year') as string, 10) : undefined

    const scoped = await getScopedOrganizationIds(user)
    if (scoped.length === 0) {
      return NextResponse.json([])
    }

    const where: any = { organizationId: { in: scoped } }
    if (year) where.year = year

    const tariffs = await prisma.organizationTariff.findMany({
      where,
      include: {
        organization: {
          select: { id: true, name: true, code: true, connectionNumber: true, category: true },
        },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { updatedAt: 'desc' }],
    })

    const includeCategory = searchParams.get('includeCategory') === '1'
    if (!includeCategory) return NextResponse.json(tariffs)

    const catFind = await prisma.$runCommandRaw({
      find: 'category_tariffs',
      filter: {},
      sort: { updatedAt: -1 },
      limit: 500,
    } as any)
    const catDocs = extractMongoBatch(catFind) as CategoryTariffDoc[]
    const categoryTariffs = catDocs.map((d: any) => ({
      id: `category:${d.category}`,
      kind: 'category',
      category: d.category,
      baseCleanFee: d.baseCleanFee ?? 0,
      baseDirtyFee: d.baseDirtyFee ?? 0,
      cleanPerM3: d.cleanPerM3 ?? 0,
      dirtyPerM3: d.dirtyPerM3 ?? 0,
      updatedAt: d.updatedAt,
    }))

    return NextResponse.json([...tariffs, ...categoryTariffs])
  } catch (error: any) {
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json(
        { error: 'Энэ үйлдлийг хийх эрх байхгүй байна. Дансны эрхээр нэвтэрнэ үү.' },
        { status: 403 }
      )
    }
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Нэвтрэх эрх шаардлагатай' }, { status: 401 })

    const data = await request.json()

    let organizationId = data.organizationId as string | undefined
    const category = data.category as string | undefined
    if (organizationId && !(await organizationIdInScope(user, organizationId))) {
      return NextResponse.json(
        { error: 'Зөвхөн өөрийн хамрах хүрээний байгууллагын тариф тохируулах боломжтой' },
        { status: 403 }
      )
    }
    if (user.organizationId && !category) organizationId = user.organizationId
    const year = organizationId ? parseInt(String(data.year), 10) : 0
    const month = organizationId ? parseInt(String(data.month), 10) : 0
    if (organizationId) {
      const validationError = validateMonthYear(month, year)
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 })
      }
    }

    let baseCleanFee = parseNumberOrDefault(data.baseCleanFee, 0)
    let baseDirtyFee = parseNumberOrDefault(data.baseDirtyFee, 0)
    const cleanPerM3 = parseNumberOrDefault(data.cleanPerM3, 0)
    const dirtyPerM3 = parseNumberOrDefault(data.dirtyPerM3, 0)

    if (baseCleanFee < 0 || baseDirtyFee < 0 || cleanPerM3 < 0 || dirtyPerM3 < 0) {
      return NextResponse.json(
        { error: 'Тарифын утгууд сөрөг байж болохгүй' },
        { status: 400 }
      )
    }

    const pipeFees = await prisma.pipeFee.findMany({ orderBy: { diameterMm: 'asc' } })
    const getBaseFromPipe = (connectionNumber: string | null) => {
      if (!connectionNumber) return null
      const diam = parseInt(String(connectionNumber).trim(), 10)
      if (Number.isNaN(diam)) return null
      const pipe = pipeFees.find((p) => p.diameterMm === diam)
      return pipe ? { baseCleanFee: pipe.baseCleanFee, baseDirtyFee: pipe.baseDirtyFee } : null
    }

    // Хэрэв байгууллага сонгосон бол нэг байгууллагад тариф үүсгэнэ
    if (organizationId) {
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { connectionNumber: true },
      })
      const pipeBase = org ? getBaseFromPipe(org.connectionNumber) : null
      if (pipeBase) {
        baseCleanFee = pipeBase.baseCleanFee
        baseDirtyFee = pipeBase.baseDirtyFee
      }
      const existing = await prisma.organizationTariff.findUnique({
        where: { organizationId_year_month: { organizationId, year, month } },
        select: { id: true },
      })

      const tariff = existing
        ? await prisma.organizationTariff.update({
            where: { organizationId_year_month: { organizationId, year, month } },
            data: { baseCleanFee, baseDirtyFee, cleanPerM3, dirtyPerM3 },
            include: {
              organization: {
                select: { id: true, name: true, code: true, connectionNumber: true, category: true },
              },
            },
          })
        : await prisma.organizationTariff.create({
            data: {
              organizationId,
              month,
              year,
              baseCleanFee,
              baseDirtyFee,
              cleanPerM3,
              dirtyPerM3,
            },
            include: {
              organization: {
                select: { id: true, name: true, code: true, connectionNumber: true, category: true },
              },
            },
          })

      return NextResponse.json({
        success: true,
        created: existing ? 0 : 1,
        updated: existing ? 1 : 0,
        tariff,
      })
    }

    // Харин байгууллага сонгохгүй, зөвхөн хэрэглэгчийн төрөл (category) сонгосон тохиолдолд
    if (!category) {
      return NextResponse.json(
        { error: 'Хэрэглэгчийн төрөл эсвэл байгууллага заавал сонгоно уу' },
        { status: 400 }
      )
    }

    // Бүх байгууллагад төрлийн тариф тараах — зөвхөн нягтлан
    if (String(user.role) !== Role.ACCOUNTANT) {
      return NextResponse.json(
        { error: 'Энэ үйлдлийг зөвхөн нягтлан хийнэ' },
        { status: 403 }
      )
    }

    // Нэг төрлийн тариф нэг л байна; шинэчлэх хүртэл идэвхтэй
    await upsertCategoryTariff({
      category,
      baseCleanFee,
      baseDirtyFee,
      cleanPerM3,
      dirtyPerM3,
    })

    // Байгууллага бүрт тухайн сарын тариф бичлэг үүсгэж, уншилтанд хэрэглэгдэнэ
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() + 1
    const orgs = await prisma.organization.findMany({
      where: { category },
      select: { id: true, name: true, connectionNumber: true },
    })
    let created = 0
    let updated = 0
    for (const org of orgs) {
      const pipeBase = getBaseFromPipe(org.connectionNumber)
      const orgBaseClean = pipeBase ? pipeBase.baseCleanFee : baseCleanFee
      const orgBaseDirty = pipeBase ? pipeBase.baseDirtyFee : baseDirtyFee
      const key = { organizationId: org.id, year: currentYear, month: currentMonth }
      const existing = await prisma.organizationTariff.findUnique({
        where: { organizationId_year_month: key },
        select: { id: true },
      })
      if (existing) {
        await prisma.organizationTariff.update({
          where: { organizationId_year_month: key },
          data: {
            baseCleanFee: orgBaseClean,
            baseDirtyFee: orgBaseDirty,
            cleanPerM3,
            dirtyPerM3,
          },
        })
        updated += 1
      } else {
        await prisma.organizationTariff.create({
          data: {
            organizationId: org.id,
            year: currentYear,
            month: currentMonth,
            baseCleanFee: orgBaseClean,
            baseDirtyFee: orgBaseDirty,
            cleanPerM3,
            dirtyPerM3,
          },
        })
        created += 1
      }
    }

    const parts: string[] = []
    if (created > 0) parts.push(`нэмэгдсэн: ${created}`)
    if (updated > 0) parts.push(`шинэчлэгдсэн: ${updated}`)
    const detail = parts.length ? ` (${parts.join(', ')})` : ''
    return NextResponse.json({
      success: true,
      message:
        orgs.length === 0
          ? 'Төрлийн тариф хадгаллаа. Шинэчлэлт хийх хүртэл энэ тариф хүчинтэй байна.'
          : `Төрлийн тариф хадгаллаа. ${orgs.length} байгууллагад тухайн сарын тариф хэрэглэгдлээ.${detail}`,
    })
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Энэ байгууллага дээр энэ сарын тариф аль хэдийн бүртгэлтэй байна' },
        { status: 400 }
      )
    }
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json(
        { error: 'Энэ үйлдлийг хийх эрх байхгүй байна. Дансны эрхээр нэвтэрнэ үү.' },
        { status: 403 }
      )
    }
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const data = await request.json()
    if (!data.id) {
      return NextResponse.json({ error: 'Tariff ID шаардлагатай' }, { status: 400 })
    }

    const patch: any = {}
    if (data.baseCleanFee !== undefined) patch.baseCleanFee = parseNumberOrDefault(data.baseCleanFee, 0)
    if (data.baseDirtyFee !== undefined) patch.baseDirtyFee = parseNumberOrDefault(data.baseDirtyFee, 0)
    if (data.cleanPerM3 !== undefined) patch.cleanPerM3 = parseNumberOrDefault(data.cleanPerM3, 0)
    if (data.dirtyPerM3 !== undefined) patch.dirtyPerM3 = parseNumberOrDefault(data.dirtyPerM3, 0)

    const negatives = ['baseCleanFee', 'baseDirtyFee', 'cleanPerM3', 'dirtyPerM3'].some(
      (k) => typeof patch[k] === 'number' && patch[k] < 0
    )
    if (negatives) {
      return NextResponse.json(
        { error: 'Тарифын утгууд сөрөг байж болохгүй' },
        { status: 400 }
      )
    }
    const existing = await prisma.organizationTariff.findUnique({
      where: { id: data.id },
      select: { organizationId: true },
    })
    if (
      !existing?.organizationId ||
      !(await organizationIdInScope(user, existing.organizationId))
    ) {
      return NextResponse.json(
        { error: 'Энэ тарифыг засах эрхгүй' },
        { status: 403 }
      )
    }

    const updated = await prisma.organizationTariff.update({
      where: { id: data.id },
      data: patch,
      include: {
        organization: { select: { id: true, name: true, code: true, connectionNumber: true, category: true } },
      },
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json(
        { error: 'Энэ үйлдлийг хийх эрх байхгүй байна. Дансны эрхээр нэвтэрнэ үү.' },
        { status: 403 }
      )
    }
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const kind = searchParams.get('kind')
    if (kind === 'category') {
      const category = searchParams.get('category')
      if (!category) {
        return NextResponse.json({ error: 'Хэрэглэгчийн төрөл (category) шаардлагатай' }, { status: 400 })
      }
      await prisma.$runCommandRaw({
        delete: 'category_tariffs',
        deletes: [{ q: { category }, limit: 1 }],
      } as any)
      return NextResponse.json({ success: true })
    }
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Tariff ID шаардлагатай' }, { status: 400 })
    const tariff = await prisma.organizationTariff.findUnique({
      where: { id },
      select: { organizationId: true },
    })
    if (
      !tariff?.organizationId ||
      !(await organizationIdInScope(user, tariff.organizationId))
    ) {
      return NextResponse.json(
        { error: 'Энэ тарифыг устгах эрхгүй' },
        { status: 403 }
      )
    }

    await prisma.organizationTariff.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json(
        { error: 'Энэ үйлдлийг хийх эрх байхгүй байна. Дансны эрхээр нэвтэрнэ үү.' },
        { status: 403 }
      )
    }
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа' },
      { status: 500 }
    )
  }
}

