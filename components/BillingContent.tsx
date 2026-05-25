'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { DocumentArrowUpIcon } from '@heroicons/react/24/outline'
import { fetchWithAuth } from '@/lib/api'
import MonthlyReadingsGrid, {
  normalizeApiReadings,
  type BillingGridActions,
  type MonthlyReadingRow,
} from '@/components/MonthlyReadingsGrid'
import BankImportModal from '@/components/BankImportModal'
import {
  billingGridRowsToImportPayload,
  BILLING_EXCEL_HEADER_LABELS,
  type BillingExcelGridRow,
} from '@/lib/billing-export-excel'
import {
  aggregateBillingReadingsByOrganization,
  readingIdsForBillingRow,
} from '@/lib/billing-aggregate'

type BillingReading = MonthlyReadingRow & {
  id: string
  paidAmount?: number | null
  approved: boolean
  smsSentAt?: string | Date | null
  ebarimtStatus?: string | null
  ebarimtBillId?: string | null
  ebarimtLastError?: string | null
  meter: {
    meterNumber: string
    billingMode?: string | null
    waterChargeSplit?: string | null
    billingCategory?: string | null
  }
  organization: {
    id: string
    name: string
    code: string | null
    phone?: string | null
    users?: { phone: string | null }[]
    category?: string
  }
}

interface BillingRow {
  id: string
  /** Нэг тоолуур = 1 id; нэгтгэсэн мөр = олон заалтын id */
  readingIds: string[]
  month: number
  year: number
  usage: number
  total: number
  paidStored: number
  approved: boolean
  ebarimtStatus?: string | null
  ebarimtBillId?: string | null
  ebarimtLastError?: string | null
  meterNumber: string
  customerPhones: string
  organization: {
    id: string
    name: string
    code: string | null
    phone?: string | null
    users?: { phone: string | null }[]
  }
}

function collectCustomerPhones(org: BillingReading['organization']): string {
  const set = new Set<string>()
  const p = org?.phone?.trim()
  if (p) set.add(p)
  org?.users?.forEach((u) => {
    const up = u?.phone?.trim()
    if (up) set.add(up)
  })
  return Array.from(set).join(', ') || '—'
}

