'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { ColDef, ModuleRegistry, AllCommunityModule, ICellEditorParams } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { TrashIcon, PlusIcon } from '@heroicons/react/24/outline'

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule])

interface Organization {
  id: string
  name: string
}

interface Meter {
  id: string
  meterNumber: string
  organizationId: string
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
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [readings, setReadings] = useState<Reading[]>([])
  const [readingsLoading, setReadingsLoading] = useState(false)
  const [filterMonth, setFilterMonth] = useState<number | ''>('')
  const [filterYear, setFilterYear] = useState<number | ''>('')
  const [filterOrgId, setFilterOrgId] = useState<string>('')
  const [showAddModal, setShowAddModal] = useState(false)
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

  const addNewRow = useCallback(() => {
    const newReading: Reading = {
      _isNew: true,
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
      startValue: 0,
      endValue: 0,
      usage: 0,
      baseClean: 0,
      baseDirty: 0,
      cleanAmount: 0,
      dirtyAmount: 0,
      subtotal: 0,
      vat: 0,
      total: 0,
    }
    setNewReadings(prev => [newReading, ...prev])
    
    // Wait for React to update and grid to render
    setTimeout(() => {
      if (modalGridRef.current?.api) {
        // Scroll to top to show the new row
        modalGridRef.current.api.ensureIndexVisible(0, 'top')
        
        // Set focus and start editing
        modalGridRef.current.api.setFocusedCell(0, 'meterId')
        modalGridRef.current.api.startEditingCell({
          rowIndex: 0,
          colKey: 'meterId',
        })
      }
    }, 200)
  }, [])

  const handleOpenAddModal = () => {
    setNewReadings([])
    setShowAddModal(true)
  }

  const handleCloseAddModal = () => {
    setShowAddModal(false)
    setNewReadings([])
    setMessage(null)
  }

  const handleSaveNewReadings = async () => {
    // Save all new readings
    const unsavedReadings = newReadings.filter(r => r._isNew && r.meterId)
    
    if (unsavedReadings.length === 0) {
      setMessage({ type: 'error', text: 'Хадгалах заалт олдсонгүй' })
      setTimeout(() => setMessage(null), 3000)
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      for (const reading of unsavedReadings) {
        const res = await fetch('/api/readings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meterId: reading.meterId,
            month: reading.month,
            year: reading.year,
            startValue: reading.startValue,
            endValue: reading.endValue,
            baseClean: reading.baseClean || 0,
            baseDirty: reading.baseDirty || 0,
            cleanPerM3: 0,
            dirtyPerM3: 0,
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
        if (params.data?._isNew) return 'Шинэ'
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
      width: 200,
      editable: false,
      valueGetter: (params: any) => params.data?.organization?.name || '-',
    },
    {
      headerName: 'Он',
      width: 100,
      field: 'year',
      editable: true,
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 2000,
        max: 2100,
      },
    },
    {
      headerName: 'Сар',
      width: 100,
      field: 'month',
      editable: true,
      cellEditor: 'agNumberCellEditor',
      cellEditorParams: {
        min: 1,
        max: 12,
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
              onClick={() => {
                // Remove from newReadings if in modal, otherwise from readings
                if (showAddModal) {
                  setNewReadings(prev => prev.filter(r => r !== params.data))
                } else {
                  setReadings(prev => prev.filter(r => r !== params.data))
                }
              }}
              className="text-gray-600 hover:text-gray-900 p-1 rounded hover:bg-gray-50 transition-colors"
              title="Цуцлах"
            >
              <span className="text-xs">Цуцлах</span>
            </button>
          )
        }
        return (
          <button
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

      {/* Add New Readings Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            {/* Backdrop */}
            <div
              className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
              onClick={handleCloseAddModal}
            ></div>

            {/* Modal Panel */}
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-6xl sm:w-full max-h-[90vh] flex flex-col">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4 flex flex-col flex-1 overflow-hidden">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-2xl font-semibold text-gray-900">Шинэ заалт оруулах</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={addNewRow}
                      className="px-3 py-1 bg-primary-600 text-white rounded-md hover:bg-primary-700 text-sm flex items-center gap-1"
                    >
                      <PlusIcon className="h-4 w-4" />
                      Мөр нэмэх
                    </button>
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

                {/* Grid in Modal */}
                <div className="flex-1 overflow-hidden">
                  <div className="ag-theme-alpine" style={{ height: '500px', width: '100%' }}>
                    <AgGridReact
                      ref={modalGridRef}
                      rowData={newReadings}
                      columnDefs={columnDefs}
                      defaultColDef={{
                        sortable: true,
                        filter: false,
                        resizable: true,
                      }}
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
                    disabled={loading || newReadings.filter(r => r._isNew && r.meterId).length === 0}
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

        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="ag-theme-alpine" style={{ height: '600px', width: '100%' }}>
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

