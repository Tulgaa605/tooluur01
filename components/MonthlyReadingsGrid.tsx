'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { ColDef, ModuleRegistry, AllCommunityModule, ICellRendererParams } from 'ag-grid-community'
import {
  ArrowDownTrayIcon,
  PaperAirplaneIcon,
} from '@heroicons/react/24/outline'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { fetchWithAuth } from '@/lib/api'
import { normalizeBillingMode } from '@/lib/meter-reading-calc-core'
import { AG_GRID_LOCALE_MN } from '@/lib/ag-grid-locale-mn'

ModuleRegistry.registerModules([AllCommunityModule])

const WATER_GRID_FIELDS = new Set(['baseDirty', 'baseClean', 'dirtyAmount', 'cleanAmount'])
const HEAT_GRID_FIELDS = new Set(['heatReading', 'heatAmount'])

function formatMoney(value: unknown): string {
  const n = Number(value ?? 0)
  const safe = Number.isFinite(n) ? n : 0
  return safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export interface MonthlyReadingRow {
  id?: string
  month: number
  year: number
  startValue: number
  endValue: number
  usage: number
  heatUsage?: number
  baseClean: number
  baseDirty: number
  cleanPerM3?: number
  dirtyPerM3?: number
  heatBase?: number
  heatPerM3?: number
  heatPerM2?: number
  cleanAmount: number
  dirtyAmount: number
  heatAmount?: number
  subtotal: number
  vat: number
  total: number
  meterId?: string
  billingMode?: string
  meter?: {
    id?: string
    meterNumber: string
    billingMode?: string | null
    waterChargeSplit?: string | null
    pipeDiameterMm?: number | null
    billingCategory?: string | null
  }
  organizationId?: string
  organization?: {
    name: string
    id: string
    code: string | null
    category?: string
  }
  usageWaterDiffSum?: number
  heatReadingSum?: number
  /** Төлбөрийн хуудас */
  paidAmount?: number | null
  paymentReference?: string | null
  /** Өмнөх саруудын үлдэгдэл (carry-forward) — сервер тооцоолж буцаана */
  previousRemaining?: number | null
  /** SMS амжилттай илгээгдсэн → заалт түгжигдэнэ */
  smsSentAt?: string | Date | null
  ebarimtStatus?: string | null
  ebarimtBillId?: string | null
  ebarimtLastError?: string | null
  /** Pinned «Нийт дүн» */
  paidSum?: number
  remainingSum?: number
  /** Нэгтгэсэн төлбөрийн мөр (хувь хүн, олон тоолуур) */
  aggregatedReadingIds?: string[]
}

const PAY_EPS = 0.009

function roundMoneyLocal(n: number): number {
  return Math.round(n * 100) / 100
}

function effectivePaidAmount(row: MonthlyReadingRow | undefined): number {
  return roundMoneyLocal(Number(row?.paidAmount ?? 0) || 0)
}

function rowTotalAmount(row: MonthlyReadingRow | undefined, getTotal: (r: MonthlyReadingRow | undefined) => number): number {
  if (!row) return 0
  if (row.organization?.name === 'Нийт дүн') return Number(row.total ?? 0) || 0
  return getTotal(row)
}

function previousRemainingForRow(row: MonthlyReadingRow | undefined): number {
  if (!row) return 0
  if (row.organization?.name === 'Нийт дүн') {
    return Number((row as { prevRemainingSum?: number }).prevRemainingSum ?? 0) || 0
  }
  return roundMoneyLocal(Number(row.previousRemaining ?? 0) || 0)
}

function remainingForRow(row: MonthlyReadingRow | undefined, getTotal: (r: MonthlyReadingRow | undefined) => number): number {
  // Carry-forward: өмнөх саруудын үлдэгдэл + тухайн сарын төлбөр − төлөгдсөн дүн
  const t = rowTotalAmount(row, getTotal)
  const prev = previousRemainingForRow(row)
  return Math.max(0, roundMoneyLocal(prev + t - effectivePaidAmount(row)))
}

function isPaidInFullRow(row: MonthlyReadingRow | undefined, getTotal: (r: MonthlyReadingRow | undefined) => number): boolean {
  return remainingForRow(row, getTotal) <= PAY_EPS
}

function paymentStatusLabel(row: MonthlyReadingRow | undefined, getTotal: (r: MonthlyReadingRow | undefined) => number): string {
  if (!row || row.organization?.name === 'Нийт дүн') return ''
  if (isPaidInFullRow(row, getTotal)) return 'Бүрэн төлөгдсөн'
  if (effectivePaidAmount(row) > PAY_EPS) return 'Хэсэгчлэн төлөгдсөн'
  return 'Хүлээгдэж буй'
}

function collectCustomerPhones(org: MonthlyReadingRow['organization']): string {
  const set = new Set<string>()
  const p = (org as { phone?: string | null })?.phone?.trim()
  if (p) set.add(p)
  const users = (org as { users?: { phone: string | null }[] })?.users
  users?.forEach((u) => {
    const up = u?.phone?.trim()
    if (up) set.add(up)
  })
  return Array.from(set).join(', ') || '—'
}

export type BillingGridActions = {
  onDownload: (row: MonthlyReadingRow) => void
  onSendSms: (row: MonthlyReadingRow) => void
  onIssueEbarimt: (row: MonthlyReadingRow) => void
  /** Inline төлбөр засах */
  onPaidAmountChange?: (row: MonthlyReadingRow, newPaid: number) => Promise<void> | void
  /** 4-р сард жилийн нээлтийн үлдэгдэлийг засах */
  onOpeningBalanceChange?: (row: MonthlyReadingRow, newAmount: number) => Promise<void> | void
  sendingId?: string | null
  issuingEbarimtId?: string | null
}

interface Organization {
  id: string
  name: string
  category?: string
}

interface Meter {
  id: string
  meterNumber: string
  organizationId: string
  billingMode?: string | null
  waterChargeSplit?: string | null
  billingCategory?: string | null
}

function readingRowUsesWater(r: MonthlyReadingRow): boolean {
  const m = normalizeBillingMode(r.billingMode ?? r.meter?.billingMode)
  return m === 'WATER' || m === 'WATER_HEAT'
}

function readingRowUsesHeat(r: MonthlyReadingRow): boolean {
  const m = normalizeBillingMode(r.billingMode ?? r.meter?.billingMode)
  return m === 'HEAT' || m === 'WATER_HEAT'
}

function filterReadingGridColumnsByBilling(
  cols: ColDef<MonthlyReadingRow>[],
  needsWater: boolean,
  needsHeat: boolean
): ColDef<MonthlyReadingRow>[] {
  return cols.filter((c) => {
    const key = (c.colId ?? c.field) as string | undefined
    if (!key) return true
    if (!needsWater && WATER_GRID_FIELDS.has(key)) return false
    if (!needsHeat && HEAT_GRID_FIELDS.has(key)) return false
    return true
  })
}

/** `/api/readings` хариуг заалтын grid-д тохируулна */
export function normalizeApiReadings(data: unknown[]): MonthlyReadingRow[] {
  const toNum = (v: unknown): number => {
    if (v == null || v === '') return 0
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0
    if (typeof v === 'object' && v && '$numberDecimal' in v) {
      const s = String((v as { $numberDecimal?: string }).$numberDecimal ?? '').trim()
      const n = parseFloat(s.replace(',', '.'))
      return Number.isFinite(n) ? n : 0
    }
    const n = parseFloat(String(v).replace(',', '.').trim())
    return Number.isFinite(n) ? n : 0
  }

  return data.map((raw) => {
    const r = raw as Record<string, unknown>
    const startVal = r.startValue ?? r.start_value
    const endVal = r.endValue ?? r.end_value
    const heatUsageVal = r.heatUsage ?? r.heat_usage
    return {
      ...r,
      startValue: toNum(startVal),
      endValue: toNum(endVal),
      usage: toNum(r.usage),
      heatUsage: toNum(heatUsageVal),
      baseClean: toNum(r.baseClean ?? r.base_clean),
      baseDirty: toNum(r.baseDirty ?? r.base_dirty),
      cleanPerM3: toNum(r.cleanPerM3 ?? r.clean_per_m3),
      dirtyPerM3: toNum(r.dirtyPerM3 ?? r.dirty_per_m3),
      cleanAmount: toNum(r.cleanAmount ?? r.clean_amount),
      dirtyAmount: toNum(r.dirtyAmount ?? r.dirty_amount),
      heatBase: toNum(r.heatBase ?? r.heat_base),
      heatPerM3: toNum(r.heatPerM3 ?? r.heat_per_m3),
      heatPerM2: toNum(r.heatPerM2 ?? r.heat_per_m2),
      heatAmount: toNum(r.heatAmount ?? r.heat_amount),
      subtotal: toNum(r.subtotal),
      vat: toNum(r.vat),
      total: toNum(r.total),
    } as MonthlyReadingRow
  })
}

export type MonthlyReadingsGridProps = {
  rowData: MonthlyReadingRow[]
  loading?: boolean
  /** Төлбөрийн хуудас: recalculate=1-ээр ирсэн дүнг шууд харуулна */
  showCalculated?: boolean
  height?: string
  emptyMessage?: string
  /** `billing` — төлбөрийн нэмэлт багана + үйлдэл */
  variant?: 'readings' | 'billing'
  billingActions?: BillingGridActions
  /** Баруун товч — Excel цэс (төлбөрийн хуудас) */
  onGridContextMenu?: (coords: { x: number; y: number }) => void
}

export default function MonthlyReadingsGrid({
  rowData,
  loading = false,
  showCalculated = true,
  height = 'min(75vh, calc(100vh - 11rem))',
  emptyMessage = 'Заалтын мэдээлэл олдсонгүй',
  variant = 'readings',
  billingActions,
  onGridContextMenu,
}: MonthlyReadingsGridProps) {
  const gridRef = useRef<AgGridReact>(null)
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [allMeters, setAllMeters] = useState<Meter[]>([])

  const numberColStyle = useMemo(
    () => ({
      cellClass: 'ag-right-aligned-cell',
      headerClass: 'ag-right-aligned-header',
    }),
    []
  )

  useEffect(() => {
    fetchWithAuth('/api/organizations?customersOnly=1')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) =>
        setOrganizations(Array.isArray(data) ? (data as Organization[]) : [])
      )
      .catch(() => setOrganizations([]))
  }, [])

  useEffect(() => {
    fetchWithAuth('/api/meters')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setAllMeters(Array.isArray(data) ? (data as Meter[]) : []))
      .catch(() => setAllMeters([]))
  }, [])

  const heatQtyForDisplay = useCallback((r: MonthlyReadingRow | undefined): number | null => {
    if (!r || !readingRowUsesHeat(r)) return null
    const bm = normalizeBillingMode(r.billingMode ?? r.meter?.billingMode)
    if (bm === 'HEAT' || bm === 'WATER_HEAT') return Number(r.heatUsage ?? r.usage ?? 0) || 0
    return 0
  }, [])

  /**
   * Дулааны дүнг сервер талын тухайн (он, сар)-ийн тарифт тулгуурлан тооцсон утгыг шууд харуулна
   * ингэснээр Сарын заалт ба Төлбөрийн хуудас зөрүүтэй болохгүй.
   *
   * Өмнөх client-side fallback (latestOrgTariffByOrgId зэргийг ашиглах) нь сүүлийн сарын тарифыг
   * хуучин заалтанд хэрэглэснээс зөрүү гарч байсан.
   */
  const getTariffHeatDisplayAmount = useCallback(
    (r: MonthlyReadingRow | undefined): number => {
      if (!r || !readingRowUsesHeat(r)) return 0
      return Number(r.heatAmount ?? 0) || 0
    },
    []
  )

  /**
   * Subtotal / VAT / Total: сервер талаас (recalculate=1) ирсэн утгыг шууд харуулна.
   * Билл хуудастай ижил тарифын логик ашиглахаар цуцаагүй (зөрүүгүй болгох).
   */
  const getDisplaySubtotalVatTotal = useCallback(
    (r: MonthlyReadingRow | undefined): { subtotal: number; vat: number; total: number } => {
      if (!r) return { subtotal: 0, vat: 0, total: 0 }
      return {
        subtotal: Number(r.subtotal ?? 0) || 0,
        vat: Number(r.vat ?? 0) || 0,
        total: Number(r.total ?? 0) || 0,
      }
    },
    []
  )

  const allReadingColumnDefs: ColDef<MonthlyReadingRow>[] = useMemo(
    () => [
      {
        headerName: 'РД',
        width: 100,
        editable: false,
        valueGetter: (params) => {
          if (params.data?.organization?.code) return params.data.organization.code
          if (params.data?.organization?.id) return params.data.organization.id.slice(-7)
          if (params.data?.id) return params.data.id.slice(-7)
          return '-'
        },
      },
      {
        headerName: 'Т/дугаар',
        width: 150,
        editable: false,
        valueGetter: (params) => {
          if (params.data?.meter?.meterNumber) return params.data.meter.meterNumber
          if (params.data?.meterId) {
            const meter = allMeters.find((m) => m.id === params.data?.meterId)
            return meter?.meterNumber || '-'
          }
          return '-'
        },
      },
      {
        headerName: 'Хэрэглэгчийн нэр',
        width: 180,
        minWidth: 140,
        editable: false,
        valueGetter: (params) => params.data?.organization?.name || '-',
      },
      {
        headerName: 'Огноо',
        width: 140,
        editable: false,
        valueGetter: (params) => {
          const year = params.data?.year
          const month = params.data?.month
          if (!year || !month) return '-'
          return `${year}-${String(month).padStart(2, '0')}`
        },
      },
      {
        headerName: 'Эхний заалт',
        width: 130,
        colId: 'startValue',
        field: 'startValue',
        ...numberColStyle,
        editable: false,
        valueFormatter: (params) => {
          const v = params.data?.startValue
          if (v == null) return '0.00'
          return Number(v).toFixed(2)
        },
      },
      {
        headerName: 'Эцсийн заалт',
        width: 130,
        colId: 'endValue',
        field: 'endValue',
        ...numberColStyle,
        editable: false,
        valueFormatter: (params) => {
          const v = params.data?.endValue
          if (v == null) return '0.00'
          return Number(v).toFixed(2)
        },
      },
      {
        headerName: 'Зөрүү',
        width: 100,
        colId: 'waterDiff',
        ...numberColStyle,
        editable: false,
        valueGetter: (params) => {
          const d = params.data
          if (d?.organization?.name === 'Нийт дүн') return Number(d.usageWaterDiffSum ?? 0)
          const start = d?.startValue || 0
          const end = d?.endValue || 0
          return end > start ? end - start : 0
        },
        valueFormatter: (params) => {
          if (params.value == null) return '0.00'
          return formatMoney(params.value)
        },
      },
      {
        headerName: 'Б/Суурь хураамж',
        width: 150,
        field: 'baseDirty',
        ...numberColStyle,
        editable: false,
        valueFormatter: (params) => formatMoney(params.value ?? 0),
      },
      {
        headerName: 'Ц/Суурь хураамж',
        width: 150,
        field: 'baseClean',
        ...numberColStyle,
        editable: false,
        valueFormatter: (params) => formatMoney(params.value ?? 0),
      },
      {
        headerName: 'Бохир',
        width: 120,
        field: 'dirtyAmount',
        ...numberColStyle,
        editable: false,
        valueFormatter: (params) => formatMoney(params.value ?? 0),
      },
      {
        headerName: 'Цэвэр',
        width: 120,
        field: 'cleanAmount',
        ...numberColStyle,
        editable: false,
        valueFormatter: (params) => formatMoney(params.value ?? 0),
      },
      {
        headerName: 'м³/м²',
        width: 100,
        colId: 'heatReading',
        field: 'heatUsage',
        ...numberColStyle,
        editable: false,
        valueGetter: (params) => {
          const d = params.data
          if (!d) return null
          if (d.organization?.name === 'Нийт дүн') return Number(d.heatReadingSum ?? 0)
          return heatQtyForDisplay(d)
        },
        valueFormatter: (params) => {
          const d = params.data
          if (!d || !readingRowUsesHeat(d)) return ''
          if (params.value == null || params.value === '') return '0.00'
          return Number(params.value).toFixed(2)
        },
      },
      {
        headerName: 'Дулаан',
        width: 120,
        field: 'heatAmount',
        ...numberColStyle,
        editable: false,
        valueGetter: (params) => {
          const d = params.data
          if (!d) return 0
          if (d.organization?.name === 'Нийт дүн') return Number(d.heatAmount ?? 0) || 0
          return getTariffHeatDisplayAmount(d)
        },
        valueFormatter: (params) => formatMoney(params.value ?? 0),
      },
      {
        headerName: 'Нийт',
        width: 120,
        field: 'subtotal',
        ...numberColStyle,
        editable: false,
        valueGetter: (params) => getDisplaySubtotalVatTotal(params.data).subtotal,
        valueFormatter: (params) => formatMoney(params.value ?? 0),
      },
      {
        headerName: 'НӨАТ',
        width: 120,
        field: 'vat',
        ...numberColStyle,
        editable: false,
        valueGetter: (params) => getDisplaySubtotalVatTotal(params.data).vat,
        valueFormatter: (params) => formatMoney(params.value ?? 0),
      },
      {
        headerName: 'Нийт',
        width: 120,
        field: 'total',
        ...numberColStyle,
        editable: false,
        valueGetter: (params) => getDisplaySubtotalVatTotal(params.data).total,
        valueFormatter: (params) => {
          if (params.value == null) return '0.00'
          return Number(params.value).toFixed(2)
        },
      },
    ],
    [allMeters, numberColStyle, getTariffHeatDisplayAmount, getDisplaySubtotalVatTotal, heatQtyForDisplay]
  )

  const gridNeedsWater = useMemo(
    () => rowData.length === 0 || rowData.some(readingRowUsesWater),
    [rowData]
  )
  const gridNeedsHeat = useMemo(
    () => rowData.length === 0 || rowData.some(readingRowUsesHeat),
    [rowData]
  )

  const getRowTotal = useCallback(
    (r: MonthlyReadingRow | undefined) => getDisplaySubtotalVatTotal(r).total,
    [getDisplaySubtotalVatTotal]
  )

  const billingOnlyColumnDefs: ColDef<MonthlyReadingRow>[] = useMemo(() => {
    const centerStyle = { cellClass: 'ag-center-aligned-cell', headerClass: 'ag-center-aligned-header' }
    return [
      {
        headerName: 'Он',
        width: 80,
        colId: 'year',
        ...centerStyle,
        editable: false,
        valueGetter: (params) =>
          params.data?.organization?.name === 'Нийт дүн' ? 'Нийт дүн' : params.data?.year ?? '',
      },
      {
        headerName: 'Сар',
        width: 70,
        colId: 'month',
        ...centerStyle,
        editable: false,
        valueGetter: (params) => {
          if (params.data?.organization?.name === 'Нийт дүн') return ''
          const m = params.data?.month
          return m != null ? String(m).padStart(2, '0') : ''
        },
      },
      {
        headerName: 'Байгууллага',
        width: 180,
        minWidth: 140,
        editable: false,
        valueGetter: (params) => {
          if (params.data?.organization?.name === 'Нийт дүн') return ''
          return params.data?.organization?.name || '-'
        },
      },
      {
        headerName: 'Тоолуур',
        width: 120,
        ...centerStyle,
        editable: false,
        valueGetter: (params) => {
          if (params.data?.organization?.name === 'Нийт дүн') return ''
          if (params.data?.meter?.meterNumber) return params.data.meter.meterNumber
          if (params.data?.meterId) {
            const meter = allMeters.find((m) => m.id === params.data?.meterId)
            return meter?.meterNumber || '-'
          }
          return '-'
        },
      },
      {
        headerName: 'Харилцагчийн утас',
        width: 160,
        colId: 'customerPhones',
        editable: false,
        valueGetter: (params) => {
          if (params.data?.organization?.name === 'Нийт дүн') return ''
          return collectCustomerPhones(params.data?.organization)
        },
        wrapText: true,
        autoHeight: true,
      },
      {
        headerName: 'Хэрэглээ (м³)',
        width: 110,
        colId: 'usage',
        ...numberColStyle,
        editable: false,
        valueGetter: (params) => {
          if (params.data?.organization?.name === 'Нийт дүн') {
            return rowData.reduce((acc, r) => acc + (Number(r.usage ?? 0) || 0), 0)
          }
          return Number(params.data?.usage ?? 0) || 0
        },
        valueFormatter: (params) => {
          if (params.value == null) return '0.00'
          return Number(params.value).toFixed(2)
        },
      },
      {
        headerName: 'Төлбөр (₮)',
        width: 120,
        colId: 'billTotal',
        ...numberColStyle,
        editable: false,
        valueGetter: (params) => {
          if (params.data?.organization?.name === 'Нийт дүн') {
            return rowData.reduce((acc, r) => acc + getRowTotal(r), 0)
          }
          return getRowTotal(params.data)
        },
        valueFormatter: (params) => formatMoney(params.value ?? 0),
      },
      {
        headerName: 'Өмнөх үлдэгдэл (₮)',
        width: 140,
        colId: 'previousRemaining',
        ...numberColStyle,
        // Зөвхөн 4-р сарын мөр + billing variant + handler байгаа үед засаж болно.
        editable: (params) =>
          Boolean(billingActions?.onOpeningBalanceChange) &&
          params.data?.organization?.name !== 'Нийт дүн' &&
          Number(params.data?.month) === 4,
        valueGetter: (params) => {
          if (params.data?.organization?.name === 'Нийт дүн') {
            return rowData.reduce((acc, r) => acc + previousRemainingForRow(r), 0)
          }
          return previousRemainingForRow(params.data)
        },
        valueParser: (params) => {
          const raw = params.newValue
          if (raw == null || raw === '') return 0
          const n =
            typeof raw === 'number'
              ? raw
              : parseFloat(String(raw).replace(/,/g, '').replace(/₮/g, '').trim())
          return Number.isNaN(n) || n < 0 ? 0 : Math.round(n * 100) / 100
        },
        valueSetter: (params) => {
          if (!params.data) return false
          const n = Number(params.newValue ?? 0)
          ;(params.data as MonthlyReadingRow).previousRemaining = Number.isFinite(n) ? n : 0
          return true
        },
        valueFormatter: (params) => formatMoney(params.value ?? 0),
        cellStyle: (params) => {
          const base = { textAlign: 'right' as const }
          if (
            billingActions?.onOpeningBalanceChange &&
            params.data?.organization?.name !== 'Нийт дүн' &&
            Number(params.data?.month) === 4
          ) {
            return { ...base, backgroundColor: '#fff7ed' }
          }
          return base
        },
      },
      {
        headerName: 'Төлөгдсөн (₮)',
        width: 120,
        colId: 'paidAmount',
        ...numberColStyle,
        // Тайлбар: SMS илгээгдсэн ч төлбөрийн дүнг хүссэн үедээ засах боломжтой.
        // Phantom мөр (заалтгүй ч өмнөх үлдэгдэлтэй харилцагч) — засах боломжгүй.
        editable: (params) =>
          Boolean(billingActions?.onPaidAmountChange) &&
          params.data?.organization?.name !== 'Нийт дүн' &&
          !String(params.data?.id ?? '').startsWith('phantom-'),
        valueGetter: (params) => {
          if (params.data?.organization?.name === 'Нийт дүн') return Number(params.data?.paidSum ?? 0)
          return effectivePaidAmount(params.data)
        },
        valueParser: (params) => {
          const raw = params.newValue
          if (raw == null || raw === '') return 0
          const n =
            typeof raw === 'number'
              ? raw
              : parseFloat(String(raw).replace(/,/g, '').replace(/₮/g, '').trim())
          return Number.isNaN(n) || n < 0 ? 0 : Math.round(n * 100) / 100
        },
        valueSetter: (params) => {
          if (!params.data) return false
          const n = Number(params.newValue ?? 0)
          params.data.paidAmount = Number.isFinite(n) ? n : 0
          return true
        },
        valueFormatter: (params) => formatMoney(params.value ?? 0),
      },
      {
        headerName: 'Үлдэгдэл (₮)',
        width: 120,
        colId: 'remaining',
        ...numberColStyle,
        editable: false,
        valueGetter: (params) => {
          if (params.data?.organization?.name === 'Нийт дүн') return Number(params.data?.remainingSum ?? 0)
          return remainingForRow(params.data, getRowTotal)
        },
        valueFormatter: (params) => formatMoney(params.value ?? 0),
      },
      {
        headerName: 'Төлөв',
        width: 140,
        colId: 'paymentStatus',
        ...centerStyle,
        editable: false,
        valueGetter: (params) => paymentStatusLabel(params.data, getRowTotal),
        cellRenderer: (params: ICellRendererParams<MonthlyReadingRow>) => {
          const label = paymentStatusLabel(params.data, getRowTotal)
          if (!label) return null
          const paid = effectivePaidAmount(params.data)
          const full = isPaidInFullRow(params.data, getRowTotal)
          const cls = full
            ? 'border-gray-200 bg-gray-50 text-gray-800'
            : paid > PAY_EPS
              ? 'border-gray-200 bg-gray-50 text-gray-700'
              : 'border-gray-200 bg-white text-gray-600'
          return (
            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full border ${cls}`}>
              {label}
            </span>
          )
        },
      },
      {
        headerName: 'E-barimt',
        width: 130,
        colId: 'ebarimtStatus',
        ...centerStyle,
        editable: false,
        cellRenderer: (params: ICellRendererParams<MonthlyReadingRow>) => {
          if (params.data?.organization?.name === 'Нийт дүн') return null
          const st = params.data?.ebarimtStatus ?? 'PENDING'
          const cls =
            st === 'SENT'
              ? 'bg-blue-100 text-blue-800'
              : st === 'FAILED'
                ? 'bg-red-100 text-red-800'
                : st === 'PARTIAL'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-gray-100 text-gray-700'
          const label =
            st === 'SENT'
              ? params.data?.ebarimtBillId
                ? `SENT (${params.data.ebarimtBillId})`
                : 'SENT'
              : st === 'FAILED'
                ? 'FAILED'
                : st === 'PARTIAL'
                  ? 'Хэсэгчлэн'
                  : 'PENDING'
          return (
            <span
              className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${cls}`}
              title={params.data?.ebarimtLastError || undefined}
            >
              {label}
            </span>
          )
        },
      },
      {
        headerName: 'Үйлдэл',
        width: 110,
        colId: 'billingActions',
        pinned: 'right',
        sortable: false,
        filter: false,
        editable: false,
        cellRenderer: (params: ICellRendererParams<MonthlyReadingRow>) => {
          if (!params.data || params.data.organization?.name === 'Нийт дүн' || !billingActions) return null
          const row = params.data
          const id = row.id ?? ''
          const isPhantom = String(id).startsWith('phantom-')
          return (
            <div className="flex items-center justify-center gap-1 h-full">
              <button
                type="button"
                onClick={() => billingActions.onDownload(row)}
                className="text-primary-600 hover:text-primary-900 p-1 rounded hover:bg-primary-50"
                title="Татах"
              >
                <ArrowDownTrayIcon className="h-5 w-5" />
              </button>
              {!isPhantom && (
                <button
                  type="button"
                  onClick={() => billingActions.onIssueEbarimt(row)}
                  disabled={billingActions.issuingEbarimtId === id}
                  className="text-indigo-600 hover:text-indigo-900 p-1 rounded hover:bg-indigo-50 disabled:opacity-50"
                  title="E-barimt илгээх"
                >
                  <span className="text-xs font-semibold">EB</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => billingActions.onSendSms(row)}
                disabled={billingActions.sendingId === id}
                className="text-green-600 hover:text-green-900 p-1 rounded hover:bg-green-50 disabled:opacity-50"
                title="SMS илгээх"
              >
                <PaperAirplaneIcon className="h-5 w-5" />
              </button>
            </div>
          )
        },
      },
    ]
  }, [allMeters, numberColStyle, getRowTotal, billingActions, rowData])

  const columnDefs = useMemo(() => {
    if (variant === 'billing') return billingOnlyColumnDefs
    return filterReadingGridColumnsByBilling(allReadingColumnDefs, gridNeedsWater, gridNeedsHeat)
  }, [variant, billingOnlyColumnDefs, allReadingColumnDefs, gridNeedsWater, gridNeedsHeat])

  const pinnedBottomRowData = useMemo(() => {
    if (variant === 'billing') {
      const usageSum = rowData.reduce((acc, r) => acc + (Number(r.usage ?? 0) || 0), 0)
      const totalSum = rowData.reduce((acc, r) => acc + getRowTotal(r), 0)
      const paidSum = rowData.reduce((acc, r) => acc + effectivePaidAmount(r), 0)
      const prevRemainingSum = rowData.reduce((acc, r) => acc + previousRemainingForRow(r), 0)
      const remainingSum = rowData.reduce((acc, r) => acc + remainingForRow(r, getRowTotal), 0)
      return [
        {
          organization: { name: 'Нийт дүн', id: '-', code: null },
          usage: usageSum,
          total: totalSum,
          paidSum,
          prevRemainingSum,
          remainingSum,
          month: 0,
          year: 0,
        } as MonthlyReadingRow & { prevRemainingSum: number },
      ]
    }

    const sum = (field: keyof MonthlyReadingRow) =>
      rowData.reduce((acc, row) => acc + (Number(row[field] ?? 0) || 0), 0)
    const usageWaterDiffSum = rowData.reduce((acc, r) => {
      const s = Number(r.startValue ?? 0)
      const e = Number(r.endValue ?? 0)
      return acc + (e > s ? e - s : 0)
    }, 0)
    const heatReadingSum = rowData.reduce((acc, r) => {
      if (!readingRowUsesHeat(r)) return acc
      return acc + (Number(r.heatUsage ?? 0) || 0)
    }, 0)
    const subtotalSum = rowData.reduce((acc, r) => acc + getDisplaySubtotalVatTotal(r).subtotal, 0)
    const vatSum = rowData.reduce((acc, r) => acc + getDisplaySubtotalVatTotal(r).vat, 0)
    const totalSum = rowData.reduce((acc, r) => acc + getDisplaySubtotalVatTotal(r).total, 0)
    return [
      {
        meterId: '',
        organization: { name: 'Нийт дүн', id: '-', code: null },
        startValue: 0,
        endValue: 0,
        usageWaterDiffSum,
        heatReadingSum,
        usage: sum('usage'),
        baseDirty: sum('baseDirty'),
        baseClean: sum('baseClean'),
        dirtyAmount: sum('dirtyAmount'),
        cleanAmount: sum('cleanAmount'),
        heatAmount: rowData.reduce((acc, row) => acc + getTariffHeatDisplayAmount(row), 0),
        subtotal: subtotalSum,
        vat: vatSum,
        total: totalSum,
        month: 0,
        year: 0,
      } as MonthlyReadingRow,
    ]
  }, [rowData, getTariffHeatDisplayAmount, getDisplaySubtotalVatTotal, variant, getRowTotal])

  const overlayNoRows = useMemo(
    () =>
      `<div style="padding:20px;text-align:center"><p style="font-size:16px;margin-bottom:8px">${emptyMessage}</p></div>`,
    [emptyMessage]
  )

  const [pinMenu, setPinMenu] = useState<{
    x: number
    y: number
    colId: string
    pinned: 'left' | 'right' | null
  } | null>(null)
  const pinMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!pinMenu) return
    const onMouseDown = (e: MouseEvent) => {
      const el = pinMenuRef.current
      if (!el) return
      if (e.target instanceof Node && el.contains(e.target)) return
      setPinMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinMenu(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [pinMenu])

  const handleHeaderContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!(e.target instanceof HTMLElement)) return
    const headerCell = e.target.closest('.ag-header-cell') as HTMLElement | null
    if (!headerCell) return
    const colId = headerCell.getAttribute('col-id')
    if (!colId) return
    e.preventDefault()
    e.stopPropagation()
    const api = gridRef.current?.api
    const column = api?.getColumn(colId)
    const pinned = (column?.getPinned() as 'left' | 'right' | null) ?? null
    setPinMenu({ x: e.clientX, y: e.clientY, colId, pinned })
  }, [])

  const applyPin = useCallback((colId: string, pinned: 'left' | 'right' | null) => {
    const api = gridRef.current?.api
    if (!api) return
    api.applyColumnState({
      state: [{ colId, pinned }],
      defaultState: {},
    })
    setPinMenu(null)
  }, [])

  return (
    <div className="bg-white rounded-lg border border-gray-200 w-full">
      <div
        className="ag-theme-alpine"
        style={{ height, width: '100%' }}
        onContextMenu={handleHeaderContextMenu}
      >
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-600 min-h-[12rem]">
            Ачааллаж байна...
          </div>
        ) : (
          <AgGridReact
            theme="legacy"
            reactiveCustomComponents
            ref={gridRef}
            rowData={rowData}
            pinnedBottomRowData={rowData.length > 0 ? pinnedBottomRowData : undefined}
            columnDefs={columnDefs}
            suppressContextMenu={!onGridContextMenu}
            preventDefaultOnContextMenu={Boolean(onGridContextMenu)}
            onCellContextMenu={
              onGridContextMenu
                ? (params) => {
                    const ev = params.event
                    ev?.preventDefault()
                    ev?.stopPropagation()
                    const mouse = ev instanceof MouseEvent ? ev : null
                    onGridContextMenu({
                      x: mouse?.clientX ?? 0,
                      y: mouse?.clientY ?? 0,
                    })
                  }
                : undefined
            }
            getRowId={(params) =>
              params.data?.id ??
              `m-${params.data?.meterId ?? 'x'}-${params.data?.year ?? 0}-${params.data?.month ?? 0}`
            }
            rowBuffer={20}
            defaultColDef={{
              sortable: true,
              filter: true,
              resizable: true,
              lockPinned: false,
            }}
            localeText={AG_GRID_LOCALE_MN}
            pagination
            paginationPageSize={20}
            domLayout="normal"
            singleClickEdit
            stopEditingWhenCellsLoseFocus
            overlayNoRowsTemplate={overlayNoRows}
            onCellValueChanged={(e) => {
              if (e.colDef.colId === 'paidAmount' && billingActions?.onPaidAmountChange && e.data) {
                const newPaid = Number(e.newValue ?? 0)
                if (Number.isFinite(newPaid) && newPaid >= 0) {
                  void billingActions.onPaidAmountChange(e.data, newPaid)
                }
              }
              if (
                e.colDef.colId === 'previousRemaining' &&
                billingActions?.onOpeningBalanceChange &&
                e.data &&
                Number(e.data.month) === 4
              ) {
                const newAmount = Number(e.newValue ?? 0)
                if (Number.isFinite(newAmount) && newAmount >= 0) {
                  void billingActions.onOpeningBalanceChange(e.data, newAmount)
                }
              }
            }}
            getRowStyle={(params) =>
              params.node.rowPinned ? { fontWeight: 700, backgroundColor: '#f9fafb' } : undefined
            }
          />
        )}
      </div>
      {pinMenu && (
        <div
          ref={pinMenuRef}
          style={{
            position: 'fixed',
            top: pinMenu.y,
            left: pinMenu.x,
            zIndex: 99999,
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
            padding: 4,
            minWidth: 180,
          }}
        >
          <div className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-100 mb-1">
            Багана түгжих
          </div>
          <button
            type="button"
            onClick={() => applyPin(pinMenu.colId, 'left')}
            className={`w-full px-3 py-1.5 text-left text-sm rounded-md hover:bg-gray-50 ${
              pinMenu.pinned === 'left' ? 'text-primary-700 font-medium' : 'text-gray-900'
            }`}
          >
            {pinMenu.pinned === 'left' ? '✓ ' : ''}Зүүнд түгжих
          </button>
          <button
            type="button"
            onClick={() => applyPin(pinMenu.colId, 'right')}
            className={`w-full px-3 py-1.5 text-left text-sm rounded-md hover:bg-gray-50 ${
              pinMenu.pinned === 'right' ? 'text-primary-700 font-medium' : 'text-gray-900'
            }`}
          >
            {pinMenu.pinned === 'right' ? '✓ ' : ''}Баруунд түгжих
          </button>
          <button
            type="button"
            onClick={() => applyPin(pinMenu.colId, null)}
            className={`w-full px-3 py-1.5 text-left text-sm rounded-md hover:bg-gray-50 ${
              pinMenu.pinned === null ? 'text-primary-700 font-medium' : 'text-gray-900'
            }`}
          >
            {pinMenu.pinned === null ? '✓ ' : ''}Түгжихгүй
          </button>
        </div>
      )}
    </div>
  )
}
