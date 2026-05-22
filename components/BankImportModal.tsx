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
import { DocumentArrowUpIcon, PlusIcon } from '@heroicons/react/24/outline'
import {
  BILLING_EXCEL_REQUIRED_HEADERS,
  billingGridRowsToImportPayload,
  billingImportRowsToGridRows,
  createEmptyBillingGridRows,
  parseBillingExportExcel,
  parseBillingExportFromClipboard,
  type BillingExcelGridRow,
} from '@/lib/billing-export-excel'

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

  useEffect(() => {
    setRows(createEmptyBillingGridRows(8))
    setPasteHint(null)
    setGridKey((k) => k + 1)
  }, [])

  const syncRemaining = (row: BillingExcelGridRow): BillingExcelGridRow => {
    const total = parseFloat(String(row.total ?? '').replace(/,/g, '')) || 0
    const paid = parseFloat(String(row.paidAmount ?? '').replace(/,/g, '')) || 0
    const rem = Math.max(0, Math.round((total - paid) * 100) / 100)
    return { ...row, remaining: Number.isFinite(rem) ? String(rem) : '' }
  }

  const columnDefs = useMemo<ColDef<BillingExcelGridRow>[]>(
    () => [
      { headerName: 'Он', field: 'year', width: 72 },
      { headerName: 'Сар', field: 'month', width: 64 },
      { headerName: 'Байгууллага', field: 'organizationName', flex: 1, minWidth: 120 },
      { headerName: 'Тоолуур', field: 'meterNumber', width: 110 },
      { headerName: 'Харилцагчийн утас', field: 'customerPhone', width: 130 },
      {
        headerName: 'Хэрэглээ (м³)',
        field: 'usage',
        width: 110,
        cellClass: 'ag-right-aligned-cell',
      },
      {
        headerName: 'Төлбөр (₮)',
        field: 'total',
        width: 110,
        cellClass: 'ag-right-aligned-cell',
      },
      {
        headerName: 'Төлөгдсөн (₮)',
        field: 'paidAmount',
        width: 110,
        cellClass: 'ag-right-aligned-cell',
      },
      {
        headerName: 'Үлдэгдэл (₮)',
        field: 'remaining',
        width: 110,
        editable: false,
        cellClass: 'ag-right-aligned-cell ag-cell-readonly',
      },
    ],
    []
  )

  const handleCellValueChanged = useCallback((e: CellValueChangedEvent<BillingExcelGridRow>) => {
    const field = e.colDef?.field as keyof BillingExcelGridRow | undefined
    const id = e.data?.id
    if (!id || !field || field === 'id' || field === 'remaining') return

    const newVal = e.newValue != null ? String(e.newValue) : ''

    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r
        const next = syncRemaining({ ...r, [field]: newVal })
        return next
      })
    )
  }, [])

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
      parsed.map((r, i) =>
        syncRemaining({
          ...r,
          id: `${source}-${i}-${stamp}`,
          year: String(r.year ?? ''),
          month: String(r.month ?? ''),
          organizationName: String(r.organizationName ?? ''),
          meterNumber: String(r.meterNumber ?? ''),
          customerPhone: String(r.customerPhone ?? ''),
          usage: String(r.usage ?? ''),
          total: String(r.total ?? ''),
          paidAmount: String(r.paidAmount ?? ''),
        })
      )
    )
    setGridKey((k) => k + 1)
    setPasteHint(`${parsed.length} мөр нэмэгдлээ. Нүдний дарж засварлана. «Хадгалах» дарна уу.`)
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

  const addRow = () => {
    setRows((prev) => [
      ...prev,
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
    >

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
            }}
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
    </div>
  )
}
