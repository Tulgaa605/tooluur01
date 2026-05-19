'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { ColDef, ModuleRegistry, AllCommunityModule } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { DocumentArrowUpIcon, PlusIcon } from '@heroicons/react/24/outline'
import {
  bankGridRowsToImportPayload,
  bankStatementParsedToGridRows,
  createEmptyBankGridRows,
  parseClipboardToBankGridRows,
  type BankGridRow,
} from '@/lib/bank-grid-paste'

ModuleRegistry.registerModules([AllCommunityModule])

/** Төлбөрийн хуудсын доод хэсэгт (MonthlyReadingsGrid-тай ижил хүрээ) inline харуулна */
const BANK_GRID_HEIGHT = 'min(75vh, calc(100vh - 11rem))'

type BankImportModalProps = {
  year: string
  month: string
  saving: boolean
  onClose: () => void
  onSave: (rows: BankGridRow[]) => Promise<void>
}

export default function BankImportModal({ year, month, saving, onClose, onSave }: BankImportModalProps) {
  const gridRef = useRef<AgGridReact>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<BankGridRow[]>(() => createEmptyBankGridRows(12))
  const [pasteHint, setPasteHint] = useState<string | null>(null)

  useEffect(() => {
    setRows(createEmptyBankGridRows(12))
    setPasteHint(null)
  }, [])

  const columnDefs = useMemo<ColDef<BankGridRow>[]>(
    () => [
      {
        headerName: '№',
        width: 56,
        editable: false,
        valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1,
      },
      {
        headerName: 'Дүн (₮)',
        field: 'amount',
        width: 120,
        editable: true,
        cellClass: 'ag-right-aligned-cell',
      },
      {
        headerName: 'Гүйлгээний утга',
        field: 'description',
        flex: 1,
        minWidth: 200,
        editable: true,
      },
      {
        headerName: 'Тоолуур',
        field: 'meterNumber',
        width: 120,
        editable: true,
        headerTooltip: 'Тоолуурын дугаараар тааруулах (сонголттой)',
      },
    ],
    []
  )

  const handleCellValueChanged = useCallback((e: { data?: BankGridRow }) => {
    if (!e.data?.id) return
    setRows((prev) => prev.map((r) => (r.id === e.data!.id ? { ...e.data! } : r)))
  }, [])

  const applyImportedRows = useCallback((parsed: Omit<BankGridRow, 'id'>[], source: 'paste' | 'file') => {
    if (parsed.length === 0) {
      setPasteHint(
        source === 'file'
          ? 'Excel-д тохирох мөр олдсонгүй. Банкны хуулгын «Дүн», «Гүйлгээний утга» баганатай эсэхийг шалгана уу.'
          : 'Хуулсан өгөгдөл танигдсангүй. Excel-ээс бүтэн мөрөөр (tab) хуулна уу.'
      )
      return
    }
    const stamp = Date.now()
    setRows(
      parsed.map((r, i) => ({
        ...r,
        id: `${source}-${i}-${stamp}`,
      }))
    )
    setPasteHint(`${parsed.length} мөр нэмэгдлээ. Засвар хийж «Хадгалах» дарна уу.`)
  }, [])

  const applyPasteText = useCallback(
    async (text: string) => {
      const { parseBankStatementRowsFromClipboard } = await import('@/lib/bank-statement-excel')
      const smart = bankStatementParsedToGridRows(parseBankStatementRowsFromClipboard(text))
      if (smart.length > 0) {
        applyImportedRows(smart, 'paste')
        return
      }
      const simple = parseClipboardToBankGridRows(text)
      applyImportedRows(simple, 'paste')
    },
    [applyImportedRows]
  )

  const handleWrapperPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const text = e.clipboardData.getData('text/plain')
      if (!text?.trim()) return
      if (!text.includes('\t') && !text.includes('\n') && text.length < 80) return
      e.preventDefault()
      void applyPasteText(text)
    },
    [applyPasteText]
  )

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        amount: '',
        description: '',
        meterNumber: '',
      },
    ])
  }

  const handleFile = async (file: File) => {
    const { parseBankStatementRowsFromExcel } = await import('@/lib/bank-statement-excel')
    const buf = await file.arrayBuffer()
    const smart = bankStatementParsedToGridRows(parseBankStatementRowsFromExcel(buf))
    if (smart.length > 0) {
      applyImportedRows(smart, 'file')
      return
    }
    const XLSX = await import('xlsx')
    const wb = XLSX.read(buf, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    if (!sheet) {
      setPasteHint('Excel хуудас хоосон байна.')
      return
    }
    const tsv = XLSX.utils.sheet_to_csv(sheet, { FS: '\t' })
    await applyPasteText(tsv)
  }

  const handleSave = async () => {
    const payload = bankGridRowsToImportPayload(rows)
    if (payload.length === 0) {
      setPasteHint('Хадгалах мөр алга. Дүн болон утга (эсвэл тоолуур) бөглөнө үү.')
      return
    }
    await onSave(rows)
  }

  return (
    <div
      className="bg-white rounded-lg border border-gray-200 w-full overflow-hidden flex flex-col"
      onPaste={handleWrapperPaste}
    >
      <div className="px-4 pt-4 pb-2 border-b border-gray-200 shrink-0">
        <h3 className="text-lg font-semibold text-gray-900">Банкны гүйлгээ оруулах</h3>
        <p className="text-sm text-gray-600 mt-1">
          {year}-{String(month).padStart(2, '0')} — Доорх хүснэг нь төлбөрийн үндсэн хүснэгтэй ижил хэлбэртэй; эхлээд
          хоосон, Excel-ээс paste (Ctrl+V) хийж засварлана.
        </p>
        {pasteHint && (
          <p className="mt-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            {pasteHint}
          </p>
        )}
      </div>

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
          accept=".xlsx,.xls,.csv"
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
        <div className="ag-theme-alpine" style={{ height: BANK_GRID_HEIGHT, width: '100%' }}>
          <AgGridReact
            theme="legacy"
            ref={gridRef}
            rowData={rows}
            columnDefs={columnDefs}
            getRowId={(p) => (p.data as BankGridRow).id}
            defaultColDef={{
              sortable: false,
              filter: false,
              resizable: true,
            }}
            onCellValueChanged={handleCellValueChanged}
            singleClickEdit
            stopEditingWhenCellsLoseFocus
            suppressClickEdit={false}
            suppressClipboardPaste
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
