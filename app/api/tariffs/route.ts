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

const tariffOrgSelect = {
  id: true,
  name: true,
  code: true,
  connectionNumber: true,
  category: true,
} as const

type OrgForTariff = {
  id: string
  name: string
  code: string | null
  connectionNumber: string | null
  category: string | null
}

/**
 * `include: { organization }` нь FK-д тохирох байгууллага үгүй (устгагдсан) үед Prisma
 * "Inconsistent query result" алдаа өгдөг. Тарифыг тусдаа уншаад байгууллагыг нэгтгэнэ.
 */
async function attachOrganizationsToTariffs<T extends { organizationId: string }>(
  rows: T[]
): Promise<Array<T & { organization: OrgForTariff }>> {
  const ids = [...new Set(rows.map((r) => r.organizationId))]
  const orgs =
    ids.length === 0
      ? []
      : await prisma.organization.findMany({
          where: { id: { in: ids } },
          select: tariffOrgSelect,
        })
  const byId = new Map<string, OrgForTariff>(orgs.map((o) => [o.id, o]))
  const missing: OrgForTariff = {
    id: '',
    name: '(Байгууллага олдсонгүй)',
    code: null,
    connectionNumber: null,
    category: null,
  }
  return rows.map((t) => {
    const o = byId.get(t.organizationId)
    return {
      ...t,
      organization: o ?? { ...missing, id: t.organizationId },
    }
  })
}

