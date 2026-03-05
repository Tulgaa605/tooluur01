'use client'

import { useEffect, useMemo, useState } from 'react'

type OrganizationCategory =
  | 'HOUSEHOLD'
  | 'ORGANIZATION'
  | 'BUSINESS'
  | 'TRANSPORT_DISPOSAL'
  | 'TRANSPORT_RECEPTION'
  | 'WATER_POINT'

const CATEGORY_LABELS: Record<OrganizationCategory, string> = {
  HOUSEHOLD: 'Хувь хүн',
  ORGANIZATION: 'Байгууллага',
  BUSINESS: 'Аж ахуйн нэгж',
  TRANSPORT_DISPOSAL: 'Зөөврөөр татан зайлуулах',
  TRANSPORT_RECEPTION: 'Зөөврөөр хүлээн авах',
  WATER_POINT: 'Ус түгээх байр',
}

interface Organization {
  id: string
  name: string
  code?: string | null
  category?: OrganizationCategory
  connectionNumber?: string | null
}

interface Tariff {
  id: string
  organizationId: string
  organization?: Organization
  year: number
  month: number
  baseCleanFee: number
  baseDirtyFee: number
  cleanPerM3: number
  dirtyPerM3: number
}

interface PipeFee {
  id: string
  diameterMm: number
  baseCleanFee: number
  baseDirtyFee: number
}

