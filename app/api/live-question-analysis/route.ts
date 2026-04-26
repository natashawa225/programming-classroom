import { NextRequest, NextResponse } from 'next/server'
import { getTeacherSession } from '@/lib/teacher-auth'
import { clusterLiveQuestionResponses, LiveClusteringError } from '@/lib/ai/live-question-clustering'
import {
  closeCurrentQuestion,
  getSession,
  getSessionQuestions,
  getSessionResponses,
  upsertLiveQuestionAnalysis,
} from '@/lib/supabase/queries'
import type { AttemptType } from '@/lib/types/database'

async function retryOperation<T>(operation: () => Promise<T>, attempts = 3, delayMs = 250): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)))
      }
    }
  }

  throw lastError
}

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

    const [session, questions] = await Promise.all([
      retryOperation(() => getSession(sessionId)),
      retryOperation(() => getSessionQuestions(sessionId)),
    ])
    const question =
      questions.find((entry) => entry.position === session.current_question_position) ||
      questions[0] ||
      null
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
      await retryOperation(() => closeCurrentQuestion(sessionId, attemptType))
    }

    const responses = (await retryOperation(() => getSessionResponses(sessionId))).filter((response) => {
      return response.question_id === question.question_id && response.attempt_type === attemptType
    })
    if (responses.length === 0) {
      return NextResponse.json({ error: 'No responses found for this question attempt.' }, { status: 400 })
    }

    const analysis = await clusterLiveQuestionResponses({
      questionPrompt: question.prompt,
      attemptType,
      responses: responses.map((response) => ({
        response_id: response.response_id,
        answer: response.answer,
        confidence: response.confidence,
      })),
    })

    let saved = null
    let persistenceWarning: string | null = null
    try {
      saved = await retryOperation(() =>
        upsertLiveQuestionAnalysis({
          sessionId,
          questionId: question.question_id,
          attemptType,
          analysisJson: analysis,
        })
      )
    } catch (storageError) {
      console.error('live-question-analysis storage warning', storageError)
      persistenceWarning = 'Analysis was generated, but saving it failed. It is available for this view only until storage recovers.'
    }

    return NextResponse.json({
      question,
      attemptType,
      analysis,
      saved,
      persistenceWarning,
    })
  } catch (error) {
    console.error('live-question-analysis error', error)
    if (error instanceof LiveClusteringError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === 'no_responses' ? 400 : 502 }
      )
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to analyze live question.' },
      { status: 500 }
    )
  }
}
