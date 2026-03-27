import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, generateToken } from '@/lib/auth'
import { Role } from '@/lib/role'
import { applyCategoryTariffsToOrganization } from '@/lib/tariff'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { email, password, name, organizationId } = await request.json()

    if (!email || !password || !name) {
      return NextResponse.json(
        { error: 'Имэйл, нууц үг, нэр оруулна уу' },
        { status: 400 }
      )
    }

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


