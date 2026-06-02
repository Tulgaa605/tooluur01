import { prisma } from '@/lib/prisma'
import type { AdditionalFeeDefinitionRow, AdditionalFeeSelectionRow } from '@/lib/additional-fees-calc'
import { parseChargeBasis } from '@/lib/additional-fees-calc'

export async function loadActiveAdditionalFeeDefinitions(
  createdByUserId?: string
): Promise<AdditionalFeeDefinitionRow[]> {
  const rows = await prisma.additionalFeeDefinition.findMany({
    where: {
      active: true,
      ...(createdByUserId ? { createdByUserId } : {}),
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
  return rows.flatMap((r) => {
    const chargeBasis = parseChargeBasis(r.chargeBasis)
    if (!chargeBasis) return []
    const row: AdditionalFeeDefinitionRow = {
      id: r.id,
      name: r.name,
      chargeBasis,
      unitPrice: Number(r.unitPrice) || 0,
      active: r.active,
      sortOrder: r.sortOrder,
    }
    return [row]
  })
}

export async function loadAdditionalFeeDefinitionsByIds(
  ids: string[]
): Promise<AdditionalFeeDefinitionRow[]> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return []
  const rows = await prisma.additionalFeeDefinition.findMany({
    where: { id: { in: unique }, active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
  return rows.flatMap((r) => {
    const chargeBasis = parseChargeBasis(r.chargeBasis)
    if (!chargeBasis) return []
    const row: AdditionalFeeDefinitionRow = {
      id: r.id,
      name: r.name,
      chargeBasis,
      unitPrice: Number(r.unitPrice) || 0,
      active: r.active,
      sortOrder: r.sortOrder,
    }
    return [row]
  })
}

export async function loadAllAdditionalFeeDefinitions(): Promise<AdditionalFeeDefinitionRow[]> {
  const rows = await prisma.additionalFeeDefinition.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
  return rows.flatMap((r) => {
    const chargeBasis = parseChargeBasis(r.chargeBasis)
    if (!chargeBasis) return []
    const row: AdditionalFeeDefinitionRow = {
      id: r.id,
      name: r.name,
      chargeBasis,
      unitPrice: Number(r.unitPrice) || 0,
      active: r.active,
      sortOrder: r.sortOrder,
    }
    return [row]
  })
}

export async function loadAdditionalFeeSelectionsForPeriods(
  orgPeriods: Array<{ organizationId: string; year: number; month: number }>
): Promise<Map<string, AdditionalFeeSelectionRow[]>> {
  // Backward compat wrapper: organizationId -> all meters of org is now required.
  // Keep signature for callers that haven't been migrated yet.
  const map = new Map<string, AdditionalFeeSelectionRow[]>()
  if (orgPeriods.length === 0) return map
  const orgIds = [...new Set(orgPeriods.map((p) => p.organizationId))]
  const meters = await prisma.meter.findMany({
    where: { organizationId: { in: orgIds } },
    select: { id: true, organizationId: true },
  })
  const meterPeriods = orgPeriods.flatMap((p) =>
    meters
      .filter((m) => m.organizationId === p.organizationId)
      .map((m) => ({ meterId: m.id, year: p.year, month: p.month }))
  )
  const byMeter = await loadAdditionalFeeSelectionsForMeterPeriods(meterPeriods)
  for (const p of orgPeriods) {
    const list: AdditionalFeeSelectionRow[] = []
    for (const m of meters.filter((mm) => mm.organizationId === p.organizationId)) {
      const k = `${m.id}|${p.year}|${p.month}`
      const sels = byMeter.get(k) ?? []
      list.push(...sels)
    }
    map.set(`${p.organizationId}|${p.year}|${p.month}`, list)
  }
  return map
}

export async function loadAdditionalFeeSelectionsForMeterPeriods(
  meterPeriods: Array<{ meterId: string; year: number; month: number }>
): Promise<Map<string, AdditionalFeeSelectionRow[]>> {
  const map = new Map<string, AdditionalFeeSelectionRow[]>()
  if (meterPeriods.length === 0) return map

  const meterIds = [...new Set(meterPeriods.map((p) => p.meterId))]
  const years = [...new Set(meterPeriods.map((p) => p.year))]
  const months = [...new Set(meterPeriods.map((p) => p.month))]

  const rows = await prisma.meterAdditionalFeeSelection.findMany({
    where: {
      meterId: { in: meterIds },
      year: { in: years },
      month: { in: months },
      enabled: true,
    },
    select: {
      meterId: true,
      year: true,
      month: true,
      feeDefinitionId: true,
      enabled: true,
      quantity: true,
    },
  })

  for (const r of rows) {
    const k = `${r.meterId}|${r.year}|${r.month}`
    const list = map.get(k) ?? []
    list.push({
      feeDefinitionId: r.feeDefinitionId,
      enabled: r.enabled,
      quantity: Number(r.quantity) || 0,
    })
    map.set(k, list)
  }
  return map
}
