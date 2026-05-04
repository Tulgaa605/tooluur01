'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownTrayIcon,
  DocumentArrowUpIcon,
  PaperAirplaneIcon,
} from '@heroicons/react/24/outline'
import { fetchWithAuth } from '@/lib/api'

interface Reading {
  id: string
  month: number
  year: number
  usage: number
  total: number
  paidAmount?: number | null
  paymentReference?: string | null
  approved: boolean
  ebarimtStatus?: string | null
  ebarimtBillId?: string | null
  ebarimtLastError?: string | null
  meter: {
    meterNumber: string
  }
  organization: {
    id: string
    name: string
    code: string | null
    phone?: string | null
    users?: { phone: string | null }[]
  }
}

interface BillingRow {
  id: string
  month: number
  year: number
  usage: number
  total: number
  /** DB `paidAmount` — зөвхөн энэ заалт/тоолуурын бүртгэсэн төлбөр */
  paidStored: number
  approved: boolean
  ebarimtStatus?: string | null
  ebarimtBillId?: string | null
  ebarimtLastError?: string | null
  meterNumber: string
  paymentReference: string | null
  customerPhones: string
  organization: {
    id: string
    name: string
    code: string | null
    phone?: string | null
    users?: { phone: string | null }[]
  }
}

function collectCustomerPhones(org: Reading['organization']): string {
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

/** Зөвхөн `paidAmount` (нэг заалт = нэг тоолуурын мөр). `approved` дангаараа бусад тоолуурыг төлсөн гэж тооцохгүй. */
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

function paymentStatusLabel(
  row: Pick<BillingRow, 'paidStored' | 'total'>
): string {
  if (isPaidInFull(row)) return 'Бүрэн төлөгдсөн'
  if (effectivePaid(row) > PAY_EPS) return 'Хэсэгчлэн төлөгдсөн'
  return 'Хүлээгдэж буй'
}

type BillingPaymentTab = 'unpaid' | 'paid'

type BankImportApplied = {
  readingId: string
  code: string
  added: number
  newPaid: number
  total: number
  rowIndex: number
}
type BankImportSkipped = { rowIndex: number; reason: string; description: string }

export default function BillingContent() {
  const [readings, setReadings] = useState<Reading[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState<string | null>(null)
  const [sendingAll, setSendingAll] = useState(false)
  const [issuingEbarimt, setIssuingEbarimt] = useState<string | null>(null)
  const [issuingEbarimtAll, setIssuingEbarimtAll] = useState(false)
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()))
  const [filterMonth, setFilterMonth] = useState(String(new Date().getMonth() + 1))
  const [senderPhone, setSenderPhone] = useState('')
  const [senderOptions, setSenderOptions] = useState<string[]>([])
  const [senderPickCustom, setSenderPickCustom] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [paymentTab, setPaymentTab] = useState<BillingPaymentTab>('unpaid')
  const [bankImporting, setBankImporting] = useState(false)
  const [bankImportReport, setBankImportReport] = useState<{
    applied: BankImportApplied[]
    skipped: BankImportSkipped[]
  } | null>(null)
  const bankFileRef = useRef<HTMLInputElement>(null)
  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return [y + 1, y, y - 1, y - 2]
  }, [])

  const billingRows = useMemo<BillingRow[]>(() => {
    // Билл нь заалт/тоолуур тус бүрээр (meter тус бүрээр) гарах ёстой.
    // Тиймээс бөөгнөрүүлэлгүй, `readings`-ийг шууд map хийж мөр тус бүрийн төлбөр гаргана.
    return [...readings]
      .map((r) => ({
        id: r.id,
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
        paymentReference: r.paymentReference?.trim() || null,
        customerPhones: collectCustomerPhones(r.organization),
        organization: {
          id: (r.organization?.id && String(r.organization.id).trim()) || '',
          name: r.organization?.name || '-',
          code: r.organization?.code || null,
          phone: r.organization?.phone ?? null,
          users: r.organization?.users,
        },
      }))
      .sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year
        if (a.month !== b.month) return b.month - a.month
        // Байгууллага + тоолуурын дугаараар тогтвортой эрэмбэлнэ
        const orgCmp = a.organization.name.localeCompare(b.organization.name)
        if (orgCmp !== 0) return orgCmp
        return String(a.meterNumber).localeCompare(String(b.meterNumber))
      })
  }, [readings])

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

  const footerTotals = useMemo(() => {
    return filteredBillingRows.reduce(
      (acc, row) => {
        acc.usage += Number(row.usage ?? 0) || 0
        acc.total += Number(row.total ?? 0) || 0
        acc.paid += effectivePaid(row)
        acc.remaining += remainingBalance(row)
        return acc
      },
      { usage: 0, total: 0, paid: 0, remaining: 0 }
    )
  }, [filteredBillingRows])

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
      else if (data && Array.isArray(data)) setReadings(data)
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

  const handleDownload = (row: BillingRow) => {
    const invoice = `
Төлбөрийн нэхэмжлэх
Байгууллага: ${row.organization?.name || '-'}${row.organization?.code ? ` (${row.organization.code})` : ''}
Тоолуурын дугаар: ${row.meterNumber || '-'}
Сар: ${row.year}-${String(row.month).padStart(2, '0')}
Хэрэглээ: ${(row.usage ?? 0).toFixed(2)} м³
Нийт төлбөр: ${formatMoney(row.total ?? 0)} ₮
Төлөгдсөн: ${formatMoney(effectivePaid(row))} ₮
Үлдэгдэл: ${formatMoney(remainingBalance(row))} ₮
    `
    const blob = new Blob([invoice], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `invoice-${row.year}-${row.month}.txt`
    a.click()
  }

  const handleSendNotification = async (row: BillingRow) => {
    setSending(row.id)
    try {
      const res = await fetchWithAuth('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readingId: row.id, fromPhone: senderPhone.trim() }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Алдаа гарлаа')
      }

      const toPhones =
        Array.isArray(data.recipients) && data.recipients.length > 0
          ? data.recipients.map((r: { phone?: string }) => r.phone).filter(Boolean).join(', ')
          : collectCustomerPhones(row.organization)
      const sms = data.sms as
        | { provider?: string; sentOk?: number; sentFailed?: number; results?: { to: string; ok: boolean; error?: string }[] }
        | undefined
      let smsLine = ''
      if (sms?.provider === 'none' || !sms?.provider) {
        smsLine = '\nSMS: тохиргоо хийгээгүй (.env дээр SMS_HTTP_URL).'
      } else if ((sms.sentOk ?? 0) === 0 && (sms.sentFailed ?? 0) === 0) {
        smsLine = '\nSMS: хүлээн авагчийн утас олдсонгүй.'
      } else {
        smsLine = `\nSMS (${sms.provider}): амжилт ${sms.sentOk ?? 0}, алдаа ${sms.sentFailed ?? 0}.`
        const failed = sms.results?.filter((r) => !r.ok).map((r) => `${r.to}: ${r.error || 'алдаа'}`)
        if (failed?.length) smsLine += `\n${failed.slice(0, 3).join('\n')}`
      }
      alert(
        `Төлбөрийн мэдээлэл боловсрууллаа.\n` +
          `Илгээгч: ${data.fromPhone || senderPhone.trim()}\n` +
          `Хүлээн авагч: ${toPhones || 'Утас бүртгэгдээгүй'}\n` +
          `Төлбөрийн код: ${data.paymentCode}` +
          smsLine
      )
    } catch (err: any) {
      alert(err.message || 'Алдаа гарлаа')
    } finally {
      setSending(null)
    }
  }

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
          body: JSON.stringify({ readingId: row.id, fromPhone: senderPhone.trim() }),
        })
        if (res.ok) okCount += 1
      }
      setMessage({ type: 'success', text: `Амжилттай илгээлээ: ${okCount}/${filteredBillingRows.length}` })
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Бүгдэд илгээх үед алдаа гарлаа' })
    } finally {
      setSendingAll(false)
      setTimeout(() => setMessage(null), 3500)
    }
  }

  const handleIssueEbarimt = async (row: BillingRow) => {
    setIssuingEbarimt(row.id)
    try {
      const res = await fetchWithAuth('/api/ebarimt/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readingId: row.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'e-barimt ilgeeh uyd aldaa garlaa')
      setReadings((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
                ...r,
                ebarimtStatus: data?.ebarimt?.status ?? 'SENT',
                ebarimtBillId: data?.ebarimt?.billId ?? null,
                ebarimtLastError: null,
              }
            : r
        )
      )
      setMessage({ type: 'success', text: 'e-barimt amjilttai ilgeegdlee.' })
    } catch (err: any) {
      setReadings((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
                ...r,
                ebarimtStatus: 'FAILED',
                ebarimtLastError: err?.message || 'Issue failed',
              }
            : r
        )
      )
      setMessage({ type: 'error', text: err?.message || 'e-barimt ilgeeh uyd aldaa garlaa.' })
    } finally {
      setIssuingEbarimt(null)
      setTimeout(() => setMessage(null), 3500)
    }
  }

  const handleBankExcelSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!filterYear || !filterMonth) {
      setMessage({ type: 'error', text: 'Банкны Excel-д зориулж эхлээд он, сарыг сонгоно уу.' })
      setTimeout(() => setMessage(null), 4000)
      return
    }
    setBankImporting(true)
    setBankImportReport(null)
    setMessage(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('year', filterYear)
      fd.append('month', filterMonth)
      const res = await fetchWithAuth('/api/readings/payment/bank-import', {
        method: 'POST',
        body: fd,
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
        text: `Банкны Excel: ${a} мөр төлбөрт нэмэгдлээ, ${s} мөр алгасагдлаа.`,
      })
      await reloadReadings()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Алдаа гарлаа'
      setMessage({ type: 'error', text: msg })
    } finally {
      setBankImporting(false)
      setTimeout(() => setMessage(null), 5000)
    }
  }

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
      for (const row of filteredBillingRows) {
        const res = await fetchWithAuth('/api/ebarimt/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ readingId: row.id }),
        })
        if (res.ok) ok += 1
        else failed += 1
      }
      setMessage({
        type: failed > 0 ? 'error' : 'success',
        text: `e-barimt: амжилттай ${ok}, алдаа ${failed} (сонгосон табын ${filteredBillingRows.length} мөр)`,
      })
      await reloadReadings()
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'e-barimt илгээхэд алдаа гарлаа' })
    } finally {
      setIssuingEbarimtAll(false)
      setTimeout(() => setMessage(null), 4000)
    }
  }

  if (loading) {
    return <div className="text-gray-600">Ачааллаж байна...</div>
  }

  return (
    <div className="px-4 sm:px-0">
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
            <input
              ref={bankFileRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={handleBankExcelSelected}
            />
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={() => bankFileRef.current?.click()}
                disabled={
                  bankImporting || !filterYear || !filterMonth || loading
                }
                className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 bg-white text-gray-800 rounded-md hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                title="Гүйлгээний утга дээр 6 оронтой төлбөрийн код байх (SMS-ээр илгээсэн)"
              >
                <DocumentArrowUpIcon className="h-5 w-5 shrink-0" />
                {bankImporting ? 'Уншиж байна...' : 'Банкны Excel'}
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
          <div className="flex justify-between items-start gap-2 mb-2">
            <span className="font-medium text-gray-800">Сүүлийн банкны импортын дэлгэрэнгүй</span>
            <button
              type="button"
              className="text-gray-500 hover:text-gray-800 text-xs"
              onClick={() => setBankImportReport(null)}
            >
              Хаах
            </button>
          </div>
          {bankImportReport.applied.length > 0 && (
            <ul className="mb-2 text-green-800 space-y-0.5 list-disc list-inside">
              {bankImportReport.applied.map((a, i) => (
                <li key={`${a.readingId}-${i}`}>
                  Мөр {a.rowIndex}: код {a.code} — +{formatMoney(a.added)} ₮ (нийт төлөгдсөн{' '}
                  {formatMoney(a.newPaid)} / {formatMoney(a.total)} ₮)
                </li>
              ))}
            </ul>
          )}
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

      <div className="bg-white shadow-sm rounded-lg border border-gray-200">
        <div className="max-h-[min(75vh,calc(100vh-11rem))] w-full overflow-y-auto overflow-x-auto overscroll-contain">
          <table className="min-w-[72rem] w-full divide-y divide-gray-200">
          <thead className="sticky top-0 z-10 bg-gray-50 shadow-[0_1px_0_0_rgb(229_231_235)]">
            <tr>
              <th className="px-2 sm:px-3 py-2 sm:py-3 text-center text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">
                Он
              </th>
              <th className="px-2 sm:px-3 py-2 sm:py-3 text-center text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">
                Сар
              </th>
              <th className="px-2 sm:px-3 py-2 sm:py-3 text-center text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">
                Байгууллага
              </th>
              <th className="px-2 sm:px-3 py-2 sm:py-3 text-center text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">
                Тоолуур
              </th>
              <th className="px-2 sm:px-3 py-2 sm:py-3 text-center text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">
                Гүйлгээний код
              </th>
              <th className="px-2 sm:px-3 py-2 sm:py-3 text-center text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">
                Харилцагчийн утас
              </th>
              <th className="px-2 sm:px-3 py-2 sm:py-3 text-center text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">
                Хэрэглээ (м³)
              </th>
              <th className="px-2 sm:px-3 py-2 sm:py-3 text-center text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">
                Төлбөр (₮)
              </th>
              <th className="px-2 sm:px-3 py-2 sm:py-3 text-center text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">
                Төлөгдсөн (₮)
              </th>
              <th className="px-2 sm:px-3 py-2 sm:py-3 text-center text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">
                Үлдэгдэл (₮)
              </th>
              <th className="px-2 sm:px-3 py-2 sm:py-3 text-center text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">
                Төлөв
              </th>
              <th className="px-2 sm:px-3 py-2 sm:py-3 text-center text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">
                E-barimt
              </th>
              <th className="px-2 sm:px-3 py-2 sm:py-3 text-center text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wide">
                Үйлдэл
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredBillingRows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-900">
                  {row.year}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-900">
                  {String(row.month).padStart(2, '0')}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-900">
                  {row.organization?.name || '-'}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-900">
                  {row.meterNumber}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-center font-mono text-gray-800">
                  {row.paymentReference || '—'}
                </td>
                <td className="px-4 py-4 text-sm text-center text-gray-700 max-w-[14rem] break-words">
                  {row.customerPhones}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-900">
                  {(row.usage ?? 0).toFixed(2)}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-900">
                  {formatMoney(row.total ?? 0)}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-900">
                  {formatMoney(effectivePaid(row))}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-center text-gray-900">
                  {formatMoney(remainingBalance(row))}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-center">
                  <span
                    className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full border ${
                      isPaidInFull(row)
                        ? 'border-gray-200 bg-gray-50 text-gray-800'
                        : effectivePaid(row) > PAY_EPS
                        ? 'border-gray-200 bg-gray-50 text-gray-700'
                        : 'border-gray-200 bg-white text-gray-600'
                    }`}
                  >
                    {paymentStatusLabel(row)}
                  </span>
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-center">
                  <span
                    className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      row.ebarimtStatus === 'SENT'
                        ? 'bg-blue-100 text-blue-800'
                        : row.ebarimtStatus === 'FAILED'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                    title={row.ebarimtLastError || undefined}
                  >
                    {row.ebarimtStatus === 'SENT'
                      ? row.ebarimtBillId
                        ? `SENT (${row.ebarimtBillId})`
                        : 'SENT'
                      : row.ebarimtStatus === 'FAILED'
                      ? 'FAILED'
                      : 'PENDING'}
                  </span>
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDownload(row)}
                      className="text-primary-600 hover:text-primary-900 p-1 rounded hover:bg-primary-50 transition-colors"
                      title="Татах"
                    >
                      <ArrowDownTrayIcon className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleIssueEbarimt(row)}
                      disabled={issuingEbarimt === row.id}
                      className="text-indigo-600 hover:text-indigo-900 p-1 rounded hover:bg-indigo-50 transition-colors disabled:opacity-50"
                      title={issuingEbarimt === row.id ? 'E-barimt ilgej baina...' : 'E-barimt ilgeeh'}
                    >
                      <span className="text-xs font-semibold">EB</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSendNotification(row)}
                      disabled={sending === row.id}
                      className="text-green-600 hover:text-green-900 p-1 rounded hover:bg-green-50 transition-colors disabled:opacity-50"
                      title={sending === row.id ? 'Илгээж байна...' : 'Илгээх'}
                    >
                      <PaperAirplaneIcon className="h-5 w-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {filteredBillingRows.length > 0 && (
            <tfoot className="bg-gray-50 border-t border-gray-200">
              <tr>
                <td colSpan={6} className="px-6 py-3 text-sm font-semibold text-gray-900">
                  Нийт дүн
                </td>
                <td className="px-6 py-3 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                  {footerTotals.usage.toFixed(2)}
                </td>
                <td className="px-6 py-3 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                  {formatMoney(footerTotals.total)}
                </td>
                <td className="px-6 py-3 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                  {formatMoney(footerTotals.paid)}
                </td>
                <td className="px-6 py-3 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                  {formatMoney(footerTotals.remaining)}
                </td>
                <td colSpan={3} className="px-6 py-3" />
              </tr>
            </tfoot>
          )}
        </table>
        </div>
        {filteredBillingRows.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            {billingRows.length === 0
              ? 'Төлбөрийн мэдээлэл олдсонгүй'
              : paymentTab === 'unpaid'
                ? 'Төлөөгүй төлбөр байхгүй'
                : 'Төлсөн төлбөр байхгүй'}
          </div>
        )}
      </div>
    </div>
  )
}