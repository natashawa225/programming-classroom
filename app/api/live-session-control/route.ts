import { NextRequest, NextResponse } from 'next/server'
import { generateSessionSummary, storeSessionSummary } from '@/lib/session-summary'
import { getTeacherSession } from '@/lib/teacher-auth'
import {
  completeSession,
  getCurrentSessionQuestion,
  getSession,
  logSessionEvent,
  moveToNextQuestion,
  openQuestionRevision,
  startCurrentQuestion,
} from '@/lib/supabase/queries'

async function logEventSafely(data: {
  sessionId: string
  eventType: 'session_started' | 'question_opened' | 'revision_opened'
  questionId?: string | null
  roundNumber?: 1 | 2
}) {
  try {
    await logSessionEvent(data)
  } catch (error) {
    console.error('session event logging warning', error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const teacherSession = await getTeacherSession()
    if (!teacherSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const sessionId = String(body?.sessionId || '')
    const action = String(body?.action || '')
    const timerSeconds =
      body?.timerSeconds === null || body?.timerSeconds === undefined || body?.timerSeconds === ''
        ? undefined
        : Number(body.timerSeconds)

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    if (action === 'start') {
      const [currentSession, currentQuestion] = await Promise.all([
        getSession(sessionId),
        getCurrentSessionQuestion(sessionId),
      ])
      const session = await startCurrentQuestion(sessionId, timerSeconds)
      if (currentSession.live_phase === 'not_started') {
        await logEventSafely({
          sessionId,
          eventType: 'session_started',
          questionId: currentQuestion?.question_id ?? null,
          roundNumber: 1,
        })
      }
      await logEventSafely({
        sessionId,
        eventType: 'question_opened',
        questionId: currentQuestion?.question_id ?? null,
        roundNumber: 1,
      })
      return NextResponse.json({ session })
    }

    if (action === 'open_revision') {
      const currentQuestion = await getCurrentSessionQuestion(sessionId)
      const session = await openQuestionRevision(sessionId, timerSeconds)
      await logEventSafely({
        sessionId,
        eventType: 'revision_opened',
        questionId: currentQuestion?.question_id ?? null,
        roundNumber: 2,
      })
      return NextResponse.json({ session })
    }

    if (action === 'next_question') {
      const session = await moveToNextQuestion(sessionId, timerSeconds)
      const nextQuestion = await getCurrentSessionQuestion(sessionId)
      await logEventSafely({
        sessionId,
        eventType: 'question_opened',
        questionId: nextQuestion?.question_id ?? null,
        roundNumber: 1,
      })
      return NextResponse.json({ session })
    }

    if (action === 'complete_session') {
      const session = await completeSession(sessionId)
      void (async () => {
        try {
          const summary = await generateSessionSummary({ sessionId, force: true })
          await storeSessionSummary(sessionId, summary)
        } catch (error) {
          console.error('background session summary generation failed', error)
        }
      })()
      return NextResponse.json({ session, summaryTriggered: true })
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  } catch (error) {
    console.error('live-session-control error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update live session.' },
      { status: 500 }
    )
  }
}
