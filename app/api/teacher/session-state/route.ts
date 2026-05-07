import { NextRequest, NextResponse } from 'next/server'
import {
  getLiveQuestionAnalyses,
  getSession,
  getSessionParticipants,
  getSessionQuestions,
  getSessionResponses,
} from '@/lib/supabase/queries'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const sessionId = String(body?.sessionId || '')

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const [session, participants, questions, responses, liveQuestionAnalyses] = await Promise.all([
      getSession(sessionId),
      getSessionParticipants(sessionId),
      getSessionQuestions(sessionId),
      getSessionResponses(sessionId),
      getLiveQuestionAnalyses(sessionId),
    ])

    return NextResponse.json({
      session,
      participants,
      questions,
      responses,
      liveQuestionAnalyses,
    })
  } catch (error) {
    console.error('teacher session-state error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load teacher session state.' },
      { status: 500 }
    )
  }
}
