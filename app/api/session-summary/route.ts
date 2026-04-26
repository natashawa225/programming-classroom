import { NextRequest, NextResponse } from 'next/server'
import { getTeacherSession } from '@/lib/teacher-auth'
import { generateSessionSummary, storeSessionSummary } from '@/lib/session-summary'

export async function POST(request: NextRequest) {
  try {
    const teacherSession = await getTeacherSession()
    if (!teacherSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const sessionId = String(body?.sessionId || '')
    const force = request.nextUrl.searchParams.get('force') === 'true' || body?.force === true

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const summary = await generateSessionSummary({
      sessionId,
      force,
    })
    await storeSessionSummary(sessionId, summary)

    return NextResponse.json(summary)
  } catch (error) {
    console.error('session-summary error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate session summary.' },
      { status: 500 }
    )
  }
}
