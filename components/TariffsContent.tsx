'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import ConfirmModal from './ConfirmModal'
import { fetchWithAuth } from '@/lib/api'
import { HEAT_CATEGORY_DEFAULT_RATES, heatDefaultsForCategory } from '@/lib/heat-tariff-defaults'

type OrganizationCategory =
  | 'HOUSEHOLD'
  | 'ORGANIZATION'
  | 'BUSINESS'
  | 'TRANSPORT_DISPOSAL'
  | 'TRANSPORT_RECEPTION'
  | 'WATER_POINT'

const CATEGORY_LABELS: Record<OrganizationCategory, string> = {
  HOUSEHOLD: 'Иргэн,увь хүн',
  ORGANIZATION: 'Төсөвт байгууллага',
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
  organizationId?: string
  organization?: Organization
  kind?: 'org' | 'category'
  category?: OrganizationCategory
  year?: number
  month?: number
  baseCleanFee: number
  baseDirtyFee: number
  cleanPerM3: number
  dirtyPerM3: number
  heatBaseFee?: number
  heatPerM3?: number
  heatPerM2?: number
  updatedAt?: string
}

interface PipeFee {
  id: string
  diameterMm: number
  baseCleanFee: number
  baseDirtyFee: number
}

type TariffEditTarget =
  | { mode: 'new' }
  | { mode: 'category'; tariff: Tariff }
  | { mode: 'org'; tariff: Tariff }

