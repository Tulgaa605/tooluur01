import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'

const STANDARD_PIPE_FEES: Array<{ diameterMm: number; baseFee: number }> = [
  { diameterMm: 15, baseFee: 1000 },
  { diameterMm: 20, baseFee: 1200 },
  { diameterMm: 25, baseFee: 1800 },
  { diameterMm: 32, baseFee: 2700 },
  { diameterMm: 40, baseFee: 4000 },
  { diameterMm: 50, baseFee: 6400 },
  { diameterMm: 65, baseFee: 7900 },
  { diameterMm: 80, baseFee: 10500 },
  { diameterMm: 100, baseFee: 15280 },
  { diameterMm: 125, baseFee: 18500 },
  { diameterMm: 150, baseFee: 25200 },
  { diameterMm: 200, baseFee: 31200 },
  { diameterMm: 250, baseFee: 43000 },
  { diameterMm: 300, baseFee: 59800 },
  { diameterMm: 400, baseFee: 76800 },
]

async function ensureStandardPipeFees() {
  // Стандарт хүснэгтийг нэг удаа "анхны дүүргэлт" маягаар үүсгэнэ.
  // Хэрэглэгч өмнө нь зассан (0 биш) утгуудыг дахин дарж бичихгүй.
  const existing = await prisma.pipeFee.findMany({
    select: { diameterMm: true, baseCleanFee: true, baseDirtyFee: true },
  })
  const existingByDiameter = new Map<number, { baseCleanFee: number; baseDirtyFee: number }>(
    existing.map((e) => [e.diameterMm, { baseCleanFee: e.baseCleanFee ?? 0, baseDirtyFee: e.baseDirtyFee ?? 0 }])
  )

  const toCreate = STANDARD_PIPE_FEES.filter((f) => !existingByDiameter.has(f.diameterMm))
  const toUpdate = STANDARD_PIPE_FEES.filter((f) => {
    const ex = existingByDiameter.get(f.diameterMm)
    if (!ex) return false
    // Хоосон/анхдагч 0 орсон мөрүүдийг л стандарт утгаар нөхнө.
    return (ex.baseCleanFee ?? 0) === 0 && (ex.baseDirtyFee ?? 0) === 0
  })

  await Promise.all([
    ...toCreate.map((f) =>
      prisma.pipeFee.create({
        data: {
          diameterMm: f.diameterMm,
          baseCleanFee: f.baseFee,
          baseDirtyFee: f.baseFee,
        },
      })
    ),
    ...toUpdate.map((f) =>
      prisma.pipeFee.update({
        where: { diameterMm: f.diameterMm },
        data: {
          baseCleanFee: f.baseFee,
          baseDirtyFee: f.baseFee,
        },
      })
    ),
  ])
}

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Pipe fee стандарт утгууд хоосон байвал автоматаар дүүргэнэ
    await ensureStandardPipeFees()

    const fees = await prisma.pipeFee.findMany({
      orderBy: { diameterMm: 'asc' },
    })

    return NextResponse.json(fees)
  } catch (error: any) {
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
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
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const data = await request.json()
    const diameterMm = parseInt(String(data.diameterMm), 10)
    if (!Number.isInteger(diameterMm) || diameterMm <= 0) {
      return NextResponse.json(
        { error: 'Шугамын голч зөв бүхэл тоо байх ёстой' },
        { status: 400 }
      )
    }

    const baseCleanFee = Number.isFinite(Number(data.baseCleanFee))
      ? Number(data.baseCleanFee)
      : 0
    const baseDirtyFee = Number.isFinite(Number(data.baseDirtyFee))
      ? Number(data.baseDirtyFee)
      : 0

    if (baseCleanFee < 0 || baseDirtyFee < 0) {
      return NextResponse.json(
        { error: 'Суурь хураамж сөрөг байж болохгүй' },
        { status: 400 }
      )
    }

    const fee = await prisma.pipeFee.create({
      data: {
        diameterMm,
        baseCleanFee,
        baseDirtyFee,
        createdByUserId: user.userId,
        updatedByUserId: user.userId,
      },
    })

    return NextResponse.json(fee)
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Энэ голчтой шугамын суурь хураамж аль хэдийн бүртгэлтэй байна' },
        { status: 400 }
      )
    }
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
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
      return NextResponse.json(
        { error: 'PipeFee ID шаардлагатай' },
        { status: 400 }
      )
    }

    const patch: any = {}
    if (data.diameterMm !== undefined) {
      const diameterMm = parseInt(String(data.diameterMm), 10)
      if (!Number.isInteger(diameterMm) || diameterMm <= 0) {
        return NextResponse.json(
          { error: 'Шугамын голч зөв бүхэл тоо байх ёстой' },
          { status: 400 }
        )
      }
      patch.diameterMm = diameterMm
    }

    if (data.baseCleanFee !== undefined) {
      const v = Number.isFinite(Number(data.baseCleanFee)) ? Number(data.baseCleanFee) : 0
      if (v < 0) {
        return NextResponse.json(
          { error: 'Цэвэр усны суурь хураамж сөрөг байж болохгүй' },
          { status: 400 }
        )
      }
      patch.baseCleanFee = v
    }

    if (data.baseDirtyFee !== undefined) {
      const v = Number.isFinite(Number(data.baseDirtyFee)) ? Number(data.baseDirtyFee) : 0
      if (v < 0) {
        return NextResponse.json(
          { error: 'Бохир усны суурь хураамж сөрөг байж болохгүй' },
          { status: 400 }
        )
      }
      patch.baseDirtyFee = v
    }

    const updated = await prisma.pipeFee.update({
      where: { id: data.id },
      data: { ...patch, updatedByUserId: user.userId },
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Энэ голчтой шугамын суурь хураамж аль хэдийн бүртгэлтэй байна' },
        { status: 400 }
      )
    }
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
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
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json(
        { error: 'PipeFee ID шаардлагатай' },
        { status: 400 }
      )
    }

    await prisma.pipeFee.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа' },
      { status: 500 }
    )
  }
}

