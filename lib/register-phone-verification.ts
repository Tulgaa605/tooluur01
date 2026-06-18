import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { sendTextSms } from '@/lib/sms'
import { normalizeToE164MN } from '@/lib/sms'
import { getDefaultSmsSender } from '@/lib/sms-senders'
import { assertUserPhoneAvailable } from '@/lib/user-phone'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'
const RESEND_COOLDOWN_MS = 60 * 1000
const MAX_ATTEMPTS = 5
const OTP_TOKEN_TTL = '10m'
const VERIFICATION_TOKEN_TTL = '30m'

export const REGISTER_PHONE_TOKEN_PURPOSE = 'register_phone_verified'
const REGISTER_OTP_PURPOSE = 'register_otp'

/** Түр зуур: бүртгэлд утасны SMS код шаардахгүй */
export const SKIP_REGISTER_PHONE_VERIFICATION = true

export interface RegisterPhoneTokenPayload {
  purpose: typeof REGISTER_PHONE_TOKEN_PURPOSE
  phone: string
}

interface RegisterOtpTokenPayload {
  purpose: typeof REGISTER_OTP_PURPOSE
  phone: string
  codeHash: string
  attempts: number
}

export function normalizeRegisterPhone(input: string): string | null {
  return normalizeToE164MN(input)
}

function generateSixDigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function createOtpSessionToken(phone: string, codeHash: string, attempts = 0): string {
  const payload: RegisterOtpTokenPayload = {
    purpose: REGISTER_OTP_PURPOSE,
    phone,
    codeHash,
    attempts,
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: OTP_TOKEN_TTL })
}

function decodeOtpSessionToken(token: string): RegisterOtpTokenPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as RegisterOtpTokenPayload
    if (payload?.purpose !== REGISTER_OTP_PURPOSE || !payload.phone || !payload.codeHash) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

function getTokenIssuedAtMs(token: string): number | null {
  const decoded = jwt.decode(token) as { iat?: number } | null
  if (!decoded?.iat) return null
  return decoded.iat * 1000
}

export function generateRegisterPhoneToken(phone: string): string {
  const payload: RegisterPhoneTokenPayload = {
    purpose: REGISTER_PHONE_TOKEN_PURPOSE,
    phone,
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: VERIFICATION_TOKEN_TTL })
}

export function verifyRegisterPhoneToken(token: string): RegisterPhoneTokenPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as RegisterPhoneTokenPayload
    if (payload?.purpose !== REGISTER_PHONE_TOKEN_PURPOSE || !payload.phone) return null
    return payload
  } catch {
    return null
  }
}

export async function sendRegisterVerificationCode(
  rawPhone: string,
  previousOtpSessionToken?: string
): Promise<{ phone: string; otpSessionToken: string; devCode?: string }> {
  const phone = normalizeRegisterPhone(rawPhone)
  if (!phone) {
    throw new Error('Утасны дугаар буруу байна (8 оронтой Монгол дугаар оруулна уу)')
  }

  await assertUserPhoneAvailable(phone)

  if (previousOtpSessionToken) {
    const issuedAt = getTokenIssuedAtMs(previousOtpSessionToken)
    if (issuedAt) {
      const elapsed = Date.now() - issuedAt
      if (elapsed < RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000)
        throw new Error(`${waitSec} секундын дараа дахин илгээнэ үү`)
      }
    }
  }

  const code = generateSixDigitCode()
  const codeHash = await bcrypt.hash(code, 10)
  const otpSessionToken = createOtpSessionToken(phone, codeHash, 0)

  const message = `Бүртгэлийн баталгаажуулах код: ${code}. 10 минутын дотор ашиглана уу.`
  const sms = await sendTextSms([phone], message, getDefaultSmsSender())

  const isDev = process.env.NODE_ENV !== 'production'
  if (!sms.enabled) {
    if (isDev) {
      console.log(`[register-otp] ${phone}: ${code}`)
      return { phone, otpSessionToken, devCode: code }
    }
    throw new Error('SMS илгээх тохиргоо хийгдээгүй байна. Админтай холбогдоно уу.')
  }

  const failed = sms.results.find((r) => !r.ok)
  if (failed) {
    throw new Error(failed.error || 'SMS илгээхэд алдаа гарлаа')
  }

  return { phone, otpSessionToken }
}

export class RegisterOtpVerifyError extends Error {
  otpSessionToken?: string

  constructor(message: string, otpSessionToken?: string) {
    super(message)
    this.name = 'RegisterOtpVerifyError'
    this.otpSessionToken = otpSessionToken
  }
}

export async function verifyRegisterVerificationCode(
  rawPhone: string,
  code: string,
  otpSessionToken: string
): Promise<{ phone: string; phoneVerificationToken: string }> {
  const phone = normalizeRegisterPhone(rawPhone)
  if (!phone) {
    throw new Error('Утасны дугаар буруу байна')
  }

  const normalizedCode = String(code ?? '').trim()
  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new Error('6 оронтой код оруулна уу')
  }

  const session = decodeOtpSessionToken(otpSessionToken)
  if (!session || session.phone !== phone) {
    throw new Error('Кодын хугацаа дууссан эсвэл буруу байна. Шинэ код илгээнэ үү')
  }

  if (session.attempts >= MAX_ATTEMPTS) {
    throw new Error('Оролдлогын хязгаар хэтэрсэн. Шинэ код илгээнэ үү')
  }

  const isMatch = await bcrypt.compare(normalizedCode, session.codeHash)
  if (!isMatch) {
    const nextAttempts = session.attempts + 1
    const nextToken = createOtpSessionToken(phone, session.codeHash, nextAttempts)
    throw new RegisterOtpVerifyError('Баталгаажуулах код буруу байна', nextToken)
  }

  return {
    phone,
    phoneVerificationToken: generateRegisterPhoneToken(phone),
  }
}
