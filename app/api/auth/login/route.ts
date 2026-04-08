import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { comparePassword, generateToken } from '@/lib/auth'
import { Role } from '@/lib/role'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Имэйл болон нууц үг оруулна уу' },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        name: true,
        role: true,
        organizationId: true,
      },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Имэйл эсвэл нууц үг буруу байна' },
        { status: 401 }
      )
    }

    const isValid = await comparePassword(password, user.password)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Имэйл эсвэл нууц үг буруу байна' },
        { status: 401 }
      )
    }

    // Зарим хуучин бүртгэлд (ялангуяа ACCOUNTANT/MANAGER) organizationId хоосон үлдсэн байж болно.
    // Тэгвэл scope-д тулгуурласан бүх үйлдлүүд (тоолуур/заалт/харилцагч) ажиллахгүй тул login үед засварлана.
    let organizationId = user.organizationId
    const role = user.role as Role
    if ((role === Role.ACCOUNTANT || role === Role.MANAGER) && !organizationId) {
      const currentYear = new Date().getFullYear()
      const orgName = `${user.name.trim()} (${user.email})`
      const org = await prisma.organization.create({
        data: {
          name: orgName,
          category: 'ORGANIZATION',
          baseCleanFee: 0,
          baseDirtyFee: 0,
          year: currentYear,
          createdByUserId: user.id,
          updatedByUserId: user.id,
        },
      })
      await prisma.user.update({
        where: { id: user.id },
        data: { organizationId: org.id },
      })
      organizationId = org.id
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role,
      organizationId,
    })

    const response = NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId,
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
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа' },
      { status: 500 }
    )
  }
}

