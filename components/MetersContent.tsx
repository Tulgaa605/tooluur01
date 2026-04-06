'use client'

import { useEffect, useState } from 'react'
import { PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import ConfirmModal from './ConfirmModal'
import { fetchWithAuth } from '@/lib/api'

interface Organization {
  id: string
  name: string
}

type MeterServiceStatus = 'NORMAL' | 'DAMAGED' | 'REPLACED'

interface Meter {
  id: string
  meterNumber: string
  year: number
  organizationId: string
  serviceStatus?: MeterServiceStatus | string
  organization: {
    name: string
  }
}
type OwnerType = 'organization' | 'household'

export default function MetersContent() {
  const [meters, setMeters] = useState<Meter[]>([])
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [households, setHouseholds] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const currentYear = new Date().getFullYear()
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [form, setForm] = useState({
    ownerType: '' as OwnerType | '',
    meterNumber: '',
    organizationId: '',
    year: currentYear,
    serviceStatus: 'NORMAL' as MeterServiceStatus,
  })

  useEffect(() => {
    loadMeters()
    // Тоолуур нэмэх модал дээр «албан өөрийн байгууллага» биш зөвхөн харилцагчуудыг харуулах
    fetchWithAuth('/api/organizations?customersOnly=1', { credentials: 'include' })
      .then(res => (res.ok ? res.json() : []))
      .then(data => {
        if (Array.isArray(data)) {
          setOrganizations(data.filter((o: { category?: string }) => o.category !== 'HOUSEHOLD'))
        } else {
          setOrganizations([])
        }
      })
      .catch(() => setOrganizations([]))
    fetchWithAuth('/api/organizations?category=HOUSEHOLD&customersOnly=1', { credentials: 'include' })
      .then(res => (res.ok ? res.json() : []))
      .then(data => {
        if (Array.isArray(data)) {
          setHouseholds(data)
        } else {
          setHouseholds([])
        }
      })
      .catch(() => setHouseholds([]))
  }, [])

  const loadMeters = () => {
    fetchWithAuth('/api/meters')
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
          setMeters([])
        } else if (data && Array.isArray(data)) {
          setMeters(data)
        } else {
          setMeters([])
        }
        setLoading(false)
      })
      .catch(() => {
        setMeters([])
        setLoading(false)
      })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId && !form.ownerType) {
      alert('Байгууллага эсвэл Хувь хүн сонгоно уу.')
      return
    }
    if (!editingId && !form.organizationId) {
      alert('Байгууллага эсвэл Хувь хүнийг сонгоно уу.')
      return
    }
    try {
      const method = editingId ? 'PUT' : 'POST'
      const body = editingId
        ? { ...form, id: editingId }
        : {
            meterNumber: form.meterNumber,
            organizationId: form.organizationId,
            year: form.year,
            serviceStatus: form.serviceStatus || 'NORMAL',
          }

      const res = await fetchWithAuth('/api/meters', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Алдаа гарлаа')

      setShowForm(false)
      setEditingId(null)
      setForm({ ownerType: '', meterNumber: '', organizationId: '', year: currentYear, serviceStatus: 'NORMAL' })
      loadMeters()
    } catch (err: any) {
      alert(err.message || 'Алдаа гарлаа')
    }
  }

  const handleEdit = (meter: Meter) => {
    setEditingId(meter.id)
    const inHousehold = households.some(h => h.id === meter.organizationId)
    const st = String(meter.serviceStatus ?? 'NORMAL').toUpperCase()
    const serviceStatus: MeterServiceStatus =
      st === 'DAMAGED' || st === 'REPLACED' ? st : 'NORMAL'
    setForm({
      ownerType: inHousehold ? 'household' : 'organization',
      meterNumber: meter.meterNumber,
      organizationId: meter.organizationId,
      year: meter.year ?? currentYear,
      serviceStatus,
    })
    setShowForm(true)
  }

  const handleDelete = (id: string) => {
    setDeleteConfirmId(id)
  }

  const doDelete = async () => {
    if (!deleteConfirmId) return
    const id = deleteConfirmId
    setDeleteConfirmId(null)
    try {
      const res = await fetchWithAuth(`/api/meters?id=${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Алдаа гарлаа')
      loadMeters()
    } catch (err: any) {
      alert(err.message || 'Алдаа гарлаа')
    }
  }

  if (loading) {
    return <div className="text-gray-600">Ачааллаж байна...</div>
  }

  return (
    <div className="px-4 sm:px-0">
      <div className="mb-8 flex justify-between items-center">
        <h2 className="text-2xl font-semibold text-gray-900">Тоолуурууд</h2>
        <button
          onClick={() => {
            setShowForm(!showForm)
            setEditingId(null)
            setForm({ ownerType: '', meterNumber: '', organizationId: '', year: currentYear, serviceStatus: 'NORMAL' })
          }}
          className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
        >
          {showForm ? 'Цуцлах' : 'Шинэ тоолуур'}
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div
              className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
              onClick={() => {
                setShowForm(false)
                setEditingId(null)
                setForm({ ownerType: '', meterNumber: '', organizationId: '', year: currentYear, serviceStatus: 'NORMAL' })
              }}
              aria-hidden="true"
            />
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-semibold text-gray-900">
                    {editingId ? 'Тоолуур засах' : 'Шинэ тоолуур нэмэх'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false)
                      setEditingId(null)
                      setForm({ ownerType: '', meterNumber: '', organizationId: '', year: currentYear, serviceStatus: 'NORMAL' })
                    }}
                    className="text-gray-400 hover:text-gray-500 focus:outline-none"
                  >
                    <span className="sr-only">Хаах</span>
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <div className="flex gap-6 mb-3">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="ownerType"
                          checked={form.ownerType === 'organization'}
                          onChange={() => setForm(prev => ({ ...prev, ownerType: 'organization', organizationId: '' }))}
                          className="text-primary-600 border-gray-300"
                        />
                        <span>Байгууллага</span>
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="ownerType"
                          checked={form.ownerType === 'household'}
                          onChange={() => setForm(prev => ({ ...prev, ownerType: 'household', organizationId: '' }))}
                          className="text-primary-600 border-gray-300"
                        />
                        <span>Иргэн, хувь хүн</span>
                      </label>
                    </div>
                    {(form.ownerType === 'organization' || form.ownerType === 'household') && (
                      <select
                        value={form.organizationId}
                        onChange={(e) => setForm(prev => ({ ...prev, organizationId: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        required
                      >
                        <option value="">Сонгох</option>
                        {form.ownerType === 'organization' &&
                          organizations.map(org => (
                            <option key={org.id} value={org.id}>{org.name}</option>
                          ))}
                        {form.ownerType === 'household' &&
                          households.map(h => (
                            <option key={h.id} value={h.id}>{h.name}</option>
                          ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Тоолуурын дугаар
                    </label>
                    <input
                      type="text"
                      value={form.meterNumber}
                      onChange={(e) => setForm(prev => ({ ...prev, meterNumber: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Он
                    </label>
                    <select
                      value={form.year}
                      onChange={(e) => setForm(prev => ({ ...prev, year: parseInt(e.target.value, 10) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      {Array.from({ length: 11 }, (_, i) => currentYear - 5 + i).map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Төлөв
                    </label>
                    <select
                      value={form.serviceStatus}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, serviceStatus: e.target.value as MeterServiceStatus }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      <option value="NORMAL">Хэвийн</option>
                      <option value="DAMAGED">Эвдэрсэн</option>
                      <option value="REPLACED">Солигдсон</option>
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      «Эвдэрсэн», «Солигдсон» тоолуур нь заалтын үндсэн хүснэгтэнд харагдана; зөвхөн «заалт оруулах»
                      цонхонд автоматаар орохгүй.
                    </p>
                  </div>
                  <div className="flex justify-end gap-3 mt-4 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowForm(false)
                        setEditingId(null)
                        setForm({ ownerType: '', meterNumber: '', organizationId: '', year: currentYear, serviceStatus: 'NORMAL' })
                      }}
                      className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                    >
                      Цуцлах
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
                    >
                      {editingId ? 'Шинэчлэх' : 'Хадгалах'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Тоолуурын дугаар
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Хэрэглэгч
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Он
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Төлөв
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Үйлдэл
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {meters.map((meter) => (
              <tr key={meter.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {meter.meterNumber}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {meter.organization?.name || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {meter.year || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                  {String(meter.serviceStatus ?? 'NORMAL').toUpperCase() === 'DAMAGED'
                    ? 'Эвдэрсэн'
                    : String(meter.serviceStatus ?? 'NORMAL').toUpperCase() === 'REPLACED'
                      ? 'Солигдсон'
                      : 'Хэвийн'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(meter)}
                       className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50 transition-colors"
                      title="Засах"
                    >
                      <PencilIcon className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => handleDelete(meter.id)}
                      className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50 transition-colors"
                      title="Устгах"
                    >
                      <TrashIcon className="h-5 w-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {meters.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            Тоолуур олдсонгүй
          </div>
        )} 
      </div>
      <ConfirmModal
        open={deleteConfirmId !== null}
        title="Тоолуур устгах"
        message="Та энэ тоолуурыг устгахдаа итгэлтэй байна уу?"
        onConfirm={doDelete}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  )
}