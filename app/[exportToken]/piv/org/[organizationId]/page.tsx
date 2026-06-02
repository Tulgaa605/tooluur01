import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import {
  computeReadingBreakdownLine,
  formatMoney,
  formatUsage,
  loadOrgAdditionalFeesBreakdown,
  paymentStatusLabel,
  type ReadingBreakdownLine,
} from '@/lib/public-billing-breakdown'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function PublicOrgBillingBreakdownPage(props: {
  params: Promise<{ exportToken: string; organizationId: string }>
  searchParams: Promise<{ year?: string; month?: string }>
}) {
  const expected = (process.env.PAYMENT_LIST_EXPORT_TOKEN ?? '').trim()
  if (!expected) notFound()

  const { exportToken: rawToken, organizationId: rawOrgId } = await props.params
  const sp = await props.searchParams
  const exportToken = decodeURIComponent(rawToken ?? '')
  const organizationId = decodeURIComponent(rawOrgId ?? '').replace(/[^a-f\d]/gi, '')

  const year = parseInt(String(sp.year ?? ''), 10)
  const month = parseInt(String(sp.month ?? ''), 10)

  if (!exportToken || exportToken !== expected) notFound()
  if (!/^[a-f\d]{24}$/i.test(organizationId)) notFound()
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) notFound()

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, code: true, address: true },
  })
  if (!organization) notFound()

  const readings = await prisma.meterReading.findMany({
    where: { organizationId, year, month },
    include: {
      organization: { select: { category: true } },
      meter: {
        select: {
          meterNumber: true,
          billingMode: true,
          waterChargeSplit: true,
          pipeDiameterMm: true,
          billingCategory: true,
        },
      },
    },
    orderBy: { meter: { meterNumber: 'asc' } },
  })

  // Өмнөх үлдэгдэл: Σ(total − paidAmount) where (year, month) < (this year, month)
  const priorReadings = await prisma.meterReading.findMany({
    where: {
      organizationId,
      OR: [
        { year: { lt: year } },
        { year, month: { lt: month } },
      ],
    },
    select: { total: true, paidAmount: true },
  })
  const previousRemainingRaw = priorReadings.reduce(
    (acc, r) => acc + (Number(r.total) || 0) - (Number(r.paidAmount) || 0),
    0
  )
  const previousRemaining = Math.round(previousRemainingRaw * 100) / 100

  // Заалт байхгүй ч өмнөх үлдэгдэлтэй бол phantom хуудас үзүүлнэ;
  // тэр ч үгүй бол хуудас байхгүй.
  if (readings.length === 0 && Math.abs(previousRemaining) < 0.005) notFound()

  const lines: ReadingBreakdownLine[] = []
  for (const r of readings) {
    lines.push(await computeReadingBreakdownLine(r))
  }

  const additionalFees = await loadOrgAdditionalFeesBreakdown(
    organizationId,
    year,
    month,
    readings
  )

  const totalUsage = lines.reduce((a, l) => a + l.usage, 0)
  const meterBill = lines.reduce((a, l) => a + l.total, 0)
  const totalBill =
    readings.length > 0
      ? readings.reduce((a, r) => a + (Number(r.total) || 0), 0)
      : meterBill + additionalFees.extraTotal
  const totalPaid = readings.reduce((a, r) => a + (Number(r.paidAmount) || 0), 0)
  // Энэ сарын төлбөр + өмнөх үлдэгдэл − энэ сард төлсөн = одоогийн нийт үлдэгдэл
  const totalRemaining = Math.max(
    0,
    Math.round((previousRemaining + totalBill - totalPaid) * 100) / 100
  )
  const totalSubtotal =
    readings.length > 0
      ? readings.reduce((a, r) => a + (Number(r.subtotal) || 0), 0)
      : lines.reduce((a, l) => a + l.subtotal, 0) + additionalFees.extraSubtotal
  const totalVat =
    readings.length > 0
      ? readings.reduce((a, r) => a + (Number(r.vat) || 0), 0)
      : lines.reduce((a, l) => a + l.vat, 0) + additionalFees.extraVat

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-gray-900">Төлбөрийн задаргаа</h1>
          <p className="text-sm text-gray-600">
            {year}-{String(month).padStart(2, '0')}
            {lines.length > 1 ? ` · ${lines.length} тоолуур` : ''}
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm mb-4">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-gray-600">Байгууллага</span>
              <span className="text-gray-900 text-right">
                {organization.name}
                {organization.code ? ` (${organization.code})` : ''}
              </span>
            </div>
            {organization.address ? (
              <div className="flex justify-between gap-3">
                <span className="text-gray-600">Хаяг</span>
                <span className="text-gray-900 text-right">{organization.address}</span>
              </div>
            ) : null}
          </div>
        </div>

        {lines.map((line) => (
          <div
            key={line.readingId}
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm mb-3"
          >
            <div className="flex justify-between items-start gap-2 mb-3">
              <div>
                <div className="text-sm text-gray-600">Тоолуур</div>
                <div className="font-mono font-semibold text-gray-900">{line.meterNumber}</div>
              </div>
              <div className="text-right text-sm">
                <div className="text-gray-600">Хэрэглээ</div>
                <div className="font-semibold text-gray-900">{formatUsage(line.usage)} м³</div>
              </div>
            </div>
            <div className="space-y-1.5 text-sm border-t border-gray-100 pt-3">
              <div className="flex justify-between gap-3">
                <span className="text-gray-700">Цэвэр ус</span>
                <span>{formatMoney(line.cleanAmount)} ₮</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-700">Бохир ус</span>
                <span>{formatMoney(line.dirtyAmount)} ₮</span>
              </div>
              {line.heatAmount > 0 ? (
                <div className="flex justify-between gap-3">
                  <span className="text-gray-700">Халаалт</span>
                  <span>{formatMoney(line.heatAmount)} ₮</span>
                </div>
              ) : null}
              <div className="flex justify-between gap-3 font-medium pt-1 border-t border-gray-100">
                <span>Нийт төлөх</span>
                <span>{formatMoney(line.total)} ₮</span>
              </div>
              <div className="flex justify-between gap-3 text-gray-600">
                <span>Төлөгдсөн / үлдэгдэл</span>
                <span>
                  {formatMoney(line.paid)} / {formatMoney(line.remaining)} ₮
                </span>
              </div>
            </div>
          </div>
        ))}

        {additionalFees.lines.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 shadow-sm mb-3">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Бусад нэмэлт төлбөр</h2>
            <div className="space-y-2 text-sm">
              {additionalFees.lines.map((fee) => (
                <div key={fee.name} className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-gray-800">{fee.name}</span>
                    {fee.detail ? (
                      <span className="block text-xs text-gray-500 mt-0.5">{fee.detail}</span>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-gray-900">{formatMoney(fee.amount)} ₮</span>
                </div>
              ))}
              <div className="flex justify-between gap-3 pt-2 border-t border-amber-200/80 text-gray-600">
                <span>НӨАТ (10%)</span>
                <span>{formatMoney(additionalFees.extraVat)} ₮</span>
              </div>
              <div className="flex justify-between gap-3 font-medium">
                <span>Нэмэлт төлбөрийн нийт</span>
                <span>{formatMoney(additionalFees.extraTotal)} ₮</span>
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border border-gray-300 bg-gray-50 p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Нийт дүн</h2>
          <div className="space-y-2 text-sm">
            {lines.length > 0 ? (
              <>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-700">Нийт хэрэглээ</span>
                  <span className="font-semibold">{formatUsage(totalUsage)} м³</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-700">Нийт (НӨАТ-гүй)</span>
                  <span>{formatMoney(totalSubtotal)} ₮</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-700">НӨАТ</span>
                  <span>{formatMoney(totalVat)} ₮</span>
                </div>
                <div className="flex justify-between gap-3 font-medium">
                  <span>Тухайн сарын төлбөр</span>
                  <span>{formatMoney(totalBill)} ₮</span>
                </div>
              </>
            ) : null}
            <div className="flex justify-between gap-3">
              <span className="text-gray-700">Өмнөх үлдэгдэл</span>
              <span className={previousRemaining < 0 ? 'text-green-700' : 'text-gray-900'}>
                {formatMoney(previousRemaining)} ₮
              </span>
            </div>
            <div className="flex justify-between gap-3 text-base font-semibold pt-1 border-t border-gray-200">
              <span>Нийт төлөх дүн</span>
              <span>{formatMoney(totalBill + previousRemaining)} ₮</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-700">Төлөгдсөн</span>
              <span>{formatMoney(totalPaid)} ₮</span>
            </div>
            <div className="flex justify-between gap-3 font-semibold">
              <span className="text-gray-700">Үлдэгдэл</span>
              <span>{formatMoney(totalRemaining)} ₮</span>
            </div>
            <div className="flex justify-between gap-3 pt-1">
              <span className="text-gray-700">Төлөв</span>
              <span className="font-semibold">
                {paymentStatusLabel(totalBill + previousRemaining, totalPaid)}
              </span>
            </div>
          </div>
        </div>

        <p className="mt-4 text-xs text-gray-500 text-center">
          Энэ хуудас нь зөвхөн мэдээлэл харах зориулалттай (төлбөр төлөх үйлдэл байхгүй).
        </p>
      </div>
    </div>
  )
}
