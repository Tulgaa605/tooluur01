import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { sendTextSms } from '@/lib/sms'
import { normalizeRegisterPhone } from '@/lib/register-phone-verification'
import { assertUserPhoneAvailable, normalizeUserPhone } from '@/lib/user-phone'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'
const RESEND_COOLDOWN_MS = 60 * 1000
const MAX_ATTEMPTS = 5
const OTP_TOKEN_TTL = '10m'
const VERIFICATION_TOKEN_TTL = '15m'
export const PROFILE_SMS_SENDER = '159099'

export const PROFILE_PHONE_TOKEN_PURPOSE = 'profile_phone_verified'
const PROFILE_OTP_PURPOSE = 'profile_otp'

export interface ProfilePhoneTokenPayload {
  purpose: typeof PROFILE_PHONE_TOKEN_PURPOSE
  userId: string
  phone: string
}

interface ProfileOtpTokenPayload {
  purpose: typeof PROFILE_OTP_PURPOSE
  userId: string
  phone: string
  codeHash: string
  attempts: number
}

export class ProfileOtpVerifyError extends Error {
  otpSessionToken?: string

  constructor(message: string, otpSessionToken?: string) {
    super(message)
    this.name = 'ProfileOtpVerifyError'
    this.otpSessionToken = otpSessionToken
  }
}

function generateSixDigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function createOtpSessionToken(
  userId: string,
  phone: string,
  codeHash: string,
  attempts = 0
): string {
  const payload: ProfileOtpTokenPayload = {
    purpose: PROFILE_OTP_PURPOSE,
    userId,
    phone,
    codeHash,
    attempts,
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: OTP_TOKEN_TTL })
}

function decodeOtpSessionToken(token: string): ProfileOtpTokenPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as ProfileOtpTokenPayload
    if (
      payload?.purpose !== PROFILE_OTP_PURPOSE ||
      !payload.userId ||
      !payload.phone ||
      !payload.codeHash
    ) {
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

export function generateProfilePhoneToken(userId: string, phone: string): string {
  const payload: ProfilePhoneTokenPayload = {
    purpose: PROFILE_PHONE_TOKEN_PURPOSE,
    userId,
    phone,
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: VERIFICATION_TOKEN_TTL })
}

export function verifyProfilePhoneToken(token: string): ProfilePhoneTokenPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as ProfilePhoneTokenPayload
    if (payload?.purpose !== PROFILE_PHONE_TOKEN_PURPOSE || !payload.userId || !payload.phone) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

export function maskPhoneForDisplay(phone: string | null | undefined): string {
  if (!phone) return '—'
  const digits = phone.replace(/\D/g, '')
  const local = digits.length >= 8 ? digits.slice(-8) : digits
  if (local.length < 4) return '****'
  return `+976 ****${local.slice(-4)}`
}

async function resolveProfilePhone(
  userId: string,
  newPhone?: string
): Promise<{ phone: string; isLinking: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true },
  })
  const stored = normalizeUserPhone(String(user?.phone ?? ''))

  if (stored) {
    return { phone: stored, isLinking: false }
  }

  const phone = normalizeUserPhone(String(newPhone ?? ''))
  if (!phone) {
    throw new Error('Утасны дугаар оруулна уу (8 оронтой Монгол дугаар)')
  }

  await assertUserPhoneAvailable(phone, userId)
  return { phone, isLinking: true }
}

export async function sendProfileVerificationCode(
  userId: string,
  opts?: { otpSessionToken?: string; newPhone?: string }
): Promise<{ phone: string; phoneMasked: string; otpSessionToken: string; devCode?: string }> {
  const { phone } = await resolveProfilePhone(userId, opts?.newPhone)

  if (opts?.otpSessionToken) {
    const issuedAt = getTokenIssuedAtMs(opts.otpSessionToken)
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
  const otpSessionToken = createOtpSessionToken(userId, phone, codeHash, 0)

  const message = `Профайл засварлах баталгаажуулах код: ${code}. 10 минутын дотор ашиглана уу.`
  const sms = await sendTextSms([phone], message, PROFILE_SMS_SENDER)

  const isDev = process.env.NODE_ENV !== 'production'
  if (!sms.enabled) {
    if (isDev) {
      console.log(`[profile-otp] ${phone}: ${code}`)
      return {
        phone,
        phoneMasked: maskPhoneForDisplay(phone),
        otpSessionToken,
        devCode: code,
      }
    }
    throw new Error('SMS илгээх тохиргоо хийгдээгүй байна. Админтай холбогдоно уу.')
  }

  const failed = sms.results.find((r) => !r.ok)
  if (failed) {
    throw new Error(failed.error || 'SMS илгээхэд алдаа гарлаа')
  }

  return {
    phone,
    phoneMasked: maskPhoneForDisplay(phone),
    otpSessionToken,
  }
}

export async function verifyProfileVerificationCode(
  userId: string,
  code: string,
  otpSessionToken: string
): Promise<{ phone: string; profileVerificationToken: string; phoneLinked: boolean }> {
  const normalizedCode = String(code ?? '').trim()
  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new Error('6 оронтой код оруулна уу')
  }

  const session = decodeOtpSessionToken(otpSessionToken)
  if (!session || session.userId !== userId) {
    throw new Error('Кодын хугацаа дууссан эсвэл буруу байна. Шинэ код илгээнэ үү')
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true },
  })
  const stored = normalizeUserPhone(String(user?.phone ?? ''))
  if (stored && stored !== session.phone) {
    throw new Error('Утасны дугаар таарахгүй байна. Шинэ код илгээнэ үү')
  }

  if (session.attempts >= MAX_ATTEMPTS) {
    throw new Error('Оролдлогын хязгаар хэтэрсэн. Шинэ код илгээнэ үү')
  }

  const isMatch = await bcrypt.compare(normalizedCode, session.codeHash)
  if (!isMatch) {
    const nextAttempts = session.attempts + 1
    const nextToken = createOtpSessionToken(userId, session.phone, session.codeHash, nextAttempts)
    throw new ProfileOtpVerifyError('Баталгаажуулах код буруу байна', nextToken)
  }

  let phoneLinked = false
  if (!stored) {
    await assertUserPhoneAvailable(session.phone, userId)
    await prisma.user.update({
      where: { id: userId },
      data: { phone: session.phone },
    })
    phoneLinked = true
  }

  return {
    phone: session.phone,
    profileVerificationToken: generateProfilePhoneToken(userId, session.phone),
    phoneLinked,
  }
}
