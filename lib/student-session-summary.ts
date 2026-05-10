import {
  getLiveQuestionAnalysesForStudent,
  getSession,
  getSessionQuestions,
  getSessionResponsesForStudentSummary,
} from '@/lib/supabase/queries'
import type { AttemptType, LiveQuestionAnalysis, Response, Session } from '@/lib/types/database'

type SummarySource = 'live_analysis'
type UnderstandingBucket = 'strong_alignment' | 'mixed_reasoning' | 'needs_attention' | 'unclear'

type LiveAnalysisPayload = {
  version: 'live_question_clusters_v1' | 'live_question_clusters_v2'
  question_prompt: string
  attempt_type: AttemptType
  total_responses: number
  cluster_count: number
  source: 'openai' | 'fallback'
  fallback_reason?: string | null
  clusters: Array<{
    cluster_id: string
    label: string
    summary: string
    count: number
    average_confidence: number
    representative_answers: string[]
    understanding_bucket?: UnderstandingBucket
    teacher_note?: string | null
  }>
}

type StudentQuestionSummary = {
  questionId: string
  position: number
  prompt: string
  yourAnswer: string | null
  yourFirstAnswer: string | null
  yourRevisedAnswer: string | null
  confidence: {
    initial: number | null
    revised: number | null
    direction: 'increased' | 'decreased' | 'same' | 'unknown'
  }
  submitted: {
    initial: boolean
    revised: boolean
  }
  finalAnalysisAttemptType: AttemptType | null
  finalAnalysisLabel: 'Revision summary' | 'Initial response summary' | null
  analysisSource: 'openai' | 'fallback' | null
  usesFallbackGrouping: boolean
  clusters: Array<{
    clusterId: string
    label: string
    summary: string
    count: number
    averageConfidence: number
    understandingBucket: UnderstandingBucket
    understandingLabel: string
    learningNote: string | null
    representativeAnswers: string[]
  }>
}

export type StudentSessionSummaryPayload = {
  sessionId: string
  sessionCode: string
  condition: Session['condition']
  studentLabel: string
  source: SummarySource
  generatedAt: string
  averageConfidence: number | null
  questionsAnswered: number
  totalQuestions: number
  questions: StudentQuestionSummary[]
  revisionStats: null
}

function roundToOneDecimal(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null
  return Math.round(value * 10) / 10
}

function getConfidenceDirection(initial: number | null, revised: number | null) {
  if (initial === null || revised === null) return 'unknown' as const
  if (revised > initial) return 'increased' as const
  if (revised < initial) return 'decreased' as const
  return 'same' as const
}

function parseLiveAnalysis(value: LiveQuestionAnalysis | null | undefined): LiveAnalysisPayload | null {
  const raw = value?.analysis_json
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).clusters)) return null
  return raw as unknown as LiveAnalysisPayload
}

function getUnderstandingLabel(bucket: UnderstandingBucket) {
  switch (bucket) {
    case 'strong_alignment':
      return 'Strong understanding'
    case 'mixed_reasoning':
      return 'Partly developed reasoning'
    case 'needs_attention':
      return 'Needs review'
    case 'unclear':
    default:
      return 'Unclear reasoning pattern'
  }
}

function getFinalAnalysisForQuestion(questionId: string, analyses: LiveQuestionAnalysis[]) {
  const questionAnalyses = analyses.filter((analysis) => analysis.question_id === questionId)
  return (
    questionAnalyses.find((analysis) => analysis.attempt_type === 'revision') ||
    questionAnalyses.find((analysis) => analysis.attempt_type === 'initial') ||
    null
  )
}

function getResponseForAttempt(responses: Response[], questionId: string, attemptType: AttemptType) {
  return (
    responses
      .filter((response) => response.question_id === questionId && response.attempt_type === attemptType)
      .slice()
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0] || null
  )
}

export async function generateStudentSessionSummary(sessionId: string): Promise<StudentSessionSummaryPayload> {
  const [{ participation, responses }, session, questions, liveAnalyses] = await Promise.all([
    getSessionResponsesForStudentSummary(sessionId),
    getSession(sessionId),
    getSessionQuestions(sessionId),
    getLiveQuestionAnalysesForStudent(sessionId),
  ])

  if (session.status !== 'closed' && session.live_phase !== 'session_completed') {
    throw new Error('Student summary is only available after the session has ended.')
  }

  const studentResponses = responses.filter(
    (response) => response.session_participant_id === participation.session_participant_id
  )
  const averageConfidence =
    studentResponses.length > 0
      ? roundToOneDecimal(
          studentResponses.reduce((sum, response) => sum + Number(response.confidence || 0), 0) / studentResponses.length
        )
      : null

  const sortedQuestions = questions.slice().sort((a, b) => a.position - b.position)
  const questionSummaries = sortedQuestions.map((question) => {
    const initialResponse = getResponseForAttempt(studentResponses, question.question_id, 'initial')
    const revisedResponse = getResponseForAttempt(studentResponses, question.question_id, 'revision')
    const finalAnalysisRow = getFinalAnalysisForQuestion(question.question_id, liveAnalyses)
    const finalAnalysis = parseLiveAnalysis(finalAnalysisRow)

    return {
      questionId: question.question_id,
      position: question.position,
      prompt: question.prompt,
      yourAnswer: (revisedResponse || initialResponse)?.answer ?? null,
      yourFirstAnswer: initialResponse?.answer ?? null,
      yourRevisedAnswer: revisedResponse?.answer ?? null,
      confidence: {
        initial: initialResponse?.confidence ?? null,
        revised: revisedResponse?.confidence ?? null,
        direction: getConfidenceDirection(initialResponse?.confidence ?? null, revisedResponse?.confidence ?? null),
      },
      submitted: {
        initial: Boolean(initialResponse),
        revised: Boolean(revisedResponse),
      },
      finalAnalysisAttemptType: finalAnalysisRow?.attempt_type ?? null,
      finalAnalysisLabel: finalAnalysisRow
        ? finalAnalysisRow.attempt_type === 'revision'
          ? 'Revision summary'
          : 'Initial response summary'
        : null,
      analysisSource: finalAnalysis?.source ?? null,
      usesFallbackGrouping: finalAnalysis?.source === 'fallback',
      clusters: (finalAnalysis?.clusters ?? []).map((cluster) => {
        const bucket = cluster.understanding_bucket ?? 'unclear'
        return {
          clusterId: cluster.cluster_id,
          label: cluster.label,
          summary: cluster.summary,
          count: cluster.count,
          averageConfidence: roundToOneDecimal(cluster.average_confidence) ?? cluster.average_confidence,
          understandingBucket: bucket,
          understandingLabel: getUnderstandingLabel(bucket),
          learningNote: cluster.teacher_note?.trim() || null,
          representativeAnswers: (cluster.representative_answers ?? [])
            .map((answer) => answer.trim())
            .filter(Boolean),
        }
      }),
    } satisfies StudentQuestionSummary
  })

  return {
    sessionId,
    sessionCode: session.session_code,
    condition: session.condition,
    studentLabel: participation.anonymized_label,
    source: 'live_analysis',
    generatedAt: new Date().toISOString(),
    averageConfidence,
    questionsAnswered: questionSummaries.filter((question) => question.submitted.initial || question.submitted.revised).length,
    totalQuestions: sortedQuestions.length,
    questions: questionSummaries,
    revisionStats: null,
  }
}
