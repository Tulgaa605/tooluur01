import { NextRequest, NextResponse } from 'next/server'
import {
  RegisterOtpVerifyError,
  verifyRegisterVerificationCode,
} from '@/lib/register-phone-verification'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { phone, code, otpSessionToken } = await request.json()
    if (!phone || !String(phone).trim()) {
      return NextResponse.json({ error: 'Утасны дугаар оруулна уу' }, { status: 400 })
    }
    if (!code || !String(code).trim()) {
      return NextResponse.json({ error: 'Баталгаажуулах код оруулна уу' }, { status: 400 })
    }
    if (!otpSessionToken || !String(otpSessionToken).trim()) {
      return NextResponse.json({ error: 'Кодын сесс дууссан. Шинэ код илгээнэ үү' }, { status: 400 })
    }

    const result = await verifyRegisterVerificationCode(
      String(phone),
      String(code),
      String(otpSessionToken)
    )

    return NextResponse.json({
      success: true,
      phone: result.phone,
      phoneVerificationToken: result.phoneVerificationToken,
    })
  } catch (error: unknown) {
    if (error instanceof RegisterOtpVerifyError) {
      return NextResponse.json(
        { error: error.message, otpSessionToken: error.otpSessionToken },
        { status: 400 }
      )
    }
    const message = error instanceof Error ? error.message : 'Код баталгаажуулахад алдаа гарлаа'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
