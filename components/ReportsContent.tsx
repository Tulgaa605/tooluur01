'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { fetchWithAuth } from '@/lib/api'
import { downloadMonthlyAccountingReport } from '@/lib/download-monthly-accounting-report'
import type { MonthlyAccountingTableView } from '@/lib/monthly-accounting-report-excel'

function formatCell(n: number): string {
  if (!Number.isFinite(n) || n === 0) return ''
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ReportsContent() {
  const [table, setTable] = useState<MonthlyAccountingTableView | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  )
  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth() + 1
  const [exportYear, setExportYear] = useState(String(currentYear))
  const [exportMonth, setExportMonth] = useState(String(currentMonth))

  const loadTable = useCallback(async () => {
    const y = parseInt(exportYear.trim(), 10)
    const m = parseInt(exportMonth.trim(), 10)
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
      setTable(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetchWithAuth(
        `/api/exports/monthly-accounting-report?year=${y}&month=${m}&format=json`
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || res.statusText)
      }
      const data = (await res.json()) as MonthlyAccountingTableView
      setTable(data)
    } catch (e: unknown) {
      setTable(null)
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Тайлан ачаалахад алдаа гарлаа',
      })
      setTimeout(() => setMessage(null), 5000)
    } finally {
      setLoading(false)
    }
  }, [exportYear, exportMonth])

  useEffect(() => {
    void loadTable()
  }, [loadTable])

  const handleExportAccounting = useCallback(async () => {
    const y = parseInt(exportYear.trim(), 10)
    const m = parseInt(exportMonth.trim(), 10)
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
      setMessage({ type: 'error', text: 'Он, сарыг сонгоно уу' })
      setTimeout(() => setMessage(null), 4000)
      return
    }
    setExporting(true)
    setMessage(null)
    try {
      await downloadMonthlyAccountingReport(y, m)
    } catch (e: unknown) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : 'Тайлан татахад алдаа гарлаа',
      })
      setTimeout(() => setMessage(null), 5000)
    } finally {
      setExporting(false)
    }
  }, [exportYear, exportMonth])

  const yearOptions = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2]

  return (
    <div className="px-4 sm:px-0 space-y-6">
      <h2 className="text-2xl font-semibold text-gray-900">Тайлан</h2>

      {message && (
        <div
          className={`rounded-md px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="bg-white p-4 rounded-lg border border-gray-200">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 max-w-2xl">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Он</label>
            <select
              value={exportYear}
              onChange={(e) => setExportYear(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Сар</label>
            <select
              value={exportMonth}
              onChange={(e) => setExportMonth(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                <option key={m} value={String(m)}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2 flex items-end">
            <button
              type="button"
              onClick={() => void handleExportAccounting()}
              disabled={exporting || loading}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-60"
            >
              <ArrowDownTrayIcon className="h-5 w-5" />
              {exporting ? 'Татаж байна...' : 'Excel татах'}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-600">Ачааллаж байна...</div>
        ) : !table || table.rows.length === 0 ? (
          <div className="p-8 text-center text-gray-600">
            Сонгосон сард тайлангийн мэдээлэл олдсонгүй
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-[11px] font-sans">
              <thead>
                <tr>
                  <th
                    colSpan={table.headers.length}
                    className="border border-gray-300 px-2 py-1 text-center font-bold bg-white"
                  >
                    {table.period}
                  </th>
                </tr>
                <tr className="bg-gray-50">
                  {table.headers.map((h, i) => (
                    <th
                      key={i}
                      className={`border border-gray-300 px-1 py-1 text-center font-bold whitespace-nowrap ${
                        i === 9 ? 'bg-yellow-200' : ''
                      }`}
                    >
                      {h || '\u00a0'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="bg-blue-50 font-bold">
                  <td className="border border-gray-300 px-2 py-1 text-left bg-blue-100">
                    {table.summaryLabel}
                  </td>
                  {table.summaryCells.map((c, i) => (
                    <td
                      key={i}
                      className={`border border-gray-300 px-1 py-1 text-right ${
                        i === 8 ? 'bg-yellow-100' : ''
                      }`}
                    >
                      {formatCell(c)}
                    </td>
                  ))}
                </tr>
                {table.rows.map((row, ri) => (
                  <tr key={ri} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-2 py-1 text-left bg-blue-50 max-w-[220px]">
                      {row.label}
                    </td>
                    {row.cells.map((c, ci) => (
                      <td
                        key={ci}
                        className={`border border-gray-300 px-1 py-1 text-right ${
                          ci === 8 ? 'bg-yellow-50' : ''
                        }`}
                      >
                        {formatCell(c)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-blue-50 font-bold">
                  <td className="border border-gray-300 px-2 py-1 text-left bg-blue-100">
                    {table.footerLabel}
                  </td>
                  {table.footerCells.map((c, i) => (
                    <td
                      key={i}
                      className={`border border-gray-300 px-1 py-1 text-right ${
                        i === 8 ? 'bg-yellow-100' : ''
                      }`}
                    >
                      {formatCell(c)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
