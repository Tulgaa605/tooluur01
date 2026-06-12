import { fetchWithAuth } from '@/lib/api'

export async function downloadMonthlyAccountingReport(
  year: number,
  month: number
): Promise<void> {
  const res = await fetchWithAuth(
    `/api/exports/monthly-accounting-report?year=${year}&month=${month}`
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || res.statusText)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Тайлан-${year}-${String(month).padStart(2, '0')}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
