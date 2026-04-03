'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { fetchWithAuth } from '@/lib/api'
import { AgGridReact } from 'ag-grid-react'
import { ColDef, ModuleRegistry, AllCommunityModule } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { PlusIcon } from '@heroicons/react/24/outline'

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule])

/**
 * AG Grid v31+ reactive cell editor: imperative getValue() энд ашиглагдахгүй.
 * Утгыг onValueChange-аар дамжуулна — үгүй бол засвар дуусахад үргэлж анхны 0 хэвээр үлдэнэ.
 */
function NumberCellEditorSelectAll(props: {
  value: unknown
  onValueChange: (value: unknown) => void
  eventKey: string | null
  stopEditing: (cancel?: boolean) => void
}) {
  const { value, onValueChange, eventKey, stopEditing } = props

  const inputRef = useRef<HTMLInputElement>(null)
  const seededFromKey = useRef(false)

  useEffect(() => {
    if (seededFromKey.current) return
    seededFromKey.current = true
    if (eventKey && /^[0-9.,]$/.test(eventKey)) {
      onValueChange(eventKey === ',' ? '.' : eventKey)
    }
  }, [eventKey, onValueChange])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    const id = requestAnimationFrame(() => el.select())
    return () => cancelAnimationFrame(id)
  }, [])

  const text = value === null || value === undefined ? '' : String(value)

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        let v = e.target.value.replace(',', '.')
        if (v === '') {
          onValueChange(null)
          return
        }
        onValueChange(v)
      }}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          stopEditing()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          stopEditing(true)
        }
      }}
      style={{
        width: '100%',
        height: '100%',
        border: '1px solid #ccc',
        padding: '4px',
        fontSize: '14px',
        boxSizing: 'border-box',
      }}
    />
  )
}

interface Organization {
  id: string
  name: string
  baseCleanFee?: number
  baseDirtyFee?: number
  category?: string
  connectionNumber?: string | null
}

interface PipeFee {
  id: string
  diameterMm: number
  baseCleanFee: number
  baseDirtyFee: number
}

interface OrganizationTariff {
  id: string
  organizationId: string
  year: number
  month: number
  baseCleanFee: number
  baseDirtyFee: number
  cleanPerM3: number
  dirtyPerM3: number
  organization?: {
    id: string
    category?: string
  }
}

interface CategoryTariff {
  id: string
  kind: 'category'
  category: string
  baseCleanFee: number
  baseDirtyFee: number
  cleanPerM3: number
  dirtyPerM3: number
}

interface Meter {
  id: string
  meterNumber: string
  organizationId: string
  organization?: {
    name: string
    code?: string | null
    id?: string
  }
}

interface ReadingForm {
  meterId: string
  month: number
  year: number
  startValue: number
  endValue: number
  baseClean: number
  baseDirty: number
  cleanPerM3: number
  dirtyPerM3: number
}

interface Reading {
  id?: string
  month: number
  year: number
  startValue: number
  endValue: number
  usage: number
  baseClean: number
  baseDirty: number
  cleanPerM3?: number
  dirtyPerM3?: number
  cleanAmount: number
  dirtyAmount: number
  subtotal: number
  vat: number
  total: number
  meterId?: string
  meter?: {
    id?: string
    meterNumber: string
  }
  organizationId?: string
  organization?: {
    name: string
    id: string
    code: string | null
  }
  _isNew?: boolean
}

