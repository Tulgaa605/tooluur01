'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDownTrayIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline'
import { fetchWithAuth } from '@/lib/api'

interface Reading {
  id: string
  month: number
  year: number
  usage: number
  total: number
  approved: boolean
  meter: {
    meterNumber: string
  }
  organization: {
    id: string
    name: string
    code: string | null
  }
}

interface BillingRow {
  id: string
  month: number
  year: number
  usage: number
  total: number
  approved: boolean
  meterNumber: string
  organization: {
    id: string
    name: string
    code: string | null
  }
}

export default function BillingContent() {
  const [readings, setReadings] = useState<Reading[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState<string | null>(null)
  const [sendingAll, setSendingAll] = useState(false)
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()))
  const [filterMonth, setFilterMonth] = useState(String(new Date().getMonth() + 1))
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear()
    return [y + 1, y, y - 1, y - 2]
  }, [])

  const billingRows = useMemo<BillingRow[]>(() => {
    const grouped = new Map<string, BillingRow>()
    for (const r of readings) {
      const normalizedYear = Number(r.year) || 0
      const normalizedMonth = Number(r.month) || 0
      const orgKey =
        (r.organization?.id && String(r.organization.id).trim()) ||
        (r.organization?.code && `code:${String(r.organization.code).trim()}`) ||
        `name:${String(r.organization?.name || '-').trim().toLowerCase()}`
      const key = `${orgKey}-${normalizedYear}-${normalizedMonth}`
      const existing = grouped.get(key)
      if (!existing) {
        grouped.set(key, {
          id: r.id,
          month: normalizedMonth,
          year: normalizedYear,
          usage: Number(r.usage ?? 0) || 0,
          total: Number(r.total ?? 0) || 0,
          approved: !!r.approved,
          meterNumber: r.meter?.meterNumber || '-',
          organization: {
            id: (r.organization?.id && String(r.organization.id).trim()) || orgKey,
            name: r.organization?.name || '-',
            code: r.organization?.code || null,
          },
        })
      } else {
        existing.usage += Number(r.usage ?? 0) || 0
        existing.total += Number(r.total ?? 0) || 0
        existing.approved = existing.approved && !!r.approved
      }
    }
    return Array.from(grouped.values()).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year
      if (a.month !== b.month) return b.month - a.month
      return a.organization.name.localeCompare(b.organization.name)
    })
  }, [readings])

  const footerTotals = useMemo(() => {
    return billingRows.reduce(
      (acc, row) => {
        acc.usage += Number(row.usage ?? 0) || 0
        acc.total += Number(row.total ?? 0) || 0
        return acc
      },
      { usage: 0, total: 0 }
    )
  }, [billingRows])

  useEffect(() => {
    const params = new URLSearchParams()
    if (filterYear) params.append('year', filterYear)
    if (filterMonth) params.append('month', filterMonth)
    params.append('limit', '500')
    params.append('recalculate', '1')
    fetchWithAuth(`/api/readings?${params.toString()}`)
      .then(res => {
        if (!res.ok) {
          return res.json().then(err => {
            throw new Error(err.error || 'Алдаа гарлаа')
          })
        }
        return res.json()
      })
      .then(data => {
        if (data && data.error) {
          setReadings([])
        } else if (data && Array.isArray(data)) {
          setReadings(data)
        } else {
          setReadings([])
        }
        setLoading(false)
      })
      .catch(() => {
        setReadings([])
        setLoading(false)
      })
  }, [filterYear, filterMonth])

  const handleDownload = (reading: Reading) => {
    const invoice = `
Төлбөрийн нэхэмжлэх
Байгууллага: ${reading.organization?.name || '-'}${reading.organization?.code ? ` (${reading.organization.code})` : ''}
Тоолуурын дугаар: ${reading.meter?.meterNumber || '-'}
Сар: ${reading.year}-${String(reading.month).padStart(2, '0')}
Хэрэглээ: ${(reading.usage ?? 0).toFixed(2)} м³
Нийт төлбөр: ${(reading.total ?? 0).toFixed(2)} ₮
    `
    const blob = new Blob([invoice], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `invoice-${reading.year}-${reading.month}.txt`
    a.click()
  }

  const handleSendNotification = async (row: BillingRow) => {
    setSending(row.id)
    try {
      const res = await fetchWithAuth('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readingId: row.id }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Алдаа гарлаа')
      }

      alert(`Төлбөрийн мэдээлэл илгээгдлээ!\nТөлбөрийн код: ${data.paymentCode}`)
    } catch (err: any) {
      alert(err.message || 'Алдаа гарлаа')
    } finally {
      setSending(null)
    }
  }

  const handleSendAllNotifications = async () => {
    if (billingRows.length === 0) {
      setMessage({ type: 'error', text: 'Илгээх төлбөрийн мөр алга байна.' })
      setTimeout(() => setMessage(null), 3000)
      return
    }
    setSendingAll(true)
    setMessage(null)
    try {
      let okCount = 0
      for (const row of billingRows) {
        const res = await fetchWithAuth('/api/notifications/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ readingId: row.id }),
        })
        if (res.ok) okCount += 1
      }
      setMessage({ type: 'success', text: `Амжилттай илгээлээ: ${okCount}/${billingRows.length}` })
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Бүгдэд илгээх үед алдаа гарлаа' })
    } finally {
      setSendingAll(false)
      setTimeout(() => setMessage(null), 3500)
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
      <div className="bg-white p-4 rounded-lg border border-gray-200 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
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
          <div>
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
          <div className="md:col-span-2 flex items-end justify-end">
            <button
              type="button"
              onClick={handleSendAllNotifications}
              disabled={sendingAll || billingRows.length === 0}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {sendingAll ? 'Илгээж байна...' : 'Илгээх'}
            </button>
          </div>
        </div>
      </div>
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

      <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Он
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Сар
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Байгууллага
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Тоолуур
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Хэрэглээ (м³)
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Төлбөр (₮)
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Төлөв
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Үйлдэл
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {billingRows.map((row) => (
              <tr key={`${row.organization.id}-${row.year}-${row.month}`}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                  {row.year}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                  {String(row.month).padStart(2, '0')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {row.organization?.name || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {row.meterNumber}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                  {(row.usage ?? 0).toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                  {(row.total ?? 0).toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      row.approved
                        ? 'bg-green-100 text-green-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {row.approved ? 'Төлбөр төлсөн' : 'Хүлээгдэж буй'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleDownload({
                        id: row.id,
                        month: row.month,
                        year: row.year,
                        usage: row.usage,
                        total: row.total,
                        approved: row.approved,
                        meter: { meterNumber: row.meterNumber },
                        organization: row.organization,
                      })}
                      className="text-primary-600 hover:text-primary-900 p-1 rounded hover:bg-primary-50 transition-colors"
                      title="Татах"
                    >
                      <ArrowDownTrayIcon className="h-5 w-5" />
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
          <tfoot className="bg-gray-50 border-t border-gray-200">
            <tr>
              <td colSpan={4} className="px-6 py-3 text-sm font-semibold text-gray-900">
                Нийт дүн
              </td>
              <td className="px-6 py-3 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                {footerTotals.usage.toFixed(2)}
              </td>
              <td className="px-6 py-3 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                {footerTotals.total.toFixed(2)}
              </td>
              <td colSpan={2} className="px-6 py-3" />
            </tr>
          </tfoot>
        </table>
        {billingRows.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            Төлбөрийн мэдээлэл олдсонгүй
          </div>
        )}
      </div>
    </div>
  )
}