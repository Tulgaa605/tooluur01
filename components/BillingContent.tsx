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
    name: string
    code: string | null
  }
}

export default function BillingContent() {
  const [readings, setReadings] = useState<Reading[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState<string | null>(null)

  const footerTotals = useMemo(() => {
    return readings.reduce(
      (acc, reading) => {
        acc.usage += Number(reading.usage ?? 0) || 0
        acc.total += Number(reading.total ?? 0) || 0
        return acc
      },
      { usage: 0, total: 0 }
    )
  }, [readings])

  useEffect(() => {
    fetchWithAuth('/api/readings')
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

  const handleSendNotification = async (reading: Reading) => {
    setSending(reading.id)
    try {
      const res = await fetchWithAuth('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readingId: reading.id }),
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

  if (loading) {
    return <div className="text-gray-600">Ачааллаж байна...</div>
  }

  return (
    <div className="px-4 sm:px-0">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900">Төлбөр</h2>
      </div>

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
            {readings.map((reading) => (
              <tr key={reading.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                  {reading.year}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                  {String(reading.month).padStart(2, '0')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {reading.organization?.name || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {reading.meter?.meterNumber || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                  {(reading.usage ?? 0).toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                  {(reading.total ?? 0).toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      reading.approved
                        ? 'bg-green-100 text-green-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {reading.approved ? 'Төлбөр төлсөн' : 'Хүлээгдэж буй'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleDownload(reading)}
                      className="text-primary-600 hover:text-primary-900 p-1 rounded hover:bg-primary-50 transition-colors"
                      title="Татах"
                    >
                      <ArrowDownTrayIcon className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSendNotification(reading)}
                      disabled={sending === reading.id}
                      className="text-green-600 hover:text-green-900 p-1 rounded hover:bg-green-50 transition-colors disabled:opacity-50"
                      title={sending === reading.id ? 'Илгээж байна...' : 'Илгээх'}
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
                Хөл дүн
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
        {readings.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            Төлбөрийн мэдээлэл олдсонгүй
          </div>
        )}
      </div>
    </div>
  )
}