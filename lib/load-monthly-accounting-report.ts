import { attachOrgsAndMetersToReadings } from '@/lib/attach-reading-relations'
import {
  loadAdditionalFeeDefinitionsByIds,
  loadAdditionalFeeSelectionsForMeterPeriods,
} from '@/lib/additional-fees-db'
import { prisma } from '@/lib/prisma'
import { getScopedOrganizationIds } from '@/lib/org-scope'
import { ensureOfficeOrganizationId } from '@/lib/readings-office-org'
import type { TokenPayload } from '@/lib/auth'
import {
  buildMonthlyAccountingReportByMeter,
  type MeterReportRow,
  type MonthlyAccountingReportSourceRow,
} from '@/lib/monthly-accounting-report-excel'

export async function loadMonthlyAccountingMeterRows(
  user: TokenPayload,
  year: number,
  month: number
): Promise<MeterReportRow[]> {
  const officeOrgId = await ensureOfficeOrganizationId(user)
  const scoped = await getScopedOrganizationIds({
    ...user,
    organizationId: officeOrgId ?? user.organizationId,
  })
  if (scoped.length === 0) return []

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

  const sourceRows: MonthlyAccountingReportSourceRow[] = readings.map((r) => ({
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

  return buildMonthlyAccountingReportByMeter(sourceRows, definitions, selectionsByMeter)
}
