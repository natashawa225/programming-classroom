import { NextRequest, NextResponse } from 'next/server'
import { getTeacherSession } from '@/lib/teacher-auth'
import { clusterLiveQuestionResponses, LiveClusteringError } from '@/lib/ai/live-question-clustering'
import { getUnionFindQuestionContext } from '@/lib/ai/union-find-question-config'
import {
  closeCurrentQuestion,
  createAnalysisRun,
  getSession,
  getSessionQuestions,
  getSessionResponses,
  logSessionEvent,
  updateAnalysisRun,
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

function getRoundNumberForAttemptType(attemptType: AttemptType): 1 | 2 {
  return attemptType === 'revision' ? 2 : 1
}

function buildLiveQuestionPromptPayload(input: {
  questionId: string
  questionPosition: number
  questionPrompt: string
  correctAnswer: string | null
  lessonContext: ReturnType<typeof getUnionFindQuestionContext>
  attemptType: AttemptType
  responses: Array<{ response_id: string; answer: string; confidence: number }>
}) {
  return {
    prompt_version: 'live_question_clusters_v1',
    system_instruction:
      'Cluster short student answers for one open-ended classroom question into 2 to 5 reasoning-pattern groups.',
    user_input: {
      question_id: input.questionId,
      question_position: input.questionPosition,
      question_prompt: input.questionPrompt,
      correct_answer: input.correctAnswer,
      lesson_concept: input.lessonContext?.lesson_concept ?? null,
      target_misconception: input.lessonContext?.target_misconception ?? null,
      strong_answer_criteria: input.lessonContext?.strong_answer_criteria ?? [],
      misconception_variants: input.lessonContext?.misconception_variants ?? [],
      attempt_type: input.attemptType,
      responses: input.responses,
    },
  }
}

async function logEventSafely(data: {
  sessionId: string
  questionId?: string | null
  eventType: 'question_closed' | 'revision_closed' | 'analysis_generated'
  roundNumber: 1 | 2
}) {
  try {
    await logSessionEvent(data)
  } catch (error) {
    console.error('session event logging warning', error)
  }
}

export async function POST(request: NextRequest) {
  let analysisRunId: string | null = null
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

    let closedInThisRequest = false
    if (
      (attemptType === 'initial' && session.live_phase === 'question_initial_open') ||
      (attemptType === 'revision' && session.live_phase === 'question_revision_open')
    ) {
      await retryOperation(() => closeCurrentQuestion(sessionId, attemptType))
      closedInThisRequest = true
    }

    const responses = (await retryOperation(() => getSessionResponses(sessionId))).filter((response) => {
      return response.question_id === question.question_id && response.attempt_type === attemptType
    })
    if (responses.length === 0) {
      return NextResponse.json({ error: 'No responses found for this question attempt.' }, { status: 400 })
    }

    const roundNumber = getRoundNumberForAttemptType(attemptType)
    const lessonContext = getUnionFindQuestionContext({
      position: question.position,
      prompt: question.prompt,
    })
    const promptPayload = buildLiveQuestionPromptPayload({
      questionId: question.question_id,
      questionPosition: question.position,
      questionPrompt: question.prompt,
      correctAnswer: question.correct_answer ?? null,
      lessonContext,
      attemptType,
      responses: responses.map((response) => ({
        response_id: response.response_id,
        answer: response.answer,
        confidence: response.confidence,
      })),
    })
    console.info(
      `[live-analysis] question_id=${question.question_id} position=${question.position} prompt_included=true correct_answer_included=${Boolean(question.correct_answer && question.correct_answer.trim())} lesson_context_included=${Boolean(lessonContext)} response_count=${responses.length} round_number=${roundNumber} attempt_type=${attemptType}`
    )
    const modelName = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
    const run = await createAnalysisRun({
      sessionId,
      questionId: question.question_id,
      condition: session.condition,
      sessionStatus: session.status,
      roundNumber,
      model: modelName,
      modelName,
      status: 'running',
      promptJson: promptPayload,
    })
    analysisRunId = run.analysis_run_id

    const analysis = await clusterLiveQuestionResponses({
      questionId: question.question_id,
      questionPosition: question.position,
      questionPrompt: question.prompt,
      correctAnswer: question.correct_answer ?? null,
      lessonContext,
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

    await updateAnalysisRun({
      analysisRunId: run.analysis_run_id,
      status: 'completed',
      analysisJson: analysis as Record<string, unknown>,
      summaryJson: {
        source: analysis.source,
        total_responses: analysis.total_responses,
        cluster_count: analysis.cluster_count,
        attempt_type: analysis.attempt_type,
      },
      rawResponseJson: {
        question_id: question.question_id,
        responses: responses.map((response) => ({
          response_id: response.response_id,
          session_participant_id: response.session_participant_id,
          answer: response.answer,
          confidence: response.confidence,
          original_response_id: response.original_response_id,
          created_at: response.created_at,
        })),
      },
    })

    if (closedInThisRequest) {
      await logEventSafely({
        sessionId,
        questionId: question.question_id,
        eventType: attemptType === 'revision' ? 'revision_closed' : 'question_closed',
        roundNumber,
      })
    }
    await logEventSafely({
      sessionId,
      questionId: question.question_id,
      eventType: 'analysis_generated',
      roundNumber,
    })

    return NextResponse.json({
      question,
      attemptType,
      analysis,
      saved,
      persistenceWarning,
    })
  } catch (error) {
    console.error('live-question-analysis error', error)
    if (analysisRunId) {
      try {
        await updateAnalysisRun({
          analysisRunId,
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Failed to analyze live question.',
        })
      } catch {}
    }
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
