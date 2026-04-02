'use client'

import { useEffect, useState } from 'react'
import { PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import ConfirmModal from './ConfirmModal'
import { fetchWithAuth } from '@/lib/api'

type OrganizationCategory =
  | 'HOUSEHOLD'
  | 'ORGANIZATION'
  | 'BUSINESS'
  | 'TRANSPORT_DISPOSAL'
  | 'TRANSPORT_RECEPTION'
  | 'WATER_POINT'

interface Organization {
  id: string
  name: string
  ovog?: string | null
  code: string | null
  address: string | null
  phone: string | null
  email: string | null
  connectionNumber: string | null
  year: number
  category?: OrganizationCategory
}

const CATEGORY_LABELS: Record<OrganizationCategory, string> = {
  HOUSEHOLD: 'Иргэн, хувь хүн',
  ORGANIZATION: 'Төсөвт байгууллага',
  BUSINESS: 'Аж ахуйн нэгж',
  TRANSPORT_DISPOSAL: 'Зөөврөөр татан зайлуулах',
  TRANSPORT_RECEPTION: 'Зөөврүүд хүлээн авах',
  WATER_POINT: 'Ус түгээх байр',
}

export default function UsersContent() {
  const [activeTab, setActiveTab] = useState<'users' | 'organizations'>('users')
  
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([])
  const [showUserForm, setShowUserForm] = useState(false)
  const [editingHouseholdId, setEditingHouseholdId] = useState<string | null>(null)
  const [userForm, setUserForm] = useState({
    ovog: '',
    name: '',
    email: '',
    phone: '',
    role: 'USER',
    organizationId: '',
    code: '',
    address: '',
    connectionNumber: '15',
  })

  // Хувь хүн (HOUSEHOLD) жагсаалт
  const [households, setHouseholds] = useState<Organization[]>([])
  const [householdsLoading, setHouseholdsLoading] = useState(true)

  // Organizations state
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [orgsLoading, setOrgsLoading] = useState(true)
  const [showOrgForm, setShowOrgForm] = useState(false)
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null)
  const [orgForm, setOrgForm] = useState({
    name: '',
    code: '',
    address: '',
    phone: '',
    email: '',
    connectionNumber: '',
    year: String(new Date().getFullYear()),
    // «Бусад» таб дээрх шинэ байгууллага — анхны утга HOUSEHOLD биш
    category: 'ORGANIZATION' as OrganizationCategory,
  })

  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'org' | 'household'; id: string } | null>(null)

  useEffect(() => {
    loadOrganizations()
    loadHouseholds()
    fetchWithAuth('/api/organizations?customersOnly=1', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setOrganizations(data)
        }
      })
      .catch(() => setOrganizations([]))
  }, [])

  const loadHouseholds = () => {
    setHouseholdsLoading(true)
    fetchWithAuth('/api/organizations?category=HOUSEHOLD&customersOnly=1', { credentials: 'include' })
      .then(res => {
        if (!res.ok) return res.json().then(() => ({ error: true }))
        return res.json()
      })
      .then(data => {
        if (data && !data.error && Array.isArray(data)) {
          setHouseholds(data)
        } else {
          setHouseholds([])
        }
        setHouseholdsLoading(false)
      })
      .catch(() => {
        setHouseholds([])
        setHouseholdsLoading(false)
      })
  }

  const loadOrganizations = () => {
    // «Бусад» таб дээр зөвхөн харилцагч байгууллагууд харагдана (албан өөрийгөө оруулахгүй)
    fetchWithAuth('/api/organizations?customersOnly=1')
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
          setOrgs([])
        } else if (data && Array.isArray(data)) {
          setOrgs(data.filter((o: Organization) => o.category !== 'HOUSEHOLD'))
          setOrganizations(data)
        } else {
          setOrgs([])
        }
        setOrgsLoading(false)
      })
      .catch(() => {
        setOrgs([])
        setOrgsLoading(false)
      })
  }

  const handleEditHousehold = (household: Organization) => {
    setEditingHouseholdId(household.id)
    setUserForm({
      ovog: household.ovog || '',
      name: household.name || '',
      email: household.email || '',
      phone: household.phone || '',
      role: 'USER',
      organizationId: '',
      code: household.code || '',
      address: household.address || '',
      connectionNumber: household.connectionNumber || '15',
    })
    setShowUserForm(true)
  }

  const handleDeleteHousehold = (id: string) => {
    setDeleteConfirm({ type: 'household', id })
  }

  const handleSubmitUser = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (editingHouseholdId) {
        const fullName = [userForm.ovog, userForm.name].filter(Boolean).join(' ').trim() || 'Иргэн, хувь хүн'
        const orgRes = await fetchWithAuth('/api/organizations', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            id: editingHouseholdId,
            name: fullName,
            ovog: userForm.ovog?.trim() || null,
            code: userForm.code?.trim() || null,
            address: userForm.address?.trim() || null,
            phone: userForm.phone?.trim() || null,
            email: userForm.email?.trim() || null,
            connectionNumber: (userForm.connectionNumber || '15').trim() || '15',
            category: 'HOUSEHOLD',
          }),
        })
        const orgData = await orgRes.json()
        if (!orgRes.ok) throw new Error(orgData.error || orgData.message || 'Хувь хүн засахад алдаа гарлаа')
      } else {
        const fullName = [userForm.ovog, userForm.name].filter(Boolean).join(' ').trim() || 'Иргэн, хувь хүн'
        const orgRes = await fetchWithAuth('/api/organizations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: fullName,
            ovog: userForm.ovog?.trim() || null,
            code: userForm.code?.trim() || null,
            address: userForm.address?.trim() || null,
            phone: userForm.phone?.trim() || null,
            email: userForm.email?.trim() || null,
            connectionNumber: (userForm.connectionNumber || '15').trim() || '15',
            category: 'HOUSEHOLD',
          }),
        })
        const orgData = await orgRes.json()
        if (!orgRes.ok) throw new Error(orgData.error || orgData.message || 'Байгууллага үүсгэхэд алдаа гарлаа')
        alert('Шинэ хувь хүн амжилттай бүртгэгдлээ.')
      }
      setShowUserForm(false)
      setEditingHouseholdId(null)
      setUserForm({ ovog: '', name: '', email: '', phone: '', role: 'USER', organizationId: '', code: '', address: '', connectionNumber: '15' })
      loadOrganizations()
      loadHouseholds()
    } catch (err: any) {
      alert(err.message || 'Алдаа гарлаа')
    }
  }

  const handleEditOrg = (org: Organization) => {
    setEditingOrgId(org.id)
    setOrgForm({
      name: org.name,
      code: org.code || '',
      address: org.address || '',
      phone: org.phone || '',
      email: org.email || '',
      connectionNumber: org.connectionNumber || '',
      year: String(org.year),
      category: (org.category || 'ORGANIZATION') as OrganizationCategory,
    })
    setShowOrgForm(true)
  }

  const handleDeleteOrg = (id: string) => {
    setDeleteConfirm({ type: 'org', id })
  }

  const doDeleteOrg = async () => {
    if (!deleteConfirm || (deleteConfirm.type !== 'org' && deleteConfirm.type !== 'household')) return
    const id = deleteConfirm.id
    setDeleteConfirm(null)
    try {
      const res = await fetchWithAuth(`/api/organizations?id=${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Алдаа гарлаа')
      loadOrganizations()
      loadHouseholds()
    } catch (err: any) {
      alert(err.message || 'Алдаа гарлаа')
    }
  }

  const handleSubmitOrg = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const url = editingOrgId ? '/api/organizations' : '/api/organizations'
      const method = editingOrgId ? 'PUT' : 'POST'
      const body = {
        ...orgForm,
        year: Number(orgForm.year) || new Date().getFullYear(),
        ...(editingOrgId ? { id: editingOrgId } : {}),
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

      setShowOrgForm(false)
      setEditingOrgId(null)
      setOrgForm({
        name: '',
        code: '',
        address: '',
        phone: '',
        email: '',
        connectionNumber: '',
        year: String(new Date().getFullYear()),
        category: 'ORGANIZATION' as OrganizationCategory,
      })
      loadOrganizations()
      loadHouseholds()
    } catch (err: any) {
      alert(err.message || 'Алдаа гарлаа')
    }
  }

  return (
    <div className="px-4 sm:px-0">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 mb-6">Хэрэглэгчид</h2>
        
        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('users')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'users'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Иргэн, хувь хүн
            </button>
            <button
              onClick={() => setActiveTab('organizations')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'organizations'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Бусад
            </button>
          </nav>
        </div>
      </div>

      {activeTab === 'users' && (
        <>
          <div className="mb-6 flex justify-end">
            <button
              onClick={() => {
                if (!showUserForm) {
                  setEditingHouseholdId(null)
                  setUserForm({ ovog: '', name: '', email: '', phone: '', role: 'USER', organizationId: '', code: '', address: '', connectionNumber: '15' })
                }
                setShowUserForm(!showUserForm)
              }}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
            >
              {showUserForm ? 'Цуцлах' : 'Шинэ хэрэглэгч'}
            </button>
          </div>

          {householdsLoading ? (
            <p className="text-gray-500">Ачааллаж байна...</p>
          ) : (
            <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Овог</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Нэр</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Хэрэглэгчийн код</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Хаяг</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Утас</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Имэйл</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Шугамын хоолой</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Үйлдэл</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {households.map((h) => (
                    <tr key={h.id}>
                      <td className="px-4 py-3 text-sm text-gray-900">{h.ovog ?? '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{h.name || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{h.code || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{h.address || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{h.phone || '-'}</td>
                      <td className="px-3 py-2 text-sm text-gray-900 whitespace-nowrap">{h.email || '-'}</td>
                      <td className="px-3 py-2 text-sm text-gray-900 text-center">{h.connectionNumber || '-'}</td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleEditHousehold(h)}
                            className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50 transition-colors"
                            title="Засах"
                          >
                            <PencilIcon className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => handleDeleteHousehold(h.id)}
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
              {households.length === 0 && (
                <div className="text-center py-12 text-gray-500">Бүртгэгдсэн хувь хүн байхгүй. Шинэ хэрэглэгч нэмнэ үү.</div>
              )}
            </div>
          )}

          {showUserForm && (
            <div className="fixed inset-0 z-50 overflow-y-auto">
              <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
                <div
                  className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
                  onClick={() => setShowUserForm(false)}
                />

                <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full">
                  <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-6">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-xl font-semibold text-gray-900">
                        {editingHouseholdId ? 'Хувь хүн засах' : 'Шинэ хэрэглэгч бүртгэх'}
                      </h3>
                      <button
                        onClick={() => setShowUserForm(false)}
                        className="text-gray-400 hover:text-gray-500 focus:outline-none"
                      >
                        <span className="sr-only">Хаах</span>
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    <form onSubmit={handleSubmitUser} className="space-y-4">
                      <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Овог</label>
                              <input
                                type="text"
                                value={userForm.ovog}
                                onChange={(e) => setUserForm(prev => ({ ...prev, ovog: e.target.value }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Нэр</label>
                              <input
                                type="text"
                                value={userForm.name}
                                onChange={(e) => setUserForm(prev => ({ ...prev, name: e.target.value }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                                required
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Хэрэглэгчийн код</label>
                            <input
                              type="text"
                              value={userForm.code}
                              onChange={(e) => setUserForm(prev => ({ ...prev, code: e.target.value }))}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Хаяг</label>
                            <input
                              type="text"
                              value={userForm.address}
                              onChange={(e) => setUserForm(prev => ({ ...prev, address: e.target.value }))}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md"
                            />
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Утас</label>
                              <input
                                type="text"
                                value={userForm.phone}
                                onChange={(e) => setUserForm(prev => ({ ...prev, phone: e.target.value }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Имэйл</label>
                              <input
                                type="email"
                                value={userForm.email}
                                onChange={(e) => setUserForm(prev => ({ ...prev, email: e.target.value }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Шугамын хоолой</label>
                            <input
                              type="text"
                              value={userForm.connectionNumber}
                              onChange={(e) => setUserForm(prev => ({ ...prev, connectionNumber: e.target.value }))}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md"
                              placeholder="15"
                            />
                          </div>
                        </>
                      <div className="mt-4 flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => setShowUserForm(false)}
                          className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                        >
                          Цуцлах
                        </button>
                        <button
                          type="submit"
                          className="px-6 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
                        >
                          {editingHouseholdId ? 'Шинэчлэх' : 'Хадгалах'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Хэрэглэгчийн жагсаалт нуугдсан — харуулахгүй */}
        </>
      )}

      {/* Organizations Tab */}
      {activeTab === 'organizations' && (
        <>
          <div className="mb-6 flex justify-end">
            <button
              onClick={() => {
                if (!showOrgForm) {
                  setEditingOrgId(null)
                  setOrgForm({
                    name: '',
                    code: '',
                    address: '',
                    phone: '',
                    email: '',
                    connectionNumber: '',
                    year: String(new Date().getFullYear()),
                    category: 'ORGANIZATION' as OrganizationCategory,
                  })
                }
                setShowOrgForm(!showOrgForm)
              }}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
            >
              {showOrgForm ? 'Цуцлах' : 'Шинэ байгууллага'}
            </button>
          </div>

          {showOrgForm && (
            <div className="fixed inset-0 z-50 overflow-y-auto">
              <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
                <div
                  className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
                  onClick={() => setShowOrgForm(false)}
                />

                <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full">
                  <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-6">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-xl font-semibold text-gray-900">
                        {editingOrgId ? 'Байгууллага засах' : 'Шинэ байгууллага нэмэх'}
                      </h3>
                      <button
                        onClick={() => setShowOrgForm(false)}
                        className="text-gray-400 hover:text-gray-500 focus:outline-none"
                      >
                        <span className="sr-only">Хаах</span>
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    <form onSubmit={handleSubmitOrg} className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Нэр
                          </label>
                          <input
                            type="text"
                            value={orgForm.name}
                            onChange={(e) => setOrgForm(prev => ({ ...prev, name: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Хэрэглэгчийн код
                          </label>
                          <input
                            type="text"
                            value={orgForm.code}
                            onChange={(e) => setOrgForm(prev => ({ ...prev, code: e.target.value }))}
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
                            value={orgForm.address}
                            onChange={(e) => setOrgForm(prev => ({ ...prev, address: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Утас
                          </label>
                          <input
                            type="text"
                            value={orgForm.phone}
                            onChange={(e) => setOrgForm(prev => ({ ...prev, phone: e.target.value }))}
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
                            value={orgForm.email}
                            onChange={(e) => setOrgForm(prev => ({ ...prev, email: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Шугамын хоолой
                          </label>
                          <input
                            type="text"
                            value={orgForm.connectionNumber}
                            onChange={(e) => setOrgForm(prev => ({ ...prev, connectionNumber: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Хэрэглэгчийн төрөл
                        </label>
                        <select
                          value={orgForm.category}
                          onChange={(e) => setOrgForm(prev => ({ ...prev, category: e.target.value as OrganizationCategory }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        >
                          <option value="ORGANIZATION">Төсөвт байгууллага</option>
                          <option value="BUSINESS">Аж ахуйн нэгж</option>
                          <option value="TRANSPORT_DISPOSAL">Зөөврөөр татан зайлуулах</option>
                          <option value="TRANSPORT_RECEPTION">Зөөврүүд хүлээн авах</option>
                          <option value="WATER_POINT">Ус түгээх байр</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Он
                        </label>
                        <input
                          type="number"
                          value={orgForm.year}
                          onChange={(e) => setOrgForm(prev => ({ ...prev, year: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md"
                          placeholder="0"
                          required
                        />
                      </div>
                      <div className="mt-4 flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => setShowOrgForm(false)}
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

          {orgsLoading ? (
            <div className="text-gray-600">Ачааллаж байна...</div>
          ) : (
            <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Нэр
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Хэрэглэгчийн код
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Хаяг
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Утас
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                      Имэйл
                    </th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                      Шугамын хоолой
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Он
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Хэрэглэгчийн төрөл
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Үйлдэл
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {orgs.map((org) => (
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
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                        {org.email || '-'}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900 text-center">
                        {org.connectionNumber || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {org.year || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {org.category ? (CATEGORY_LABELS[org.category] || org.category) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleEditOrg(org)}
                            className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50 transition-colors"
                            title="Засах"
                          >
                            <PencilIcon className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => handleDeleteOrg(org.id)}
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
              {orgs.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  Байгууллага олдсонгүй
                </div>
              )}
            </div>
          )}
        </>
      )}
      {deleteConfirm && (
        <ConfirmModal
          open={true}
          title={
            deleteConfirm.type === 'household'
                ? 'Хувь хүн устгах'
                : 'Байгууллага устгах'
          }
          message={
            deleteConfirm.type === 'household'
                ? 'Та энэ хувь хүнийг устгахдаа итгэлтэй байна уу?'
                : 'Та энэ байгууллагыг устгахдаа итгэлтэй байна уу?'
          }
          onConfirm={doDeleteOrg}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  )
}
