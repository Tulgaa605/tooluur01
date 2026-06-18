import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/middleware'
import { sendProfileVerificationCode } from '@/lib/profile-phone-verification'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthUser(request)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const otpSessionToken =
      typeof (body as { otpSessionToken?: unknown }).otpSessionToken === 'string'
        ? (body as { otpSessionToken: string }).otpSessionToken
        : undefined
    const newPhone =
      typeof (body as { phone?: unknown }).phone === 'string'
        ? (body as { phone: string }).phone
        : undefined

    const result = await sendProfileVerificationCode(auth.userId, {
      otpSessionToken,
      newPhone,
    })

    return NextResponse.json({
      phoneMasked: result.phoneMasked,
      otpSessionToken: result.otpSessionToken,
      ...(result.devCode ? { devCode: result.devCode } : {}),
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Код илгээхэд алдаа гарлаа'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
