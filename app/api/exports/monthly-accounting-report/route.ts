import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { attachOrgsAndMetersToReadings } from '@/lib/attach-reading-relations'
import { prisma } from '@/lib/prisma'
import { getScopedOrganizationIds } from '@/lib/org-scope'
import { ensureOfficeOrganizationId } from '@/lib/readings-office-org'
import {
  loadAdditionalFeeDefinitionsByIds,
  loadAdditionalFeeSelectionsForMeterPeriods,
} from '@/lib/additional-fees-db'
import { Role } from '@/lib/role'
import {
  buildMonthlyAccountingReportByMeter,
  monthlyAccountingReportToBuffer,
} from '@/lib/monthly-accounting-report-excel'

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const year = parseInt(searchParams.get('year') ?? '', 10)
    const month = parseInt(searchParams.get('month') ?? '', 10)
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return NextResponse.json(
        { error: 'year, month (1–12) шаардлагатай' },
        { status: 400 }
      )
    }

    const officeOrgId = await ensureOfficeOrganizationId(user)
    const scoped = await getScopedOrganizationIds({
      ...user,
      organizationId: officeOrgId ?? user.organizationId,
    })
    if (scoped.length === 0) {
      return NextResponse.json({ error: 'Хамрах хүрээ хоосон' }, { status: 403 })
    }

    // Grid-тэй ижил: scope + өөрийн нэмсэн заалтууд
    const rawReadings = await prisma.meterReading.findMany({
      where: {
        year,
        month,
        OR: [
          { organizationId: { in: scoped } },
          { createdByUserId: user.userId },
        ],
      },
      orderBy: [{ organization: { name: 'asc' } }, { meter: { meterNumber: 'asc' } }],
    })

    const readings = await attachOrgsAndMetersToReadings(rawReadings)
    const meterPeriods = readings.map((r) => ({
      meterId: r.meterId,
      year: r.year,
      month: r.month,
    }))
    const selectionsByMeter = await loadAdditionalFeeSelectionsForMeterPeriods(meterPeriods)
    const feeIds = new Set<string>()
    for (const sels of selectionsByMeter.values()) {
      for (const s of sels) feeIds.add(s.feeDefinitionId)
    }
    const definitions = await loadAdditionalFeeDefinitionsByIds([...feeIds])

    const sourceRows = readings.map((r) => ({
      organizationId: r.organizationId,
      organizationName: r.organization?.name ?? '',
      meterNumber: r.meter?.meterNumber ?? '',
      startValue: r.startValue,
      endValue: r.endValue,
      usage: r.usage,
      baseClean: r.baseClean,
      baseDirty: r.baseDirty,
      cleanAmount: r.cleanAmount,
      dirtyAmount: r.dirtyAmount,
      heatAmount: r.heatAmount,
      additionalFeesAmount: (r as { additionalFeesAmount?: number }).additionalFeesAmount,
      total: r.total,
      meterId: r.meterId,
      year: r.year,
      month: r.month,
    }))

    const meterRows = buildMonthlyAccountingReportByMeter(
      sourceRows,
      definitions,
      selectionsByMeter
    )
    const buf = await monthlyAccountingReportToBuffer(year, month, meterRows)
    const monthPad = String(month).padStart(2, '0')
    const utf8Filename = `Тайлан-${year}-${monthPad}.xlsx`
    const asciiFilename = `borluulalt-${year}-${monthPad}.xlsx`
    const contentDisposition = `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(utf8Filename)}`

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': contentDisposition,
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Алдаа гарлаа'
    if (msg === 'Unauthorized' || msg === 'Forbidden') {
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
