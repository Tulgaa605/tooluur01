'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MagnifyingGlassIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import ConfirmModal from './ConfirmModal'
import { fetchWithAuth } from '@/lib/api'
import * as XLSX from 'xlsx'
import { effectiveBillingCategory } from '@/lib/meter-reading-calc-core'

interface Organization {
  id: string
  name: string
  code?: string | null
  category?: string | null
  year?: number
}

type OrgCustomerCategory =
  | 'ORGANIZATION'
  | 'BUSINESS'
  | 'TRANSPORT_DISPOSAL'
  | 'TRANSPORT_RECEPTION'
  | 'WATER_POINT'

const ORG_CUSTOMER_CATEGORY_LABELS: Record<OrgCustomerCategory, string> = {
  ORGANIZATION: 'Төсөвт байгууллага',
  BUSINESS: 'Аж ахуйн нэгж',
  TRANSPORT_DISPOSAL: 'Зөөврөөр татан зайлуулах',
  TRANSPORT_RECEPTION: 'Зөөврөөр хүлээн авах',
  WATER_POINT: 'Ус түгээх байр',
}

function isOrgCustomerCategory(s: string | null | undefined): s is OrgCustomerCategory {
  return (
    s === 'ORGANIZATION' ||
    s === 'BUSINESS' ||
    s === 'TRANSPORT_DISPOSAL' ||
    s === 'TRANSPORT_RECEPTION' ||
    s === 'WATER_POINT'
  )
}

function customerTypeLabel(category: string | null | undefined): string {
  if (!category || category === 'HOUSEHOLD') return 'Иргэн, хувь хүн'
  if (isOrgCustomerCategory(category)) return ORG_CUSTOMER_CATEGORY_LABELS[category]
  return category
}

function defaultOrgCustomerCategory(org: Organization | undefined): OrgCustomerCategory {
  const raw = org?.category ?? 'ORGANIZATION'
  return isOrgCustomerCategory(raw) ? raw : 'ORGANIZATION'
}

type MeterServiceStatus = 'NORMAL' | 'DAMAGED' | 'REPLACED'
type MeterBillingMode = 'WATER' | 'HEAT' | 'WATER_HEAT'
type WaterChargeSplit = 'BOTH' | 'CLEAN_ONLY' | 'DIRTY_ONLY'

interface Meter {
  id: string
  meterNumber: string
  year: number
  organizationId: string
  billingMode?: MeterBillingMode | string
  waterChargeSplit?: string | null
  serviceStatus?: MeterServiceStatus | string
  defaultHeatUsage?: number | null
  /** Шугамын хоолой (мм) — тоолуур тус бүр */
  pipeDiameterMm?: number | null
  /** Тоолуур тус бүрийн тарифын ангилал (байгууллагын category-аас давхаргана) */
  billingCategory?: string | null
  organization: {
    name: string
    connectionNumber?: string | null
    category?: string | null
  }
}
type OwnerType = '' | 'organization' | 'household'

type MeterFormState = {
  ownerType: OwnerType
  orgCustomerCategory: '' | OrgCustomerCategory
  meterNumber: string
  defaultHeatM3M2: string
  organizationId: string
  year: number
  serviceStatus: MeterServiceStatus
  billingMode: MeterBillingMode
  waterChargeSplit: WaterChargeSplit
  pipeDiameterMm: string
}

const ORG_CUSTOMER_CATEGORY_KEYS = Object.keys(
  ORG_CUSTOMER_CATEGORY_LABELS
) as OrgCustomerCategory[]

function customerCategorySelectOptions(
  placeholder: string,
  includeHouseholdStandard = false
) {
  const opts: { value: string; label: string }[] = []
  if (includeHouseholdStandard) {
    opts.push({ value: '', label: 'Иргэн, хувь хүн (стандарт тариф)' })
  } else {
    opts.push({ value: '', label: placeholder })
  }
  for (const k of ORG_CUSTOMER_CATEGORY_KEYS) {
    opts.push({ value: k, label: ORG_CUSTOMER_CATEGORY_LABELS[k] })
  }
  return opts
}

