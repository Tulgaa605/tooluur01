'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { ColDef, ModuleRegistry, AllCommunityModule, ICellEditorParams } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { TrashIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline'

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule])

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
  year: number
  month: number
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
  const [filterMonth, setFilterMonth] = useState<number | ''>('')
  const [filterYear, setFilterYear] = useState<number | ''>('')
  const [filterOrgId, setFilterOrgId] = useState<string>('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [latestMeterReadings, setLatestMeterReadings] = useState<Reading[]>([])
  const [newReadings, setNewReadings] = useState<Reading[]>([])
  const gridRef = useRef<AgGridReact>(null)
  const modalGridRef = useRef<AgGridReact>(null)

  useEffect(() => {
    fetch('/api/organizations')
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
    fetch('/api/tariffs?includeCategory=1')
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
    fetch('/api/pipe-fees')
      .then(res => (res.ok ? res.json() : []))
      .then(data => (Array.isArray(data) ? setPipeFees(data) : setPipeFees([])))
      .catch(() => setPipeFees([]))
  }, [])

  useEffect(() => {
    // Load all meters for dropdown
    fetch('/api/meters')
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

  const fetchReadings = useCallback(async () => {
    setReadingsLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterMonth) params.append('month', filterMonth.toString())
      if (filterYear) params.append('year', filterYear.toString())
      if (filterOrgId) params.append('organizationId', filterOrgId)

      const res = await fetch(`/api/readings?${params.toString()}`)
      const data = await res.json()

      if (res.ok && Array.isArray(data)) {
        console.log('Readings data:', data)
        setReadings(data)
      } else {
        console.error('Error fetching readings:', data)
        setReadings([])
      }
    } catch (error) {
      console.error('Error fetching readings:', error)
      setReadings([])
    } finally {
      setReadingsLoading(false)
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
    
    // If it's a new row in the modal, calculate all values and update display
    if (reading._isNew && showAddModal) {
      // Auto-fill start value from previous month if not set
      if (reading.startValue === 0 && reading.meterId && reading.month && reading.year) {
        try {
          const res = await fetch(`/api/readings/previous?meterId=${reading.meterId}&month=${reading.month}&year=${reading.year}`)
          if (res.ok) {
            const data = await res.json()
            if (data && !data.error && typeof data.endValue === 'number') {
              reading.startValue = data.endValue
              params.api.refreshCells({ rowNodes: [params.node], columns: ['startValue'] })
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
      
      // Refresh all calculated columns in the grid
      params.api.refreshCells({ 
        rowNodes: [params.node], 
        columns: ['usage', 'cleanAmount', 'dirtyAmount', 'subtotal', 'vat', 'total'] 
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

      // Auto-fill start value from previous month if not set
      if (reading.startValue === 0 && reading.meterId && reading.month && reading.year) {
        try {
          const res = await fetch(`/api/readings/previous?meterId=${reading.meterId}&month=${reading.month}&year=${reading.year}`)
          if (res.ok) {
            const data = await res.json()
            if (data && !data.error && typeof data.endValue === 'number') {
              reading.startValue = data.endValue
              params.api.refreshCells({ rowNodes: [params.node], columns: ['startValue'] })
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
        const res = await fetch(`/api/readings?id=${reading.id}`, {
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
        fetchReadings()
      } catch (err: any) {
        setMessage({ type: 'error', text: err.message || 'Алдаа гарлаа' })
        setTimeout(() => setMessage(null), 3000)
      }
    }
  }, [fetchReadings, showAddModal])

  const handleDeleteReading = async (id: string) => {
    if (!confirm('Та энэ заалтыг устгахдаа итгэлтэй байна уу?')) {
      return
    }

    try {
      const res = await fetch(`/api/readings?id=${id}`, {
        method: 'DELETE',
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Алдаа гарлаа')

      fetchReadings()
    } catch (err: any) {
      alert(err.message || 'Алдаа гарлаа')
    }
  }

  const handleOpenAddModal = async () => {
    setShowAddModal(true)
    setMessage(null)
    setLoading(true)
    setNewReadings([])
    try {
      // Хамгийн сүүлийн өгөгдөл авахын өмнө байгууллага, тоолуурын жагсаалтыг шинэчилнэ
      const [orgRes, meterRes, readingsRes, pipeRes] = await Promise.all([
        fetch('/api/organizations'),
        fetch('/api/meters'),
        fetch('/api/readings'),
        fetch('/api/pipe-fees'),
      ])

      const orgData = await orgRes.json()
      if (orgRes.ok && Array.isArray(orgData)) {
        setOrganizations(orgData)
      }

      const meterData = await meterRes.json()
      if (meterRes.ok && Array.isArray(meterData)) {
        setAllMeters(meterData)
      }

      const readingsData = await readingsRes.json()

      let latest: Reading[] = []
      if (readingsRes.ok && Array.isArray(readingsData)) {
        latest = readingsData
        setLatestMeterReadings(readingsData)
      } else {
        setLatestMeterReadings([])
      }

      const orgList: Organization[] = orgRes.ok && Array.isArray(orgData) ? orgData : organizations
      const metersList: Meter[] = meterRes.ok && Array.isArray(meterData) ? meterData : allMeters
      const pipeData = await pipeRes.json().catch(() => [])
      const pipes: PipeFee[] = Array.isArray(pipeData) ? pipeData : pipeFees

      // Хэрэглэгч (байгууллага) бүрээр 1 мөр үүсгэнэ.
      // Хэрэв тоолуур байвал эхний тоолуурыг автоматаар сонгоно.
      let rows: Reading[] = orgList.map((org) => {
        const meter = metersList.find((m) => m.organizationId === org.id)
        const latestForMeter = meter ? latest.find((r) => r.meterId === meter.id) : undefined

        let month = new Date().getMonth() + 1
        let year = new Date().getFullYear()
        let startValue = 0
        let baseClean = 0
        let baseDirty = 0
        let cleanPerM3 = 0
        let dirtyPerM3 = 0

        if (latestForMeter) {
          const lastMonth = latestForMeter.month
          const lastYear = latestForMeter.year
          if (lastMonth && lastYear) {
            if (lastMonth === 12) {
              month = 1
              year = lastYear + 1
            } else {
              month = lastMonth + 1
              year = lastYear
            }
          }
          // Эхний заалт = хамгийн сүүлийн заалтын эцсийн заалт
          startValue = latestForMeter.endValue ?? 0
        }

        // Суурь хураамж нь шугамын хоолойгоор (PipeFee) тодорхойлогдоно. Хэрэглэгч "Шугамын хоолой 50" гэж
        // бүртгэсэн бол 50мм-ийн PipeFee-аас суурь авна. М³-ийн үнэ (cleanPerM3, dirtyPerM3) нь тарифаас ирнэ.
        const pipeDiam = org.connectionNumber ? parseInt(String(org.connectionNumber).trim(), 10) : NaN
        const pipeFee = !Number.isNaN(pipeDiam) && pipes.length > 0
          ? pipes.find((p) => p.diameterMm === pipeDiam)
          : undefined
        if (pipeFee) {
          baseClean = pipeFee.baseCleanFee ?? 0
          baseDirty = pipeFee.baseDirtyFee ?? 0
        }

        // М³-ийн үнэ болон тарифын суурь (шугам олдоогүй тохиолдолд) нь (year, month)-ын тарифаас ирнэ.
        let tariffForPeriod = tariffs.find(
          (t) =>
            t.organizationId === org.id &&
            t.year === year &&
            t.month === month
        )
        if (!tariffForPeriod && org?.category) {
          const cat = categoryTariffs.find(
            (t) => t.category === org.category && t.year === year && t.month === month
          )
          if (cat) {
            tariffForPeriod = {
              id: cat.id,
              organizationId: org.id,
              year: cat.year,
              month: cat.month,
              baseCleanFee: cat.baseCleanFee,
              baseDirtyFee: cat.baseDirtyFee,
              cleanPerM3: cat.cleanPerM3,
              dirtyPerM3: cat.dirtyPerM3,
              organization: { id: org.id, category: org.category },
            }
          } else {
            tariffForPeriod = tariffs.find(
              (t) =>
                t.organization?.category === org.category &&
                t.year === year &&
                t.month === month
            )
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
      })

      setNewReadings(rows)
    } catch (error) {
      setLatestMeterReadings([])
      setNewReadings([])
    } finally {
      setLoading(false)
    }
  }

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
        const res = await fetch('/api/readings', {
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

  // Meter dropdown cell editor component
  const MeterCellEditor = useMemo(() => {
    return (props: ICellEditorParams) => {
      const [value, setValue] = useState(props.value || '')

      const stopEditing = () => {
        props.stopEditing()
      }

      const handleChange = (newValue: string) => {
        setValue(newValue)
        const meter = allMeters.find(m => m.id === newValue)
        if (meter) {
          props.data.meterId = newValue
          props.data.meter = { meterNumber: meter.meterNumber }
          // Find organization for this meter
          const org = organizations.find(o => o.id === meter.organizationId)
          if (org) {
            props.data.organizationId = org.id
            props.data.organization = { name: org.name, id: org.id, code: null }
          }
          props.api.refreshCells({ rowNodes: [props.node!], columns: ['organization'] })
        }
        stopEditing()
      }

      // Return select element that AG Grid will render in the cell
      // This should appear inline in the cell, not as a popup
      return (
        <select
          autoFocus
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={stopEditing}
          style={{ 
            width: '100%', 
            height: '100%', 
            border: '1px solid #ccc', 
            padding: '4px',
            fontSize: '14px',
            backgroundColor: 'white'
          }}
          onClick={(e) => {
            // Prevent event bubbling that might cause issues
            e.stopPropagation()
          }}
        >
          <option value="">Сонгох</option>
          {allMeters.map(meter => (
            <option key={meter.id} value={meter.id}>{meter.meterNumber}</option>
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
      flex: 1,
      minWidth: 120,
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
      field: 'startValue',
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
      headerName: 'Эцсийн заалт',
      width: 130,
      field: 'endValue',
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
      headerName: 'Зөрүү',
      width: 100,
      field: 'usage',
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
      valueFormatter: (params: any) => {
        if (params.value == null) return '0.00'
        return Number(params.value).toFixed(2)
      },
    },
    {
      headerName: 'Цэвэр',
      width: 120,
      field: 'cleanAmount',
      valueFormatter: (params: any) => {
        if (params.value == null) return '0.00'
        return Number(params.value).toFixed(2)
      },
    },
    {
      headerName: 'Нийт',
      width: 120,
      field: 'subtotal',
      valueFormatter: (params: any) => {
        if (params.value == null) return '0.00'
        return Number(params.value).toFixed(2)
      },
    },
    {
      headerName: 'НӨАТ',
      width: 120,
      field: 'vat',
      valueFormatter: (params: any) => {
        if (params.value == null) return '0.00'
        return Number(params.value).toFixed(2)
      },
    },
    {
      headerName: 'Нийт',
      width: 120,
      field: 'total',
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
  ], [allMeters, organizations, MeterCellEditor, showAddModal])

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
          onClick={handleOpenAddModal}
          className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 flex items-center gap-2"
        >
          <PlusIcon className="h-5 w-5" />
          Шинэ заалт нэмэх
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
                  <h3 className="text-2xl font-semibold text-gray-900">Шинэ заалт оруулах</h3>
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

                <p className="mb-4 text-sm text-gray-600 bg-blue-50 border border-blue-200 rounded-md px-4 py-3">
                  <strong>Мэдэгдэл:</strong> Эхний заалт нь өмнөх сарын эцсийн заалтаас автоматаар дутуулагдана. Эцсийн заалтын баганад тоолуурын одоогийн уншилтыг оруулна уу. Тоолуургүй байгууллагад эхлээд «Тоолуурууд» хуудсаас тоолуур нэмнэ үү.
                </p>

                <div className="flex-1 overflow-x-auto overflow-y-hidden min-h-0 w-full">
                  <div className="ag-theme-alpine w-full" style={{ height: '500px', width: '100%' }}>
                    <AgGridReact
                      ref={modalGridRef}
                      rowData={newReadings}
                      columnDefs={modalColumnDefs}
                      defaultColDef={{
                        sortable: true,
                        filter: false,
                        resizable: true,
                      }}
                      onGridReady={(e) => e.api.sizeColumnsToFit()}
                      onCellValueChanged={handleCellValueChanged}
                      pagination={false}
                      domLayout="normal"
                      stopEditingWhenCellsLoseFocus={true}
                      suppressClickEdit={false}
                      enterNavigatesVertically={true}
                      enterNavigatesVerticallyAfterEdit={true}
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
                  Байгууллага
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
                  min="1"
                  max="12"
                  value={filterMonth}
                  onChange={(e) => setFilterMonth(e.target.value ? parseInt(e.target.value) : '')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Бүгд"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Он
                </label>
                <input
                  type="number"
                  value={filterYear}
                  onChange={(e) => setFilterYear(e.target.value ? parseInt(e.target.value) : '')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Бүгд"
                />
              </div>

              <div className="flex items-end">
                <button
                  onClick={fetchReadings}
                  className="w-full px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  Шүүх
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto w-full">
          <div className="ag-theme-alpine w-full" style={{ height: '600px', width: '100%' }}>
            {readingsLoading ? (
              <div className="flex items-center justify-center h-full text-gray-600">
                Ачааллаж байна...
              </div>
            ) : (
              <AgGridReact
                ref={gridRef}
                rowData={readings}
                columnDefs={columnDefs}
                defaultColDef={{
                  sortable: true,
                  filter: true,
                  resizable: true,
                }}
                onGridReady={(e) => e.api.sizeColumnsToFit()}
                onCellValueChanged={handleCellValueChanged}
                pagination={true}
                paginationPageSize={20}
                domLayout="normal"
                stopEditingWhenCellsLoseFocus={true}
                suppressClickEdit={false}
                enterNavigatesVertically={true}
                enterNavigatesVerticallyAfterEdit={true}
                overlayNoRowsTemplate={
                  '<div style="padding: 20px; text-align: center;"><p style="font-size: 16px; margin-bottom: 8px;">Заалтын мэдээлэл олдсонгүй</p><p style="font-size: 14px; color: #666;">Шүүлт өөрчлөх эсвэл шинэ заалт оруулна уу</p></div>'
                }
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

