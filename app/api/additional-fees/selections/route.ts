import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { ensureOfficeOrganizationId } from '@/lib/readings-office-org'
import { parseChargeBasis } from '@/lib/additional-fees-calc'
import { recalculateAndPersistOrgPeriodAdditionalFees } from '@/lib/readings-with-additional-fees'

async function ensureOrgInOfficeScopeOrClaim(params: {
  officeOrgId: string | null
  organizationId: string
}): Promise<'ok' | 'forbidden'> {
  const { officeOrgId, organizationId } = params
  if (!officeOrgId) return 'forbidden'
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, managedByOrganizationId: true },
  })
  if (!org) return 'forbidden'
  // Эзэнгүй (managedByOrganizationId=null) харилцагчийг анх ашиглах үед тухайн алба өөрийн болгож claim хийнэ.
  if (org.managedByOrganizationId == null) {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { managedByOrganizationId: officeOrgId },
    })
    return 'ok'
  }
  return org.managedByOrganizationId === officeOrgId ? 'ok' : 'forbidden'
}

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const meterId = searchParams.get('meterId')?.trim() ?? ''
    const year = parseInt(searchParams.get('year') ?? '', 10)
    const month = parseInt(searchParams.get('month') ?? '', 10)

    if (!meterId || !Number.isFinite(year) || !Number.isFinite(month)) {
      return NextResponse.json(
        { error: 'meterId, year, month шаардлагатай' },
        { status: 400 }
      )
    }

    const meter = await prisma.meter.findUnique({
      where: { id: meterId },
      select: { id: true, organizationId: true },
    })
    if (!meter) return NextResponse.json({ error: 'Тоолуур олдсонгүй' }, { status: 404 })

    const officeOrgId = await ensureOfficeOrganizationId(user)
    const scopeOk = await ensureOrgInOfficeScopeOrClaim({ officeOrgId, organizationId: meter.organizationId })
    if (scopeOk !== 'ok') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [definitions, selections] = await Promise.all([
      prisma.additionalFeeDefinition.findMany({
        where: { active: true, createdByUserId: user.userId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      prisma.meterAdditionalFeeSelection.findMany({
        where: { meterId, year, month },
      }),
    ])

    const selByFee = new Map(selections.map((s) => [s.feeDefinitionId, s]))

    return NextResponse.json({
      meterId,
      year,
      month,
      items: definitions
        .map((d) => {
          const chargeBasis = parseChargeBasis(d.chargeBasis)
          if (!chargeBasis) return null
          const s = selByFee.get(d.id)
          return {
            feeDefinitionId: d.id,
            name: d.name,
            chargeBasis,
            unitPrice: Number(d.unitPrice) || 0,
            enabled: s?.enabled === true,
            quantity: Number(s?.quantity) || 0,
          }
        })
        .filter((item) => item != null),
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
    const meterId = typeof body?.meterId === 'string' ? body.meterId.trim() : ''
    const year = Number(body?.year)
    const month = Number(body?.month)
    const items = Array.isArray(body?.selections) ? body.selections : []

    if (!meterId || !Number.isFinite(year) || !Number.isFinite(month)) {
      return NextResponse.json(
        { error: 'meterId, year, month шаардлагатай' },
        { status: 400 }
      )
    }
    if (month < 1 || month > 12) {
      return NextResponse.json({ error: 'Сар буруу байна' }, { status: 400 })
    }

    const meter = await prisma.meter.findUnique({
      where: { id: meterId },
      select: { id: true, organizationId: true },
    })
    if (!meter) return NextResponse.json({ error: 'Тоолуур олдсонгүй' }, { status: 404 })

    const officeOrgId = await ensureOfficeOrganizationId(user)
    const scopeOk = await ensureOrgInOfficeScopeOrClaim({ officeOrgId, organizationId: meter.organizationId })
    if (scopeOk !== 'ok') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const activeDefs = await prisma.additionalFeeDefinition.findMany({
      where: { active: true, createdByUserId: user.userId },
      select: { id: true },
    })
    const validIds = new Set(activeDefs.map((d) => d.id))

    await prisma.$transaction(async (tx) => {
      await tx.meterAdditionalFeeSelection.deleteMany({
        where: { meterId, year, month },
      })

      for (const item of items) {
        const feeDefinitionId =
          typeof item?.feeDefinitionId === 'string' ? item.feeDefinitionId.trim() : ''
        if (!feeDefinitionId || !validIds.has(feeDefinitionId)) continue
        if (!item?.enabled) continue
        const quantity = Math.max(0, Number(item?.quantity) || 0)
        await tx.meterAdditionalFeeSelection.create({
          data: {
            meterId,
            year: Math.trunc(year),
            month: Math.trunc(month),
            feeDefinitionId,
            enabled: true,
            quantity: Math.round(quantity * 100) / 100,
          },
        })
      }
    })

    await recalculateAndPersistOrgPeriodAdditionalFees(
      meter.organizationId,
      Math.trunc(year),
      Math.trunc(month)
    )

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Алдаа гарлаа'
    if (msg === 'Unauthorized' || msg === 'Forbidden') {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
