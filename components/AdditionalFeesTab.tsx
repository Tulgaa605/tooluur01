'use client'

import { useCallback, useEffect, useState } from 'react'
import { PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import ConfirmModal from './ConfirmModal'
import { fetchWithAuth } from '@/lib/api'
import {
  ADDITIONAL_FEE_BASIS_LABELS,
  additionalFeeUnitLabel,
  additionalFeeUsesUnitPrice,
  parseChargeBasis,
  type AdditionalFeeChargeBasis,
} from '@/lib/additional-fees-calc'

type AdditionalFeeRow = {
  id: string
  name: string
  chargeBasis: AdditionalFeeChargeBasis
  unitPrice: number
  accountCode?: string | null
  sortOrder: number
  active: boolean
}

const BASIS_OPTIONS: AdditionalFeeChargeBasis[] = ['M3', 'M2', 'PIECE', 'AMOUNT']

const emptyForm = () => ({
  id: '',
  name: '',
  chargeBasis: 'M3' as AdditionalFeeChargeBasis,
  unitPrice: '',
  accountCode: '',
  sortOrder: '0',
  active: true,
})

export default function AdditionalFeesTab() {
  const [rows, setRows] = useState<AdditionalFeeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetchWithAuth('/api/additional-fees')
      const data = await res.json()
      if (!res.ok) {
        setMessage({
          type: 'error',
          text: typeof data?.error === 'string' ? data.error : 'Ачааллахад алдаа гарлаа',
        })
        setRows([])
        return
      }
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Алдаа гарлаа' })
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openNew = () => {
    setForm(emptyForm())
    setShowForm(true)
  }

  const openEdit = (row: AdditionalFeeRow) => {
    setForm({
      id: row.id,
      name: row.name,
      chargeBasis: parseChargeBasis(row.chargeBasis) ?? 'M3',
      unitPrice: String(row.unitPrice),
      accountCode: String(row.accountCode ?? ''),
      sortOrder: String(row.sortOrder ?? 0),
      active: row.active !== false,
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      setMessage({ type: 'error', text: 'Төлбөрийн нэр оруулна уу' })
      return
    }
    const needsUnitPrice = additionalFeeUsesUnitPrice(form.chargeBasis)
    const unitPrice = needsUnitPrice ? parseFloat(form.unitPrice.replace(',', '.')) : 0
    if (needsUnitPrice && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      setMessage({ type: 'error', text: 'Нэгжийн үнэ буруу байна' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const isEdit = !!form.id
      const res = await fetchWithAuth('/api/additional-fees', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: form.id || undefined,
          name: form.name.trim(),
          chargeBasis: form.chargeBasis,
          unitPrice,
          accountCode: form.accountCode.trim() || null,
          sortOrder: parseInt(form.sortOrder, 10) || 0,
          active: form.active,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({
          type: 'error',
          text: typeof data?.error === 'string' ? data.error : 'Хадгалахад алдаа гарлаа',
        })
        return
      }
      setMessage({ type: 'success', text: isEdit ? 'Амжилттай шинэчлэгдлээ' : 'Амжилттай нэмэгдлээ' })
      setShowForm(false)
      await load()
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Алдаа гарлаа' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setSaving(true)
    try {
      const res = await fetchWithAuth(`/api/additional-fees?id=${encodeURIComponent(deleteId)}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({
          type: 'error',
          text: typeof data?.error === 'string' ? data.error : 'Устгахад алдаа гарлаа',
        })
        return
      }
      setMessage({ type: 'success', text: 'Амжилттай устгалаа' })
      setDeleteId(null)
      await load()
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Алдаа гарлаа' })
    } finally {
      setSaving(false)
    }
  }

  const unitLabel = additionalFeeUnitLabel(form.chargeBasis)

  if (loading) {
    return <div className="text-gray-600 py-8">Ачааллаж байна...</div>
  }

  return (
    <div>
      <div className="mb-6 flex justify-end">
        <button
          type="button"
          onClick={openNew}
          className="shrink-0 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
        >
          Нэмэлт төлбөр нэмэх
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

      {rows.length === 0 ? (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 text-center py-12 text-gray-500">
          Нэмэлт төлбөр бүртгэгдээгүй байна
        </div>
      ) : (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Төлбөрийн нэр
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Тооцоолол
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Нэгжийн үнэ
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Данс
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Идэвхтэй
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Үйлдэл
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {rows.map((r) => (
                <tr key={r.id} className={!r.active ? 'opacity-50' : undefined}>
                  <td className="px-6 py-4 text-sm text-gray-900">{r.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    {ADDITIONAL_FEE_BASIS_LABELS[r.chargeBasis] ?? r.chargeBasis}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {additionalFeeUsesUnitPrice(r.chargeBasis)
                      ? `${r.unitPrice.toFixed(2)} ₮`
                      : '—'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">{r.accountCode ? r.accountCode : '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">{r.active ? 'Тийм' : 'Үгүй'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50"
                        title="Засах"
                      >
                        <PencilIcon className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteId(r.id)}
                        className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50"
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
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {form.id ? 'Нэмэлт төлбөр засах' : 'Шинэ нэмэлт төлбөр'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Төлбөрийн нэр</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Тооцооллын төрөл</label>
                <select
                  value={form.chargeBasis}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      chargeBasis: e.target.value as AdditionalFeeChargeBasis,
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  {BASIS_OPTIONS.map((b) => (
                    <option key={b} value={b}>
                      {ADDITIONAL_FEE_BASIS_LABELS[b]}
                    </option>
                  ))}
                </select>
              </div>
              {additionalFeeUsesUnitPrice(form.chargeBasis) ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{unitLabel}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.unitPrice}
                    onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  «Мөнгөн дүн» төрөлд дүнг сарын заалт хуудсан дээр харилцагч бүрт оруулна.
                </p>
              )}
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Данс</label>
                
                <div className="mt-0.5">
                  <input
                    type="text"
                    value={form.accountCode}
                    onChange={(e) => setForm((f) => ({ ...f, accountCode: e.target.value }))}
                    placeholder=""
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                />
                Идэвхтэй
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                disabled={saving}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Болих
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                {saving ? 'Хадгалж байна...' : 'Хадгалах'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <ConfirmModal
          open={true}
          title="Нэмэлт төлбөр устгах"
          message="Энэ төлбөрийн бүх сонголтыг устгана. Үргэлжлүүлэх үү?"
          confirmLabel="Устгах"
          cancelLabel="Болих"
          danger
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  )
}
