import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { additionalFeeUsesUnitPrice, parseChargeBasis } from '@/lib/additional-fees-calc'

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rows = await prisma.additionalFeeDefinition.findMany({
      where: { createdByUserId: user.userId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })
    return NextResponse.json(
      rows
        .map((r) => {
          const chargeBasis = parseChargeBasis(r.chargeBasis)
          if (!chargeBasis) return null
          return {
            id: r.id,
            name: r.name,
            chargeBasis,
            unitPrice: Number(r.unitPrice) || 0,
            accountCode: r.accountCode ?? null,
            sortOrder: r.sortOrder,
            active: r.active,
          }
        })
        .filter((r) => r != null)
    )
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Алдаа гарлаа'
    if (msg === 'Unauthorized' || msg === 'Forbidden') {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const accountCode =
      typeof body?.accountCode === 'string' && body.accountCode.trim()
        ? body.accountCode.trim()
        : null
    const chargeBasis = parseChargeBasis(body?.chargeBasis)
    const unitPrice = Number(body?.unitPrice ?? 0)
    const sortOrder = Number.isFinite(Number(body?.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : 0

    if (!name) {
      return NextResponse.json({ error: 'Төлбөрийн нэр оруулна уу' }, { status: 400 })
    }
    if (!chargeBasis) {
      return NextResponse.json(
        { error: 'Тооцооллын төрөл: м³, м², тоо ширхэг эсвэл мөнгөн дүн сонгоно уу' },
        { status: 400 }
      )
    }
    const needsUnitPrice = additionalFeeUsesUnitPrice(chargeBasis)
    if (needsUnitPrice && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      return NextResponse.json({ error: 'Нэгжийн үнэ буруу байна' }, { status: 400 })
    }

    const row = await prisma.additionalFeeDefinition.create({
      data: {
        name,
        chargeBasis,
        unitPrice: needsUnitPrice ? Math.round(unitPrice * 100) / 100 : 0,
        accountCode,
        sortOrder,
        active: body?.active !== false,
        createdByUserId: user.userId,
        updatedByUserId: user.userId,
      },
    })

    return NextResponse.json({
      id: row.id,
      name: row.name,
      chargeBasis: parseChargeBasis(row.chargeBasis),
      unitPrice: Number(row.unitPrice) || 0,
      accountCode: row.accountCode ?? null,
      sortOrder: row.sortOrder,
      active: row.active,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Алдаа гарлаа'
    if (msg === 'Unauthorized' || msg === 'Forbidden') {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    if (!id) return NextResponse.json({ error: 'ID шаардлагатай' }, { status: 400 })

    const existing = await prisma.additionalFeeDefinition.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Олдсонгүй' }, { status: 404 })

    const name =
      typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : existing.name
    const accountCode =
      body?.accountCode != null
        ? (typeof body.accountCode === 'string' && body.accountCode.trim()
            ? body.accountCode.trim()
            : null)
        : (existing as any).accountCode ?? null
    const chargeBasis =
      body?.chargeBasis != null ? parseChargeBasis(body.chargeBasis) : parseChargeBasis(existing.chargeBasis)
    const unitPrice =
      body?.unitPrice != null
        ? Math.round(Number(body.unitPrice) * 100) / 100
        : Number(existing.unitPrice) || 0
    const sortOrder =
      body?.sortOrder != null && Number.isFinite(Number(body.sortOrder))
        ? Math.trunc(Number(body.sortOrder))
        : existing.sortOrder
    const active = body?.active != null ? body.active !== false : existing.active

    if (!chargeBasis) {
      return NextResponse.json(
        { error: 'Тооцооллын төрөл: м³, м², тоо ширхэг эсвэл мөнгөн дүн сонгоно уу' },
        { status: 400 }
      )
    }
    const needsUnitPrice = additionalFeeUsesUnitPrice(chargeBasis)
    if (needsUnitPrice && unitPrice < 0) {
      return NextResponse.json({ error: 'Нэгжийн үнэ буруу байна' }, { status: 400 })
    }

    const row = await prisma.additionalFeeDefinition.update({
      where: { id },
      data: {
        name,
        chargeBasis,
        unitPrice: needsUnitPrice ? unitPrice : 0,
        accountCode,
        sortOrder,
        active,
        updatedByUserId: user.userId,
      },
    })

    return NextResponse.json({
      id: row.id,
      name: row.name,
      chargeBasis: parseChargeBasis(row.chargeBasis),
      unitPrice: Number(row.unitPrice) || 0,
      accountCode: row.accountCode ?? null,
      sortOrder: row.sortOrder,
      active: row.active,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Алдаа гарлаа'
    if (msg === 'Unauthorized' || msg === 'Forbidden') {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')?.trim() ?? ''
    if (!id) return NextResponse.json({ error: 'ID шаардлагатай' }, { status: 400 })

    await prisma.meterAdditionalFeeSelection.deleteMany({ where: { feeDefinitionId: id } })
    await prisma.additionalFeeDefinition.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Алдаа гарлаа'
    if (msg === 'Unauthorized' || msg === 'Forbidden') {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
