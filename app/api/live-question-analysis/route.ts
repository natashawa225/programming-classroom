import { NextRequest, NextResponse } from 'next/server'
import { getTeacherSession } from '@/lib/teacher-auth'
import { clusterLiveQuestionResponses } from '@/lib/ai/live-question-clustering'
import {
  closeCurrentQuestion,
  getCurrentSessionQuestion,
  getSession,
  getSessionResponses,
  upsertLiveQuestionAnalysis,
} from '@/lib/supabase/queries'
import type { AttemptType } from '@/lib/types/database'

function inferAttemptType(session: Awaited<ReturnType<typeof getSession>>): AttemptType | null {
  if (session.live_phase === 'question_initial_open' || session.live_phase === 'question_initial_closed') {
    return 'initial'
  }
  if (session.live_phase === 'question_revision_open' || session.live_phase === 'question_revision_closed') {
    return 'revision'
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    const teacherSession = await getTeacherSession()
    if (!teacherSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const sessionId = String(body?.sessionId || '')
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const session = await getSession(sessionId)
    const question = await getCurrentSessionQuestion(sessionId)
    const attemptType = (body?.attemptType as AttemptType | undefined) || inferAttemptType(session)

    if (!question) {
      return NextResponse.json({ error: 'No current question found.' }, { status: 400 })
    }
    if (!attemptType) {
      return NextResponse.json({ error: 'No question attempt is active or selected.' }, { status: 400 })
    }

    if (
      (attemptType === 'initial' && session.live_phase === 'question_initial_open') ||
      (attemptType === 'revision' && session.live_phase === 'question_revision_open')
    ) {
      await closeCurrentQuestion(sessionId, attemptType)
    }

    const responses = (await getSessionResponses(sessionId)).filter((response) => {
      return response.question_id === question.question_id && response.attempt_type === attemptType
    })

    const analysis = await clusterLiveQuestionResponses({
      questionPrompt: question.prompt,
      attemptType,
      responses: responses.map((response) => ({
        response_id: response.response_id,
        answer: response.answer,
        confidence: response.confidence,
      })),
    })

    const saved = await upsertLiveQuestionAnalysis({
      sessionId,
      questionId: question.question_id,
      attemptType,
      analysisJson: analysis,
    })

    return NextResponse.json({
      question,
      attemptType,
      analysis,
      saved,
    })
  } catch (error) {
    console.error('live-question-analysis error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to analyze live question.' },
      { status: 500 }
    )
  }
}
