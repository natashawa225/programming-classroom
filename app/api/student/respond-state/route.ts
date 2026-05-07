import { NextRequest, NextResponse } from 'next/server'
import { getSession, getSessionParticipantForStudent, getSessionQuestions } from '@/lib/supabase/queries'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const sessionId = String(body?.sessionId || '')

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const [session, participation, questions] = await Promise.all([
      getSession(sessionId),
      getSessionParticipantForStudent(sessionId),
      getSessionQuestions(sessionId),
    ])

    return NextResponse.json({
      session,
      participation,
      questions,
    })
  } catch (error) {
    console.error('student respond-state error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load student session state.' },
      { status: 500 }
    )
  }
}
