import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/supabase/queries'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const sessionId = String(body?.sessionId || '')

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const session = await getSession(sessionId)
    return NextResponse.json({ session })
  } catch (error) {
    console.error('student session-status error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load student session status.' },
      { status: 500 }
    )
  }
}
