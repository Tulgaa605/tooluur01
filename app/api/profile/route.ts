import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { hashPassword, generateToken } from '@/lib/auth'
import { Role } from '@/lib/role'
import {
  maskPhoneForDisplay,
  verifyProfilePhoneToken,
} from '@/lib/profile-phone-verification'
import { normalizeRegisterPhone } from '@/lib/register-phone-verification'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthUser(request)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        organizationId: true,
      },
    })
    if (!user) return NextResponse.json({ error: 'Хэрэглэгч олдсонгүй' }, { status: 404 })

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
        phoneMasked: maskPhoneForDisplay(user.phone),
        hasPhone: Boolean(user.phone?.trim()),
      },
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = getAuthUser(request)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Хүсэлт буруу байна' }, { status: 400 })
    }

    const profileVerificationToken = String(
      (body as { profileVerificationToken?: unknown }).profileVerificationToken ?? ''
    ).trim()
    if (!profileVerificationToken) {
      return NextResponse.json(
        { error: 'Утасны дугаараа баталгаажуулсны дараа засварлана уу' },
        { status: 400 }
      )
    }

    const tokenPayload = verifyProfilePhoneToken(profileVerificationToken)
    if (!tokenPayload || tokenPayload.userId !== auth.userId) {
      return NextResponse.json(
        { error: 'Баталгаажуулалтын хугацаа дууссан. Кодоо дахин баталгаажуулна уу' },
        { status: 400 }
      )
    }

    const current = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, email: true, phone: true, password: true, role: true, organizationId: true },
    })
    if (!current) return NextResponse.json({ error: 'Хэрэглэгч олдсонгүй' }, { status: 404 })

    if (!current.phone || normalizeRegisterPhone(current.phone) !== tokenPayload.phone) {
      return NextResponse.json(
        { error: 'Утасны дугаар таарахгүй байна. Дахин баталгаажуулна уу' },
        { status: 400 }
      )
    }

    const data: {
      email?: string
      password?: string
    } = {}

    if ('email' in body) {
      const email = String((body as { email?: unknown }).email ?? '').trim().toLowerCase()
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'Имэйл буруу байна' }, { status: 400 })
      }
      if (email !== current.email) {
        const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } })
        if (taken && taken.id !== current.id) {
          return NextResponse.json({ error: 'Энэ имэйлтэй хэрэглэгч аль хэдийн бүртгэлтэй байна' }, { status: 400 })
        }
        data.email = email
      }
    }

    if ('password' in body) {
      const password = String((body as { password?: unknown }).password ?? '')
      if (password) {
        if (password.length < 6) {
          return NextResponse.json(
            { error: 'Нууц үг хамгийн багадаа 6 тэмдэгт байх ёстой' },
            { status: 400 }
          )
        }
        data.password = await hashPassword(password)
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Засах мэдээлэл оруулна уу' }, { status: 400 })
    }

    const updated = await prisma.user.update({
      where: { id: current.id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        organizationId: true,
      },
    })

    const response = NextResponse.json({
      success: true,
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        organizationId: updated.organizationId,
        phoneMasked: maskPhoneForDisplay(updated.phone),
        hasPhone: Boolean(updated.phone?.trim()),
      },
    })

    if (data.email && updated.email !== auth.email) {
      const token = generateToken({
        userId: updated.id,
        email: updated.email,
        role: updated.role as Role,
        organizationId: updated.organizationId,
      })
      response.cookies.set('token', token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
      })
    }

    return response
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Алдаа гарлаа'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