function createEmptyMeterForm(year: number): MeterFormState {
  return {
    ownerType: '',
    orgCustomerCategory: '',
    meterNumber: '',
    defaultHeatM3M2: '',
    organizationId: '',
    year,
    serviceStatus: 'NORMAL',
    billingMode: 'WATER',
    waterChargeSplit: 'BOTH',
    pipeDiameterMm: '',
  }
}

const nameCollator = new Intl.Collator(['mn', 'ru', 'en'], {
  sensitivity: 'base',
  numeric: true,
  ignorePunctuation: true,
})

export default function MetersContent() {
  const [meters, setMeters] = useState<Meter[]>([])
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [households, setHouseholds] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const currentYear = new Date().getFullYear()
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [excelExportMenu, setExcelExportMenu] = useState<{ x: number; y: number } | null>(null)
  const excelExportMenuRef = useRef<HTMLDivElement | null>(null)
  const [form, setForm] = useState<MeterFormState>(() => createEmptyMeterForm(currentYear))

  function reloadCustomerLists() {
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
  }

  useEffect(() => {
    loadMeters()
    reloadCustomerLists()
  }, [])

  useEffect(() => {
    if (!excelExportMenu) return
    const onMouseDown = (e: MouseEvent) => {
      const el = excelExportMenuRef.current
      if (!el) return
      if (e.target instanceof Node && el.contains(e.target)) return
      setExcelExportMenu(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [excelExportMenu])

  const organizationsSorted = useMemo(() => {
    const arr = [...organizations]
    arr.sort((a, b) => nameCollator.compare(String(a.name ?? ''), String(b.name ?? '')))
    return arr
  }, [organizations])

  const householdsSorted = useMemo(() => {
    const arr = [...households]
    arr.sort((a, b) => nameCollator.compare(String(a.name ?? ''), String(b.name ?? '')))
    return arr
  }, [households])

  const meterCountForSelectedOrg = useMemo(() => {
    if (!form.organizationId || form.ownerType === 'household') return 0
    return meters.filter((m) => m.organizationId === form.organizationId).length
  }, [form.organizationId, form.ownerType, meters])

  const metersFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return meters
    return meters.filter((m) => {
      const name = String(m.organization?.name ?? '').toLowerCase()
      const num = String(m.meterNumber ?? '').toLowerCase()
      const cat = customerTypeLabel(
        effectiveBillingCategory(m.billingCategory, m.organization?.category)
      ).toLowerCase()
      return name.includes(q) || num.includes(q) || cat.includes(q)
    })
  }, [meters, searchQuery])

  const exportMetersXlsx = () => {
    const rows = meters.map((m) => ({
      'Тоолуурын дугаар': m.meterNumber ?? '',
      'Хэрэглэгч': m.organization?.name ?? '',
      'Хэрэглэгчийн төрөл': customerTypeLabel(
        effectiveBillingCategory(m.billingCategory, m.organization?.category)
      ),
      'Он': m.year ?? '',
      'Төлөв':
        String(m.serviceStatus ?? 'NORMAL').toUpperCase() === 'DAMAGED'
          ? 'Эвдэрсэн'
          : String(m.serviceStatus ?? 'NORMAL').toUpperCase() === 'REPLACED'
            ? 'Солигдсон'
            : 'Хэвийн',
      'Тооцоо':
        String(m.billingMode ?? 'WATER').toUpperCase() === 'HEAT'
          ? 'Дулаан'
          : String(m.billingMode ?? 'WATER').toUpperCase() === 'WATER_HEAT'
            ? 'Дулаан ба ус'
            : 'Ус',
      'Ус (цэвэр/бохир)':
        String(m.billingMode ?? 'WATER').toUpperCase() === 'HEAT'
          ? '—'
          : String(m.waterChargeSplit ?? 'BOTH').toUpperCase() === 'CLEAN_ONLY'
            ? 'Зөвхөн цэвэр'
            : String(m.waterChargeSplit ?? 'BOTH').toUpperCase() === 'DIRTY_ONLY'
              ? 'Зөвхөн бохир'
              : 'Цэвэр + бохир',
      'м³/м²':
        String(m.billingMode ?? 'WATER').toUpperCase() === 'HEAT' ||
        String(m.billingMode ?? 'WATER').toUpperCase() === 'WATER_HEAT'
          ? (m.defaultHeatUsage != null && Number(m.defaultHeatUsage) > 0
              ? Number(m.defaultHeatUsage).toFixed(2)
              : '')
          : '',
      'Шугамын хоолой (мм)':
        m.pipeDiameterMm != null && Number(m.pipeDiameterMm) > 0
          ? String(m.pipeDiameterMm)
          : (m.organization?.connectionNumber ?? ''),
    }))
    const ws = XLSX.utils.json_to_sheet(rows, { skipHeader: false })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Meters')
    XLSX.writeFile(wb, `meters-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

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
      })
      .catch(() => {
        setMeters([])
      })
      .finally(() => {
        setLoading(false)
      })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage(null)
    if (!form.ownerType) {
      setMessage({ type: 'error', text: 'Байгууллага эсвэл иргэн, хувь хүн сонгоно уу.' })
      return
    }
    if (!form.organizationId) {
      setMessage({
        type: 'error',
        text:
          form.ownerType === 'household'
            ? 'Иргэн, хувь хүн сонгоно уу.'
            : 'Байгууллага сонгоно уу.',
      })
      return
    }
    if (form.ownerType === 'organization' && !form.orgCustomerCategory) {
      setMessage({ type: 'error', text: 'Хэрэглэгчийн төрөл сонгоно уу.' })
      return
    }
    const billingCategoryPayload = form.orgCustomerCategory
      ? { billingCategory: form.orgCustomerCategory }
      : {}
    const meterNo = String(form.meterNumber ?? '').trim()
    if (!meterNo) {
      setMessage({ type: 'error', text: 'Тоолуурын дугаар заавал оруулна уу.' })
      return
    }
    const needsHeat = form.billingMode === 'HEAT' || form.billingMode === 'WATER_HEAT'
    const pipeDiameter = parseInt(String(form.pipeDiameterMm ?? '').trim(), 10)
    if (!Number.isInteger(pipeDiameter) || pipeDiameter <= 0) {
      setMessage({ type: 'error', text: 'Шугамын хоолойн хэмжээ (мм) заавал оруулна уу.' })
      return
    }
    const heatVal = parseFloat(String(form.defaultHeatM3M2 ?? '').replace(',', '.').trim())
    if (needsHeat && (!Number.isFinite(heatVal) || heatVal <= 0)) {
      setMessage({
        type: 'error',
        text: 'Дулаан / Ус+дулаан сонгосон бол м³/м² заавал оруулна уу (0-ээс их).',
      })
      return
    }
    try {
      const method = editingId ? 'PUT' : 'POST'
      const waterSplitBody =
        form.billingMode === 'WATER' || form.billingMode === 'WATER_HEAT'
          ? { waterChargeSplit: form.waterChargeSplit }
          : {}
      const body = editingId
        ? {
            id: editingId,
            meterNumber: meterNo,
            organizationId: form.organizationId,
            year: form.year,
            serviceStatus: form.serviceStatus || 'NORMAL',
            billingMode: form.billingMode,
            ...waterSplitBody,
            ...(needsHeat ? { defaultHeatUsage: heatVal } : {}),
            pipeDiameterMm: pipeDiameter,
            ...billingCategoryPayload,
          }
        : {
            meterNumber: meterNo,
            organizationId: form.organizationId,
            year: form.year,
            serviceStatus: form.serviceStatus || 'NORMAL',
            billingMode: form.billingMode,
            ...waterSplitBody,
            ...(needsHeat ? { defaultHeatUsage: heatVal } : {}),
            pipeDiameterMm: pipeDiameter,
            ...billingCategoryPayload,
          }

      const res = await fetchWithAuth('/api/meters', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Алдаа гарлаа')

      setMessage({
        type: 'success',
        text: editingId ? 'Амжилттай шинэчиллээ' : 'Амжилттай хадгаллаа',
      })
      setShowForm(false)
      setEditingId(null)
      setForm(createEmptyMeterForm(currentYear))
      loadMeters()
      reloadCustomerLists()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Алдаа гарлаа' })
    }
  }

  const handleEdit = (meter: Meter) => {
    setMessage(null)
    setEditingId(meter.id)
    const inHousehold = households.some(h => h.id === meter.organizationId)
    const st = String(meter.serviceStatus ?? 'NORMAL').toUpperCase()
    const serviceStatus: MeterServiceStatus =
      st === 'DAMAGED' || st === 'REPLACED' ? st : 'NORMAL'
    const bm = String(meter.billingMode ?? 'WATER').toUpperCase()
    const billingMode: MeterBillingMode =
      bm === 'HEAT' || bm === 'WATER_HEAT' ? (bm as MeterBillingMode) : 'WATER'
    const wcs = String(meter.waterChargeSplit ?? 'BOTH').toUpperCase()
    const waterChargeSplit: WaterChargeSplit =
      wcs === 'CLEAN_ONLY' || wcs === 'DIRTY_ONLY' ? (wcs as WaterChargeSplit) : 'BOTH'
    const co = organizations.find((o) => o.id === meter.organizationId)
    const eff = effectiveBillingCategory(
      meter.billingCategory,
      co?.category ?? meter.organization?.category
    )
    setForm({
      ownerType: inHousehold ? 'household' : 'organization',
      orgCustomerCategory: isOrgCustomerCategory(eff)
        ? eff
        : inHousehold
          ? ''
          : defaultOrgCustomerCategory(co),
      meterNumber: meter.meterNumber,
      defaultHeatM3M2:
        meter.defaultHeatUsage != null && Number(meter.defaultHeatUsage) > 0
          ? String(meter.defaultHeatUsage)
          : '',
      organizationId: meter.organizationId,
      year: meter.year ?? currentYear,
      serviceStatus,
      billingMode,
      waterChargeSplit,
      pipeDiameterMm: String(
        meter.pipeDiameterMm != null && Number(meter.pipeDiameterMm) > 0
          ? meter.pipeDiameterMm
          : (meter.organization?.connectionNumber ?? '')
      ),
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
    <div
      className="px-4 sm:px-0"
      onContextMenu={(e) => {
        // Баруун товч: Excel export menu
        e.preventDefault()
        setExcelExportMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <div className="mb-8 flex justify-between items-center">
        <h2 className="text-2xl font-semibold text-gray-900">Тоолуурууд</h2>
        <button
          onClick={() => {
            setShowForm(!showForm)
            setEditingId(null)
            setMessage(null)
            setForm(createEmptyMeterForm(currentYear))
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
                setMessage(null)
                setForm(createEmptyMeterForm(currentYear))
              }}
              aria-hidden="true"
            />
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-xl sm:w-full">
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
                      setMessage(null)
                      setForm(createEmptyMeterForm(currentYear))
                    }}
                    className="text-gray-400 hover:text-gray-500 focus:outline-none"
                  >
                    <span className="sr-only">Хаах</span>
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {message && (
                  <div
                    className={`mb-4 rounded border p-3 text-sm ${
                      message.type === 'success'
                        ? 'bg-green-50 border-green-200 text-green-700'
                        : 'bg-red-50 border-red-200 text-red-700'
                    }`}
                  >
                    {message.text}
                  </div>
                )}
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <div className="flex gap-6 mb-3">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="ownerType"
                          checked={form.ownerType === 'organization'}
                          onChange={() =>
                            setForm((prev) => ({
                              ...prev,
                              ownerType: 'organization',
                              organizationId: '',
                              orgCustomerCategory: '',
                            }))
                          }
                          className="text-primary-600 border-gray-300"
                        />
                        <span>Байгууллага</span>
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="ownerType"
                          checked={form.ownerType === 'household'}
                          onChange={() =>
                            setForm((prev) => ({
                              ...prev,
                              ownerType: 'household',
                              organizationId: '',
                              orgCustomerCategory: '',
                            }))
                          }
                          className="text-primary-600 border-gray-300"
                        />
                        <span>Иргэн, хувь хүн</span>
                      </label>
                    </div>
                    {(form.ownerType === 'organization' || form.ownerType === 'household') && (
                      <>
                        {form.ownerType === 'organization' && (
                          <>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Байгууллага (харилцагч)
                            </label>
                            <select
                              value={form.organizationId}
                              onChange={(e) => {
                                const id = e.target.value
                                const org = organizations.find((o) => o.id === id)
                                setForm((prev) => ({
                                  ...prev,
                                  organizationId: id,
                                  orgCustomerCategory: id ? defaultOrgCustomerCategory(org) : ('' as const),
                                }))
                              }}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md mb-2"
                              required
                            >
                              <option value="">Сонгох</option>
                              {organizationsSorted.map((org) => (
                                <option key={org.id} value={org.id}>
                                  {org.name}
                                  {org.code ? ` — ${org.code}` : ''}
                                </option>
                              ))}
                            </select>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Хэрэглэгчийн төрөл
                            </label>
                            <select
                              value={form.orgCustomerCategory}
                              disabled={!form.organizationId}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  orgCustomerCategory: e.target.value as OrgCustomerCategory | '',
                                }))
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-md"
                              required={Boolean(form.organizationId)}
                            >
                              {!form.organizationId
                                ? customerCategorySelectOptions('Эхлээд байгууллага сонгоно уу').map((o) => (
                                    <option key={o.value || 'placeholder'} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))
                                : customerCategorySelectOptions('Сонгох...').map((o) => (
                                    <option key={o.value || 'pick'} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                            </select>
                            {meterCountForSelectedOrg > 1 && (
                              <p className="mt-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
                                Энэ харилцагчид {meterCountForSelectedOrg} тоолуур бүртгэлтэй. Төрөл нь зөвхөн энэ
                                тоолуурын тарифад хамаарна; сарын заалт тоолуур бүрээр тусад нь оруулна.
                              </p>
                            )}
                          </>
                        )}
                        {form.ownerType === 'household' && (
                          <>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Иргэн, хувь хүн
                            </label>
                            <select
                              value={form.organizationId}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  organizationId: e.target.value,
                                  orgCustomerCategory: '',
                                }))
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-md mb-2"
                              required
                            >
                              <option value="">Сонгох</option>
                              {householdsSorted.map((h) => (
                                <option key={h.id} value={h.id}>
                                  {h.name}
                                </option>
                              ))}
                            </select>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Хэрэглэгчийн төрөл
                            </label>
                            <select
                              value={form.orgCustomerCategory}
                              disabled={!form.organizationId}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  orgCustomerCategory: e.target.value as OrgCustomerCategory | '',
                                }))
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded-md"
                            >
                              {!form.organizationId
                                ? customerCategorySelectOptions('Эхлээд иргэн, хувь хүн сонгоно уу').map((o) => (
                                    <option key={o.value || 'placeholder'} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))
                                : customerCategorySelectOptions('', true).map((o) => (
                                    <option key={o.value || 'household'} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                            </select>
                            <p className="mt-1.5 text-xs text-gray-500">
                              Зөөврөөр татан зайлуулах, хүлээн авах зэрэг төрөл сонговол тухайн тарифаар тооцно.
                            </p>
                          </>
                        )}
                      </>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Тооцооллын төрөл
                    </label>
                    <div
                      className="grid grid-cols-3 rounded-md border border-gray-300 overflow-hidden bg-white"
                      role="group"
                      aria-label="Тооцооллын төрөл"
                    >
                      {(
                        [
                          { id: 'WATER', label: 'Ус' },
                          { id: 'HEAT', label: 'Дулаан' },
                          { id: 'WATER_HEAT', label: 'Дулаан ба ус' },
                        ] as Array<{ id: MeterBillingMode; label: string }>
                      ).map((opt, idx) => {
                        const active = form.billingMode === opt.id
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              const billingMode = opt.id
                              setForm((p) => ({
                                ...p,
                                billingMode,
                                ...(billingMode === 'WATER' ? { defaultHeatM3M2: '' } : {}),
                              }))
                            }}
                            className={[
                              'px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500',
                              active
                                ? 'bg-primary-600 text-white'
                                : 'bg-white text-gray-700 hover:bg-gray-50',
                              idx === 1 ? 'border-x border-gray-300' : '',
                            ].join(' ')}
                            aria-pressed={active}
                          >
                            {opt.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  {(form.billingMode === 'WATER' || form.billingMode === 'WATER_HEAT') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Усны төлбөр (цэвэр / бохир)
                      </label>
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-5">
                        {(
                          [
                            { id: 'BOTH' as WaterChargeSplit, label: 'Цэвэр ус бохир ус' },
                            { id: 'CLEAN_ONLY' as WaterChargeSplit, label: 'Цэвэр ус' },
                            { id: 'DIRTY_ONLY' as WaterChargeSplit, label: 'Бохир ус' },
                          ] as const
                        ).map((opt) => (
                          <label key={opt.id} className="inline-flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="waterChargeSplit"
                              checked={form.waterChargeSplit === opt.id}
                              onChange={() => setForm((p) => ({ ...p, waterChargeSplit: opt.id }))}
                              className="text-primary-600 border-gray-300"
                            />
                            <span className="text-sm text-gray-800">{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {(form.billingMode === 'HEAT' || form.billingMode === 'WATER_HEAT') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        м³/м² (заавал)
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={form.defaultHeatM3M2}
                        onChange={(e) => setForm((prev) => ({ ...prev, defaultHeatM3M2: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        placeholder="Жишээ: 80.5"
                        required
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Заалт оруулахад энэ утгаар анх бөглөгдөнө; сар бүр заалт дээр өөрчилж болно.
                      </p>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Шугамын хоолой (мм)
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={form.pipeDiameterMm}
                      onChange={(e) => setForm(prev => ({ ...prev, pipeDiameterMm: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="Жишээ: 15"
                      required
                    />
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
                  </div>
                  <div className="flex justify-end gap-3 mt-4 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowForm(false)
                        setEditingId(null)
                        setMessage(null)
                        setForm(createEmptyMeterForm(currentYear))
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
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50/80">
          <div className="relative max-w-lg">
            <MagnifyingGlassIcon
              className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Хэрэглэгчийн нэр, төрөл, тоолуурын дугаараар хайх…"
              className="w-full rounded-md border border-gray-300 py-2 pl-10 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              aria-label="Хайлт"
            />
          </div>
        </div>
        <div className="overflow-x-auto px-3 sm:px-4">
          <table className="w-full min-w-[1120px] table-auto divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                  Тоолуурын дугаар
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[15rem] min-w-[15rem] max-w-[15rem]">
                  Хэрэглэгч
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                  Төрөл
                </th>
                <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                  Он
                </th>
                <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                  Төлөв
                </th>
                <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                  Тооцоо
                </th>
                <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase leading-tight">
                  Ус (ц/б)
                </th>
                <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                  м³/м²
                </th>
                <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase leading-tight">
                  <span className="block whitespace-nowrap">Шугамын</span>
                  <span className="block whitespace-nowrap">хоолой (мм)</span>
                </th>
                <th className="px-3 py-3 pr-4 text-right text-xs font-medium text-gray-500 uppercase">
                  Үйлдэл
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {metersFiltered.map((meter) => (
                <tr key={meter.id}>
                  <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-900 tabular-nums">
                    {meter.meterNumber}
                  </td>
                  <td
                    className="px-3 py-3 w-[15rem] min-w-[15rem] max-w-[15rem] text-sm text-gray-900 truncate"
                    title={meter.organization?.name || undefined}
                  >
                    {meter.organization?.name || '-'}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700 whitespace-nowrap">
                    {customerTypeLabel(
                      effectiveBillingCategory(meter.billingCategory, meter.organization?.category)
                    )}
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap text-center text-sm text-gray-900">
                    {meter.year || '-'}
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap text-center text-sm text-gray-700">
                    {String(meter.serviceStatus ?? 'NORMAL').toUpperCase() === 'DAMAGED'
                      ? 'Эвдэрсэн'
                      : String(meter.serviceStatus ?? 'NORMAL').toUpperCase() === 'REPLACED'
                        ? 'Солигдсон'
                        : 'Хэвийн'}
                  </td>
                  <td className="px-2 py-3 text-center text-sm text-gray-700 leading-tight">
                    {String(meter.billingMode ?? 'WATER').toUpperCase() === 'HEAT'
                      ? 'Дулаан'
                      : String(meter.billingMode ?? 'WATER').toUpperCase() === 'WATER_HEAT'
                        ? 'Дулаан ба ус'
                        : 'Ус'}
                  </td>
                  <td className="px-2 py-3 text-center text-sm text-gray-600 leading-tight">
                    {String(meter.billingMode ?? 'WATER').toUpperCase() === 'HEAT'
                      ? '—'
                      : String(meter.waterChargeSplit ?? 'BOTH').toUpperCase() === 'CLEAN_ONLY'
                        ? 'Цэвэр ус'
                        : String(meter.waterChargeSplit ?? 'BOTH').toUpperCase() === 'DIRTY_ONLY'
                          ? 'Бохир ус'
                          : 'Цэвэр ус бохир ус'}
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap text-center text-sm text-gray-700 tabular-nums">
                    {String(meter.billingMode ?? 'WATER').toUpperCase() === 'HEAT' ||
                    String(meter.billingMode ?? 'WATER').toUpperCase() === 'WATER_HEAT'
                      ? (meter.defaultHeatUsage != null && Number(meter.defaultHeatUsage) > 0
                          ? Number(meter.defaultHeatUsage).toFixed(2)
                          : '-')
                      : '-'}
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap text-center text-sm text-gray-700 tabular-nums">
                    {meter.pipeDiameterMm != null && Number(meter.pipeDiameterMm) > 0
                      ? String(meter.pipeDiameterMm)
                      : meter.organization?.connectionNumber || '-'}
                  </td>
                  <td className="px-3 py-3 pr-4 whitespace-nowrap text-sm">
                    <div className="flex justify-end gap-1">
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
        </div>
        {meters.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            Тоолуур олдсонгүй
          </div>
        )}
        {meters.length > 0 && metersFiltered.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            Хайлтын үр дүн олдсонгүй
          </div>
        )} 
      </div>
      {excelExportMenu && (
        <div
          ref={excelExportMenuRef}
          style={{
            position: 'fixed',
            top: excelExportMenu.y,
            left: excelExportMenu.x,
            zIndex: 99999,
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
            padding: 6,
            minWidth: 220,
          }}
        >
          <button
            type="button"
            onClick={() => {
              setExcelExportMenu(null)
              exportMetersXlsx()
            }}
            className="w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-50 rounded-md"
          >
            Excel файл болгох
          </button>
        </div>
      )}
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