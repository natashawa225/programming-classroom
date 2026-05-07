import { NextRequest, NextResponse } from 'next/server'
import { updateSessionStatus } from '@/lib/supabase/queries'
import type { SessionStatus } from '@/lib/types/database'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const sessionId = String(body?.sessionId || '')
    const status = body?.status as SessionStatus | undefined

    if (!sessionId || typeof status !== 'string') {
      return NextResponse.json({ error: 'Missing sessionId or status' }, { status: 400 })
    }

    const session = await updateSessionStatus(sessionId, status)
    return NextResponse.json({ session })
  } catch (error) {
    console.error('teacher session-status error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update session status.' },
      { status: 500 }
    )
  }
}
