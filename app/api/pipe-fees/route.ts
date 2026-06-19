import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { getAccountantOwnerOrganizationId } from '@/lib/category-tariff-scope'
import { ensureDefaultOfficePipeFeesInDb } from '@/lib/seed-accountant-defaults'
import { listOfficePipeFees } from '@/lib/pipe-fee-scope'
import { ensureOfficeOrganizationId } from '@/lib/readings-office-org'

async function resolveOfficeOrgId(
  user: { userId: string; organizationId?: string | null; email?: string; name?: string }
): Promise<string | null> {
  const officeOrgId = await ensureOfficeOrganizationId(user)
  const ownerOrganizationId = await getAccountantOwnerOrganizationId({
    userId: user.userId,
    organizationId: officeOrgId ?? user.organizationId,
  })
  return ownerOrganizationId
}

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const officeOrganizationId = await resolveOfficeOrgId(user)
    if (!officeOrganizationId) {
      return NextResponse.json([])
    }

    await ensureDefaultOfficePipeFeesInDb(officeOrganizationId, user.userId)
    const fees = await listOfficePipeFees(officeOrganizationId)
    return NextResponse.json(fees)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    if (msg === 'Unauthorized' || msg === 'Forbidden') {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const officeOrganizationId = await resolveOfficeOrgId(user)
    if (!officeOrganizationId) {
      return NextResponse.json({ error: 'Албан байгууллага тохируулаагүй байна' }, { status: 400 })
    }

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

    const fee = await prisma.officePipeFee.create({
      data: {
        officeOrganizationId,
        diameterMm,
        baseCleanFee,
        baseDirtyFee,
        createdByUserId: user.userId,
        updatedByUserId: user.userId,
      },
    })

    return NextResponse.json(fee)
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string }
    if (err.code === 'P2002') {
      return NextResponse.json(
        { error: 'Энэ голчтой шугамын суурь хураамж аль хэдийн бүртгэлтэй байна' },
        { status: 400 }
      )
    }
    const msg = err.message || 'Алдаа гарлаа'
    if (msg === 'Unauthorized' || msg === 'Forbidden') {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const officeOrganizationId = await resolveOfficeOrgId(user)
    if (!officeOrganizationId) {
      return NextResponse.json({ error: 'Албан байгууллага тохируулаагүй байна' }, { status: 400 })
    }

    const data = await request.json()
    if (!data.id) {
      return NextResponse.json({ error: 'PipeFee ID шаардлагатай' }, { status: 400 })
    }

    const existing = await prisma.officePipeFee.findFirst({
      where: { id: data.id, officeOrganizationId },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Засах эрхгүй эсвэл олдсонгүй' }, { status: 403 })
    }

    const patch: {
      diameterMm?: number
      baseCleanFee?: number
      baseDirtyFee?: number
      updatedByUserId: string
    } = { updatedByUserId: user.userId }

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

    const updated = await prisma.officePipeFee.update({
      where: { id: data.id },
      data: patch,
    })

    return NextResponse.json(updated)
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string }
    if (err.code === 'P2002') {
      return NextResponse.json(
        { error: 'Энэ голчтой шугамын суурь хураамж аль хэдийн бүртгэлтэй байна' },
        { status: 400 }
      )
    }
    const msg = err.message || 'Алдаа гарлаа'
    if (msg === 'Unauthorized' || msg === 'Forbidden') {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const officeOrganizationId = await resolveOfficeOrgId(user)
    if (!officeOrganizationId) {
      return NextResponse.json({ error: 'Албан байгууллага тохируулаагүй байна' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'PipeFee ID шаардлагатай' }, { status: 400 })
    }

    const existing = await prisma.officePipeFee.findFirst({
      where: { id, officeOrganizationId },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Устгах эрхгүй эсвэл олдсонгүй' }, { status: 403 })
    }

    await prisma.officePipeFee.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    if (msg === 'Unauthorized' || msg === 'Forbidden') {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
