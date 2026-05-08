import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import {
  applyWaterChargeSplitToWaterRates,
  computeReadingMoney,
  computeReadingMoneySplit,
  effectiveWaterChargeSplit,
  getHeatTariffRatesForPeriod,
  getWaterTariffRatesForPeriod,
  normalizeBillingMode,
  type BillingMode,
  type WaterTariffRates,
} from '@/lib/meter-reading-calc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function formatMoney(value: unknown): string {
  const n = Number(value ?? 0)
  const safe = Number.isFinite(n) ? n : 0
  return safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatUsage(value: unknown): string {
  const n = Number(value ?? 0)
  const safe = Number.isFinite(n) ? n : 0
  return safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function roundMoneyLocal(n: number): number {
  return Math.round(n * 100) / 100
}

const PAY_EPS = 0.009

function effectivePaid(paidStored: unknown): number {
  return roundMoneyLocal(Number(paidStored ?? 0) || 0)
}

function remainingBalance(total: unknown, paidStored: unknown): number {
  const t = Number(total ?? 0) || 0
  return Math.max(0, roundMoneyLocal(t - effectivePaid(paidStored)))
}

function paymentStatusLabel(total: unknown, paidStored: unknown): string {
  const rem = remainingBalance(total, paidStored)
  if (rem <= PAY_EPS) return 'Бүрэн төлөгдсөн'
  if (effectivePaid(paidStored) > PAY_EPS) return 'Хэсэгчлэн төлөгдсөн'
  return 'Хүлээгдэж буй'
}

function waterUsageFromReading(r: { startValue?: unknown; endValue?: unknown; usage?: unknown }): number {
  const s = Number(r.startValue ?? 0)
  const e = Number(r.endValue ?? 0)
  const diff = e > s ? e - s : 0
  if (diff > 0) return diff
  const u = Number(r.usage ?? 0)
  return Number.isFinite(u) && u >= 0 ? u : 0
}

function waterTariffAdjustedForMeter(
  raw: WaterTariffRates,
  billingMode: BillingMode,
  waterChargeSplit: string | null | undefined
): WaterTariffRates {
  return applyWaterChargeSplitToWaterRates(
    raw,
    effectiveWaterChargeSplit(waterChargeSplit, billingMode)
  )
}

export default async function PublicBillingBreakdownPage(props: {
  params: Promise<{ exportToken: string; readingId: string }>
}) {
  const expected = (process.env.PAYMENT_LIST_EXPORT_TOKEN ?? '').trim()
  if (!expected) notFound()

  const { exportToken: rawToken, readingId: rawId } = await props.params
  const exportToken = decodeURIComponent(rawToken ?? '')
  const readingIdRaw = decodeURIComponent(rawId ?? '')
  const readingId = readingIdRaw.replace(/[^a-f\d]/gi, '')

  if (!exportToken || exportToken !== expected) notFound()
  if (!/^[a-f\d]{24}$/i.test(readingId)) notFound()

  const reading = await prisma.meterReading.findUnique({
    where: { id: readingId },
    include: {
      organization: {
        select: { id: true, name: true, code: true, category: true, address: true },
      },
      meter: {
        select: {
          meterNumber: true,
          billingMode: true,
          waterChargeSplit: true,
          pipeDiameterMm: true,
        },
      },
    },
  })

  if (!reading) notFound()

  const pipeMm =
    reading.meter?.pipeDiameterMm != null &&
    Number.isFinite(Number(reading.meter.pipeDiameterMm)) &&
    Number(reading.meter.pipeDiameterMm) > 0
      ? Math.trunc(Number(reading.meter.pipeDiameterMm))
      : null

  const orgCategory = reading.organization?.category ?? 'HOUSEHOLD'
  const billingMode = normalizeBillingMode(reading.meter?.billingMode)
  const rawWater = await getWaterTariffRatesForPeriod(reading.organizationId, reading.year, reading.month, {
    pipeDiameterMm: pipeMm,
  })
  const heat = await getHeatTariffRatesForPeriod(reading.organizationId, reading.year, reading.month)
  const water = waterTariffAdjustedForMeter(rawWater, billingMode, reading.meter?.waterChargeSplit)

  const waterUsage = waterUsageFromReading(reading)
  const heatUsage = Number(reading.heatUsage ?? 0) || 0
  const usage = billingMode === 'HEAT' ? heatUsage : waterUsage

  const money =
    billingMode === 'WATER_HEAT'
      ? computeReadingMoneySplit(waterUsage, heatUsage, orgCategory, billingMode, water, heat)
      : computeReadingMoney(usage, orgCategory, billingMode, water, heat)

  const total = Number(money.total ?? 0) || 0
  const paid = effectivePaid(reading.paidAmount)
  const remaining = remainingBalance(total, reading.paidAmount)

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-gray-900">Төлбөрийн задаргаа</h1>
          <p className="text-sm text-gray-600">
            {reading.year}-{String(reading.month).padStart(2, '0')}
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-gray-600">Байгууллага</span>
              <span className="text-gray-900 text-right">
                {reading.organization?.name ?? '-'}
                {reading.organization?.code ? ` (${reading.organization.code})` : ''}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-600">Тоолуур</span>
              <span className="text-gray-900 font-mono">{reading.meter?.meterNumber ?? '-'}</span>
            </div>
            {reading.organization?.address ? (
              <div className="flex justify-between gap-3">
                <span className="text-gray-600">Хаяг</span>
                <span className="text-gray-900 text-right">{reading.organization.address}</span>
              </div>
            ) : null}
          </div>

          <div className="my-4 border-t border-gray-200" />

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md bg-gray-50 p-3 border border-gray-200">
              <div className="text-gray-600">Хэрэглээ</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">
                {formatUsage(usage)} <span className="text-sm font-medium text-gray-600">м³</span>
              </div>
            </div>
            <div className="rounded-md bg-gray-50 p-3 border border-gray-200">
              <div className="text-gray-600">Төлөв</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">
                {paymentStatusLabel(total, reading.paidAmount)}
              </div>
            </div>
          </div>

          <div className="my-4 border-t border-gray-200" />

          <div className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-gray-700">Цэвэр ус</span>
              <span className="text-gray-900">{formatMoney(money.cleanAmount)} ₮</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-700">Бохир ус</span>
              <span className="text-gray-900">{formatMoney(money.dirtyAmount)} ₮</span>
            </div>
            {Number(money.heatAmount ?? 0) > 0 ? (
              <div className="flex justify-between gap-3">
                <span className="text-gray-700">Халаалт</span>
                <span className="text-gray-900">{formatMoney(money.heatAmount)} ₮</span>
              </div>
            ) : null}

            <div className="my-2 border-t border-gray-200" />

            <div className="flex justify-between gap-3">
              <span className="text-gray-700">Нийт дүн</span>
              <span className="text-gray-900">{formatMoney(money.subtotal)} ₮</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-700">НӨАТ дүн</span>
              <span className="text-gray-900">{formatMoney(money.vat)} ₮</span>
            </div>
            <div className="flex justify-between gap-3 text-base font-semibold">
              <span className="text-gray-900">Нийт төлөх дүн</span>
              <span className="text-gray-900">{formatMoney(total)} ₮</span>
            </div>

            <div className="my-2 border-t border-gray-200" />

            <div className="flex justify-between gap-3">
              <span className="text-gray-700">Төлөгдсөн</span>
              <span className="text-gray-900">{formatMoney(paid)} ₮</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-700">Үлдэгдэл</span>
              <span className="text-gray-900">{formatMoney(remaining)} ₮</span>
            </div>
          </div>

          {reading.paymentReference?.trim() ? (
            <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
              <div className="text-gray-600">Төлбөрийн код</div>
              <div className="mt-1 font-mono text-gray-900">{reading.paymentReference.trim()}</div>
            </div>
          ) : null}

          <div className="mt-5 text-xs text-gray-500">
            Энэ хуудас нь зөвхөн мэдээлэл харах зориулалттай (төлбөр төлөх үйлдэл байхгүй).
          </div>
        </div>
      </div>
    </div>
  )
}

