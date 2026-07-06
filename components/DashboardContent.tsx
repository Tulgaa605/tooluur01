'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BanknotesIcon, BeakerIcon } from '@heroicons/react/24/outline'
import { fetchWithAuth } from '@/lib/api'

interface MonthPoint {
  month: string
  value: number
}

interface DashboardData {
  totalUsage: number
  totalHeat: number
  currentMonthUsage: number
  currentMonthHeat: number
  previousMonthUsage: number
  usageChange: number
  currentMonthTotal: number
  currentMonthPaid: number
  currentMonthRemaining: number
  paymentRate: number
  monthlyWater: MonthPoint[]
  monthlyHeat: MonthPoint[]
  monthlyBilled: MonthPoint[]
  monthlyPaid: MonthPoint[]
}

function formatMoney(value: unknown): string {
  const n = Number(value ?? 0)
  const safe = Number.isFinite(n) ? n : 0
  return safe.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function formatUsage(value: unknown): string {
  const n = Number(value ?? 0)
  const safe = Number.isFinite(n) ? n : 0
  return safe.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

function formatAxisUsage(value: unknown): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1000) return `${(n / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`
  return String(Math.round(n))
}

function formatAxisMoney(value: unknown): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1000) return `${Math.round(n / 1000)}K`
  return String(Math.round(n))
}

function shortMonthLabel(ym: string): string {
  const parts = ym.split('-')
  if (parts.length !== 2) return ym
  const month = parseInt(parts[1], 10)
  if (!Number.isFinite(month)) return ym
  return `${month}`
}

function withLabels(rows: MonthPoint[]) {
  return rows.map((row) => ({
    ...row,
    label: shortMonthLabel(row.month),
  }))
}

function normalizeDashboard(payload: Record<string, unknown>): DashboardData | null {
  if (typeof payload.totalUsage !== 'number') return null

  const p = payload as unknown as DashboardData & {
    monthlyData?: Array<{ month: string; usage: number }>
    monthlyPayment?: Array<{ month: string; total: number; paid: number }>
  }

  return {
    totalUsage: p.totalUsage ?? 0,
    totalHeat: p.totalHeat ?? 0,
    currentMonthUsage: p.currentMonthUsage ?? 0,
    currentMonthHeat: p.currentMonthHeat ?? 0,
    previousMonthUsage: p.previousMonthUsage ?? 0,
    usageChange: p.usageChange ?? 0,
    currentMonthTotal: p.currentMonthTotal ?? 0,
    currentMonthPaid: p.currentMonthPaid ?? 0,
    currentMonthRemaining: p.currentMonthRemaining ?? 0,
    paymentRate: p.paymentRate ?? 0,
    monthlyWater:
      p.monthlyWater ??
      p.monthlyData?.map((row) => ({ month: row.month, value: row.usage })) ??
      [],
    monthlyHeat: p.monthlyHeat ?? [],
    monthlyBilled:
      p.monthlyBilled ??
      p.monthlyPayment?.map((row) => ({ month: row.month, value: row.total })) ??
      [],
    monthlyPaid:
      p.monthlyPaid ??
      p.monthlyPayment?.map((row) => ({ month: row.month, value: row.paid })) ??
      [],
  }
}

function MiniStat({
  label,
  value,
  hint,
  color,
}: {
  label: string
  value: string
  hint?: string
  color: string
}) {
  return (
    <div className="flex min-h-0 flex-col justify-center overflow-hidden rounded-lg border border-gray-200 bg-white px-2.5 py-2 shadow-sm">
      <p className="truncate text-xs font-medium leading-tight text-gray-500">{label}</p>
      <p className={`truncate text-base font-semibold leading-tight ${color}`}>{value}</p>
      {hint ? (
        <p className="truncate text-[11px] leading-tight text-gray-400">{hint}</p>
      ) : (
        <span className="block h-[14px]" aria-hidden />
      )}
    </div>
  )
}

