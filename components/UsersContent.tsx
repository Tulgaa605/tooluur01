'use client'

import { useEffect, useState } from 'react'
import { PencilIcon, TrashIcon } from '@heroicons/react/24/outline'

interface User {
  id: string
  email: string
  name: string
  role: string
  year: number
  phone: string | null
  organizationId: string | null
  organization: {
    name: string
  } | null
}

type OrganizationCategory =
  | 'ORGANIZATION'       // Байгууллага
  | 'BUSINESS'           // Аж ахуйн нэгж
  | 'TRANSPORT_DISPOSAL' // Зөөврөөр татан зайлуулах
  | 'TRANSPORT_RECEPTION'// Зөөврүүд хүлээн авах
  | 'WATER_POINT'        // Ус түгээх байр

interface Organization {
  id: string
  name: string
  code: string | null
  address: string | null
  phone: string | null
  email: string | null
  connectionNumber: string | null
  year: number
  category?: OrganizationCategory
}

export default function UsersContent() {
  const [activeTab, setActiveTab] = useState<'users' | 'organizations'>('users')
  
  // Users state
  const [users, setUsers] = useState<User[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([])
  const [showUserForm, setShowUserForm] = useState(false)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [userForm, setUserForm] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'USER',
    organizationId: '',
    password: '',
  })

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
    year: new Date().getFullYear(),
    category: 'HOUSEHOLD' as OrganizationCategory,
  })

  useEffect(() => {
    loadUsers()
    loadOrganizations()
    fetch('/api/organizations')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setOrganizations(data)
        }
      })
      .catch(() => setOrganizations([]))
  }, [])

  const loadUsers = () => {
    fetch('/api/users')
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
          setUsers([])
        } else if (data && Array.isArray(data)) {
          setUsers(data)
        } else {
          setUsers([])
        }
        setUsersLoading(false)
      })
      .catch(() => {
        setUsers([])
        setUsersLoading(false)
      })
  }

  const loadOrganizations = () => {
    fetch('/api/organizations')
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
          setOrgs(data)
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

  // User handlers
  const handleEditUser = (user: User) => {
    setEditingUserId(user.id)
    setUserForm({
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      role: user.role,
      organizationId: user.organizationId || '',
      password: '',
    })
    setShowUserForm(true)
  }

  const handleDeleteUser = async (id: string) => {
    if (!confirm('Та энэ хэрэглэгчийг устгахдаа итгэлтэй байна уу?')) {
      return
    }

    try {
      const res = await fetch(`/api/users?id=${id}`, {
        method: 'DELETE',
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Алдаа гарлаа')

      loadUsers()
    } catch (err: any) {
      alert(err.message || 'Алдаа гарлаа')
    }
  }

  const handleSubmitUser = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const method = editingUserId ? 'PUT' : 'POST'
      const body = editingUserId ? { ...userForm, id: editingUserId } : userForm

      const res = await fetch(editingUserId ? '/api/users' : '/api/auth/register', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Алдаа гарлаа')

      setShowUserForm(false)
      setEditingUserId(null)
      setUserForm({ name: '', email: '', phone: '', role: 'USER', organizationId: '', password: '' })
      loadUsers()
      loadOrganizations() // Refresh organizations list for dropdown
    } catch (err: any) {
      alert(err.message || 'Алдаа гарлаа')
    }
  }

  // Organization handlers
  const handleEditOrg = (org: Organization) => {
    setEditingOrgId(org.id)
    setOrgForm({
      name: org.name,
      code: org.code || '',
      address: org.address || '',
      phone: org.phone || '',
      email: org.email || '',
      connectionNumber: org.connectionNumber || '',
      year: org.year,
      category: (org.category || 'HOUSEHOLD') as OrganizationCategory,
    })
    setShowOrgForm(true)
  }

  const handleDeleteOrg = async (id: string) => {
    if (!confirm('Та энэ байгууллагыг устгахдаа итгэлтэй байна уу?')) {
      return
    }

    try {
      const res = await fetch(`/api/organizations?id=${id}`, {
        method: 'DELETE',
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Алдаа гарлаа')
      }

      loadOrganizations()
      loadUsers() // Refresh users list in case organization was deleted
    } catch (err: any) {
      alert(err.message || 'Алдаа гарлаа')
    }
  }

  const handleSubmitOrg = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const url = editingOrgId ? '/api/organizations' : '/api/organizations'
      const method = editingOrgId ? 'PUT' : 'POST'
      const body = editingOrgId ? { ...orgForm, id: editingOrgId } : orgForm

      const res = await fetch(url, {
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
      setOrgForm({ name: '', code: '', address: '', phone: '', email: '', connectionNumber: '', year: new Date().getFullYear(), category: 'HOUSEHOLD' as OrganizationCategory })
      loadOrganizations()
    } catch (err: any) {
      alert(err.message || 'Алдаа гарлаа')
    }
  }

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'ACCOUNTANT': return 'Нягтлан'
      case 'MANAGER': return 'Захирал'
      case 'USER': return 'Хэрэглэгч'
      default: return role
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
              Хувь хүн
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
                  setEditingUserId(null)
                  setUserForm({ name: '', email: '', phone: '', role: 'USER', organizationId: '', password: '' })
                }
                setShowUserForm(!showUserForm)
              }}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
            >
              {showUserForm ? 'Цуцлах' : 'Шинэ хэрэглэгч'}
            </button>
          </div>

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
                        {editingUserId ? 'Хэрэглэгч засах' : 'Шинэ хэрэглэгч нэмэх'}
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
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Нэр
                          </label>
                          <input
                            type="text"
                            value={userForm.name}
                            onChange={(e) => setUserForm(prev => ({ ...prev, name: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Имэйл
                          </label>
                          <input
                            type="email"
                            value={userForm.email}
                            onChange={(e) => setUserForm(prev => ({ ...prev, email: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                            required
                            disabled={!!editingUserId}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Утас
                          </label>
                          <input
                            type="text"
                            value={userForm.phone}
                            onChange={(e) => setUserForm(prev => ({ ...prev, phone: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Эрх
                          </label>
                          <select
                            value={userForm.role}
                            onChange={(e) => setUserForm(prev => ({ ...prev, role: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                            required
                          >
                            <option value="USER">Хэрэглэгч</option>
                            <option value="ACCOUNTANT">Нягтлан</option>
                            <option value="MANAGER">Захирал</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Байгууллага
                        </label>
                        <select
                          value={userForm.organizationId}
                          onChange={(e) => setUserForm(prev => ({ ...prev, organizationId: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        >
                          <option value="">Сонгох</option>
                          {organizations.map(org => (
                            <option key={org.id} value={org.id}>{org.name}</option>
                          ))}
                        </select>
                      </div>
                      {!editingUserId && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Нууц үг
                          </label>
                          <input
                            type="password"
                            value={userForm.password}
                            onChange={(e) => setUserForm(prev => ({ ...prev, password: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                            required={!editingUserId}
                          />
                        </div>
                      )}
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
                          {editingUserId ? 'Шинэчлэх' : 'Хадгалах'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          )}

          {usersLoading ? (
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
                      Имэйл
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Эрх
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Байгууллага
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
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {user.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {user.email}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                          {getRoleLabel(user.role)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {user.organization?.name || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {user.year || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleEditUser(user)}
                            className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50 transition-colors"
                            title="Засах"
                          >
                            <PencilIcon className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => handleDeleteUser(user.id)}
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
              {users.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  Хэрэглэгч олдсонгүй
                </div>
              )}
            </div>
          )}
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
                  setOrgForm({ name: '', code: '', address: '', phone: '', email: '', connectionNumber: '', year: new Date().getFullYear(), category: 'HOUSEHOLD' as OrganizationCategory })
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
                            Код
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
                          <option value="ORGANIZATION">Байгууллага</option>
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
                          onChange={(e) => setOrgForm(prev => ({ ...prev, year: parseInt(e.target.value) || new Date().getFullYear() }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md"
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
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Имэйл
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Шугамын хоолой
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
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {org.email || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {org.connectionNumber || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {org.year || '-'}
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
    </div>
  )
}
