'use client'

import { useEffect, useState } from 'react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface ReportData {
  monthlyData: Array<{ month: string; usage: number; total: number }>
  organizationData: Array<{ name: string; usage: number; total: number }>
}

export default function ReportsContent() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(String(currentYear))

  useEffect(() => {
    loadReports()
  }, [year])

  const yearNum = Number(year) || currentYear

  const loadReports = () => {
    fetch(`/api/reports?year=${yearNum}`)
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
          setData(null)
        } else if (data && Array.isArray(data.monthlyData) && Array.isArray(data.organizationData)) {
          setData(data as ReportData)
        } else {
          setData(null)
        }
        setLoading(false)
      })
      .catch(() => {
        setData(null)
        setLoading(false)
      })
  }

  if (loading) {
    return <div className="text-gray-600">Ачааллаж байна...</div>
  }

  if (!data) {
    return <div className="text-gray-600">Өгөгдөл олдсонгүй</div>
  }

  return (
    <div className="px-4 sm:px-0">
      <div className="mb-8 flex justify-between items-center">
        <h2 className="text-2xl font-semibold text-gray-900">Тайлан</h2>
        <div>
          <label className="text-sm text-gray-700 mr-2">Он:</label>
          <input
            type="number"
            value={year}
            onChange={(e) => {
              setYear(e.target.value)
              setLoading(true)
            }}
            className="px-3 py-2 border border-gray-300 rounded-md"
            placeholder="0"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Сарын хэрэглээний график
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.monthlyData || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" stroke="#6b7280" />
              <YAxis stroke="#6b7280" />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="usage"
                stroke="#0284c7"
                strokeWidth={2}
                name="Хэрэглээ (м³)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Байгууллагуудын хэрэглээ
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.organizationData || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="name" stroke="#6b7280" />
              <YAxis stroke="#6b7280" />
              <Tooltip />
              <Legend />
              <Bar dataKey="usage" fill="#0284c7" name="Хэрэглээ (м³)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Сарын дэлгэрэнгүй
        </h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Сар
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Хэрэглээ (м³)
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Нийт төлбөр (₮)
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {(data.monthlyData || []).map((item, idx) => (
                <tr key={idx}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {item.month}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {(item.usage ?? 0).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {(item.total ?? 0).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