export default function TariffsContent() {
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [pipeFees, setPipeFees] = useState<PipeFee[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<OrganizationCategory | ''>('')
  const [showTariffModal, setShowTariffModal] = useState(false)
  const [showPipeModal, setShowPipeModal] = useState(false)
  const [pipeForm, setPipeForm] = useState({
    id: '',
    diameterMm: 0,
    baseCleanFee: 0,
    baseDirtyFee: 0,
  })

  const current = useMemo(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  }, [])

  const [form, setForm] = useState({
    organizationId: '',
    year: current.year,
    month: current.month,
    baseCleanFee: 0,
    baseDirtyFee: 0,
    cleanPerM3: 0,
    dirtyPerM3: 0,
  })

  const loadAll = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const [orgRes, tariffRes, pipeRes] = await Promise.all([
        fetch('/api/organizations'),
        fetch('/api/tariffs'),
        fetch('/api/pipe-fees'),
      ])

      const orgData = await orgRes.json()
      const tariffData = await tariffRes.json()
      const pipeData = await pipeRes.json()

      setOrganizations(Array.isArray(orgData) ? orgData : [])
      setTariffs(Array.isArray(tariffData) ? tariffData : [])
      setPipeFees(Array.isArray(pipeData) ? pipeData : [])
    } catch (e: any) {
      setOrganizations([])
      setTariffs([])
      setMessage({ type: 'error', text: e?.message || 'Алдаа гарлаа' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCategory) {
      setMessage({ type: 'error', text: 'Хэрэглэгчийн төрлийг эхлээд сонгоно уу' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/tariffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: selectedCategory,
          year: Number(form.year),
          month: Number(form.month),
          baseCleanFee: Number(form.baseCleanFee),
          baseDirtyFee: Number(form.baseDirtyFee),
          cleanPerM3: Number(form.cleanPerM3),
          dirtyPerM3: Number(form.dirtyPerM3),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Алдаа гарлаа')

      setMessage({ type: 'success', text: 'Тариф амжилттай хадгаллаа' })
      await loadAll()
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Алдаа гарлаа' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Энэ тарифыг устгах уу?')) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/tariffs?id=${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Алдаа гарлаа')
      await loadAll()
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Алдаа гарлаа' })
    } finally {
      setSaving(false)
    }
  }

  const handlePipeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const method = pipeForm.id ? 'PUT' : 'POST'
      const url = pipeForm.id ? '/api/pipe-fees' : '/api/pipe-fees'
      const body = pipeForm.id ? pipeForm : {
        diameterMm: Number(pipeForm.diameterMm),
        baseCleanFee: Number(pipeForm.baseCleanFee),
        baseDirtyFee: Number(pipeForm.baseDirtyFee),
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Алдаа гарлаа')

      setPipeForm({ id: '', diameterMm: 0, baseCleanFee: 0, baseDirtyFee: 0 })
      await loadAll()
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Алдаа гарлаа' })
    } finally {
      setSaving(false)
    }
  }

  const handlePipeEdit = (fee: PipeFee) => {
    setPipeForm({
      id: fee.id,
      diameterMm: fee.diameterMm,
      baseCleanFee: fee.baseCleanFee,
      baseDirtyFee: fee.baseDirtyFee,
    })
    setShowPipeModal(true)
  }

  const handlePipeDelete = async (id: string) => {
    if (!confirm('Энэ шугамын голчийн суурь хураамжийг устгах уу?')) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/pipe-fees?id=${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Алдаа гарлаа')
      await loadAll()
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Алдаа гарлаа' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-gray-600">Ачааллаж байна...</div>
  }

  return (
    <div className="px-4 sm:px-0">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-gray-900">Тариф</h2>
        <p className="mt-1 text-sm text-gray-600">
          Сар бүрийн “цэвэр/бохир суурь хураамж” (мөн м³-ийн үнэ) оруулна.
        </p>
      </div>

      {message && (
        <div
          className={`mb-6 p-4 rounded-md ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="mb-8 flex justify-end">
        <button
          type="button"
          onClick={() => {
            setForm({
              organizationId: '',
              year: current.year,
              month: current.month,
              baseCleanFee: 0,
              baseDirtyFee: 0,
              cleanPerM3: 0,
              dirtyPerM3: 0,
            })
            setSelectedCategory('')
            setShowTariffModal(true)
          }}
          className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
        >
          Шинэ тариф нэмэх
        </button>
      </div>

      <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Он-Сар
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Байгууллага / төрөл
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
                Ц (₮/м³)
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Б (₮/м³)
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Үйлдэл
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {tariffs.map((t) => (
              <tr key={t.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {t.year}-{String(t.month).padStart(2, '0')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {t.organization?.name}
                  {t.organization?.code ? ` (${t.organization.code})` : ''}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {t.organization?.connectionNumber || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {(t.baseCleanFee ?? 0).toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {(t.baseDirtyFee ?? 0).toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {(t.cleanPerM3 ?? 0).toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {(t.dirtyPerM3 ?? 0).toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <button
                    onClick={() => handleDelete(t.id)}
                    disabled={saving}
                    className="text-red-600 hover:text-red-900 disabled:opacity-50"
                  >
                    Устгах
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {tariffs.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            Тариф олдсонгүй
          </div>
        )}
      </div>

      {/* Pipe fees by inlet diameter */}
      <div className="mt-8 bg-white p-6 rounded-lg border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Оролтын шугамын голчийн суурь хураамж
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              Шугамын голч (мм)-оор цэвэр/бохир усны суурь хураамжийг тохируулна.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setPipeForm({ id: '', diameterMm: 0, baseCleanFee: 0, baseDirtyFee: 0 })
              setShowPipeModal(true)
            }}
            className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
          >
            Шугамын голч нэмэх
          </button>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Шугамын голч (мм)
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Цэвэр усны суурь (₮/сар)
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Бохир усны суурь (₮/сар)
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Үйлдэл
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {pipeFees.map((fee) => (
                <tr key={fee.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {fee.diameterMm}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {(fee.baseCleanFee ?? 0).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {(fee.baseDirtyFee ?? 0).toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <button
                      type="button"
                      onClick={() => handlePipeEdit(fee)}
                      className="mr-3 text-blue-600 hover:text-blue-900"
                    >
                      Засах
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePipeDelete(fee.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      Устгах
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pipeFees.length === 0 && (
            <div className="text-center py-8 text-sm text-gray-500">
              Шугамын голчийн суурь хураамж бүртгэгдээгүй байна.
            </div>
          )}
        </div>
      </div>

      {/* Tariff modal */}
      {showTariffModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
            onClick={() => setShowTariffModal(false)}
          />
          <div className="relative bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all max-w-3xl w-full">
            <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold text-gray-900">Шинэ тариф нэмэх</h3>
                <button
                  type="button"
                  onClick={() => setShowTariffModal(false)}
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
                      Хэрэглэгчийн төрөл
                    </label>
                    <select
                      value={selectedCategory}
                      onChange={(e) => {
                        const value = e.target.value as OrganizationCategory | ''
                        setSelectedCategory(value)
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      required
                    >
                      <option value="">Сонгох...</option>
                      {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Он</label>
                      <input
                        type="number"
                        value={form.year}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, year: parseInt(e.target.value) || current.year }))
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Сар</label>
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={form.month}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, month: parseInt(e.target.value) || current.month }))
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Цэвэр ус (₮/м³)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={form.cleanPerM3}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, cleanPerM3: parseFloat(e.target.value) || 0 }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Бохир ус (₮/м³)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={form.dirtyPerM3}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, dirtyPerM3: parseFloat(e.target.value) || 0 }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-4 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowTariffModal(false)}
                    className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Цуцлах
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                  >
                    {saving ? 'Хадгалж байна...' : 'Хадгалах'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Pipe fee modal */}
      {showPipeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
            onClick={() => setShowPipeModal(false)}
          />

          <div className="relative bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all max-w-xl w-full">
            <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold text-gray-900">
                  Шугамын голчийн суурь хураамж {pipeForm.id ? 'засах' : 'нэмэх'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowPipeModal(false)}
                  className="text-gray-400 hover:text-gray-500 focus:outline-none"
                >
                  <span className="sr-only">Хаах</span>
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handlePipeSubmit} className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Шугамын голч (мм)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={pipeForm.diameterMm}
                    onChange={(e) =>
                      setPipeForm((p) => ({ ...p, diameterMm: parseInt(e.target.value) || 0 }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Цэвэр усны суурь (₮/сар)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={pipeForm.baseCleanFee}
                    onChange={(e) =>
                      setPipeForm((p) => ({ ...p, baseCleanFee: parseFloat(e.target.value) || 0 }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Бохир усны суурь (₮/сар)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={pipeForm.baseDirtyFee}
                    onChange={(e) =>
                      setPipeForm((p) => ({ ...p, baseDirtyFee: parseFloat(e.target.value) || 0 }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>

                <div className="flex justify-end gap-3 mt-4 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowPipeModal(false)}
                    className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Цуцлах
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                  >
                    {pipeForm.id ? 'Шинэчлэх' : 'Нэмэх'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}