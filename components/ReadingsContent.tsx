'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { fetchWithAuth } from '@/lib/api'
import { AgGridReact } from 'ag-grid-react'
import { ColDef, ModuleRegistry, AllCommunityModule } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { TrashIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline'
import ConfirmModal from './ConfirmModal'

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
  const [meters, setMeters] = useState<Meter[]>([])
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
  const [filterOrgId, setFilterOrgId] = useState<string>('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [addModalYear, setAddModalYear] = useState(() => new Date().getFullYear())
  const [addModalMonth, setAddModalMonth] = useState(() => new Date().getMonth() + 1)
  const [latestMeterReadings, setLatestMeterReadings] = useState<Reading[]>([])
  const [newReadings, setNewReadings] = useState<Reading[]>([])
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null }>({ open: false, id: null })
  const gridRef = useRef<AgGridReact>(null)
  const modalGridRef = useRef<AgGridReact>(null)
  const numberColStyle = useMemo(
    () => ({
      cellClass: 'ag-right-aligned-cell',
      headerClass: 'ag-right-aligned-header',
    }),
    []
  )

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
      if (filterOrgId) params.append('organizationId', filterOrgId)

      const res = await fetchWithAuth(`/api/readings?${params.toString()}`)
      const data = await res.json()

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
      } else {
        console.error('Error fetching readings:', data)
        setReadings([])
      }
    } catch (error) {
      console.error('Error fetching readings:', error)
      setReadings([])
    } finally {
      if (showLoading) setReadingsLoading(false)
    }
  }, [filterMonth, filterYear, filterOrgId])

  useEffect(() => {
    fetchReadings()
  }, [fetchReadings])

  // Auto-refresh when filters change
  useEffect(() => {
    if (filterOrgId !== undefined || filterMonth !== undefined || filterYear !== undefined) {
      fetchReadings()
    }
  }, [filterOrgId, filterMonth, filterYear, fetchReadings])

  const handleCellValueChanged = useCallback(async (params: any) => {
    const reading = params.data as Reading
    const changedField = params.colDef?.field as string | undefined

    // If it's a new row in the modal, calculate all values and update display
    if (reading._isNew && showAddModal) {
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
      queueMicrotask(() => {
        try {
          if (!api?.isDestroyed?.()) {
            api.refreshCells({
              rowNodes: [node],
              columns: ['usage', 'cleanAmount', 'dirtyAmount', 'subtotal', 'vat', 'total'],
            })
          }
        } catch {
          /* ignore */
        }
      })

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

  const handleDeleteReading = (id: string) => {
    setDeleteConfirm({ open: true, id })
  }

  const doDeleteReading = async () => {
    const id = deleteConfirm.id
    if (!id) return
    setDeleteConfirm({ open: false, id: null })
    try {
      const res = await fetchWithAuth(`/api/readings?id=${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Алдаа гарлаа')
      fetchReadings()
    } catch (err: any) {
      alert(err.message || 'Алдаа гарлаа')
    }
  }

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
    year: number,
    months: number[],
    prevReadingsByKey: Record<string, Reading[]>,
    pipesOverride?: PipeFee[],
    currentReadingsByKey?: Record<string, Reading[]>,
  ): Reading[] => {
    const pipes = pipesOverride ?? pipeFees
    const rows: Reading[] = []
    for (const org of orgList) {
      const meter = metersList.find((m) => m.organizationId === org.id)
      for (const month of months) {
        const currentKey = `${year}-${month}`
        const currentList = currentReadingsByKey?.[currentKey] ?? []
        const existingForMeter = meter ? currentList.find((r) => r.meterId === meter.id) : undefined
        if (existingForMeter) {
          rows.push({ ...existingForMeter, _isNew: false })
          continue
        }
        const prevMonth = month === 1 ? 12 : month - 1
        const prevYear = month === 1 ? year - 1 : year
        const key = `${prevYear}-${prevMonth}`
        const prevList = prevReadingsByKey[key] ?? []
        const prevForMeter = meter ? prevList.find((r) => r.meterId === meter.id) : undefined
        const startValue = prevForMeter != null ? (prevForMeter.endValue ?? 0) : 0
        rows.push(buildOneRow(org, meter, month, year, startValue, pipes))
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

      const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1
      const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear
      const [prevRes, currentRes] = await Promise.all([
        fetchWithAuth(`/api/readings?month=${prevMonth}&year=${prevYear}`),
        fetchWithAuth(`/api/readings?month=${currentMonth}&year=${currentYear}`),
      ])
      const prevReadingsData = prevRes.ok ? await prevRes.json() : []
      const prevReadings: Reading[] = Array.isArray(prevReadingsData) ? prevReadingsData : []
      const currentReadingsData = currentRes.ok ? await currentRes.json() : []
      const currentReadings: Reading[] = Array.isArray(currentReadingsData) ? currentReadingsData : []
      setLatestMeterReadings(prevReadings)
      const prevReadingsByKey: Record<string, Reading[]> = {
        [`${prevYear}-${prevMonth}`]: prevReadings,
      }
      const currentReadingsByKey: Record<string, Reading[]> = {
        [`${currentYear}-${currentMonth}`]: currentReadings,
      }
      const rows = buildRowsForYearAndMonths(orgList, metersList, currentYear, [currentMonth], prevReadingsByKey, pipes, currentReadingsByKey)
      setNewReadings(rows)
    } catch (error) {
      setLatestMeterReadings([])
      setNewReadings([])
    } finally {
      setLoading(false)
    }
  }

  const handleAddModalApplyMonths = useCallback(async (yearOverride?: number, monthOverride?: number) => {
    const y = yearOverride ?? addModalYear
    const m = monthOverride ?? addModalMonth
    const months = [m]
    setLoading(true)
    setMessage(null)
    try {
      const orgList = organizations.length ? organizations : await fetchWithAuth('/api/organizations?customersOnly=1').then(r => r.ok ? r.json() : []).catch(() => [])
      const metersList = allMeters.length ? allMeters : await fetchWithAuth('/api/meters').then(r => r.ok ? r.json() : []).catch(() => [])
      if (!Array.isArray(orgList)) setNewReadings([])
      else {
        // Өмнөх сар дээр модал дотор оруулсан (хадгалаагүй) эцсийн заалтыг энэ удаагийн сарны эхний заалт болгохын тулд override хийнэ.
        // Жишээ: 3-р сарын эцсийн заалтыг бичээд (хадгалахгүй) 4-р сар руу шилжихэд 4-р сарын start/end автоматаар 3-р сарын end болно.
        const prevMonth = m === 1 ? 12 : m - 1
        const prevYear = m === 1 ? y - 1 : y
        const prevKey = `${prevYear}-${prevMonth}`
        const inModalOverrides: Map<string, number> = new Map()
        for (const r of newReadings) {
          if (!r._isNew || !r.meterId) continue
          if (r.month === prevMonth && r.year === prevYear) {
            // start/end дээр нэг утга тавьсан байгаа ч энд хамгийн түрүүнд хэрэглэгч бичсэн endValue-г авч хэрэглэнэ.
            inModalOverrides.set(r.meterId, r.endValue ?? r.startValue ?? 0)
          }
        }

        const needPrevKeys: { year: number; month: number }[] = []
        for (const month of months) {
          const prevMonth = month === 1 ? 12 : month - 1
          const prevYear = month === 1 ? y - 1 : y
          needPrevKeys.push({ year: prevYear, month: prevMonth })
        }
        const uniq = needPrevKeys.filter((a, i) => needPrevKeys.findIndex(b => b.year === a.year && b.month === a.month) === i)
        const prevReadingsByKey: Record<string, Reading[]> = {}
        await Promise.all(uniq.map(async ({ year: py, month: pm }) => {
          const res = await fetchWithAuth(`/api/readings?month=${pm}&year=${py}`)
          const data = res.ok ? await res.json() : []
          prevReadingsByKey[`${py}-${pm}`] = Array.isArray(data) ? data : []
        }))

        // API-аас ирсэн previous сарын жагсаалт дээр модал дотор бичсэн endValue-г override хийнэ.
        if (inModalOverrides.size > 0) {
          const prevList = prevReadingsByKey[prevKey] ? [...prevReadingsByKey[prevKey]] : []
          for (const [meterId, endValue] of inModalOverrides) {
            const idx = prevList.findIndex((x) => x.meterId === meterId)
            if (idx >= 0) {
              prevList[idx] = { ...prevList[idx], endValue }
            } else {
              prevList.push({
                _isNew: false,
                meterId,
                month: prevMonth,
                year: prevYear,
                startValue: endValue,
                endValue,
              } as Reading)
            }
          }
          prevReadingsByKey[prevKey] = prevList
        }

        const currentReadingsByKey: Record<string, Reading[]> = {}
        await Promise.all(months.map(async (month) => {
          const res = await fetchWithAuth(`/api/readings?month=${month}&year=${y}`)
          const data = res.ok ? await res.json() : []
          currentReadingsByKey[`${y}-${month}`] = Array.isArray(data) ? data : []
        }))
        const rows = buildRowsForYearAndMonths(orgList, metersList, y, months, prevReadingsByKey, undefined, currentReadingsByKey)
        setNewReadings(rows)
      }
    } catch (e) {
      setNewReadings([])
    } finally {
      setLoading(false)
    }
  }, [addModalYear, addModalMonth, organizations, allMeters, buildRowsForYearAndMonths, newReadings])

  const handleCloseAddModal = () => {
    setShowAddModal(false)
    setNewReadings([])
    setMessage(null)
  }

  const handleSaveNewReadings = async () => {
    const rowsToSave = newReadings.filter((r) => r._isNew && r.meterId)

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
      setMessage({ type: 'error', text: 'Хадгалах заалт олдсонгүй. Тоолуур сонгосон мөрөнд эцсийн заалт оруулж хадгална уу.' })
      setTimeout(() => setMessage(null), 3000)
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      for (const reading of rowsToSave) {
        const meterId = reading.meterId!
        const res = await fetchWithAuth('/api/readings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meterId,
            month: reading.month,
            year: reading.year,
            startValue: reading.startValue,
            endValue: reading.endValue,
            baseClean: reading.baseClean || 0,
            baseDirty: reading.baseDirty || 0,
            cleanPerM3: reading.cleanPerM3 || 0,
            dirtyPerM3: reading.dirtyPerM3 || 0,
          }),
        })

        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || 'Алдаа гарлаа')
        }
      }

      setMessage({ type: 'success', text: 'Амжилттай хадгаллаа' })
      setTimeout(() => {
        handleCloseAddModal()
        fetchReadings()
        setMessage(null)
      }, 1500)
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
          onBlur={() => stopEditing()}
          style={{
            width: '100%',
            height: '100%',
            border: '1px solid #ccc',
            padding: '4px',
            fontSize: '14px',
            backgroundColor: 'white',
          }}
          onClick={(e) => e.stopPropagation()}
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
      editable: (params: any) => {
        // Only allow editing for new rows
        return params.data?._isNew === true
      },
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
      onCellClicked: (params: any) => {
        // Only allow editing new rows
        if (params.data?._isNew === true && params.colDef.field === 'meterId') {
          params.api.startEditingCell({
            rowIndex: params.rowIndex,
            colKey: 'meterId',
          })
        }
      },
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
      editable: true,
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
      editable: true,
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
      editable: true,
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
      editable: true,
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
    {
      headerName: 'Үйлдэл',
      width: 100,
      editable: false,
      cellRenderer: (params: any) => {
        if (params.data?._isNew) {
          return (
            <button
              type="button"
              onClick={() => {
                if (showAddModal) {
                  setNewReadings(prev => prev.filter(r => r !== params.data))
                } else {
                  setReadings(prev => prev.filter(r => r !== params.data))
                }
              }}
              className="text-gray-600 hover:text-gray-900 p-1 rounded hover:bg-gray-50 transition-colors"
              title="Цуцлах"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          )
        }
        return (
          <button
            type="button"
            onClick={() => handleDeleteReading(params.data.id)}
            className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50 transition-colors"
            title="Устгах"
          >
            <TrashIcon className="h-5 w-5" />
          </button>
        )
      },
    },
  ], [allMeters, organizations, MeterCellEditor, showAddModal, numberColStyle])

  const pinnedBottomRowData = useMemo(() => {
    const sum = (field: keyof Reading) =>
      readings.reduce((acc, row) => acc + (Number(row[field] ?? 0) || 0), 0)
    return [
      {
        meterId: '',
        organization: { name: 'Хөл дүн', id: 'footer', code: null },
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
      !['Б/Суурь хураамж', 'Ц/Суурь хураамж', 'Бохир', 'Цэвэр', 'Нийт', 'НӨАТ', 'Үйлдэл'].includes(
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
                      rowData={newReadings}
                      columnDefs={modalColumnDefs}
                      getRowId={(params: any) =>
                        params.data?.id ?? `new-${params.data?.organizationId}-${params.data?.year}-${params.data?.month}`
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
                    disabled={
                      loading ||
                      newReadings.filter((r) => r._isNew && r.meterId).length === 0
                    }
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
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Хэрэглэгч
                </label>
                <select
                  value={filterOrgId}
                  onChange={(e) => setFilterOrgId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">Бүгд</option>
                  {organizations.map(org => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Сар
                </label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={filterMonth}
                  onChange={(e) => setFilterMonth(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Он
                </label>
                <input
                  type="number"
                  value={filterYear}
                  onChange={(e) => setFilterYear(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  placeholder="0"
                />
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
      <ConfirmModal
        open={deleteConfirm.open}
        title="Заалт устгах"
        message="Та энэ заалтыг устгахдаа итгэлтэй байна уу?"
        onConfirm={doDeleteReading}
        onCancel={() => setDeleteConfirm({ open: false, id: null })}
      />
    </div>
  )
}

