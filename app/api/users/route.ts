import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/role'
import { getScopedOrganizationIds, organizationIdInScope } from '@/lib/org-scope'

export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request, [Role.ACCOUNTANT])
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const scoped = await getScopedOrganizationIds(user)
    if (scoped.length === 0) return NextResponse.json([])

    const users = await prisma.user.findMany({
      where: { organizationId: { in: scoped } },
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

    const target = await prisma.user.findUnique({
      where: { id: data.id },
      select: { organizationId: true },
    })
    if (
      !target?.organizationId ||
      !(await organizationIdInScope(user, target.organizationId))
    ) {
      return NextResponse.json(
        { error: 'Энэ хэрэглэгчийг засах эрхгүй' },
        { status: 403 }
      )
    }

    const updateData: any = {
      name: data.name.trim(),
      code: data.code?.trim() || null,
      phone: data.phone?.trim() || null,
    }
    if (data.organizationId != null && String(data.organizationId).trim() !== '') {
      const oid = String(data.organizationId).trim()
      if (!(await organizationIdInScope(user, oid))) {
        return NextResponse.json({ error: 'Эрхгүй' }, { status: 403 })
      }
      updateData.organizationId = oid
    } else {
      updateData.organizationId = target.organizationId
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

    const target = await prisma.user.findUnique({
      where: { id },
      select: { organizationId: true },
    })
    if (
      !target?.organizationId ||
      !(await organizationIdInScope(user, target.organizationId))
    ) {
      return NextResponse.json(
        { error: 'Энэ хэрэглэгчийг устгах эрхгүй' },
        { status: 403 }
      )
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

