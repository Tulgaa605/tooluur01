import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * `https://хост/<PAYMENT_LIST_EXPORT_TOKEN>?year=2026&month=4&format=summary&createdByUserId=...`
 * — токен нь `.env`-ийн `PAYMENT_LIST_EXPORT_TOKEN`-тай яг таарвал `/api/exports/payment-list`-тай ижил JSON буцаана.
 * Токен буруу бол 404 (өөр замуудыг `app/login` гэх мэт static замууд эхэлж сонгоно).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ exportToken: string }> }
) {
  const expected = (process.env.PAYMENT_LIST_EXPORT_TOKEN ?? '').trim()
  if (!expected) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { exportToken: raw } = await context.params
  const exportToken = decodeURIComponent(raw ?? '')
  if (exportToken !== expected) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const from = new URL(request.url)
  const inner = new URL('/api/exports/payment-list', from.origin)
  inner.searchParams.set('token', exportToken)
  from.searchParams.forEach((value, key) => {
    if (key !== 'token') inner.searchParams.set(key, value)
  })

  const res = await fetch(inner.toString(), { cache: 'no-store' })
  const body = await res.text()
  const ct = res.headers.get('content-type') ?? 'application/json; charset=utf-8'
  return new NextResponse(body, {
    status: res.status,
    headers: { 'content-type': ct },
  })
}
