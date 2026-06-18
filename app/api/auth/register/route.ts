import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, generateToken } from '@/lib/auth'
import { Role } from '@/lib/role'
import { applyCategoryTariffsToOrganization } from '@/lib/tariff'
import {
  normalizeRegisterPhone,
  verifyRegisterPhoneToken,
  SKIP_REGISTER_PHONE_VERIFICATION,
} from '@/lib/register-phone-verification'
import { assertUserPhoneAvailable } from '@/lib/user-phone'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { email, password, name, organizationId, phone, phoneVerificationToken } =
      await request.json()

    if (!email || !password || !name || !phone) {
      return NextResponse.json(
        { error: 'Имэйл, нууц үг, нэр, утасны дугаар шаардлагатай' },
        { status: 400 }
      )
    }

    const normalizedPhone = normalizeRegisterPhone(String(phone))
    if (!normalizedPhone) {
      return NextResponse.json({ error: 'Утасны дугаар буруу байна' }, { status: 400 })
    }

    if (!SKIP_REGISTER_PHONE_VERIFICATION) {
      if (!phoneVerificationToken) {
        return NextResponse.json(
          { error: 'Утасны дугаар баталгаажаагүй байна. Кодоо дахин баталгаажуулна уу' },
          { status: 400 }
        )
      }
      const phoneToken = verifyRegisterPhoneToken(String(phoneVerificationToken))
      if (!phoneToken || phoneToken.phone !== normalizedPhone) {
        return NextResponse.json(
          { error: 'Утасны дугаар баталгаажаагүй байна. Кодоо дахин баталгаажуулна уу' },
          { status: 400 }
        )
      }
    }

    await assertUserPhoneAvailable(normalizedPhone)

    const existingUser = await prisma.user.findUnique({
      where: { email },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'Энэ имэйлтэй хэрэглэгч аль хэдийн бүртгэлтэй байна' },
        { status: 400 }
      )
    }
    
    const userRole = Role.ACCOUNTANT

    const hashedPassword = await hashPassword(password)

    const currentYear = new Date().getFullYear()

    let orgId: string | null =
      organizationId != null && String(organizationId).trim() !== ''
        ? String(organizationId).trim()
        : null
    if (orgId) {
      const orgExists = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { id: true },
      })
      if (!orgExists) {
        return NextResponse.json({ error: 'Байгууллага олдсонгүй' }, { status: 400 })
      }
    }

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        phone: normalizedPhone,
        role: userRole,
        organizationId: orgId,
        year: currentYear,
      },
      include: { organization: true },
    })

    // Байгууллага заагаагүй бол автоматаар нэг байгууллага үүсгэж холбоно — эсвэл тоолуур/заалт нэмэгдэхгүй
    if (!orgId) {
      const orgName = `${name.trim()} (${email})`
      const org = await prisma.organization.create({
        data: {
          name: orgName,
          // Шинэ бүртгэл ACCOUNTANT эрхтэй тул албан байгууллага ангиллаар үүсгэнэ.
          category: 'ORGANIZATION',
          baseCleanFee: 0,
          baseDirtyFee: 0,
          year: currentYear,
          createdByUserId: user.id,
          updatedByUserId: user.id,
        },
      })
      await applyCategoryTariffsToOrganization(org.id)
      await prisma.user.update({
        where: { id: user.id },
        data: { organizationId: org.id },
      })
      orgId = org.id
    }

    const userOut = await prisma.user.findUnique({
      where: { id: user.id },
      include: { organization: true },
    })
    if (!userOut) {
      return NextResponse.json({ error: 'Бүртгэлд алдаа гарлаа' }, { status: 500 })
    }

    const token = generateToken({
      userId: userOut.id,
      email: userOut.email,
      role: userRole,
      organizationId: userOut.organizationId,
    })

    const response = NextResponse.json({
      success: true,
      token,
      user: {
        id: userOut.id,
        email: userOut.email,
        name: userOut.name,
        role: userOut.role,
        organizationId: userOut.organizationId,
        phone: userOut.phone,
      },
    })

    response.cookies.set('token', token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })

    return response
  } catch (error: any) {
    console.error('Register error:', error)
    return NextResponse.json(
      { error: error.message || 'Бүртгэлд алдаа гарлаа' },
      { status: 500 }
    )
  }
}