async function upsertCategoryTariff(
  params: {
    category: string
    baseCleanFee: number
    baseDirtyFee: number
    cleanPerM3: number
    dirtyPerM3: number
  },
  userId: string
) {
  await prisma.categoryTariff.upsert({
    where: { category: params.category },
    create: {
      category: params.category,
      baseCleanFee: params.baseCleanFee,
      baseDirtyFee: params.baseDirtyFee,
      cleanPerM3: params.cleanPerM3,
      dirtyPerM3: params.dirtyPerM3,
      createdByUserId: userId,
      updatedByUserId: userId,
    },
    update: {
      baseCleanFee: params.baseCleanFee,
      baseDirtyFee: params.baseDirtyFee,
      cleanPerM3: params.cleanPerM3,
      dirtyPerM3: params.dirtyPerM3,
      updatedByUserId: userId,
    },
  })
}

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const year = searchParams.get('year') ? parseInt(searchParams.get('year') as string, 10) : undefined

    const scoped = await getScopedOrganizationIds(user)
    // Хоосон scoped (organizationId байхгүй гэх мэт) үед ч доорх category_tariffs-ийг унших ёстой —
    // урьд нь шууд [] буцааж төрлийн тарифыг алдаж байсан.
    const where: any = { organizationId: { in: scoped } }
    if (year) where.year = year

    const rawTariffs =
      scoped.length === 0
        ? []
        : await prisma.organizationTariff.findMany({
            where,
            orderBy: [{ year: 'desc' }, { month: 'desc' }, { updatedAt: 'desc' }],
          })
    const tariffs = await attachOrganizationsToTariffs(rawTariffs)

    const includeCategory = searchParams.get('includeCategory') === '1'
    if (!includeCategory) return NextResponse.json(tariffs)

    const catRows = await prisma.categoryTariff.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 500,
    })
    const categoryTariffs = catRows.map((d) => ({
      id: `category:${d.category}`,
      kind: 'category',
      category: d.category,
      baseCleanFee: d.baseCleanFee ?? 0,
      baseDirtyFee: d.baseDirtyFee ?? 0,
      cleanPerM3: d.cleanPerM3 ?? 0,
      dirtyPerM3: d.dirtyPerM3 ?? 0,
      createdByUserId: d.createdByUserId,
      updatedByUserId: d.updatedByUserId,
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
    // Он/сар-г үргэлж тооцоолж validate хийнэ (category болон organization тариф аль алинд нь хэрэгтэй)
    const now = new Date()
    const defaultYear = now.getFullYear()
    const defaultMonth = now.getMonth() + 1
    const year = Number.isFinite(parseInt(String(data.year), 10)) ? parseInt(String(data.year), 10) : defaultYear
    const month = Number.isFinite(parseInt(String(data.month), 10)) ? parseInt(String(data.month), 10) : defaultMonth
    const validationError = validateMonthYear(month, year)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
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

      const tariffRaw = existing
        ? await prisma.organizationTariff.update({
            where: { organizationId_year_month: { organizationId, year, month } },
            data: {
              baseCleanFee,
              baseDirtyFee,
              cleanPerM3,
              dirtyPerM3,
              updatedByUserId: user.userId,
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
              createdByUserId: user.userId,
              updatedByUserId: user.userId,
            },
          })
      const [tariff] = await attachOrganizationsToTariffs([tariffRaw])

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
    await upsertCategoryTariff(
      {
        category,
        baseCleanFee,
        baseDirtyFee,
        cleanPerM3,
        dirtyPerM3,
      },
      user.userId
    )

    // Байгууллага бүрт тухайн сарын тариф бичлэг үүсгэж, уншилтанд хэрэглэгдэнэ.
    // Өмнө нь org бүрт find+write дарааллаар (2N query) удаан байсан тул:
    // нэг findMany + createMany + update-уудыг багцаар параллель хийнэ.
    const orgs = await prisma.organization.findMany({
      where: { category },
      select: { id: true, name: true, connectionNumber: true },
    })

    type RowPayload = {
      baseCleanFee: number
      baseDirtyFee: number
      cleanPerM3: number
      dirtyPerM3: number
    }

    let created = 0
    let updated = 0

    if (orgs.length > 0) {
      const orgIds = orgs.map((o) => o.id)
      const existingRows = await prisma.organizationTariff.findMany({
        where: {
          year,
          month,
          organizationId: { in: orgIds },
        },
        select: { id: true, organizationId: true },
      })
      const existingByOrgId = new Map(existingRows.map((r) => [r.organizationId, r]))

      const toCreate: Array<{
        organizationId: string
        year: number
        month: number
        createdByUserId: string
        updatedByUserId: string
      } & RowPayload> = []
      const toUpdate: Array<{ id: string } & RowPayload> = []

      for (const org of orgs) {
        const pipeBase = getBaseFromPipe(org.connectionNumber)
        const orgBaseClean = pipeBase ? pipeBase.baseCleanFee : baseCleanFee
        const orgBaseDirty = pipeBase ? pipeBase.baseDirtyFee : baseDirtyFee
        const payload: RowPayload = {
          baseCleanFee: orgBaseClean,
          baseDirtyFee: orgBaseDirty,
          cleanPerM3,
          dirtyPerM3,
        }
        const ex = existingByOrgId.get(org.id)
        if (ex) {
          toUpdate.push({ id: ex.id, ...payload })
        } else {
          toCreate.push({
            organizationId: org.id,
            year,
            month,
            createdByUserId: user.userId,
            updatedByUserId: user.userId,
            ...payload,
          })
        }
      }

      if (toCreate.length > 0) {
        await prisma.organizationTariff.createMany({ data: toCreate })
        created = toCreate.length
      }

      const UPDATE_BATCH = 40
      for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH) {
        const batch = toUpdate.slice(i, i + UPDATE_BATCH)
        await Promise.all(
          batch.map((row) =>
            prisma.organizationTariff.update({
              where: { id: row.id },
              data: {
                baseCleanFee: row.baseCleanFee,
                baseDirtyFee: row.baseDirtyFee,
                cleanPerM3: row.cleanPerM3,
                dirtyPerM3: row.dirtyPerM3,
                updatedByUserId: user.userId,
              },
            })
          )
        )
        updated += batch.length
      }
    }

    const parts: string[] = []
    if (created > 0) parts.push(`нэмэгдсэн: ${created}`)
    if (updated > 0) parts.push(`шинэчлэгдсэн: ${updated}`)
    const detail = parts.length ? ` (${parts.join(', ')})` : ''
    return NextResponse.json({
      success: true,
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

    const updatedRaw = await prisma.organizationTariff.update({
      where: { id: data.id },
      data: { ...patch, updatedByUserId: user.userId },
    })
    const [updated] = await attachOrganizationsToTariffs([updatedRaw])

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
      await prisma.categoryTariff.deleteMany({ where: { category } })
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

