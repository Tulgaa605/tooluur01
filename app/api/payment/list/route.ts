import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * Төлбөрийн жагсаалтын API — `/api/exports/payment-list`-тай **ижил** query, JSON.
 *
 * Жишээ:
 * `GET /api/payment/list?token=…&year=2026&month=4&format=summary`
 * `GET /api/payment/list?year=2026&month=4&format=summary` (нягтлан/захиралын JWT эсвэл cookie)
 */
export async function GET(request: NextRequest) {
  const from = new URL(request.url)
  const inner = new URL('/api/exports/payment-list', from.origin)
  inner.search = from.search

  const h = new Headers()
  const auth = request.headers.get('authorization')
  if (auth) h.set('authorization', auth)
  const cookie = request.headers.get('cookie')
  if (cookie) h.set('cookie', cookie)

  const res = await fetch(inner.toString(), { headers: h, cache: 'no-store' })
  const body = await res.text()
  const ct = res.headers.get('content-type') ?? 'application/json; charset=utf-8'
  return new NextResponse(body, {
    status: res.status,
    headers: { 'content-type': ct },
  })
}
