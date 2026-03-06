'use client'

import { useEffect, useState } from 'react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface DashboardData {
  totalUsage: number
  currentMonthUsage: number
  previousMonthUsage: number
  usageChange: number
  monthlyData: Array<{ month: string; usage: number }>
  topOrganizations: Array<{ name: string; usage: number }>
}

export default function DashboardContent() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard')
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
        } else if (data && typeof data.totalUsage === 'number') {
          setData(data as DashboardData)
        } else {
          setData(null)
        }
        setLoading(false)
      })
      .catch(() => {
        setData(null)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return <div className="text-gray-600">Ачааллаж байна...</div>
  }

  if (!data) {
    return <div className="text-gray-600">Өгөгдөл олдсонгүй</div>
  }

  const changeColor = (data.usageChange ?? 0) >= 0 ? 'text-red-600' : 'text-green-600'
  const changeIcon = (data.usageChange ?? 0) >= 0 ? '↑' : '↓'

  return (
    <div className="px-4 sm:px-0">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900">Хяналтын самбар</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <div className="text-sm font-medium text-gray-600">Нийт зарцуулсан ус</div>
          <div className="mt-2 text-3xl font-semibold text-gray-900">
            {(data.totalUsage ?? 0).toLocaleString()} м³
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <div className="text-sm font-medium text-gray-600">Энэ сар</div>
          <div className="mt-2 text-3xl font-semibold text-gray-900">
            {(data.currentMonthUsage ?? 0).toLocaleString()} м³
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <div className="text-sm font-medium text-gray-600">Өмнөх сартай харьцуулалт</div>
          <div className={`mt-2 text-3xl font-semibold ${changeColor}`}>
            {changeIcon} {Math.abs(data.usageChange ?? 0).toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Сарын хэрэглээний график</h3>
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
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Их хэрэглээтэй байгууллагууд</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.topOrganizations || []}>
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
    </div>
  )
}