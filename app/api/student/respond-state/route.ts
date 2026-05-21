import { NextRequest, NextResponse } from 'next/server'
import { getSessionParticipantForStudent, getStudentRespondSessionState } from '@/lib/supabase/queries'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const sessionId = String(body?.sessionId || '')

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const [state, participation] = await Promise.all([
      getStudentRespondSessionState(sessionId),
      getSessionParticipantForStudent(sessionId),
    ])

    return NextResponse.json({
      session: state.session,
      participation,
      questions: state.questions,
    })
  } catch (error) {
    console.error('student respond-state error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load student session state.' },
      { status: 500 }
    )
  }
}