export default function ReadingsContent() {
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [allMeters, setAllMeters] = useState<Meter[]>([])
  const [tariffs, setTariffs] = useState<OrganizationTariff[]>([])
  const [categoryTariffs, setCategoryTariffs] = useState<CategoryTariff[]>([])
  const [pipeFees, setPipeFees] = useState<PipeFee[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [readings, setReadings] = useState<Reading[]>([])
  const [readingsLoading, setReadingsLoading] = useState(false)
  const [filterMonth, setFilterMonth] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [addModalYear, setAddModalYear] = useState(() => new Date().getFullYear())
  const [addModalMonth, setAddModalMonth] = useState(() => new Date().getMonth() + 1)
  const [newReadings, setNewReadings] = useState<Reading[]>([])
  const gridRef = useRef<AgGridReact>(null)
  const modalGridRef = useRef<AgGridReact>(null)
  const modalOriginalRowsRef = useRef<Map<string, { startValue: number; endValue: number; meterId?: string; baseClean: number; baseDirty: number }>>(new Map())
  const numberColStyle = useMemo(
    () => ({
      cellClass: 'ag-right-aligned-cell',
      headerClass: 'ag-right-aligned-header',
    }),
    []
  )
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear()
    return [currentYear + 1, currentYear, currentYear - 1, currentYear - 2]
  }, [])

  // Modal-ийн дотор зөвхөн сонгосон (Он,Сар)-ын мөрүүдийг л харуулна.
  // Гэхдээ data/тооцоололд бүх period-үүд ашиглагдана (save үед serialize).
  const visibleModalRows = useMemo(() => {
    if (!showAddModal) return []
    return newReadings.filter((r) => r.year === addModalYear && r.month === addModalMonth)
  }, [showAddModal, newReadings, addModalYear, addModalMonth])
  const getRowSnapshotKey = useCallback((r: Reading) => {
    if (r.id) return `id:${r.id}`
    return `new:${r.organizationId ?? 'x'}-${r.meterId ?? 'x'}-${r.year}-${r.month}`
  }, [])
  const snapshotRows = useCallback((rows: Reading[]) => {
    const m = new Map<string, { startValue: number; endValue: number; meterId?: string; baseClean: number; baseDirty: number }>()
    for (const r of rows) {
      m.set(getRowSnapshotKey(r), {
        startValue: Number(r.startValue || 0),
        endValue: Number(r.endValue || 0),
        meterId: r.meterId,
        baseClean: Number(r.baseClean || 0),
        baseDirty: Number(r.baseDirty || 0),
      })
    }
    modalOriginalRowsRef.current = m
  }, [getRowSnapshotKey])

  useEffect(() => {
    fetchWithAuth('/api/organizations?customersOnly=1')
      .then(res => {
        if (!res.ok) {
          return res.json().then(() => [])
        }
        return res.json()
      })
      .then(data => {
        if (data && data.error) {
          setOrganizations([])
        } else if (data && Array.isArray(data)) {
          setOrganizations(data)
        } else {
          setOrganizations([])
        }
      })
      .catch(() => setOrganizations([]))
  }, [])

  useEffect(() => {
    fetchWithAuth('/api/tariffs?includeCategory=1')
      .then(res => {
        if (!res.ok) return res.json().then(() => [])
        return res.json()
      })
      .then(data => {
        if (Array.isArray(data)) {
          const orgTariffs = data.filter((t: any) => !t?.kind) as OrganizationTariff[]
          const catTariffs = data.filter((t: any) => t?.kind === 'category') as CategoryTariff[]
          setTariffs(orgTariffs)
          setCategoryTariffs(catTariffs)
        } else {
          setTariffs([])
          setCategoryTariffs([])
        }
      })
      .catch(() => {
        setTariffs([])
        setCategoryTariffs([])
      })
  }, [])

  useEffect(() => {
    fetchWithAuth('/api/pipe-fees')
      .then(res => (res.ok ? res.json() : []))
      .then(data => (Array.isArray(data) ? setPipeFees(data) : setPipeFees([])))
      .catch(() => setPipeFees([]))
  }, [])

  useEffect(() => {
    // Load all meters for dropdown
    fetchWithAuth('/api/meters')
      .then(res => {
        if (!res.ok) {
          return res.json().then(() => [])
        }
        return res.json()
      })
      .then(data => {
        if (data && data.error) {
          setAllMeters([])
        } else if (data && Array.isArray(data)) {
          setAllMeters(data)
        } else {
          setAllMeters([])
        }
      })
      .catch(() => setAllMeters([]))
  }, [])

  const fetchReadings = useCallback(async (opts?: { silent?: boolean }) => {
    const showLoading = !opts?.silent
    if (showLoading) setReadingsLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterMonth.trim()) params.append('month', filterMonth.trim())
      if (filterYear.trim()) params.append('year', filterYear.trim())

      params.append('limit', '300')
      // Одоогийн тариф + шугамын суурь хураамжаар дүнг харуулна (хуучин хадгалсан snapshot биш)
      params.append('recalculate', '1')
      const res = await fetchWithAuth(`/api/readings?${params.toString()}`)
      let data: any = null
      try {
        data = await res.json()
      } catch {
        data = null
      }

      if (res.ok && Array.isArray(data)) {
        const normalized = data.map((r: any) => {
          const startVal = r.startValue ?? r.start_value
          const endVal = r.endValue ?? r.end_value
          return {
            ...r,
            startValue: startVal != null && startVal !== '' ? Number(startVal) : 0,
            endValue: endVal != null && endVal !== '' ? Number(endVal) : 0,
          }
        })
        setReadings(normalized as Reading[])
      } else if (res.ok) {
        // Амжилттай хариу боловч массив биш (жишээ: {} / null) бол хоосон жагсаалт гэж үзнэ.
        setReadings([])
      } else {
        if (data?.error) {
          console.error('Error fetching readings:', data.error)
        } else {
          console.error('Error fetching readings: request failed', res.status)
        }
        setReadings([])
      }
    } catch (error) {
      console.error('Error fetching readings:', error)
      setReadings([])
    } finally {
      if (showLoading) setReadingsLoading(false)
    }
  }, [filterMonth, filterYear])

  useEffect(() => {
    fetchReadings()
  }, [fetchReadings])

  const handleCellValueChanged = useCallback(async (params: any) => {
    const reading = params.data as Reading
    const changedField = params.colDef?.field as string | undefined

    // Modal дотор засварласан мөр бүр дээр тооцооллыг local байдлаар шинэчилнэ.
    // Сервер рүү автоматаар хадгалахгүй, зөвхөн "Хадгалах" товчоор хадгална.
    if (showAddModal) {
      // Өмнөх сараас эхний заалт татахыг зөвхөн «Эхний заалт» нүд засагдсан үед хийнэ.
      // Эцсийн заалтыг эхэнд оруулаад Enter дарвал async дүүргэлт эхний заалтыг дарж алдаж болно.
      if (
        changedField === 'startValue' &&
        reading.startValue === 0 &&
        reading.meterId &&
        reading.month &&
        reading.year
      ) {
        try {
          const res = await fetchWithAuth(`/api/readings/previous?meterId=${reading.meterId}&month=${reading.month}&year=${reading.year}`)
          if (res.ok) {
            const data = await res.json()
            if (data && !data.error && typeof data.endValue === 'number') {
              reading.startValue = data.endValue
              reading.endValue = data.endValue
              params.api.refreshCells({ rowNodes: [params.node], columns: ['startValue', 'endValue'] })
            }
          }
        } catch (err) {
          // Ignore error
        }
      }

      // Calculate all values
      const usage = (reading.endValue || 0) > (reading.startValue || 0) 
        ? (reading.endValue || 0) - (reading.startValue || 0) 
        : 0
      reading.usage = usage
      
      // Get cleanPerM3 and dirtyPerM3 (default to 0 for now, as per save function)
      const cleanPerM3 = reading.cleanPerM3 || 0
      const dirtyPerM3 = reading.dirtyPerM3 || 0
      const baseClean = reading.baseClean || 0
      const baseDirty = reading.baseDirty || 0
      
      // Calculate amounts
      reading.cleanAmount = usage * cleanPerM3 + baseClean
      reading.dirtyAmount = usage * dirtyPerM3 + baseDirty
      reading.subtotal = reading.cleanAmount + reading.dirtyAmount
      reading.vat = reading.subtotal * 0.1
      reading.total = reading.subtotal + reading.vat

      // Дараагийн тикт refresh — commit дуусахаас өмнө refreshCells зарим тохиолдолд утга алдагдуулна
      const api = params.api
      const node = params.node

      // Өмнөх сарын эцсийн заалтыг өөрчилбөл дараагийн сарын эхний/эцсийн заалтыг дагуулж шинэчилнэ.
      let updatedNodes: any[] = []
      if (changedField === 'endValue' && reading.meterId && reading.month && reading.year) {
        const meterId = reading.meterId
        const nodesByKey = new Map<string, any>()
        api?.forEachNode?.((n: any) => {
          const d = n?.data
          if (!d) return
          if (!d.meterId || !d.month || !d.year) return
          nodesByKey.set(
            `${d.meterId}-${Number(d.year)}-${Number(d.month)}`,
            n
          )
        })

        let carried = Number(reading.endValue || 0)
        let curYear = Number(reading.year)
        let curMonth = Number(reading.month)

        while (true) {
          const nextMonth = curMonth === 12 ? 1 : curMonth + 1
          const nextYear = curMonth === 12 ? curYear + 1 : curYear

          const nextRow = newReadings.find((r) => r.meterId === meterId && r.month === nextMonth && r.year === nextYear)
          if (!nextRow) break

          const hadManualNextEnd = Number(nextRow.endValue || 0) !== Number(nextRow.startValue || 0)
          nextRow.startValue = carried

          if (!hadManualNextEnd) {
            // Дараагийн сарын end өмнө нь бөглөгдөөгүй бол start/end-ийг хоёуланг нь carry хийнэ.
            nextRow.endValue = carried
          }

          // start-оос бага end болохоос сэргийлнэ.
          if (Number(nextRow.endValue || 0) < carried) nextRow.endValue = carried

          nextRow.usage =
            (nextRow.endValue || 0) > (nextRow.startValue || 0)
              ? (nextRow.endValue || 0) - (nextRow.startValue || 0)
              : 0

          const nextCleanPerM3 = nextRow.cleanPerM3 || 0
          const nextDirtyPerM3 = nextRow.dirtyPerM3 || 0
          nextRow.cleanAmount = nextRow.usage * nextCleanPerM3 + (nextRow.baseClean || 0)
          nextRow.dirtyAmount = nextRow.usage * nextDirtyPerM3 + (nextRow.baseDirty || 0)
          nextRow.subtotal = nextRow.cleanAmount + nextRow.dirtyAmount
          nextRow.vat = nextRow.subtotal * 0.1
          nextRow.total = nextRow.subtotal + nextRow.vat

          const key = `${meterId}-${Number(nextRow.year)}-${Number(nextRow.month)}`
          const nodeForNext = nodesByKey.get(key)
          if (nodeForNext) updatedNodes.push(nodeForNext)

          // Дараагийн алхам end дээр суурилна.
          carried = Number(nextRow.endValue || 0)
          curYear = nextYear
          curMonth = nextMonth
        }
      }

      queueMicrotask(() => {
        try {
          if (!api?.isDestroyed?.()) {
            const rowNodesToRefresh = [...new Set([node, ...updatedNodes])].filter(Boolean)
            api.refreshCells({
              force: true,
              rowNodes: rowNodesToRefresh,
              columns: ['startValue', 'endValue', 'usage', 'cleanAmount', 'dirtyAmount', 'subtotal', 'vat', 'total'],
            })
          }
        } catch {
          /* ignore */
        }
      })

      return
    }

    // Modal дээр ямар ч мөрийг автоматаар хадгалахгүй.
    // Зөвхөн "Хадгалах" товчоор POST хийх урсгал ажиллана.
    if (showAddModal) {
      return
    }
    
    // If it's a new row in main grid (shouldn't happen now, but keep for safety)
    if (reading._isNew) {
      // Validate required fields
      if (!reading.meterId || !reading.month || !reading.year) {
        setMessage({ type: 'error', text: 'Тоолуур, сар, он заавал оруулах шаардлагатай' })
        setTimeout(() => setMessage(null), 3000)
        return
      }

      if (
        changedField === 'startValue' &&
        reading.startValue === 0 &&
        reading.meterId &&
        reading.month &&
        reading.year
      ) {
        try {
          const res = await fetchWithAuth(`/api/readings/previous?meterId=${reading.meterId}&month=${reading.month}&year=${reading.year}`)
          if (res.ok) {
            const data = await res.json()
            if (data && !data.error && typeof data.endValue === 'number') {
              reading.startValue = data.endValue
              reading.endValue = data.endValue
              params.api.refreshCells({ rowNodes: [params.node], columns: ['startValue', 'endValue'] })
            }
          }
        } catch (err) {
          // Ignore error
        }
      }

      // Calculate usage
      reading.usage = reading.endValue > reading.startValue ? reading.endValue - reading.startValue : 0
      return
    }
    
    // Update existing reading
    if (reading.id) {
      try {
        const res = await fetchWithAuth(`/api/readings?id=${reading.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            month: reading.month,
            year: reading.year,
            startValue: reading.startValue,
            endValue: reading.endValue,
            baseClean: reading.baseClean || 0,
            baseDirty: reading.baseDirty || 0,
          }),
        })

        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || 'Алдаа гарлаа')
        }

        setMessage({ type: 'success', text: 'Амжилттай шинэчлэгдлээ' })
        setTimeout(() => setMessage(null), 2000)
        // Нүд зассаны дараа бүх grid ачаалах хэсгээр солигдож Enter-тай зөрчилдөж болно
        await fetchReadings({ silent: true })
      } catch (err: any) {
        setMessage({ type: 'error', text: err.message || 'Алдаа гарлаа' })
        setTimeout(() => setMessage(null), 3000)
      }
    }
  }, [fetchReadings, showAddModal])

  const latestOrgTariffByOrgId = useMemo(() => {
    const byOrg = new Map<string, OrganizationTariff>()
    const score = (t: OrganizationTariff) =>
      (Number(t.year) || 0) * 100 +
      (Number(t.month) || 0)
    for (const t of tariffs) {
      const orgId = t.organizationId
      if (!orgId) continue
      const existing = byOrg.get(orgId)
      if (!existing || score(t) > score(existing)) {
        byOrg.set(orgId, t)
      }
    }
    return byOrg
  }, [tariffs])

  const latestOrgTariffByCategory = useMemo(() => {
    const byCategory = new Map<string, OrganizationTariff>()
    const score = (t: OrganizationTariff) =>
      (Number(t.year) || 0) * 100 +
      (Number(t.month) || 0)
    for (const t of tariffs) {
      const category = t.organization?.category
      if (!category) continue
      const existing = byCategory.get(category)
      if (!existing || score(t) > score(existing)) {
        byCategory.set(category, t)
      }
    }
    return byCategory
  }, [tariffs])

  const latestCategoryTariffByCategory = useMemo(() => {
    const byCategory = new Map<string, CategoryTariff>()
    for (const t of categoryTariffs) {
      if (t.category && !byCategory.has(t.category)) {
        byCategory.set(t.category, t)
      }
    }
    return byCategory
  }, [categoryTariffs])

  // Өмнөх сарын заалтаас эхний заалт авч, нэг (org, month, year) мөр үүсгэнэ
  const buildOneRow = useCallback((
    org: Organization,
    meter: Meter | undefined,
    month: number,
    year: number,
    startValue: number,
    pipes: PipeFee[],
  ): Reading => {
    let baseClean = 0
    let baseDirty = 0
    let cleanPerM3 = 0
    let dirtyPerM3 = 0
    const pipeDiam = org.connectionNumber ? parseInt(String(org.connectionNumber).trim(), 10) : NaN
    const pipeFee = !Number.isNaN(pipeDiam) && pipes.length > 0
      ? pipes.find((p) => p.diameterMm === pipeDiam)
      : undefined
    if (pipeFee) {
      baseClean = pipeFee.baseCleanFee ?? 0
      baseDirty = pipeFee.baseDirtyFee ?? 0
    }
    // Тооцоололд тухайн үеийн бус, хамгийн сүүлийн тариф ашиглана.
    let tariffForPeriod: OrganizationTariff | CategoryTariff | undefined =
      latestOrgTariffByOrgId.get(org.id)

    if (!tariffForPeriod && org?.category) {
      const latestCat = latestCategoryTariffByCategory.get(org.category)
      if (latestCat) {
        tariffForPeriod = latestCat
      } else {
        tariffForPeriod = latestOrgTariffByCategory.get(org.category)
      }
    }
    if (tariffForPeriod) {
      if (!pipeFee) {
        baseClean = tariffForPeriod.baseCleanFee ?? 0
        baseDirty = tariffForPeriod.baseDirtyFee ?? 0
      }
      cleanPerM3 = tariffForPeriod.cleanPerM3 ?? 0
      dirtyPerM3 = tariffForPeriod.dirtyPerM3 ?? 0
    } else if (org && !pipeFee) {
      baseClean = org.baseCleanFee ?? 0
      baseDirty = org.baseDirtyFee ?? 0
    }
    return {
      _isNew: true,
      organizationId: org.id,
      organization: {
        id: org.id,
        name: org.name || '-',
        code: (org as any)?.code ?? null,
      },
      meterId: meter?.id,
      meter: meter ? { meterNumber: meter.meterNumber } : undefined,
      month,
      year,
      startValue,
      // Өмнөх сарын эцсийн заалт → энэ сарын эхний болон эцсийн заалтын анхны утга (хэрэглэгч эцсийг өөрчилнө)
      endValue: startValue,
      usage: 0,
      baseClean,
      baseDirty,
      cleanPerM3,
      dirtyPerM3,
      cleanAmount: 0,
      dirtyAmount: 0,
      subtotal: 0,
      vat: 0,
      total: 0,
    }
  }, [latestOrgTariffByOrgId, latestCategoryTariffByCategory, latestOrgTariffByCategory])

  const buildRowsForYearAndMonths = useCallback((
    orgList: Organization[],
    metersList: Meter[],
    periods: Array<{ year: number; month: number }>,
    prevReadingsByKey: Record<string, Reading[]>,
    pipesOverride?: PipeFee[],
    currentReadingsByKey?: Record<string, Reading[]>,
  ): Reading[] => {
    const pipes = pipesOverride ?? pipeFees
    const rows: Reading[] = []
    for (const org of orgList) {
      const metersForOrg = metersList.filter((m) => m.organizationId === org.id)
      // Байгууллагад ямар нэг meter олдохгүй бол сонгох боломжтой байлгахын тулд meter-гүй нэг мөр үүсгэнэ.
      const metersToRender: Array<Meter | undefined> =
        metersForOrg.length > 0 ? metersForOrg : [undefined]

      for (const meter of metersToRender) {
        for (const period of periods) {
          const currentKey = `${period.year}-${period.month}`
          const currentList = currentReadingsByKey?.[currentKey] ?? []
          const existingForMeter = meter
            ? currentList.find((r) => r.meterId === meter.id)
            : undefined
          if (existingForMeter) {
            rows.push({ ...existingForMeter, _isNew: false })
            continue
          }

          const prevMonth = period.month === 1 ? 12 : period.month - 1
          const prevYear = period.month === 1 ? period.year - 1 : period.year
          const key = `${prevYear}-${prevMonth}`
          const prevList = prevReadingsByKey[key] ?? []
          const prevForMeter = meter ? prevList.find((r) => r.meterId === meter.id) : undefined
          const startValue = prevForMeter != null ? (prevForMeter.endValue ?? 0) : 0
          rows.push(buildOneRow(org, meter, period.month, period.year, startValue, pipes))
        }
      }
    }
    return rows
  }, [buildOneRow, pipeFees])

  const handleOpenAddModal = async () => {
    const currentMonth = new Date().getMonth() + 1
    const currentYear = new Date().getFullYear()
    setAddModalYear(currentYear)
    setAddModalMonth(currentMonth)
    setShowAddModal(true)
    setMessage(null)
    setLoading(true)
    setNewReadings([])
    try {
      const [orgRes, meterRes, pipeRes] = await Promise.all([
        fetchWithAuth('/api/organizations?customersOnly=1'),
        fetchWithAuth('/api/meters'),
        fetchWithAuth('/api/pipe-fees'),
      ])
      const orgData = await orgRes.json()
      if (orgRes.ok && Array.isArray(orgData)) setOrganizations(orgData)
      const meterData = await meterRes.json()
      if (meterRes.ok && Array.isArray(meterData)) setAllMeters(meterData)
      const pipeData = await pipeRes.json().catch(() => [])
      const pipes: PipeFee[] = Array.isArray(pipeData) ? pipeData : pipeFees
      const orgList: Organization[] = orgRes.ok && Array.isArray(orgData) ? orgData : organizations
      const metersList: Meter[] = meterRes.ok && Array.isArray(meterData) ? meterData : allMeters

      // Modal дээр сонгосон (year, month)-оос 12 сар хүртэл + дараагийн оны 1 сар хүртэлх бүх period-ийг харуулна.
      const periods: Array<{ year: number; month: number }> = []
      for (let mm = currentMonth; mm <= 12; mm++) {
        periods.push({ year: currentYear, month: mm })
      }
      periods.push({ year: currentYear + 1, month: 1 })

      const prevKeysNeeded = new Map<string, { year: number; month: number }>()
      for (const p of periods) {
        const pm = p.month === 1 ? 12 : p.month - 1
        const py = p.month === 1 ? p.year - 1 : p.year
        prevKeysNeeded.set(`${py}-${pm}`, { year: py, month: pm })
      }

      const currentKeysNeeded = new Map<string, { year: number; month: number }>()
      for (const p of periods) {
        currentKeysNeeded.set(`${p.year}-${p.month}`, p)
      }

      const prevReadingsByKey: Record<string, Reading[]> = {}
      await Promise.all(
        Array.from(prevKeysNeeded.values()).map(async (p) => {
          const res = await fetchWithAuth(`/api/readings?month=${p.month}&year=${p.year}&recalculate=1`)
          const data = res.ok ? await res.json() : []
          prevReadingsByKey[`${p.year}-${p.month}`] = Array.isArray(data) ? data : []
        })
      )

      // Сар алгассан үед өмнөх сарын бичлэг байхгүй бол "хамгийн сүүлийн өмнөх" заалтаас эхний заалтыг авна.
      // Энэ нь зөвхөн эхний period (currentYear,currentMonth)-д хэрэгжинэ.
      const prevMonthForFirst = currentMonth === 1 ? 12 : currentMonth - 1
      const prevYearForFirst = currentMonth === 1 ? currentYear - 1 : currentYear
      const firstPrevKey = `${prevYearForFirst}-${prevMonthForFirst}`
      const firstPrevList = prevReadingsByKey[firstPrevKey] ? [...prevReadingsByKey[firstPrevKey]] : []
      const hasPrevForMeter = new Set<string>()
      for (const r of firstPrevList) {
        if (r?.meterId) hasPrevForMeter.add(String(r.meterId))
      }

      const meterIds = metersList.map((m) => m.id).filter(Boolean)
      const concurrency = 10
      for (let i = 0; i < meterIds.length; i += concurrency) {
        const chunk = meterIds.slice(i, i + concurrency)
        const results = await Promise.all(
          chunk.map(async (meterId) => {
            if (hasPrevForMeter.has(meterId)) return null
            try {
              const res = await fetchWithAuth(
                `/api/readings/previous?meterId=${meterId}&month=${currentMonth}&year=${currentYear}`
              )
              if (!res.ok) return null
              const data = await res.json().catch(() => null)
              if (!data || data.error) return null
              const endValue = typeof data.endValue === 'number' ? data.endValue : Number(data.endValue)
              if (!Number.isFinite(endValue)) return null
              return { meterId, endValue }
            } catch {
              return null
            }
          })
        )

        for (const r of results) {
          if (!r) continue
          firstPrevList.push({
            _isNew: false,
            meterId: r.meterId,
            month: prevMonthForFirst,
            year: prevYearForFirst,
            startValue: r.endValue,
            endValue: r.endValue,
          } as Reading)
          hasPrevForMeter.add(r.meterId)
        }
      }
      prevReadingsByKey[firstPrevKey] = firstPrevList

      const currentReadingsByKey: Record<string, Reading[]> = {}
      await Promise.all(
        Array.from(currentKeysNeeded.values()).map(async (p) => {
          const res = await fetchWithAuth(`/api/readings?month=${p.month}&year=${p.year}&recalculate=1`)
          const data = res.ok ? await res.json() : []
          currentReadingsByKey[`${p.year}-${p.month}`] = Array.isArray(data) ? data : []
        })
      )

      const rows = buildRowsForYearAndMonths(orgList, metersList, periods, prevReadingsByKey, pipes, currentReadingsByKey)
      setNewReadings(rows)
      snapshotRows(rows)
    } catch (error) {
      setNewReadings([])
    } finally {
      setLoading(false)
    }
  }

  const handleAddModalApplyMonths = useCallback(async (yearOverride?: number, monthOverride?: number) => {
    const y = yearOverride ?? addModalYear
    const m = monthOverride ?? addModalMonth
    // Сонгосон (y,m)-оос 12 сар хүртэл + дараагийн оны 1 сар хүртэл
    const periods: Array<{ year: number; month: number }> = []
    for (let mm = m; mm <= 12; mm++) {
      periods.push({ year: y, month: mm })
    }
    periods.push({ year: y + 1, month: 1 })

    setLoading(true)
    setMessage(null)
    try {
      const orgList = organizations.length ? organizations : await fetchWithAuth('/api/organizations?customersOnly=1').then(r => r.ok ? r.json() : []).catch(() => [])
      const metersList = allMeters.length ? allMeters : await fetchWithAuth('/api/meters').then(r => r.ok ? r.json() : []).catch(() => [])
      if (!Array.isArray(orgList)) setNewReadings([])
      else {
        // Эхний period (y,m)-ийн previous period-ийн endValue-г override хийнэ.
        const prevMonthForFirst = m === 1 ? 12 : m - 1
        const prevYearForFirst = m === 1 ? y - 1 : y
        const firstPrevKey = `${prevYearForFirst}-${prevMonthForFirst}`

        // Өмнөх сар одоогийн periods-д байхгүй бол newReadings-д үлдсэн тухайн сарын мөрүүд
        // (өөр эхний сараас үүссэн үлдэгдэл) — жинхэнэ өгөгдөл биш; эндээс override хийвэл
        // сар алгасан сонгоход зөв fetch/previous-ийг 0-ээр дарна.
        const prevMonthIsInPeriods = periods.some(
          (p) => p.year === prevYearForFirst && p.month === prevMonthForFirst
        )
        const inModalOverrides: Map<string, number> = new Map()
        if (prevMonthIsInPeriods) {
          for (const r of newReadings) {
            if (!r.meterId) continue
            if (r.month === prevMonthForFirst && r.year === prevYearForFirst) {
              inModalOverrides.set(r.meterId, Number(r.endValue ?? r.startValue ?? 0))
            }
          }
        }

        // Хэрэгтэй бүх previous/current period-үүдийг fetch хийнэ.
        const prevKeysNeeded = new Map<string, { year: number; month: number }>()
        for (const p of periods) {
          const pm = p.month === 1 ? 12 : p.month - 1
          const py = p.month === 1 ? p.year - 1 : p.year
          prevKeysNeeded.set(`${py}-${pm}`, { year: py, month: pm })
        }

        const prevReadingsByKey: Record<string, Reading[]> = {}
        await Promise.all(
          Array.from(prevKeysNeeded.values()).map(async ({ year: py, month: pm }) => {
            const res = await fetchWithAuth(`/api/readings?month=${pm}&year=${py}&recalculate=1`)
            const data = res.ok ? await res.json() : []
            prevReadingsByKey[`${py}-${pm}`] = Array.isArray(data) ? data : []
          })
        )

        // Сар алгассан үед эхний сонгосон period (y,m)-ийн startValue-г "хамгийн сүүлийн өмнөх" заалтаас авна.
        // (prevMonthForFirst, prevYearForFirst) сард бичлэг байхгүй тоолуурт `/api/readings/previous` ашиглана.
        const firstPrevList0 = prevReadingsByKey[firstPrevKey] ? [...prevReadingsByKey[firstPrevKey]] : []
        const hasPrevForMeter0 = new Set<string>()
        for (const r of firstPrevList0) {
          if (r?.meterId) hasPrevForMeter0.add(String(r.meterId))
        }
        const meterIds0 = (metersList as Meter[]).map((mm) => mm.id).filter(Boolean)
        const concurrency0 = 10
        for (let i = 0; i < meterIds0.length; i += concurrency0) {
          const chunk = meterIds0.slice(i, i + concurrency0)
          const results = await Promise.all(
            chunk.map(async (meterId) => {
              if (hasPrevForMeter0.has(meterId)) return null
              try {
                const res = await fetchWithAuth(
                  `/api/readings/previous?meterId=${meterId}&month=${m}&year=${y}`
                )
                if (!res.ok) return null
                const data = await res.json().catch(() => null)
                if (!data || data.error) return null
                const endValue = typeof data.endValue === 'number' ? data.endValue : Number(data.endValue)
                if (!Number.isFinite(endValue)) return null
                return { meterId, endValue }
              } catch {
                return null
              }
            })
          )
          for (const r of results) {
            if (!r) continue
            firstPrevList0.push({
              _isNew: false,
              meterId: r.meterId,
              month: prevMonthForFirst,
              year: prevYearForFirst,
              startValue: r.endValue,
              endValue: r.endValue,
            } as Reading)
            hasPrevForMeter0.add(r.meterId)
          }
        }
        prevReadingsByKey[firstPrevKey] = firstPrevList0

        if (inModalOverrides.size > 0) {
          const prevList = prevReadingsByKey[firstPrevKey] ? [...prevReadingsByKey[firstPrevKey]] : []
          for (const [meterId, endValue] of inModalOverrides) {
            const idx = prevList.findIndex((x) => x.meterId === meterId)
            if (idx >= 0) {
              prevList[idx] = { ...prevList[idx], startValue: endValue, endValue }
            } else {
              prevList.push({
                _isNew: false,
                meterId,
                month: prevMonthForFirst,
                year: prevYearForFirst,
                startValue: endValue,
                endValue,
              } as Reading)
            }
          }
          prevReadingsByKey[firstPrevKey] = prevList
        }

        const currentReadingsByKey: Record<string, Reading[]> = {}
        await Promise.all(
          periods.map(async (p) => {
            const res = await fetchWithAuth(`/api/readings?month=${p.month}&year=${p.year}&recalculate=1`)
            const data = res.ok ? await res.json() : []
            currentReadingsByKey[`${p.year}-${p.month}`] = Array.isArray(data) ? data : []
          })
        )

        const rows = buildRowsForYearAndMonths(orgList, metersList, periods, prevReadingsByKey, undefined, currentReadingsByKey)
        setNewReadings(rows)
        snapshotRows(rows)
      }
    } catch (e) {
      setNewReadings([])
    } finally {
      setLoading(false)
    }
  }, [addModalYear, addModalMonth, organizations, allMeters, buildRowsForYearAndMonths, newReadings, snapshotRows])

  const handleCloseAddModal = () => {
    setShowAddModal(false)
    setNewReadings([])
    modalOriginalRowsRef.current = new Map()
    setMessage(null)
  }

  const handleSaveNewReadings = async () => {
    const isDirty = (r: Reading) => {
      const snap = modalOriginalRowsRef.current.get(getRowSnapshotKey(r))
      if (!snap) return true
      return (
        Number(r.startValue || 0) !== snap.startValue ||
        Number(r.endValue || 0) !== snap.endValue ||
        Number(r.baseClean || 0) !== snap.baseClean ||
        Number(r.baseDirty || 0) !== snap.baseDirty ||
        (r.meterId || '') !== (snap.meterId || '')
      )
    }
    const rowsToSave = newReadings.filter((r) => r.meterId && (r._isNew || !!r.id) && isDirty(r))

    const rowsWithDataButNoMeter = newReadings.filter((r) => {
      if (!r._isNew || !r.organizationId) return false
      if (r.meterId) return false
      const hasReading = (r.endValue ?? 0) !== 0 || (r.startValue ?? 0) !== 0
      return hasReading
    })

    if (rowsWithDataButNoMeter.length > 0) {
      const names = rowsWithDataButNoMeter.map((r) => r.organization?.name || '-').join(', ')
      setMessage({
        type: 'error',
        text: `Заалт оруулсан боловч тоолуур сонгоогүй мөр байна. Хэрэглэгч: ${names}. Тоолуур сонгоно уу эсвэл мөрийг цуцлах товч дарна уу.`,
      })
      setTimeout(() => setMessage(null), 6000)
      return
    }

    if (rowsToSave.length === 0) {
      setMessage({ type: 'error', text: 'Хадгалах мөр олдсонгүй. Тоолуур сонгоод дахин оролдоно уу.' })
      setTimeout(() => setMessage(null), 3000)
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      const saveOne = async (reading: Reading) => {
        const meterId = reading.meterId!
        const body = {
          meterId,
          month: reading.month,
          year: reading.year,
          startValue: reading.startValue,
          endValue: reading.endValue,
          baseClean: reading.baseClean || 0,
          baseDirty: reading.baseDirty || 0,
          cleanPerM3: reading.cleanPerM3 || 0,
          dirtyPerM3: reading.dirtyPerM3 || 0,
        }
        const res = reading._isNew
          ? await fetchWithAuth('/api/readings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
          : await fetchWithAuth(`/api/readings?id=${reading.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                month: reading.month,
                year: reading.year,
                startValue: reading.startValue,
                endValue: reading.endValue,
                baseClean: reading.baseClean || 0,
                baseDirty: reading.baseDirty || 0,
              }),
            })

        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Алдаа гарлаа')
      }

      const concurrency = 10
      for (let i = 0; i < rowsToSave.length; i += concurrency) {
        const chunk = rowsToSave.slice(i, i + concurrency)
        await Promise.all(chunk.map((r) => saveOne(r)))
      }

      setMessage({ type: 'success', text: 'Амжилттай хадгаллаа' })
      handleCloseAddModal()
      fetchReadings()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Алдаа гарлаа' })
    } finally {
      setLoading(false)
    }
  }

  // Meter dropdown — reactive cell editor (onValueChange + stopEditing)
  const MeterCellEditor = useMemo(() => {
    return (props: {
      value: unknown
      onValueChange: (v: unknown) => void
      stopEditing: (cancel?: boolean) => void
      data: Reading
      api: any
      node: any
    }) => {
      const { value, onValueChange, stopEditing, data, api, node } = props
      const selectVal = value == null || value === '' ? '' : String(value)

      const applySelection = (newValue: string) => {
        onValueChange(newValue || null)
        const meter = allMeters.find((m) => m.id === newValue)
        if (meter) {
          data.meterId = newValue
          data.meter = { meterNumber: meter.meterNumber }
          const org = organizations.find((o) => o.id === meter.organizationId)
          if (org) {
            data.organizationId = org.id
            data.organization = { name: org.name, id: org.id, code: null }
          }
          api.refreshCells({ rowNodes: [node], columns: ['organization'] })
        } else {
          data.meterId = undefined
          data.meter = undefined
        }
        stopEditing()
      }

      return (
        <select
          autoFocus
          value={selectVal}
          onChange={(e) => applySelection(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              stopEditing(true)
            }
          }}
          style={{
            width: '100%',
            height: '100%',
            border: '1px solid #ccc',
            padding: '4px',
            fontSize: '14px',
            backgroundColor: 'white',
          }}
        >
          <option value="">Сонгох</option>
          {allMeters.map((meter) => (
            <option key={meter.id} value={meter.id}>
              {meter.meterNumber}
            </option>
          ))}
        </select>
      )
    }
  }, [allMeters, organizations])

  const columnDefs: ColDef<Reading>[] = useMemo(() => [
    {
      headerName: 'РД',
      width: 100,
      editable: false,
      valueGetter: (params: any) => {
        if (params.data?.organization?.code) {
          return params.data.organization.code
        }
        if (params.data?.organization?.id) {
          return params.data.organization.id.slice(-7)
        }
        if (params.data?.id) {
          return params.data.id.slice(-7)
        }
        return '-'
      },
    },
    {
      headerName: 'Т/дугаар',
      width: 150,
      field: 'meterId',
      // Модал дотор `meterId` сонголт хийх шаардлагагүй (мөрүүд нь meter-ээр pre-render хийгдсэн).
      // Тиймээс editor автоматаар нээгдэж dropdown гаргахгүй.
      editable: false,
      cellEditor: MeterCellEditor,
      cellEditorParams: {
        suppressKeyboardEvent: (params: any) => {
          // Prevent unwanted keyboard events
          return false
        },
      },
      valueGetter: (params: any) => {
        if (params.data?.meter?.meterNumber) {
          return params.data.meter.meterNumber
        }
        if (params.data?.meterId) {
          const meter = allMeters.find(m => m.id === params.data.meterId)
          return meter?.meterNumber || '-'
        }
        return '-'
      },
      onCellClicked: undefined,
    },
    {
      headerName: 'Хэрэглэгчийн нэр',
      width: 180,
      minWidth: 140,
      editable: false,
      valueGetter: (params: any) => params.data?.organization?.name || '-',
    },
    {
      headerName: 'Огноо',
      width: 140,
      editable: false,
      valueGetter: (params: any) => {
        const year = params.data?.year
        const month = params.data?.month
        if (!year || !month) return '-'
        const monthStr = String(month).padStart(2, '0')
        return `${year}-${monthStr}`
      },
    },
    {
      headerName: 'Эхний заалт',
      width: 130,
      colId: 'startValue',
      field: 'startValue',
      ...numberColStyle,
      editable: (params: any) =>
        showAddModal &&
        params.data?.year === addModalYear &&
        params.data?.month === 1,
      cellEditor: NumberCellEditorSelectAll,
      valueParser: (params: any) => {
        const raw = params.newValue
        if (raw === null || raw === undefined || raw === '') return 0
        const n =
          typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.').trim())
        return Number.isNaN(n) || n < 0 ? 0 : Math.round(n * 100) / 100
      },
      valueSetter: (params: any) => {
        if (params.data) {
          const n = params.newValue != null ? Number(params.newValue) : 0
          params.data.startValue = Number.isNaN(n) ? 0 : n
        }
        return true
      },
      valueFormatter: (params: any) => {
        const v = params.data?.startValue
        if (v == null || v === '') return '0.00'
        return Number(v).toFixed(2)
      },
    },
    {
      headerName: 'Эцсийн заалт',
      width: 130,
      colId: 'endValue',
      field: 'endValue',
      ...numberColStyle,
      editable: (params: any) =>
        showAddModal &&
        params.data?.year === addModalYear &&
        params.data?.month === addModalMonth,
      cellEditor: NumberCellEditorSelectAll,
      valueParser: (params: any) => {
        const raw = params.newValue
        if (raw === null || raw === undefined || raw === '') return 0
        const n =
          typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.').trim())
        return Number.isNaN(n) || n < 0 ? 0 : Math.round(n * 100) / 100
      },
      valueSetter: (params: any) => {
        if (params.data) {
          const n = params.newValue != null ? Number(params.newValue) : 0
          params.data.endValue = Number.isNaN(n) ? 0 : n
        }
        return true
      },
      valueFormatter: (params: any) => {
        const v = params.data?.endValue
        if (v == null || v === '') return '0.00'
        return Number(v).toFixed(2)
      },
    },
    {
      headerName: 'Зөрүү',
      width: 100,
      field: 'usage',
      ...numberColStyle,
      editable: false,
      valueGetter: (params: any) => {
        const start = params.data?.startValue || 0
        const end = params.data?.endValue || 0
        return end > start ? end - start : 0
      },
      valueFormatter: (params: any) => {
        if (params.value == null) return '0.00'
        return Number(params.value).toFixed(2)
      },
    },
    {
      headerName: 'Б/Суурь хураамж',
      width: 150,
      field: 'baseDirty',
      ...numberColStyle,
      editable: (params: any) =>
        showAddModal &&
        params.data?.year === addModalYear &&
        params.data?.month === addModalMonth,
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 0,
        precision: 2,
      },
      valueFormatter: (params: any) => {
        if (params.value == null) return '0.00'
        return Number(params.value).toFixed(2)
      },
    },
    {
      headerName: 'Ц/Суурь хураамж',
      width: 150,
      field: 'baseClean',
      ...numberColStyle,
      editable: (params: any) =>
        showAddModal &&
        params.data?.year === addModalYear &&
        params.data?.month === addModalMonth,
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 0,
        precision: 2,
      },
      valueFormatter: (params: any) => {
        if (params.value == null) return '0.00'
        return Number(params.value).toFixed(2)
      },
    },
    {
      headerName: 'Бохир',
      width: 120,
      field: 'dirtyAmount',
      ...numberColStyle,
      valueFormatter: (params: any) => {
        if (params.value == null) return '0.00'
        return Number(params.value).toFixed(2)
      },
    },
    {
      headerName: 'Цэвэр',
      width: 120,
      field: 'cleanAmount',
      ...numberColStyle,
      valueFormatter: (params: any) => {
        if (params.value == null) return '0.00'
        return Number(params.value).toFixed(2)
      },
    },
    {
      headerName: 'Нийт',
      width: 120,
      field: 'subtotal',
      ...numberColStyle,
      valueFormatter: (params: any) => {
        if (params.value == null) return '0.00'
        return Number(params.value).toFixed(2)
      },
    },
    {
      headerName: 'НӨАТ',
      width: 120,
      field: 'vat',
      ...numberColStyle,
      valueFormatter: (params: any) => {
        if (params.value == null) return '0.00'
        return Number(params.value).toFixed(2)
      },
    },
    {
      headerName: 'Нийт',
      width: 120,
      field: 'total',
      ...numberColStyle,
      valueFormatter: (params: any) => {
        if (params.value == null) return '0.00'
        return Number(params.value).toFixed(2)
      },
    },
  ], [
    allMeters,
    organizations,
    MeterCellEditor,
    showAddModal,
    addModalYear,
    addModalMonth,
    numberColStyle,
  ])

  const pinnedBottomRowData = useMemo(() => {
    const sum = (field: keyof Reading) =>
      readings.reduce((acc, row) => acc + (Number(row[field] ?? 0) || 0), 0)
    return [
      {
        meterId: '',
        organization: { name: 'Нийт дүн', id: '-', code: null },
        startValue: 0,
        endValue: 0,
        usage: sum('usage'),
        baseDirty: sum('baseDirty'),
        baseClean: sum('baseClean'),
        dirtyAmount: sum('dirtyAmount'),
        cleanAmount: sum('cleanAmount'),
        subtotal: sum('subtotal'),
        vat: sum('vat'),
        total: sum('total'),
      } as Reading,
    ]
  }, [readings])

  const modalColumnDefs: ColDef<Reading>[] = useMemo(() => {
    const filtered = columnDefs.filter((col) =>
      !['Б/Суурь хураамж', 'Ц/Суурь хураамж', 'Бохир', 'Цэвэр', 'Нийт', 'НӨАТ'].includes(
        (col.headerName as string) || ''
      )
    )
    return filtered.map((col) =>
      (col.headerName as string) === 'Хэрэглэгчийн нэр'
        ? { ...col, flex: 1, minWidth: 120, width: undefined }
        : col
    )
  }, [columnDefs])

  useEffect(() => {
    if (!showAddModal) return
    const t = setTimeout(() => {
      modalGridRef.current?.api?.sizeColumnsToFit()
    }, 100)
    return () => clearTimeout(t)
  }, [showAddModal, newReadings.length])

  return (
    <div className="px-4 sm:px-0">
      <div className="mb-8 flex justify-between items-center">
        <h2 className="text-2xl font-semibold text-gray-900">Заалтын мэдээлэл</h2>
        <button
          type="button"
          onClick={handleOpenAddModal}
          className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 flex items-center gap-2"
        >
          <PlusIcon className="h-5 w-5" />
          Заалт оруулах
        </button>
      </div>

      {message && !showAddModal && (
        <div
          className={`mb-4 p-4 rounded ${
            message.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            {/* Backdrop */}
            <div
              className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
              onClick={handleCloseAddModal}
              aria-hidden
            />

            {/* Modal Panel - төвд байрлуулах */}
            <div className="relative z-10 w-full max-w-6xl max-h-[90vh] flex flex-col bg-white rounded-lg shadow-xl overflow-hidden">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4 flex flex-col flex-1 overflow-hidden">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-2xl font-semibold text-gray-900">Заалт оруулах</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCloseAddModal}
                      className="text-gray-400 hover:text-gray-500 focus:outline-none"
                    >
                      <span className="sr-only">Хаах</span>
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-600">Он:</label>
                      <select
                        value={addModalYear}
                        onChange={(e) => {
                          const newYear = Number(e.target.value)
                          setAddModalYear(newYear)
                          handleAddModalApplyMonths(newYear, addModalMonth)
                        }}
                        className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
                      >
                        {[new Date().getFullYear() + 1, new Date().getFullYear(), new Date().getFullYear() - 1].map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-600">Сар:</label>
                      <select
                        value={addModalMonth}
                        onChange={(e) => {
                          const newMonth = Number(e.target.value)
                          setAddModalMonth(newMonth)
                          handleAddModalApplyMonths(addModalYear, newMonth)
                        }}
                        className="px-3 py-1.5 border border-gray-300 rounded-md text-sm w-20"
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    {loading && <span className="text-sm text-gray-500">Бэлтгэж байна...</span>}
                  </div>
                </div>

                {message && (
                  <div
                    className={`mb-4 p-4 rounded ${
                      message.type === 'success'
                        ? 'bg-green-50 border border-green-200 text-green-700'
                        : 'bg-red-50 border border-red-200 text-red-700'
                    }`}
                  >
                    {message.text}
                  </div>
                )}

                <div className="flex-1 overflow-x-auto overflow-y-hidden min-h-0 w-full">
                  <div className="ag-theme-alpine w-full" style={{ height: '500px', width: '100%' }}>
                    <AgGridReact
                      theme="legacy"
                      reactiveCustomComponents
                      ref={modalGridRef}
                      rowData={visibleModalRows}
                      columnDefs={modalColumnDefs}
                      getRowId={(params: any) =>
                        params.data?.id ??
                        `new-${params.data?.organizationId}-${params.data?.meterId ?? 'x'}-${params.data?.year}-${params.data?.month}`
                      }
                      rowBuffer={15}
                      defaultColDef={{
                        sortable: true,
                        filter: false,
                        resizable: true,
                      }}
                      onGridReady={(e) => e.api.sizeColumnsToFit()}
                      onCellValueChanged={handleCellValueChanged}
                      pagination={false}
                      domLayout="normal"
                      singleClickEdit={true}
                      stopEditingWhenCellsLoseFocus={true}
                      suppressClickEdit={false}
                      enterNavigatesVertically={false}
                      enterNavigatesVerticallyAfterEdit={false}
                    />
                  </div>
                </div>

                {/* Footer buttons */}
                <div className="flex justify-end gap-3 mt-4 pt-4 border-t">
                  <button
                    type="button"
                    onClick={handleCloseAddModal}
                    className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    Цуцлах
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveNewReadings}
                    disabled={loading}
                    className="px-6 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                  >
                    {loading ? 'Хадгалж байна...' : 'Хадгалах'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8">
        <div className="mb-6">
          <div className="bg-white p-4 rounded-lg border border-gray-200 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Сар
                </label>
                <select
                  value={filterMonth}
                  onChange={(e) => setFilterMonth(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">Бүгд</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                    <option key={m} value={String(m)}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Он
                </label>
                <select
                  value={filterYear}
                  onChange={(e) => setFilterYear(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">Бүгд</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={String(y)}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void fetchReadings()}
                  className="w-full px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  Шүүх
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 w-full">
          <div className="ag-theme-alpine" style={{ height: '600px', width: '100%' }}>
            {readingsLoading ? (
              <div className="flex items-center justify-center h-full text-gray-600">
                Ачааллаж байна...
              </div>
            ) : (
              <AgGridReact
                theme="legacy"
                reactiveCustomComponents
                ref={gridRef}
                rowData={readings}
                pinnedBottomRowData={pinnedBottomRowData}
                columnDefs={columnDefs}
                getRowId={(params: any) =>
                  params.data?.id ??
                  `m-${params.data?.meterId ?? 'x'}-${params.data?.year ?? 0}-${params.data?.month ?? 0}`
                }
                rowBuffer={20}
                defaultColDef={{
                  sortable: true,
                  filter: true,
                  resizable: true,
                }}
                onCellValueChanged={handleCellValueChanged}
                pagination={true}
                paginationPageSize={20}
                domLayout="normal"
                singleClickEdit={true}
                stopEditingWhenCellsLoseFocus={true}
                suppressClickEdit={false}
                enterNavigatesVertically={false}
                enterNavigatesVerticallyAfterEdit={false}
                overlayNoRowsTemplate={
                  '<div style="padding: 20px; text-align: center;"><p style="font-size: 16px; margin-bottom: 8px;">Заалтын мэдээлэл олдсонгүй</p><p style="font-size: 14px; color: #666;">Шүүлт өөрчлөх эсвэл шинэ заалт оруулна уу</p></div>'
                }
                getRowStyle={(params) =>
                  params.node.rowPinned
                    ? { fontWeight: 700, backgroundColor: '#f9fafb' }
                    : undefined
                }
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

