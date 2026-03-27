'use client'

import { useEffect, useState } from 'react'
import { PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import ConfirmModal from './ConfirmModal'
import { fetchWithAuth } from '@/lib/api'

interface Organization {
  id: string
  name: string
  code: string | null
  address: string | null
  phone: string | null
  email: string | null
  connectionNumber: string | null
  baseCleanFee: number
  baseDirtyFee: number
  year: number
  category?: string
}

interface PipeFee {
  id: string
  diameterMm: number
  baseCleanFee: number
  baseDirtyFee: number
}

export default function OrganizationsContent() {
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [pipeFees, setPipeFees] = useState<PipeFee[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const currentYear = new Date().getFullYear()
  const [form, setForm] = useState({
    name: '',
    code: '',
    address: '',
    phone: '',
    email: '',
    connectionNumber: '',
    baseCleanFee: '',
    baseDirtyFee: '',
    year: String(currentYear),
    category: 'HOUSEHOLD',
  })
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  useEffect(() => {
    loadOrganizations()
  }, [])

  useEffect(() => {
    fetchWithAuth('/api/pipe-fees')
      .then(res => (res.ok ? res.json() : []))
      .then(data => setPipeFees(Array.isArray(data) ? data : []))
      .catch(() => setPipeFees([]))
  }, [])

  const loadOrganizations = () => {
    fetchWithAuth('/api/organizations')
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
          setOrganizations([])
        } else if (data && Array.isArray(data)) {
          setOrganizations(data)
        } else {
          setOrganizations([])
        }
        setLoading(false)
      })
      .catch(() => {
        setOrganizations([])
        setLoading(false)
      })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const url = editingId ? '/api/organizations' : '/api/organizations'
      const method = editingId ? 'PUT' : 'POST'
      const body = {
        ...form,
        baseCleanFee: Number(form.baseCleanFee) || 0,
        baseDirtyFee: Number(form.baseDirtyFee) || 0,
        year: Number(form.year) || currentYear,
        ...(editingId ? { id: editingId } : {}),
      }

      const res = await fetchWithAuth(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Алдаа гарлаа')
      }

      if (data.token && typeof window !== 'undefined') {
        sessionStorage.setItem('token', data.token)
      }

      setShowForm(false)
      setEditingId(null)
      setForm({
        name: '',
        code: '',
        address: '',
        phone: '',
        email: '',
        connectionNumber: '',
        baseCleanFee: '',
        baseDirtyFee: '',
        year: String(currentYear),
        category: 'HOUSEHOLD',
      })
      loadOrganizations()
    } catch (err: any) {
      alert(err.message || 'Алдаа гарлаа')
    }
  }

  const handleEdit = (org: Organization) => {
    setEditingId(org.id)
    setForm({
      name: org.name,
      code: org.code || '',
      address: org.address || '',
      phone: org.phone || '',
      email: org.email || '',
      connectionNumber: org.connectionNumber || '',
      baseCleanFee: String(org.baseCleanFee ?? ''),
      baseDirtyFee: String(org.baseDirtyFee ?? ''),
      year: String(org.year),
      category: org.category || 'HOUSEHOLD',
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
      const res = await fetchWithAuth(`/api/organizations?id=${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Алдаа гарлаа')
      loadOrganizations()
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
        <h2 className="text-2xl font-semibold text-gray-900">Байгууллагууд</h2>
        <button
          onClick={() => {
            if (!showForm) {
              setEditingId(null)
              setForm({
                name: '',
                code: '',
                address: '',
                phone: '',
                email: '',
                connectionNumber: '',
                baseCleanFee: '',
                baseDirtyFee: '',
                year: String(currentYear),
                category: 'HOUSEHOLD',
              })
            }
            setShowForm(!showForm)
          }}
          className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
        >
          {showForm ? 'Цуцлах' : 'Шинэ байгууллага'}
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div
              className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
              onClick={() => setShowForm(false)}
            />

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-semibold text-gray-900">
                    {editingId ? 'Байгууллага засах' : 'Шинэ байгууллага нэмэх'}
                  </h3>
                  <button
                    onClick={() => setShowForm(false)}
                    className="text-gray-400 hover:text-gray-500 focus:outline-none"
                  >
                    <span className="sr-only">Хаах</span>
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Нэр
                      </label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Код
                      </label>
                      <input
                        type="text"
                        value={form.code}
                        onChange={(e) => setForm(prev => ({ ...prev, code: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Хаяг
                      </label>
                      <input
                        type="text"
                        value={form.address}
                        onChange={(e) => setForm(prev => ({ ...prev, address: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Утас
                      </label>
                      <input
                        type="text"
                        value={form.phone}
                        onChange={(e) => setForm(prev => ({ ...prev, phone: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Имэйл
                      </label>
                      <input
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Шугамын хоолой (мм)
                      </label>
                      <input
                        type="text"
                        value={form.connectionNumber}
                        onChange={(e) => {
                          const val = e.target.value
                          const next = { ...form, connectionNumber: val }
                          const diam = val ? parseInt(String(val).trim(), 10) : NaN
                          const pipe = !Number.isNaN(diam) && pipeFees.length > 0
                            ? pipeFees.find(p => p.diameterMm === diam)
                            : undefined
                          if (pipe) {
                            next.baseCleanFee = String(pipe.baseCleanFee ?? '')
                            next.baseDirtyFee = String(pipe.baseDirtyFee ?? '')
                          }
                          setForm(next)
                        }}
                        placeholder="Жишээ: 50"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Шугамын голч (мм) оруулбал суурь хураамж автоматаар дутуулагдана
                      </p>
                    </div>
                  </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Хэрэглэгчийн төрөл
                  </label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm(prev => ({ ...prev, category: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="HOUSEHOLD">Иргэн,увь хүн</option>
                    <option value="ORGANIZATION">Төсөвт байгууллага</option>
                    <option value="BUSINESS">Аж ахуйн нэгж</option>
                    <option value="TRANSPORT_DISPOSAL">Зөөврөөр татан зайлуулах</option>
                    <option value="TRANSPORT_RECEPTION">Зөөврүүд хүлээн авах</option>
                    <option value="WATER_POINT">Ус түгээх байр</option>
                  </select>
                </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Цэвэр усны суурь хураамж
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={form.baseCleanFee}
                        onChange={(e) =>
                          setForm(prev => ({ ...prev, baseCleanFee: e.target.value }))
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Бохир усны суурь хураамж
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={form.baseDirtyFee}
                        onChange={(e) =>
                          setForm(prev => ({ ...prev, baseDirtyFee: e.target.value }))
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Он
                    </label>
                    <input
                      type="number"
                      value={form.year}
                      onChange={(e) =>
                        setForm(prev => ({ ...prev, year: e.target.value }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="0"
                      required
                    />
                  </div>
                  <div className="mt-4 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowForm(false)}
                      className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                    >
                      Цуцлах
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
                    >
                      Хадгалах
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
                Нэр
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Код
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Хаяг
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Утас
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Имэйл
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Шугамын хоолой
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Ц суурь
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Б суурь
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Он
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Үйлдэл
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {organizations.map((org) => (
              <tr key={org.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {org.name}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {org.code || '-'}
                </td>
                <td className="px-6 py-4 text-sm text-gray-900">{org.address || '-'}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {org.phone || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {org.email || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {org.connectionNumber || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {(org.baseCleanFee ?? 0).toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {(org.baseDirtyFee ?? 0).toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {org.year || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(org)}
                      className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50 transition-colors"
                      title="Засах"
                    >
                      <PencilIcon className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => handleDelete(org.id)}
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
        {organizations.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            Байгууллага олдсонгүй
          </div>
        )}
      </div>
      <ConfirmModal
        open={deleteConfirmId !== null}
        title="Байгууллага устгах"
        message="Та энэ байгууллагыг устгахдаа итгэлтэй байна уу?"
        onConfirm={doDelete}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  )
}

