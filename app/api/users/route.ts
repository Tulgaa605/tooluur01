import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const where: { organizationId?: string | null } = {}
    if (user.organizationId) {
      where.organizationId = user.organizationId
    }
    const users = await prisma.user.findMany({
      where: Object.keys(where).length ? where : undefined,
      select: {
        id: true,
        email: true,
        code: true,
        name: true,
        role: true,
        year: true,
        phone: true,
        organizationId: true,
        organization: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json(users)
  } catch (error: any) {
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const data = await request.json()

    if (!data.id) {
      return NextResponse.json(
        { error: 'Хэрэглэгчийн ID шаардлагатай' },
        { status: 400 }
      )
    }

    if (!data.name || data.name.trim() === '') {
      return NextResponse.json(
        { error: 'Хэрэглэгчийн нэр оруулна уу' },
        { status: 400 }
      )
    }

    if (user.organizationId) {
      const target = await prisma.user.findUnique({
        where: { id: data.id },
        select: { organizationId: true },
      })
      if (!target || target.organizationId !== user.organizationId) {
        return NextResponse.json(
          { error: 'Энэ хэрэглэгчийг засах эрхгүй' },
          { status: 403 }
        )
      }
    }

    const updateData: any = {
      name: data.name.trim(),
      code: data.code?.trim() || null,
      phone: data.phone?.trim() || null,
      organizationId: data.organizationId ?? null,
    }
    if (user.organizationId) {
      updateData.organizationId = user.organizationId
    }

    // Only allow role update for MANAGER
    if (data.role && Object.values(Role).includes(data.role as Role)) {
      updateData.role = data.role
    }

    const updatedUser = await prisma.user.update({
      where: { id: data.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        year: true,
        phone: true,
        organization: {
          select: {
            name: true,
          },
        },
      },
    })

    return NextResponse.json(updatedUser)
  } catch (error: any) {
    console.error('User update error:', error)
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Хэрэглэгчийн ID шаардлагатай' },
        { status: 400 }
      )
    }

    // Don't allow deleting yourself
    if (id === user.userId) {
      return NextResponse.json(
        { error: 'Та өөрийгөө устгах боломжгүй' },
        { status: 400 }
      )
    }

    if (user.organizationId) {
      const target = await prisma.user.findUnique({
        where: { id },
        select: { organizationId: true },
      })
      if (!target || target.organizationId !== user.organizationId) {
        return NextResponse.json(
          { error: 'Энэ хэрэглэгчийг устгах эрхгүй' },
          { status: 403 }
        )
      }
    }

    await prisma.user.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('User deletion error:', error)
    if (error.message === 'Unauthorized' || error.message === 'Forbidden') {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    return NextResponse.json(
      { error: error.message || 'Алдаа гарлаа' },
      { status: 500 }
    )
  }
}

