import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/middleware'
import {
  ProfileOtpVerifyError,
  maskPhoneForDisplay,
  verifyProfileVerificationCode,
} from '@/lib/profile-phone-verification'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthUser(request)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Хүсэлт буруу байна' }, { status: 400 })
    }

    const code = String((body as { code?: unknown }).code ?? '').trim()
    const otpSessionToken = String((body as { otpSessionToken?: unknown }).otpSessionToken ?? '').trim()
    if (!otpSessionToken) {
      return NextResponse.json({ error: 'Эхлээд код илгээнэ үү' }, { status: 400 })
    }

    const result = await verifyProfileVerificationCode(auth.userId, code, otpSessionToken)

    return NextResponse.json({
      phone: result.phone,
      phoneMasked: maskPhoneForDisplay(result.phone),
      profileVerificationToken: result.profileVerificationToken,
      phoneLinked: result.phoneLinked,
    })
  } catch (error: unknown) {
    if (error instanceof ProfileOtpVerifyError) {
      return NextResponse.json(
        { error: error.message, otpSessionToken: error.otpSessionToken },
        { status: 400 }
      )
    }
    const msg = error instanceof Error ? error.message : 'Код баталгаажуулахад алдаа гарлаа'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