function formatMoney(value: unknown): string {
  const n = Number(value ?? 0)
  const safe = Number.isFinite(n) ? n : 0
  return safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const PAY_EPS = 0.009

function roundMoneyLocal(n: number): number {
  return Math.round(n * 100) / 100
}

function effectivePaid(row: Pick<BillingRow, 'paidStored'>): number {
  return roundMoneyLocal(Number(row.paidStored ?? 0) || 0)
}

function remainingBalance(row: Pick<BillingRow, 'paidStored' | 'total'>): number {
  const t = Number(row.total ?? 0) || 0
  return Math.max(0, roundMoneyLocal(t - effectivePaid(row)))
}

function isPaidInFull(row: Pick<BillingRow, 'paidStored' | 'total'>): boolean {
  return remainingBalance(row) <= PAY_EPS
}

function paymentStatusForExport(row: Pick<BillingRow, 'paidStored' | 'total'>): string {
  if (isPaidInFull(row)) return 'Бүрэн төлөгдсөн'
  if (effectivePaid(row) > PAY_EPS) return 'Хэсэгчлэн төлөгдсөн'
  return 'Хүлээгдэж буй'
}

function ebarimtStatusLabel(st: string | null | undefined): string {
  const s = String(st ?? 'PENDING').toUpperCase()
  if (s === 'SENT') return 'Илгээгдсэн'
  if (s === 'FAILED') return 'Алдаатай'
  if (s === 'PARTIAL') return 'Хэсэгчлэн'
  return 'Хүлээгдэж буй'
}

type BillingPaymentTab = 'unpaid' | 'paid'

type BillingImportApplied = {
  readingId: string
  meterNumber?: string
  organizationName?: string
  paidAmount: number
  total: number
  rowIndex: number
}
type BillingImportSkipped = { rowIndex: number; reason: string; description: string }

export default function BillingContent() {
  const [readings, setReadings] = useState<BillingReading[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState<string | null>(null)
  const [sendingAll, setSendingAll] = useState(false)
  const [issuingEbarimt, setIssuingEbarimt] = useState<string | null>(null)
  const [issuingEbarimtAll, setIssuingEbarimtAll] = useState(false)
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()))
  const [filterMonth, setFilterMonth] = useState(String(new Date().getMonth() + 1))
  const [senderPhone, setSenderPhone] = useState('')
  const [senderOptions, setSenderOptions] = useState<string[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [paymentTab, setPaymentTab] = useState<BillingPaymentTab>('unpaid')
  const [bankImportInline, setBankImportInline] = useState(false)
  const [bankImporting, setBankImporting] = useState(false)
  const [bankImportReport, setBankImportReport] = useState<{
    applied: BillingImportApplied[]
    skipped: BillingImportSkipped[]
  } | null>(null)
  const [excelExportMenu, setExcelExportMenu] = useState<{ x: number; y: number } | null>(null)
  const excelExportMenuRef = useRef<HTMLDivElement | null>(null)
  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return [y + 1, y, y - 1, y - 2]
  }, [])

  const displayReadings = useMemo(
    () => aggregateBillingReadingsByOrganization(readings) as BillingReading[],
    [readings]
  )

  const billingRows = useMemo<BillingRow[]>(() => {
    return displayReadings
      .filter((r) => r.id)
      .map((r) => ({
        id: String(r.id),
        readingIds: readingIdsForBillingRow(r),
        month: Number(r.month) || 0,
        year: Number(r.year) || 0,
        usage: Number(r.usage ?? 0) || 0,
        total: Number(r.total ?? 0) || 0,
        paidStored: Number(r.paidAmount ?? 0) || 0,
        approved: !!r.approved,
        ebarimtStatus: r.ebarimtStatus ?? 'PENDING',
        ebarimtBillId: r.ebarimtBillId ?? null,
        ebarimtLastError: r.ebarimtLastError ?? null,
        meterNumber: r.meter?.meterNumber || '-',
        customerPhones: collectCustomerPhones(r.organization as BillingReading['organization']),
        organization: {
          id: (r.organization?.id && String(r.organization.id).trim()) || '',
          name: r.organization?.name || '-',
          code: r.organization?.code || null,
          phone: r.organization?.phone ?? null,
          users: r.organization?.users,
        },
      }))
  }, [displayReadings])

  const tabCounts = useMemo(
    () => ({
      unpaid: billingRows.filter((r) => !isPaidInFull(r)).length,
      paid: billingRows.filter((r) => isPaidInFull(r)).length,
    }),
    [billingRows]
  )

  const filteredBillingRows = useMemo(() => {
    if (paymentTab === 'paid') return billingRows.filter((r) => isPaidInFull(r))
    return billingRows.filter((r) => !isPaidInFull(r))
  }, [billingRows, paymentTab])

  const gridRowData = useMemo(() => {
    const ids = new Set(filteredBillingRows.map((r) => r.id))
    return displayReadings.filter((r) => r.id && ids.has(r.id)) as MonthlyReadingRow[]
  }, [displayReadings, filteredBillingRows])

  const gridEmptyMessage = useMemo(() => {
    if (readings.length === 0) return 'Төлбөрийн мэдээлэл олдсонгүй'
    return paymentTab === 'unpaid' ? 'Төлөөгүй төлбөр байхгүй' : 'Төлсөн төлбөр байхгүй'
  }, [readings.length, paymentTab])

  const reloadReadings = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterYear) params.append('year', filterYear)
      if (filterMonth) params.append('month', filterMonth)
      params.append('limit', '3000')
      params.append('recalculate', '1')
      const res = await fetchWithAuth(`/api/readings?${params.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Алдаа гарлаа')
      }
      const data = await res.json()
      if (data && data.error) setReadings([])
      else if (data && Array.isArray(data)) setReadings(normalizeApiReadings(data) as BillingReading[])
      else setReadings([])
    } catch {
      setReadings([])
    } finally {
      setLoading(false)
    }
  }, [filterYear, filterMonth])

  useEffect(() => {
    reloadReadings()
  }, [reloadReadings])

  useEffect(() => {
    if (!excelExportMenu) return
    const onMouseDown = (e: MouseEvent) => {
      const el = excelExportMenuRef.current
      if (!el) return
      if (e.target instanceof Node && el.contains(e.target)) return
      setExcelExportMenu(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [excelExportMenu])

  useEffect(() => {
    fetchWithAuth('/api/sms/config')
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (data: {
          senders?: string[]
          defaultSender?: string
          httpSmsConfigured?: boolean
        } | null) => {
          if (data?.senders?.length) {
            setSenderOptions(data.senders)
            if (data.defaultSender && data.senders.includes(data.defaultSender)) {
              setSenderPhone(data.defaultSender)
            } else {
              setSenderPhone(data.senders[0])
            }
          } else if (data?.defaultSender) {
            setSenderPhone(data.defaultSender)
          }
        }
      )
      .catch(() => {})
  }, [])

  const handleDownload = useCallback(
    (row: MonthlyReadingRow) => {
      const ids = readingIdsForBillingRow(row)
      const lines =
        ids.length > 1
          ? readings
              .filter((r) => r.id && ids.includes(r.id))
              .map(
                (r) =>
                  `  • Тоолуур ${r.meter?.meterNumber ?? '-'}: хэрэглээ ${(Number(r.usage ?? 0) || 0).toFixed(2)} м³, төлбөр ${formatMoney(r.total ?? 0)} ₮, төлсөн ${formatMoney(r.paidAmount ?? 0)} ₮`
              )
              .join('\n')
          : ''

      const total = Number(row.total ?? 0) || 0
      const paid = effectivePaid({ paidStored: Number(row.paidAmount ?? 0) || 0 })
      const remaining = Math.max(0, roundMoneyLocal(total - paid))
      const invoice = `
Төлбөрийн нэхэмжлэх
Байгууллага: ${row.organization?.name || '-'}${row.organization?.code ? ` (${row.organization.code})` : ''}
Тоолуур: ${row.meter?.meterNumber || '-'}
Сар: ${row.year}-${String(row.month).padStart(2, '0')}
${lines ? `Дэлгэрэнгүй:\n${lines}\n` : ''}
Нийт хэрэглээ: ${(row.usage ?? 0).toFixed(2)} м³
Нийт төлбөр: ${formatMoney(total)} ₮
Төлөгдсөн: ${formatMoney(paid)} ₮
Үлдэгдэл: ${formatMoney(remaining)} ₮
    `
      const blob = new Blob([invoice], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `invoice-${row.year}-${row.month}.txt`
      a.click()
      URL.revokeObjectURL(url)
    },
    [readings]
  )

  const handleSendNotification = useCallback(
    async (row: MonthlyReadingRow) => {
      const ids = readingIdsForBillingRow(row)
      if (ids.length === 0) return
      setSending(row.id ?? ids[0])
      try {
        const res = await fetchWithAuth('/api/notifications/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            readingIds: ids,
            fromPhone: senderPhone.trim(),
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Алдаа гарлаа')

        const org = row.organization as BillingReading['organization']
        const toPhones =
          Array.isArray(data.recipients) && data.recipients.length > 0
            ? data.recipients.map((r: { phone?: string }) => r.phone).filter(Boolean).join(', ')
            : collectCustomerPhones(org)
        const breakdownLine = data.breakdownUrl
          ? `\nТөлбөрийн задаргаа: ${data.breakdownUrl}`
          : ''
        alert(
          `Төлбөрийн мэдээлэл илгээлээ.\n` +
            `Илгээгч: ${data.fromPhone || senderPhone.trim()}\n` +
            `Хүлээн авагч: ${toPhones || 'Утас бүртгэгдээгүй'}` +
            breakdownLine
        )
        // SMS илгээснээр уг заалт түгжигдсэн тул UI-г шинэчилнэ
        await reloadReadings()
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Алдаа гарлаа')
      } finally {
        setSending(null)
      }
    },
    [senderPhone, reloadReadings]
  )

  const handleIssueEbarimt = useCallback(async (row: MonthlyReadingRow) => {
    const ids = readingIdsForBillingRow(row)
    if (ids.length === 0) return
    setIssuingEbarimt(row.id ?? ids[0])
    try {
      let ok = 0
      for (const readingId of ids) {
        const res = await fetchWithAuth('/api/ebarimt/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ readingId }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'e-barimt илгээхэд алдаа гарлаа')
        ok += 1
        setReadings((prev) =>
          prev.map((r) =>
            r.id === readingId
              ? {
                  ...r,
                  ebarimtStatus: data?.ebarimt?.status ?? 'SENT',
                  ebarimtBillId: data?.ebarimt?.billId ?? null,
                  ebarimtLastError: null,
                }
              : r
          )
        )
      }
      setMessage({
        type: 'success',
        text: ids.length > 1 ? `e-barimt: ${ok} заалтад илгээлээ.` : 'e-barimt амжилттай илгээгдлээ.',
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'e-barimt илгээхэд алдаа гарлаа'
      setMessage({ type: 'error', text: msg })
    } finally {
      setIssuingEbarimt(null)
      setTimeout(() => setMessage(null), 3500)
    }
  }, [])

  const handleInlinePaidChange = useCallback(
    async (row: MonthlyReadingRow, newPaid: number) => {
      const ids = readingIdsForBillingRow(row)
      if (ids.length === 0) return
      try {
        const res = await fetchWithAuth('/api/readings/payment/set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            readingIds: ids,
            paidAmount: newPaid,
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Алдаа гарлаа')
        }
        await reloadReadings()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Хадгалахад алдаа гарлаа'
        setMessage({ type: 'error', text: msg })
        setTimeout(() => setMessage(null), 4000)
      }
    },
    [reloadReadings]
  )

  const billingGridActions = useMemo<BillingGridActions>(
    () => ({
      onDownload: handleDownload,
      onSendSms: handleSendNotification,
      onIssueEbarimt: handleIssueEbarimt,
      onPaidAmountChange: handleInlinePaidChange,
      sendingId: sending,
      issuingEbarimtId: issuingEbarimt,
    }),
    [handleDownload, handleSendNotification, handleIssueEbarimt, handleInlinePaidChange, sending, issuingEbarimt]
  )

  const handleSendAllNotifications = async () => {
    if (filteredBillingRows.length === 0) {
      setMessage({ type: 'error', text: 'Илгээх төлбөрийн мөр алга байна.' })
      setTimeout(() => setMessage(null), 3000)
      return
    }
    setSendingAll(true)
    setMessage(null)
    try {
      let okCount = 0
      for (const row of filteredBillingRows) {
        const res = await fetchWithAuth('/api/notifications/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            readingIds: row.readingIds,
            fromPhone: senderPhone.trim(),
          }),
        })
        if (res.ok) okCount += 1
      }
      setMessage({
        type: 'success',
        text: `Амжилттай илгээлээ: ${okCount}/${filteredBillingRows.length} харилцагч`,
      })
      // Илгээсэн заалтууд түгжигдсэн тул UI-г шинэчилнэ
      await reloadReadings()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Бүгдэд илгээх үед алдаа гарлаа'
      setMessage({ type: 'error', text: msg })
    } finally {
      setSendingAll(false)
      setTimeout(() => setMessage(null), 3500)
    }
  }

  const handleBankImportSave = async (gridRows: BillingExcelGridRow[]) => {
    const rows = billingGridRowsToImportPayload(gridRows)
    if (rows.length === 0) {
      setMessage({
        type: 'error',
        text: 'Хадгалах мөр алга. Он, сар, байгууллага/код, тоолуур, төлөгдсөн дүн бөглөнө үү.',
      })
      setTimeout(() => setMessage(null), 4000)
      return
    }
    setBankImporting(true)
    setBankImportReport(null)
    setMessage(null)
    try {
      const res = await fetchWithAuth('/api/readings/payment/billing-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Импорт амжилтгүй')
      setBankImportReport({
        applied: Array.isArray(data.applied) ? data.applied : [],
        skipped: Array.isArray(data.skipped) ? data.skipped : [],
      })
      const a = data.applied?.length ?? 0
      const s = data.skipped?.length ?? 0
      setMessage({
        type: a > 0 ? 'success' : 'error',
        text: `Excel импорт: ${a} мөр шинэчлэгдлээ, ${s} мөр алгасагдлаа.`,
      })
      setBankImportInline(false)
      await reloadReadings()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Алдаа гарлаа'
      setMessage({ type: 'error', text: msg })
    } finally {
      setBankImporting(false)
      setTimeout(() => setMessage(null), 5000)
    }
  }

  const exportBillingXlsx = useCallback(() => {
    const H = BILLING_EXCEL_HEADER_LABELS
    const rows = filteredBillingRows.map((r) => ({
      [H.year]: r.year,
      [H.month]: String(r.month).padStart(2, '0'),
      [H.organization]: r.organization.name,
      [H.meter]: r.meterNumber,
      [H.phone]: r.customerPhones,
      [H.usage]: Number(Number(r.usage ?? 0).toFixed(2)),
      [H.total]: Number(Number(r.total ?? 0).toFixed(2)),
      [H.paid]: Number(effectivePaid(r).toFixed(2)),
      [H.remaining]: Number(remainingBalance(r).toFixed(2)),
    }))
    const year = filterYear || 'all'
    const month = filterMonth || 'all'
    const tab = paymentTab === 'paid' ? 'tulsun' : 'tulugui'
    const ws = XLSX.utils.json_to_sheet(rows, { skipHeader: false })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Төлбөр')
    XLSX.writeFile(wb, `billing-${year}-${month}-${tab}.xlsx`)
  }, [filteredBillingRows, filterYear, filterMonth, paymentTab])

  const handleIssueAllEbarimt = async () => {
    if (filteredBillingRows.length === 0) {
      setMessage({ type: 'error', text: 'Илгээх мөр алга байна.' })
      setTimeout(() => setMessage(null), 3000)
      return
    }
    setIssuingEbarimtAll(true)
    setMessage(null)
    let ok = 0
    let failed = 0
    try {
      let totalIssue = 0
      for (const row of filteredBillingRows) {
        for (const readingId of row.readingIds) {
          totalIssue += 1
          const res = await fetchWithAuth('/api/ebarimt/issue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ readingId }),
          })
          if (res.ok) ok += 1
          else failed += 1
        }
      }
      setMessage({
        type: failed > 0 ? 'error' : 'success',
        text: `e-barimt: амжилттай ${ok}, алдаа ${failed} (${filteredBillingRows.length} мөр, ${totalIssue} заалт)`,
      })
      await reloadReadings()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'e-barimt илгээхэд алдаа гарлаа'
      setMessage({ type: 'error', text: msg })
    } finally {
      setIssuingEbarimtAll(false)
      setTimeout(() => setMessage(null), 4000)
    }
  }

  return (
    <div
      className="px-4 sm:px-0"
      onContextMenu={(e) => {
        if (bankImportInline) return
        e.preventDefault()
        setExcelExportMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <div className="mb-4">
        <h2 className="text-2xl font-semibold text-gray-900">Төлбөр</h2>
      </div>
      <div className="mb-4">
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
          <button
            type="button"
            onClick={() => setPaymentTab('unpaid')}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              paymentTab === 'unpaid'
                ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                : 'border border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            Төлөөгүй ({tabCounts.unpaid})
          </button>
          <button
            type="button"
            onClick={() => setPaymentTab('paid')}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              paymentTab === 'paid'
                ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                : 'border border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            Төлсөн ({tabCounts.paid})
          </button>
        </div>
      </div>
      <div className="bg-white p-4 rounded-lg border border-gray-200 mb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-4 sm:flex sm:flex-1 sm:min-w-0 sm:max-w-xl">
            <div className="min-w-0 sm:w-36">
              <label className="block text-sm font-medium text-gray-700 mb-1">Он</label>
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
            <div className="min-w-0 sm:w-36">
              <label className="block text-sm font-medium text-gray-700 mb-1">Сар</label>
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
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end sm:ml-auto sm:shrink-0">
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  if (bankImportInline) {
                    if (!bankImporting) setBankImportInline(false)
                  } else {
                    setBankImportInline(true)
                  }
                }}
                disabled={bankImporting}
                className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 bg-white text-gray-800 rounded-md hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                title={
                  bankImportInline
                    ? 'Төлбөрийн үндсэн хүснэгт рүү буцах'
                    : 'Төлбөрийн Excel (баруун товчоор татсан файл) оруулах'
                }
              >
                <DocumentArrowUpIcon className="h-5 w-5 shrink-0" />
                {bankImporting
                  ? 'Уншиж байна...'
                  : bankImportInline
                    ? 'Төлбөр рүү буцах'
                    : 'Excel импорт'}
              </button>
              <button
                type="button"
                onClick={handleIssueAllEbarimt}
                disabled={issuingEbarimtAll || filteredBillingRows.length === 0}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
              >
                {issuingEbarimtAll ? 'E-barimt ilgej baina...' : 'Бүгдэд e-barimt илгээх'}
              </button>
              <button
                type="button"
                onClick={handleSendAllNotifications}
                disabled={sendingAll || filteredBillingRows.length === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
              >
                {sendingAll ? 'Ilgej baina...' : 'Бүгдэд SMS илгээх'}
              </button>
            </div>
          </div>
        </div>
      </div>
      {bankImportReport && (bankImportReport.skipped.length > 0 || bankImportReport.applied.length > 0) && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          {bankImportReport.skipped.length > 0 && (
            <ul className="text-amber-900 space-y-0.5 list-disc list-inside">
              {bankImportReport.skipped.map((s, i) => (
                <li key={`${s.rowIndex}-${i}`}>
                  Мөр {s.rowIndex}: {s.reason}
                  {s.description ? ` — «${s.description.slice(0, 80)}»` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {message && (
        <div
          className={`mb-4 p-3 rounded ${
            message.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      {bankImportInline ? (
        <BankImportModal
          year={filterYear}
          month={filterMonth}
          saving={bankImporting}
          onClose={() => {
            if (!bankImporting) setBankImportInline(false)
          }}
          onSave={handleBankImportSave}
        />
      ) : (
        <MonthlyReadingsGrid
          variant="billing"
          rowData={gridRowData}
          loading={loading}
          showCalculated
          emptyMessage={gridEmptyMessage}
          billingActions={billingGridActions}
          onGridContextMenu={({ x, y }) => setExcelExportMenu({ x, y })}
        />
      )}
      {excelExportMenu && !bankImportInline && (
        <div
          ref={excelExportMenuRef}
          style={{
            position: 'fixed',
            top: excelExportMenu.y,
            left: excelExportMenu.x,
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
            onClick={() => {
              setExcelExportMenu(null)
              exportBillingXlsx()
            }}
            className="w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-50 rounded-md"
          >
            Excel файл болгох
          </button>
        </div>
      )}
    </div>
  )
}
