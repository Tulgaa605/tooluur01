import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, TokenPayload } from './auth'
import { Role } from '@/lib/role'

export function getAuthUser(request: NextRequest): TokenPayload | null {
  // SPA нь sessionStorage-ийн шинэ token-ийг Authorization-д явуулдаг; cookie хуучин үлдсэн тохиолдолд Bearer-ийг илүүд үзнэ
  const authHeader = request.headers.get('authorization')
  let token: string | undefined
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  }
  if (!token) {
    token = request.cookies.get('token')?.value
  }
  if (!token) return null
  return verifyToken(token)
}

export function requireAuth(
  request: NextRequest,
  allowedRoles?: Role[]
): TokenPayload | null {
  const user = getAuthUser(request)
  if (!user) {
    throw new Error('Unauthorized')
  }
  if (allowedRoles && allowedRoles.length > 0) {
    const userRoleString = String(user.role)
    const allowedRoleStrings = allowedRoles.map(r => String(r))
    
    if (!allowedRoleStrings.includes(userRoleString)) {
      throw new Error('Forbidden')
    }
  }
  return user
}

export function createResponse(data: any, status: number = 200) {
  return NextResponse.json(data, { status })
}

export function createErrorResponse(message: string, status: number = 400) {
  return NextResponse.json({ error: message }, { status })
}

