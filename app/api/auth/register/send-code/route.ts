import { NextRequest, NextResponse } from 'next/server'
import { sendRegisterVerificationCode } from '@/lib/register-phone-verification'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { phone, otpSessionToken } = await request.json()
    if (!phone || !String(phone).trim()) {
      return NextResponse.json({ error: 'Утасны дугаар оруулна уу' }, { status: 400 })
    }

    const result = await sendRegisterVerificationCode(
      String(phone),
      typeof otpSessionToken === 'string' ? otpSessionToken : undefined
    )
    const isDev = process.env.NODE_ENV !== 'production'

    return NextResponse.json({
      success: true,
      phone: result.phone,
      otpSessionToken: result.otpSessionToken,
      ...(isDev && result.devCode ? { devCode: result.devCode } : {}),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Код илгээхэд алдаа гарлаа'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
