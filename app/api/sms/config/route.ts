import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { Role } from '@/lib/role'
import { getDefaultSmsSender, getSmsSenderChoices } from '@/lib/sms-senders'

export async function GET(request: NextRequest) {
  try {
    requireAuth(request, [Role.ACCOUNTANT, Role.MANAGER, Role.USER])
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ''
    if (msg === 'Forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    senders: getSmsSenderChoices(),
    defaultSender: getDefaultSmsSender(),
  })
}