function StatGroup({
  title,
  periodLabel,
  icon: Icon,
  iconClass,
  children,
}: {
  title: string
  periodLabel?: string
  icon: React.ComponentType<{ className?: string }>
  iconClass: string
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-2.5 shadow-sm">
      <div className="mb-2 flex shrink-0 items-center gap-2">
        <div className={`rounded-md p-1.5 ${iconClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        <h3 className="truncate text-base font-semibold uppercase tracking-wide text-gray-600">
          {title}
          {periodLabel ? (
            <span className="ml-1.5 text-xs font-normal normal-case text-gray-400">
              ({periodLabel})
            </span>
          ) : null}
        </h3>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-1.5">{children}</div>
    </div>
  )
}

function ChartPanel({
  title,
  unit,
  headerClass,
  children,
}: {
  title: string
  unit: string
  headerClass: string
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className={`flex shrink-0 items-center justify-between px-3 py-2.5 ${headerClass}`}>
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs opacity-70">{unit}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-visible px-1 pb-1">{children}</div>
    </div>
  )
}

export default function DashboardContent() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchWithAuth('/api/dashboard')
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error((payload as { error?: string }).error || 'Алдаа гарлаа')
        }
        return payload
      })
      .then((payload) => {
        if (payload && (payload as { error?: string }).error) {
          setError((payload as { error?: string }).error || 'Алдаа гарлаа')
          setData(null)
        } else {
          setData(normalizeDashboard(payload as Record<string, unknown>))
          setError(null)
        }
        setLoading(false)
      })
      .catch((err: unknown) => {
        setData(null)
        setError(err instanceof Error ? err.message : 'Алдаа гарлаа')
        setLoading(false)
      })
  }, [])

  const waterChartData = useMemo(() => withLabels(data?.monthlyWater ?? []), [data?.monthlyWater])
  const heatChartData = useMemo(() => withLabels(data?.monthlyHeat ?? []), [data?.monthlyHeat])
  const billedChartData = useMemo(() => withLabels(data?.monthlyBilled ?? []), [data?.monthlyBilled])
  const paidChartData = useMemo(() => withLabels(data?.monthlyPaid ?? []), [data?.monthlyPaid])

  if (loading) {
    return (
      <div
        className="flex items-center justify-center text-gray-500"
        style={{ height: 'calc(100dvh - 5.5rem)' }}
      >
        Ачааллаж байна...
      </div>
    )
  }

  if (!data) {
    return (
      <div
        className="flex items-center justify-center text-gray-500"
        style={{ height: 'calc(100dvh - 5.5rem)' }}
      >
        {error || 'Өгөгдөл олдсонгүй'}
      </div>
    )
  }

  const usageChange = data.usageChange ?? 0
  const usageUp = usageChange >= 0
  const now = new Date()
  const currentBillingMonth = `${now.getMonth() + 1}-р сарын`
  const axisTick = { fontSize: 12, fill: '#9ca3af' }
  const usageChartMargin = { top: 4, right: 12, left: 0, bottom: 0 }
  const moneyChartMargin = { top: 4, right: 12, left: 0, bottom: 0 }

  return (
    <div
      className="flex flex-col gap-3 overflow-hidden"
      style={{ height: 'calc(100dvh - 5.5rem)' }}
    >
      <div className="shrink-0">
        <h2 className="text-xl font-semibold text-gray-900">Хяналтын самбар</h2>
        <p className="text-sm text-gray-500">Сүүлийн 12 сарын хэрэглээ, төлбөрийн тойм</p>
      </div>

      <div
        className="grid min-h-0 flex-1 gap-3"
        style={{
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: 'repeat(3, minmax(0, 1fr))',
        }}
      >
        <StatGroup title="Ус, дулаан" icon={BeakerIcon} iconClass="bg-sky-100 text-sky-600">
          <MiniStat label="Нийт ус" value={`${formatUsage(data.totalUsage)} м³`} color="text-sky-700" />
          <MiniStat
            label="Энэ сарын ус"
            value={`${formatUsage(data.currentMonthUsage)} м³`}
            hint={`Өмнөх: ${formatUsage(data.previousMonthUsage)}`}
            color="text-sky-700"
          />
          <MiniStat
            label="Энэ сарын дулаан"
            value={formatUsage(data.currentMonthHeat)}
            hint={`Нийт: ${formatUsage(data.totalHeat)}`}
            color="text-orange-600"
          />
          <MiniStat
            label="Усны өөрчлөлт"
            value={`${usageUp ? '↑' : '↓'} ${Math.abs(usageChange).toFixed(1)}%`}
            color={usageUp ? 'text-red-600' : 'text-emerald-600'}
          />
        </StatGroup>

        <StatGroup
          title="Төлбөр"
          periodLabel={currentBillingMonth}
          icon={BanknotesIcon}
          iconClass="bg-emerald-100 text-emerald-600"
        >
          <MiniStat
            label="Нэхэмжлэл"
            value={`${formatMoney(data.currentMonthTotal)} ₮`}
            color="text-violet-700"
          />
          <MiniStat
            label="Төлсөн"
            value={`${formatMoney(data.currentMonthPaid)} ₮`}
            color="text-emerald-700"
          />
          <MiniStat
            label="Үлдэгдэл"
            value={`${formatMoney(data.currentMonthRemaining)} ₮`}
            color="text-amber-700"
          />
          <MiniStat
            label="Төлбөрийн хувь"
            value={`${(data.paymentRate ?? 0).toFixed(1)}%`}
            color="text-emerald-700"
          />
        </StatGroup>

        <ChartPanel title="Дулааны хэрэглээ" unit="м³" headerClass="bg-orange-50 text-orange-800">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={heatChartData} margin={usageChartMargin}>
              <defs>
                <linearGradient id="heatFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ea580c" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#ea580c" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
              <YAxis tick={axisTick} width={48} tickFormatter={formatAxisUsage} />
              <Tooltip
                formatter={(v) => [`${formatUsage(v)}`, 'Хэрэглээ']}
                labelFormatter={(l) => `${l} сар`}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#ea580c"
                strokeWidth={1.5}
                fill="url(#heatFill)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Усны хэрэглээ" unit="м³" headerClass="bg-sky-50 text-sky-800">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={waterChartData} margin={usageChartMargin}>
              <defs>
                <linearGradient id="waterFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0284c7" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#0284c7" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
              <YAxis tick={axisTick} width={48} tickFormatter={formatAxisUsage} />
              <Tooltip
                formatter={(v) => [`${formatUsage(v)} м³`, 'Хэрэглээ']}
                labelFormatter={(l) => `${l} сар`}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#0284c7"
                strokeWidth={1.5}
                fill="url(#waterFill)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Төлбөрийн нэхэмжлэл" unit="₮" headerClass="bg-violet-50 text-violet-800">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={billedChartData} margin={moneyChartMargin} barSize={12}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
              <YAxis
                tick={axisTick}
                width={52}
                tickCount={4}
                tickFormatter={formatAxisMoney}
              />
              <Tooltip
                formatter={(v) => [`${formatMoney(v)} ₮`, 'Нэхэмжлэл']}
                labelFormatter={(l) => `${l} сар`}
              />
              <Bar dataKey="value" fill="#6366f1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Төлсөн төлбөр" unit="₮" headerClass="bg-emerald-50 text-emerald-800">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={paidChartData} margin={moneyChartMargin} barSize={12}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
              <YAxis
                tick={axisTick}
                width={52}
                tickCount={4}
                tickFormatter={formatAxisMoney}
              />
              <Tooltip
                formatter={(v) => [`${formatMoney(v)} ₮`, 'Төлсөн']}
                labelFormatter={(l) => `${l} сар`}
              />
              <Bar dataKey="value" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>
    </div>
  )
}
