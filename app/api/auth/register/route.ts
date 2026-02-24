import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, generateToken } from '@/lib/auth'
import { Role } from '@/lib/role'

export async function POST(request: NextRequest) {
  try {
    const { email, password, name, role, organizationId } = await request.json()

    if (!email || !password || !name) {
      return NextResponse.json(
        { error: 'Имэйл, нууц үг, нэр оруулна уу' },
        { status: 400 }
      )
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'Энэ имэйлтэй хэрэглэгч аль хэдийн бүртгэлтэй байна' },
        { status: 400 }
      )
    }

    // Validate role
    const userRole = role && Object.values(Role).includes(role as Role) 
      ? (role as Role) 
      : Role.USER

    // Hash password
    const hashedPassword = await hashPassword(password)

    // Get current year
    const currentYear = new Date().getFullYear()

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: userRole,
        organizationId: organizationId || null,
        year: currentYear,
      },
      include: { organization: true },
    })

    // Generate token and login automatically
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    })

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
      },
    })

    response.cookies.set('token', token, {
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


