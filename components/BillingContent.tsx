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
  approved: boolean
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

export default function BillingContent() {
  const [readings, setReadings] = useState<Reading[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState<string | null>(null)
  const [sendingAll, setSendingAll] = useState(false)
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()))
  const [filterMonth, setFilterMonth] = useState(String(new Date().getMonth() + 1))
  const [senderPhone, setSenderPhone] = useState('89980862')
  const [senderOptions, setSenderOptions] = useState<string[]>([])
  const [senderPickCustom, setSenderPickCustom] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
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
        approved: !!r.approved,
        meterNumber: r.meter?.meterNumber || '-',
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

  useEffect(() => {
    fetchWithAuth('/api/sms/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { senders?: string[]; defaultSender?: string } | null) => {
        if (data?.senders?.length) {
          setSenderOptions(data.senders)
          if (data.defaultSender && data.senders.includes(data.defaultSender)) {
            setSenderPhone(data.defaultSender)
          } else {
            setSenderPhone(data.senders[0])
          }
        }
      })
      .catch(() => {})
  }, [])

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
          body: JSON.stringify({ readingId: row.id, fromPhone: senderPhone.trim() }),
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
          <div className="flex justify-end sm:ml-auto sm:shrink-0">
            <button
              type="button"
              onClick={handleSendAllNotifications}
              disabled={sendingAll || billingRows.length === 0}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
            >
              {sendingAll ? 'Илгээж байна...' : 'Бүгдийг илгээх'}
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
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Харилцагчийн утас
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
              <tr key={row.id}>
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
                <td className="px-6 py-4 text-sm text-gray-700 max-w-[14rem] break-words">
                  {row.customerPhones}
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
              <td colSpan={5} className="px-6 py-3 text-sm font-semibold text-gray-900">
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