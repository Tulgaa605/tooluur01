'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import {
  ColDef,
  ModuleRegistry,
  AllCommunityModule,
  type CellValueChangedEvent,
} from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { DocumentArrowUpIcon, PlusIcon, ClipboardIcon } from '@heroicons/react/24/outline'
import { fetchWithAuth } from '@/lib/api'
import {
  BILLING_EXCEL_REQUIRED_HEADERS,
  billingGridRowsToImportPayload,
  billingImportRowsToGridRows,
  createEmptyBillingGridRows,
  parseBillingExportExcel,
  parseBillingExportFromClipboard,
  type BillingExcelGridRow,
} from '@/lib/billing-export-excel'
import { AG_GRID_LOCALE_MN } from '@/lib/ag-grid-locale-mn'

type MeterLookupRow = {
  meterNumber: string
  organizationName: string
  organizationCode: string
  customerPhone: string
}

ModuleRegistry.registerModules([AllCommunityModule])

const GRID_HEIGHT = 'min(75vh, calc(100vh - 11rem))'

type BankImportModalProps = {
  year: string
  month: string
  saving: boolean
  onClose: () => void
  onSave: (rows: BillingExcelGridRow[]) => Promise<void>
}

export default function BankImportModal({ year, month, saving, onClose, onSave }: BankImportModalProps) {
  const gridRef = useRef<AgGridReact>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<BillingExcelGridRow[]>(() => createEmptyBillingGridRows(8))
  const [pasteHint, setPasteHint] = useState<string | null>(null)
  const [gridKey, setGridKey] = useState(0)
  const [pasteMenu, setPasteMenu] = useState<{ x: number; y: number } | null>(null)
  const pasteMenuRef = useRef<HTMLDivElement | null>(null)
  const meterLookupRef = useRef<Map<string, MeterLookupRow>>(new Map())
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  )

  useEffect(() => {
    setRows(createEmptyBillingGridRows(8))
    setPasteHint(null)
    setGridKey((k) => k + 1)
  }, [])

  // Тоолуурын lookup нэг удаа татна
  useEffect(() => {
    let cancelled = false
    setLookupStatus('loading')
    fetchWithAuth('/api/meters/lookup')
      .then(async (res) => {
        if (!res.ok) throw new Error(`lookup ${res.status}`)
        return res.json()
      })
      .then((data: unknown) => {
        if (cancelled) return
        const map = new Map<string, MeterLookupRow>()
        if (Array.isArray(data)) {
          for (const r of data as MeterLookupRow[]) {
            const key = String(r?.meterNumber ?? '').trim().toLowerCase()
            if (key) map.set(key, r)
          }
        }
        meterLookupRef.current = map
        setLookupStatus(map.size > 0 ? 'ready' : 'error')
      })
      .catch(() => {
        if (cancelled) return
        meterLookupRef.current = new Map()
        setLookupStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!pasteMenu) return
    const onMouseDown = (e: MouseEvent) => {
      const el = pasteMenuRef.current
      if (!el) return
      if (e.target instanceof Node && el.contains(e.target)) return
      setPasteMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPasteMenu(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [pasteMenu])

  const columnDefs = useMemo<ColDef<BillingExcelGridRow>[]>(
    () => [
      { headerName: 'Он', field: 'year', flex: 1, minWidth: 80 },
      { headerName: 'Сар', field: 'month', flex: 1, minWidth: 80 },
      { headerName: 'Байгууллага', field: 'organizationName', flex: 1, minWidth: 140 },
      { headerName: 'Тоолуур', field: 'meterNumber', flex: 1, minWidth: 120 },
      { headerName: 'Харилцагчийн утас', field: 'customerPhone', flex: 1, minWidth: 140 },
      {
        headerName: 'Төлөгдсөн (₮)',
        field: 'paidAmount',
        flex: 1,
        minWidth: 140,
        cellClass: 'ag-right-aligned-cell',
      },
    ],
    []
  )

  const findMeterLookup = useCallback((meterRaw: string): MeterLookupRow | null => {
    const map = meterLookupRef.current
    if (!map || map.size === 0) return null
    const key = String(meterRaw ?? '').trim().toLowerCase()
    if (!key) return null
    if (map.has(key)) return map.get(key) ?? null
    // Хэсэгчлэн тохирох
    for (const [k, v] of map) {
      if (k.includes(key) || key.includes(k)) return v
    }
    return null
  }, [])

  const handleCellValueChanged = useCallback(
    (e: CellValueChangedEvent<BillingExcelGridRow>) => {
      const field = e.colDef?.field as keyof BillingExcelGridRow | undefined
      const id = e.data?.id
      if (!id || !field || field === 'id') return

      const newVal = e.newValue != null ? String(e.newValue).trim() : ''

      const updates: Partial<BillingExcelGridRow> = { [field]: newVal }
      if (field === 'meterNumber' && newVal) {
        const lookup = findMeterLookup(newVal)
        if (lookup) {
          updates.organizationName = lookup.organizationName
          updates.customerPhone = lookup.customerPhone
          if (!e.data?.year || !String(e.data.year).trim()) updates.year = year || ''
          if (!e.data?.month || !String(e.data.month).trim()) updates.month = month || ''
        } else if (lookupStatus === 'ready') {
          setPasteHint(`«${newVal}» тоолуур олдсонгүй. Үндсэн жагсаалтад бүртгэлтэй байх ёстой.`)
        } else if (lookupStatus === 'error') {
          setPasteHint('Тоолуурын жагсаалт татагдаагүй. Хуудсыг шинэчилнэ үү.')
        }
      }

      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)))

      // AG Grid дараах render-д шинэ утгуудыг харуулах эсэхийг баталгаажуулах
      requestAnimationFrame(() => {
        const api = gridRef.current?.api
        if (api && e.node) api.refreshCells({ force: true, rowNodes: [e.node] })
      })
    },
    [findMeterLookup, lookupStatus, year, month]
  )

  const applyImportedRows = useCallback((parsed: Omit<BillingExcelGridRow, 'id'>[], source: 'paste' | 'file') => {
    if (parsed.length === 0) {
      setPasteHint(
        source === 'file'
          ? `Зөвхөн төлбөрийн Excel (толгой: ${BILLING_EXCEL_REQUIRED_HEADERS.slice(0, 4).join(', ')} …) оруулна уу.`
          : 'Толгой мөр буруу эсвэл өгөгдөл хоосон. Төлбөр хуудаснаас Excel хуулна уу.'
      )
      return
    }
    const stamp = Date.now()
    setRows(
      parsed.map((r, i) => ({
        id: `${source}-${i}-${stamp}`,
        year: String(r.year ?? ''),
        month: String(r.month ?? ''),
        organizationName: String(r.organizationName ?? ''),
        meterNumber: String(r.meterNumber ?? ''),
        customerPhone: String(r.customerPhone ?? ''),
        usage: String(r.usage ?? ''),
        total: String(r.total ?? ''),
        paidAmount: String(r.paidAmount ?? ''),
        remaining: String(r.remaining ?? ''),
      }))
    )
  }, [])

  const applyPasteText = useCallback(
    (text: string) => {
      const result = parseBillingExportFromClipboard(text)
      if (result.error) {
        setPasteHint(result.error)
        return
      }
      applyImportedRows(billingImportRowsToGridRows(result.rows), 'paste')
    },
    [applyImportedRows]
  )

  const handleWrapperPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const text = e.clipboardData.getData('text/plain')
      if (!text?.trim()) return
      if (!text.includes('\t') && !text.includes('\n') && text.length < 80) return
      e.preventDefault()
      applyPasteText(text)
    },
    [applyPasteText]
  )

  const handleClipboardPaste = useCallback(async () => {
    setPasteMenu(null)
    try {
      if (!navigator.clipboard?.readText) {
        setPasteHint('Browser-ийн clipboard зөвшөөрөл байхгүй. Ctrl+V дарна уу.')
        return
      }
      const text = await navigator.clipboard.readText()
      if (!text?.trim()) {
        setPasteHint('Clipboard хоосон байна. Excel-ээс хуулсан өгөгдөл байх ёстой.')
        return
      }
      applyPasteText(text)
    } catch {
      setPasteHint('Clipboard уншиж чадсангүй. Ctrl+V дарж шууд буулгана уу.')
    }
  }, [applyPasteText])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setPasteMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const addRow = () => {
    setRows((prev) => [
      {
        id: `new-${Date.now()}`,
        year: year || '',
        month: month || '',
        organizationName: '',
        meterNumber: '',
        customerPhone: '',
        usage: '',
        total: '',
        paidAmount: '',
        remaining: '',
      },
      ...prev,
    ])
  }

  const handleFile = async (file: File) => {
    const buf = await file.arrayBuffer()
    const result = parseBillingExportExcel(buf)
    if (result.error) {
      setPasteHint(result.error)
      return
    }
    applyImportedRows(billingImportRowsToGridRows(result.rows), 'file')
  }

  const handleSave = async () => {
    const payload = billingGridRowsToImportPayload(rows)
    if (payload.length === 0) {
      setPasteHint('Хадгалах мөр алга. Он, сар, байгууллага, тоолуур, төлөгдсөн дүн бөглөнө үү.')
      return
    }
    await onSave(rows)
  }

  return (
    <div
      className="bg-white rounded-lg border border-gray-200 w-full overflow-hidden flex flex-col"
      onPaste={handleWrapperPaste}
      onContextMenu={handleContextMenu}
    >
      {pasteHint && (
        <div className="px-4 pt-3 shrink-0">
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            {pasteHint}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50 shrink-0">
        <button
          type="button"
          onClick={addRow}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
          Мөр нэмэх
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void handleFile(f)
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          <DocumentArrowUpIcon className="h-4 w-4" />
          Excel файл
        </button>
        <span
          className={`ml-auto self-center text-xs ${
            lookupStatus === 'ready'
              ? 'text-green-700'
              : lookupStatus === 'error'
                ? 'text-red-700'
                : 'text-gray-500'
          }`}
        >
          {lookupStatus === 'loading' && 'Тоолуурын жагсаалт татаж байна...'}
          {lookupStatus === 'error' &&
            'Тоолуурын жагсаалт татагдаагүй. Хуудсыг refresh хийнэ үү.'}
        </span>
      </div>

      <div className="p-4 pt-2 flex-1 min-h-0">
        <div className="ag-theme-alpine" style={{ height: GRID_HEIGHT, width: '100%' }}>
          <AgGridReact
            key={gridKey}
            theme="legacy"
            ref={gridRef}
            rowData={rows}
            columnDefs={columnDefs}
            getRowId={(p) => (p.data as BillingExcelGridRow).id}
            defaultColDef={{
              sortable: false,
              filter: false,
              resizable: true,
              editable: !saving,
              lockPinned: false,
            }}
            localeText={AG_GRID_LOCALE_MN}
            onCellValueChanged={handleCellValueChanged}
            singleClickEdit
            stopEditingWhenCellsLoseFocus
            enterNavigatesVertically
            enterNavigatesVerticallyAfterEdit
            domLayout="normal"
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 px-4 py-3 border-t border-gray-200 bg-gray-50 shrink-0">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          Төлбөрийн хүснэгт рүү буцах
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
        >
          {saving ? 'Хадгалж байна...' : 'Хадгалах'}
        </button>
      </div>

      {pasteMenu && (
        <div
          ref={pasteMenuRef}
          style={{
            position: 'fixed',
            top: pasteMenu.y,
            left: pasteMenu.x,
            zIndex: 99999,
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
            padding: 6,
            minWidth: 220,
          }}
        >
          <button
            type="button"
            onClick={handleClipboardPaste}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-50 rounded-md"
          >
            <ClipboardIcon className="h-4 w-4" />
            Excel-ээс буулгах (Paste)
          </button>
        </div>
      )}
    </div>
  )
}