export default function TariffsContent() {
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [pipeFees, setPipeFees] = useState<PipeFee[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<OrganizationCategory | ''>('')
  const [showTariffModal, setShowTariffModal] = useState(false)
  const [showPipeModal, setShowPipeModal] = useState(false)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const [historyCategory, setHistoryCategory] = useState<OrganizationCategory | null>(null)
  const [historyRows, setHistoryRows] = useState<Array<{ year: number; month: number; cleanPerM3: number; dirtyPerM3: number }>>([])
  // Category тариф нэмэх үед сонгосон он/сар-г хадгалж тухайн period дээр organization мөрүүдийг нуух, мөн category мөрийн Он-Сарыг зөв харуулахад ашиглана.
  const [appliedCategoryPeriod, setAppliedCategoryPeriod] = useState<{
    category: OrganizationCategory
    year: number
    month: number
  } | null>(null)
  const [pipeForm, setPipeForm] = useState<{
    id: string
    diameterMm: string
    baseCleanFee: string
    baseDirtyFee: string
  }>({
    id: '',
    diameterMm: '',
    baseCleanFee: '',
    baseDirtyFee: '',
  })

  const current = useMemo(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  }, [])

  const [form, setForm] = useState({
    organizationId: '',
    year: String(current.year),
    month: String(current.month),
    cleanPerM3: '',
    dirtyPerM3: '',
    baseCleanFee: '',
    baseDirtyFee: '',
    heatBaseFee: '',
    heatPerM3: '',
    heatPerM2: '',
  })
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'tariff' | 'pipe'; id: string; part?: 'water' | 'heat' } | null>(null)
  const [tariffEditTarget, setTariffEditTarget] = useState<TariffEditTarget>({ mode: 'new' })

  const loadAll = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const [orgRes, tariffRes, pipeRes] = await Promise.all([
        fetchWithAuth('/api/organizations?customersOnly=1'),
        fetchWithAuth('/api/tariffs?includeCategory=1'),
        fetchWithAuth('/api/pipe-fees'),
      ])

      const orgData = await orgRes.json()
      const tariffData = await tariffRes.json()
      const pipeData = await pipeRes.json()

      if (!tariffRes.ok) {
        const errText =
          typeof tariffData?.error === 'string'
            ? tariffData.error
            : 'Тарифын мэдээлэл ачааллахад алдаа гарлаа'
        setMessage({ type: 'error', text: errText })
        setTariffs([])
      } else {
        setTariffs(Array.isArray(tariffData) ? tariffData : [])
      }

      setOrganizations(Array.isArray(orgData) ? orgData : [])
      setPipeFees(Array.isArray(pipeData) ? pipeData : [])
    } catch (e) {
      setOrganizations([])
      setTariffs([])
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Алдаа гарлаа' })
    } finally {
      setLoading(false)
    }
  }

  /** Хадгалах/устгасны дараа бүх хуудсыг ачаалахгүйгээр зөвхөн тариф (орг + төрөл) */
  const reloadTariffsSilently = async () => {
    try {
      const tariffRes = await fetchWithAuth('/api/tariffs?includeCategory=1')
      const tariffData = await tariffRes.json()
      if (!tariffRes.ok) {
        const errText =
          typeof tariffData?.error === 'string'
            ? tariffData.error
            : 'Тарифын мэдээлэл ачааллахад алдаа гарлаа'
        setMessage({ type: 'error', text: errText })
        return
      }
      setTariffs(Array.isArray(tariffData) ? tariffData : [])
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Алдаа гарлаа' })
    }
  }

  const reloadPipeFeesSilently = async () => {
    try {
      const pipeRes = await fetchWithAuth('/api/pipe-fees')
      const pipeData = await pipeRes.json()
      if (pipeRes.ok && Array.isArray(pipeData)) setPipeFees(pipeData)
    } catch {
      /* үл тоомсорлох — дараагийн loadAll-д засагдана */
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // UI дээр type/category тариф (kind === 'category') байвал тухайн category-н current month-ийн
  // organizationTariff мөрүүдийг нууж "2 удаа нэмэгдсэн" мэт харагдахаас сэргийлнэ.
  const categoryTariffCategories = useMemo(() => {
    const s = new Set<OrganizationCategory>()
    for (const t of tariffs) {
      if (t.kind === 'category' && t.category) {
        s.add(t.category)
      }
    }
    return s
  }, [tariffs])

  const visibleTariffs = useMemo(() => {
    return tariffs.filter((t) => {
      // Category тариф үргэлж харагдана
      if (t.kind === 'category') return true
      const orgCategory = t.organization?.category
      if (!orgCategory) return true

      const orgCat = orgCategory as OrganizationCategory
      const isAppliedPeriod =
        appliedCategoryPeriod &&
        appliedCategoryPeriod.category === orgCat &&
        t.year === appliedCategoryPeriod.year &&
        t.month === appliedCategoryPeriod.month

      // Хэрэв саяхан category тариф дээр он/сар сонгож хадгалсан бол тэр period дээрх organization мөрүүдийг нуух.
      if (isAppliedPeriod) {
        return !categoryTariffCategories.has(orgCat)
      }

      // Өмнөх зангилаа: current month дээр category тариф байгаа бол organization мөрүүдийг нуух.
      if (!appliedCategoryPeriod && t.year === current.year && t.month === current.month) {
        return !categoryTariffCategories.has(orgCat)
      }
      return true
    })
  }, [tariffs, categoryTariffCategories, current.year, current.month, appliedCategoryPeriod])

  const getTariffPeriod = (t: Tariff): { year: number; month: number } => {
    if (t.kind === 'category') {
      const cat = t.category as OrganizationCategory | undefined
      if (cat && appliedCategoryPeriod && appliedCategoryPeriod.category === cat) {
        return { year: appliedCategoryPeriod.year, month: appliedCategoryPeriod.month }
      }
      return { year: current.year, month: current.month }
    }
    return {
      year: Number(t.year) || 0,
      month: Number(t.month) || 0,
    }
  }

  const sortedVisibleTariffs = useMemo(() => {
    const list = [...visibleTariffs]
    list.sort((a, b) => {
      const ap = getTariffPeriod(a)
      const bp = getTariffPeriod(b)
      if (bp.year !== ap.year) return bp.year - ap.year
      if (bp.month !== ap.month) return bp.month - ap.month
      const aUpdated = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
      const bUpdated = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
      if (bUpdated !== aUpdated) return bUpdated - aUpdated
      return String(b.id).localeCompare(String(a.id))
    })
    return list
  }, [visibleTariffs, appliedCategoryPeriod, current.year, current.month])

  const latestTariffsOnly = useMemo(() => {
    const picked = new Map<string, Tariff>()
    for (const t of sortedVisibleTariffs) {
      const category =
        t.kind === 'category'
          ? (t.category as OrganizationCategory | undefined)
          : (t.organization?.category as OrganizationCategory | undefined)
      if (!category) {
        picked.set(`id:${t.id}`, t)
        continue
      }
      const key = `cat:${category}`
      if (!picked.has(key)) {
        picked.set(key, t)
      }
    }
    return Array.from(picked.values())
  }, [sortedVisibleTariffs])

  // Дулааны тариф зөвхөн 3 төрөл дээр байх ёстой.
  const HEAT_CATEGORIES = useMemo(
    () => new Set<OrganizationCategory>(['ORGANIZATION', 'BUSINESS', 'HOUSEHOLD']),
    []
  )
  const latestHeatTariffsOnly = useMemo(() => {
    return latestTariffsOnly.filter((t) => {
      const cat =
        t.kind === 'category'
          ? (t.category as OrganizationCategory | undefined)
          : (t.organization?.category as OrganizationCategory | undefined)
      if (!cat) return false
      return HEAT_CATEGORIES.has(cat)
    })
  }, [latestTariffsOnly, HEAT_CATEGORIES])

  const openTariffHistory = (t: Tariff) => {
    const category =
      t.kind === 'category'
        ? (t.category as OrganizationCategory | undefined)
        : (t.organization?.category as OrganizationCategory | undefined)
    if (!category) return

    const clickedPeriod = getTariffPeriod(t)
    const grouped = new Map<string, { year: number; month: number; cleanPerM3: number; dirtyPerM3: number; updatedAt: number }>()
    for (const row of tariffs) {
      if (row.kind === 'category') continue
      const rowCategory = row.organization?.category as OrganizationCategory | undefined
      if (!rowCategory || rowCategory !== category) continue
      const year = Number(row.year) || 0
      const month = Number(row.month) || 0
      if (!year || !month) continue
      // "өмнөх сарууд" тул дарсан мөртэй ижил period-ийг алгасна
      if (year === clickedPeriod.year && month === clickedPeriod.month) continue

      const key = `${year}-${month}`
      const updatedAt = row.updatedAt ? new Date(row.updatedAt).getTime() : 0
      const existing = grouped.get(key)
      if (!existing || updatedAt > existing.updatedAt) {
        grouped.set(key, {
          year,
          month,
          cleanPerM3: row.cleanPerM3 ?? 0,
          dirtyPerM3: row.dirtyPerM3 ?? 0,
          updatedAt,
        })
      }
    }

    const rows = Array.from(grouped.values())
      .sort((a, b) => (b.year - a.year) || (b.month - a.month) || (b.updatedAt - a.updatedAt))
      .map(({ year, month, cleanPerM3, dirtyPerM3 }) => ({ year, month, cleanPerM3, dirtyPerM3 }))

    setHistoryCategory(category)
    setHistoryRows(rows)
    setShowHistoryModal(true)
  }

  const closeTariffModal = () => {
    setShowTariffModal(false)
    setTariffEditTarget({ mode: 'new' })
  }

  const openNewTariffModal = () => {
    setTariffEditTarget({ mode: 'new' })
    setForm({
      organizationId: '',
      year: String(current.year),
      month: String(current.month),
      cleanPerM3: '',
      dirtyPerM3: '',
      baseCleanFee: '',
      baseDirtyFee: '',
      heatBaseFee: '',
      heatPerM3: '',
      heatPerM2: '',
    })
    setSelectedCategory('')
    setShowTariffModal(true)
  }

  const handleEditTariff = (t: Tariff, e: React.MouseEvent) => {
    e.stopPropagation()
    if (t.kind === 'category' && t.category) {
      const p = getTariffPeriod(t)
      setTariffEditTarget({ mode: 'category', tariff: t })
      setSelectedCategory(t.category)
      setForm({
        organizationId: '',
        year: String(p.year),
        month: String(p.month),
        cleanPerM3: String(t.cleanPerM3 ?? 0),
        dirtyPerM3: String(t.dirtyPerM3 ?? 0),
        baseCleanFee: '',
        baseDirtyFee: '',
        heatBaseFee: String(t.heatBaseFee ?? 0),
        heatPerM3: String(t.heatPerM3 ?? 0),
        heatPerM2: String(t.heatPerM2 ?? 0),
      })
    } else {
      setTariffEditTarget({ mode: 'org', tariff: t })
      setSelectedCategory('')
      setForm({
        organizationId: t.organizationId || '',
        year: String(t.year ?? current.year),
        month: String(t.month ?? current.month),
        cleanPerM3: String(t.cleanPerM3 ?? 0),
        dirtyPerM3: String(t.dirtyPerM3 ?? 0),
        baseCleanFee: String(t.baseCleanFee ?? 0),
        baseDirtyFee: String(t.baseDirtyFee ?? 0),
        heatBaseFee: String(t.heatBaseFee ?? 0),
        heatPerM3: String(t.heatPerM3 ?? 0),
        heatPerM2: String(t.heatPerM2 ?? 0),
      })
    }
    setShowTariffModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setMessage(null)
    try {
      if (tariffEditTarget.mode === 'org') {
        const t = tariffEditTarget.tariff
        const res = await fetchWithAuth('/api/tariffs', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: t.id,
            cleanPerM3: Number(form.cleanPerM3) || 0,
            dirtyPerM3: Number(form.dirtyPerM3) || 0,
            baseCleanFee: Number(form.baseCleanFee) || 0,
            baseDirtyFee: Number(form.baseDirtyFee) || 0,
            heatBaseFee: Number(form.heatBaseFee) || 0,
            heatPerM3: Number(form.heatPerM3) || 0,
            heatPerM2: Number(form.heatPerM2) || 0,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || 'Алдаа гарлаа')
        closeTariffModal()
        await reloadTariffsSilently()
        setMessage({ type: 'success', text: 'Тариф амжилттай шинэчлэгдлээ' })
        return
      }

      if (!selectedCategory) {
        setMessage({ type: 'error', text: 'Хэрэглэгчийн төрлийг эхлээд сонгоно уу' })
        setSaving(false)
        savingRef.current = false
        return
      }
      const year = Number(form.year) || current.year
      const month = Number(form.month) || current.month
      const res = await fetchWithAuth('/api/tariffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: selectedCategory,
          year,
          month,
          baseCleanFee: 0,
          baseDirtyFee: 0,
          cleanPerM3: Number(form.cleanPerM3) || 0,
          dirtyPerM3: Number(form.dirtyPerM3) || 0,
          heatBaseFee: Number(form.heatBaseFee) || 0,
          heatPerM3: Number(form.heatPerM3) || 0,
          heatPerM2: Number(form.heatPerM2) || 0,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Алдаа гарлаа')

      closeTariffModal()
      setAppliedCategoryPeriod({
        category: selectedCategory,
        year,
        month,
      })
      await reloadTariffsSilently()
      setMessage({ type: 'success', text: data.message || 'Тариф амжилттай хадгаллаа' })
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Алдаа гарлаа' })
    } finally {
      setSaving(false)
      savingRef.current = false
    }
  }

  const handleDelete = (id: string, part?: 'water' | 'heat') => {
    setDeleteConfirm({ type: 'tariff', id, part })
  }

  const doDeleteTariff = async () => {
    if (!deleteConfirm || deleteConfirm.type !== 'tariff') return
    const id = deleteConfirm.id
    const part = deleteConfirm.part
    setDeleteConfirm(null)
    setSaving(true)
    setMessage(null)
    try {
      const t = tariffs.find((x) => x.id === id)
      const url =
        t?.kind === 'category' && t.category
          ? `/api/tariffs?kind=category&category=${encodeURIComponent(t.category)}${part ? `&part=${part}` : ''}`
          : `/api/tariffs?id=${id}${part ? `&part=${part}` : ''}`
      const res = await fetchWithAuth(url, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Алдаа гарлаа')
      await reloadTariffsSilently()
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Алдаа гарлаа' })
    } finally {
      setSaving(false)
    }
  }

  const handlePipeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setDeleteConfirm(null)
    setSaving(true)
    setMessage(null)
    try {
      const method = pipeForm.id ? 'PUT' : 'POST'
      const url = pipeForm.id ? '/api/pipe-fees' : '/api/pipe-fees'
      const diameterMm = Number(pipeForm.diameterMm) || 0
      const baseCleanFee = Number(pipeForm.baseCleanFee) || 0
      const baseDirtyFee = Number(pipeForm.baseDirtyFee) || 0
      const body = pipeForm.id
        ? { id: pipeForm.id, diameterMm, baseCleanFee, baseDirtyFee }
        : { diameterMm, baseCleanFee, baseDirtyFee }

      const res = await fetchWithAuth(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Алдаа гарлаа')

      // Хадгалсны дараа модалийг хаах
      setShowPipeModal(false)
      setPipeForm({ id: '', diameterMm: '', baseCleanFee: '', baseDirtyFee: '' })
      await reloadPipeFeesSilently()
      setMessage({ type: 'success', text: 'Шугамын суурь хураамж амжилттай хадгалагдлаа' })
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Алдаа гарлаа' })
    } finally {
      setSaving(false)
    }
  }

  const handlePipeEdit = (fee: PipeFee) => {
    setPipeForm({
      id: fee.id,
      diameterMm: String(fee.diameterMm),
      baseCleanFee: String(fee.baseCleanFee),
      baseDirtyFee: String(fee.baseDirtyFee),
    })
    setShowPipeModal(true)
  }

  const handlePipeDelete = (id: string) => {
    setDeleteConfirm({ type: 'pipe', id })
  }

  const doDeletePipe = async () => {
    if (!deleteConfirm || deleteConfirm.type !== 'pipe') return
    const id = deleteConfirm.id
    setDeleteConfirm(null)
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetchWithAuth(`/api/pipe-fees?id=${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Алдаа гарлаа')
      await reloadPipeFeesSilently()
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Алдаа гарлаа' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-gray-600">Ачааллаж байна...</div>
  }

  return (
    <div className="px-4 sm:px-0">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Тариф</h2>
          <p className="mt-1 text-sm text-gray-600">
            Доор ус болон дулааны тарифыг <strong>тусдаа хүснэгтээр</strong> харуулна. Усны суурь хураамж шугамын голчоор доорх
            хэсгээс автоматаар тооцогдоно.
          </p>
        </div>
        <button
          type="button"
          onClick={openNewTariffModal}
          className="shrink-0 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
        >
          Шинэ тариф нэмэх
        </button>
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

      {latestTariffsOnly.length === 0 ? (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 text-center py-12 text-gray-500">
          Тариф олдсонгүй
        </div>
      ) : (
        <div className="space-y-8">
          <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Он-Сар</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Хэрэглэгчийн төрөл
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ц (₮/м³)</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Б (₮/м³)</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Үйлдэл</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {latestTariffsOnly.map((t) => (
                  <tr
                    key={`water:${t.id}`}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => openTariffHistory(t)}
                    title="Дарж өмнөх саруудын тариф харах"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {t.kind === 'category' ? (
                        (() => {
                          const cat = t.category as OrganizationCategory | undefined
                          const year =
                            appliedCategoryPeriod && cat && appliedCategoryPeriod.category === cat
                              ? appliedCategoryPeriod.year
                              : current.year
                          const month =
                            appliedCategoryPeriod && cat && appliedCategoryPeriod.category === cat
                              ? appliedCategoryPeriod.month
                              : current.month
                          return `${year}-${String(month).padStart(2, '0')}`
                        })()
                      ) : (
                        `${t.year}-${String(t.month).padStart(2, '0')}`
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {t.kind === 'category'
                        ? (t.category ? CATEGORY_LABELS[t.category] ?? t.category : '-')
                        : t.organization?.category
                          ? CATEGORY_LABELS[t.organization.category as OrganizationCategory] ??
                            t.organization.category
                          : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {(t.cleanPerM3 ?? 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {(t.dirtyPerM3 ?? 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={(e) => handleEditTariff(t, e)}
                          disabled={saving}
                          className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50 transition-colors disabled:opacity-50"
                          title="Засах"
                        >
                          <PencilIcon className="h-5 w-5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(t.id, 'water')
                          }}
                          disabled={saving}
                          className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
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

          <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Он-Сар</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Хэрэглэгчийн төрөл
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Суурь (₮/сар)</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">₮/м³</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">₮/м²</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Үйлдэл</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {latestHeatTariffsOnly.map((t) => (
                  <tr
                    key={`heat:${t.id}`}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => openTariffHistory(t)}
                    title="Дарж өмнөх саруудын тариф харах"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {t.kind === 'category' ? (
                        (() => {
                          const cat = t.category as OrganizationCategory | undefined
                          const year =
                            appliedCategoryPeriod && cat && appliedCategoryPeriod.category === cat
                              ? appliedCategoryPeriod.year
                              : current.year
                          const month =
                            appliedCategoryPeriod && cat && appliedCategoryPeriod.category === cat
                              ? appliedCategoryPeriod.month
                              : current.month
                          return `${year}-${String(month).padStart(2, '0')}`
                        })()
                      ) : (
                        `${t.year}-${String(t.month).padStart(2, '0')}`
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {t.kind === 'category'
                        ? (t.category ? CATEGORY_LABELS[t.category] ?? t.category : '-')
                        : t.organization?.category
                          ? CATEGORY_LABELS[t.organization.category as OrganizationCategory] ??
                            t.organization.category
                          : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {(t.heatBaseFee ?? 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {(t.heatPerM3 ?? 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {(t.heatPerM2 ?? 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={(e) => handleEditTariff(t, e)}
                          disabled={saving}
                          className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50 transition-colors disabled:opacity-50"
                          title="Засах"
                        >
                          <PencilIcon className="h-5 w-5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(t.id, 'heat')
                          }}
                          disabled={saving}
                          className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
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
        </div>
      )}

      {/* Pipe fees by inlet diameter */}
      <div className="mt-8 bg-white p-6 rounded-lg border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Оролтын шугамын голчийн суурь хураамж
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              setPipeForm({ id: '', diameterMm: '', baseCleanFee: '', baseDirtyFee: '' })
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
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handlePipeEdit(fee)}
                        className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50 transition-colors"
                        title="Засах"
                      >
                        <PencilIcon className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePipeDelete(fee.id)}
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
            onClick={closeTariffModal}
          />
          <div className="relative bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all max-w-3xl w-full">
            <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold text-gray-900">
                  {tariffEditTarget.mode === 'new' ? 'Шинэ тариф нэмэх' : 'Тариф засах'}
                </h3>
                <button
                  type="button"
                  onClick={closeTariffModal}
                  className="text-gray-400 hover:text-gray-500 focus:outline-none"
                >
                  <span className="sr-only">Хаах</span>
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {tariffEditTarget.mode === 'org' && (
                  <p className="text-sm text-gray-700">
                    <span className="font-medium">Байгууллага:</span>{' '}
                    {tariffEditTarget.tariff.organization?.name ?? '-'}
                    {tariffEditTarget.tariff.organization?.category ? (
                      <span className="text-gray-500">
                        {' '}
                        (
                        {CATEGORY_LABELS[
                          tariffEditTarget.tariff.organization.category as OrganizationCategory
                        ] ?? tariffEditTarget.tariff.organization.category}
                        )
                      </span>
                    ) : null}
                  </p>
                )}
                {tariffEditTarget.mode !== 'org' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Хэрэглэгчийн төрөл
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        Нэмэгдсэн тариф шинэчлэлт хийх хүртэл идэвхтэй байна.
                      </p>
                      <select
                        value={selectedCategory}
                        onChange={(e) => {
                          const v = e.target.value as OrganizationCategory | ''
                          setSelectedCategory(v)
                          if (tariffEditTarget.mode === 'new' && v) {
                            const { heatPerM3, heatPerM2 } = heatDefaultsForCategory(v)
                            setForm((p) => ({
                              ...p,
                              heatPerM3: String(heatPerM3),
                              heatPerM2: String(heatPerM2),
                            }))
                          }
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-100 disabled:text-gray-600"
                        required
                        disabled={tariffEditTarget.mode === 'category'}
                      >
                        <option value="">Сонгох...</option>
                        {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Он
                    </label>
                    <input
                      type="number"
                      min={2000}
                      max={2100}
                      step={1}
                      value={form.year}
                      onChange={(e) => setForm((p) => ({ ...p, year: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-100"
                      placeholder={String(current.year)}
                      required
                      disabled={tariffEditTarget.mode === 'org'}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Сар
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      step={1}
                      value={form.month}
                      onChange={(e) => setForm((p) => ({ ...p, month: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-100"
                      placeholder={String(current.month)}
                      required
                      disabled={tariffEditTarget.mode === 'org'}
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 space-y-4">
                  <h4 className="text-sm font-semibold text-gray-900 border-b border-amber-200/80 pb-2">
                    Усны тариф
                  </h4>
                  {tariffEditTarget.mode === 'org' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Цэвэр усны суурь (₮/сар)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={form.baseCleanFee}
                          onChange={(e) => setForm((p) => ({ ...p, baseCleanFee: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white"
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
                          value={form.baseDirtyFee}
                          onChange={(e) => setForm((p) => ({ ...p, baseDirtyFee: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white"
                        />
                      </div>
                    </div>
                  )}

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
                        onChange={(e) => setForm((p) => ({ ...p, cleanPerM3: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white"
                        placeholder="0"
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
                        onChange={(e) => setForm((p) => ({ ...p, dirtyPerM3: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white"
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-orange-200 bg-orange-50/40 p-4 space-y-4 mt-4">
                  <h4 className="text-sm font-semibold text-gray-900 border-b border-orange-200/80 pb-2">
                    Дулааны тариф
                  </h4>
                  <ul className="text-xs text-gray-600 list-disc list-inside space-y-0.5">
                    {HEAT_CATEGORY_DEFAULT_RATES.map((row) => (
                      <li key={row.category}>
                        {row.labelMn}:{' '}
                        {row.heatPerM3 > 0 ? `1 м³ × ${row.heatPerM3} ₮` : `1 м² × ${row.heatPerM2} ₮`}
                      </li>
                    ))}
                  </ul>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Дулаан суурь (₮/сар)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={form.heatBaseFee}
                        onChange={(e) => setForm((p) => ({ ...p, heatBaseFee: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Дулаан (₮/м³) — төсөвт, ААН
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={form.heatPerM3}
                        onChange={(e) => setForm((p) => ({ ...p, heatPerM3: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Дулаан (₮/м²) — айл өрх
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={form.heatPerM2}
                        onChange={(e) => setForm((p) => ({ ...p, heatPerM2: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white"
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-4 pt-2">
                  <button
                    type="button"
                    onClick={closeTariffModal}
                    className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Цуцлах
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                  >
                    {saving ? 'Хадгалж байна...' : tariffEditTarget.mode === 'new' ? 'Хадгалах' : 'Шинэчлэх'}
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
                      setPipeForm((p) => ({ ...p, diameterMm: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="0"
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
                      setPipeForm((p) => ({ ...p, baseCleanFee: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="0"
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
                      setPipeForm((p) => ({ ...p, baseDirtyFee: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="0"
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
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
            onClick={() => setShowHistoryModal(false)}
          />
          <div className="relative bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all max-w-2xl w-full">
            <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold text-gray-900">
                  Өмнөх саруудын тариф{historyCategory ? ` — ${CATEGORY_LABELS[historyCategory] ?? historyCategory}` : ''}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowHistoryModal(false)}
                  className="text-gray-400 hover:text-gray-500 focus:outline-none"
                >
                  <span className="sr-only">Хаах</span>
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {historyRows.length === 0 ? (
                <div className="text-sm text-gray-600 py-6">Өмнөх сарын тариф олдсонгүй.</div>
              ) : (
                <div className="overflow-x-auto border border-gray-200 rounded-md">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Он-Сар</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Ц (₮/м³)</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Б (₮/м³)</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {historyRows.map((r) => (
                        <tr key={`${r.year}-${r.month}`}>
                          <td className="px-4 py-2 text-sm text-gray-900">
                            {r.year}-{String(r.month).padStart(2, '0')}
                          </td>
                          <td className="px-4 py-2 text-sm text-right text-gray-900">
                            {(r.cleanPerM3 ?? 0).toFixed(2)}
                          </td>
                          <td className="px-4 py-2 text-sm text-right text-gray-900">
                            {(r.dirtyPerM3 ?? 0).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {deleteConfirm && (
        <ConfirmModal
          open={true}
          title={deleteConfirm.type === 'tariff' ? 'Тариф устгах' : 'Шугамын голчийн суурь хураамж устгах'}
          message={
            deleteConfirm.type === 'tariff'
              ? 'Энэ тарифыг устгах уу?'
              : 'Энэ шугамын голчийн суурь хураамжийг устгах уу?'
          }
          onConfirm={deleteConfirm.type === 'tariff' ? doDeleteTariff : doDeletePipe}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  )
}