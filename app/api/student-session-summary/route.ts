import { NextRequest, NextResponse } from 'next/server'
import { generateStudentSessionSummary } from '@/lib/student-session-summary'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const sessionId = String(body?.sessionId || '')

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const summary = await generateStudentSessionSummary(sessionId)
    return NextResponse.json(summary)
  } catch (error) {
    console.error('student-session-summary error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build student summary.' },
      { status: 500 }
    )
  }
}
