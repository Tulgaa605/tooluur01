import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      data: patch,
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

