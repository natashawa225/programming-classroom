import { createHash } from 'crypto'
import { openaiChatJson } from '@/lib/ai/openai-json'
import { getConfidenceLevel } from '@/lib/confidence'
import { createAdminClient } from '@/lib/supabase/server'
import {
  getLatestCompletedAnalysisRunForStudent,
  getSession,
  getSessionQuestions,
  getSessionResponsesForStudentSummary,
  getStudentSessionSummaryRecord,
  upsertStudentSessionSummaryRecord,
} from '@/lib/supabase/queries'
import type { QuestionAnalysis, SessionRoundAnalysis, SessionAnalysisResponseLabel } from '@/lib/ai/experiment-analysis'
import type { AnalysisRun, Response, Session, SessionQuestion } from '@/lib/types/database'

type SummarySource = 'local' | 'mixed'

type ResponseStatus = 'correct' | 'incorrect' | 'partial' | 'unclear' | 'unknown'

type QuestionChangeKind =
  | 'improved'
  | 'regressed'
  | 'stayed_correct'
  | 'stayed_incorrect'
  | 'same'
  | 'revised'
  | 'submitted'
  | 'skipped'

type StudentQuestionSummary = {
  questionId: string
  position: number
  prompt: string
  yourAnswer: string | null
  yourFirstAnswer: string | null
  yourRevisedAnswer: string | null
  classroomPattern: string
  classroomPatternAfterRevision: string | null
  referenceAnswer: string | null
  explanation: string
  suggestion: string
  confidence: {
    initial: number | null
    revised: number | null
    direction: 'increased' | 'decreased' | 'same' | 'unknown'
  }
  status: {
    initial: ResponseStatus
    revised: ResponseStatus
  }
  submitted: {
    initial: boolean
    revised: boolean
  }
  whatChanged: string | null
  changeKind: QuestionChangeKind
}

type RevisionStats = {
  totalComparableQuestions: number
  improvedCount: number
  improvedPercent: number | null
  correctToIncorrectCount: number
  correctToIncorrectPercent: number | null
  incorrectToCorrectCount: number
  incorrectToCorrectPercent: number | null
  stayedCorrectCount: number
  stayedCorrectPercent: number | null
  stayedIncorrectCount: number
  stayedIncorrectPercent: number | null
  suggestion: string
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
  revisionStats: RevisionStats | null
}

type StoredStudentSessionSummaryPayload = Omit<StudentSessionSummaryPayload, 'source'>

type ResponseLabelLite = Pick<
  SessionAnalysisResponseLabel,
  'response_id' | 'question_id' | 'understanding_level' | 'evaluation_category' | 'is_correct' | 'misconception_label'
>

function roundToOneDecimal(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null
  return Math.round(value * 10) / 10
}

function toPercent(count: number, total: number) {
  if (total <= 0) return null
  return Math.round((count / total) * 100)
}

function sha256(input: string) {
  return createHash('sha256').update(input).digest('hex')
}

function parseStoredStudentSummary(value: Record<string, unknown> | null | undefined, source: SummarySource) {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw.questions)) return null
  if (typeof raw.sessionId !== 'string') return null
  if (typeof raw.sessionCode !== 'string') return null
  if (typeof raw.condition !== 'string') return null
  if (typeof raw.studentLabel !== 'string') return null

  return {
    sessionId: raw.sessionId,
    sessionCode: raw.sessionCode,
    condition: raw.condition as Session['condition'],
    studentLabel: raw.studentLabel,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date().toISOString(),
    averageConfidence: typeof raw.averageConfidence === 'number' ? raw.averageConfidence : null,
    questionsAnswered: typeof raw.questionsAnswered === 'number' ? raw.questionsAnswered : 0,
    totalQuestions: typeof raw.totalQuestions === 'number' ? raw.totalQuestions : 0,
    questions: raw.questions as StudentQuestionSummary[],
    revisionStats: (raw.revisionStats as RevisionStats | null | undefined) ?? null,
    source,
  } satisfies StudentSessionSummaryPayload
}

function toStoredStudentSummary(summary: StudentSessionSummaryPayload): StoredStudentSessionSummaryPayload {
  return {
    sessionId: summary.sessionId,
    sessionCode: summary.sessionCode,
    condition: summary.condition,
    studentLabel: summary.studentLabel,
    generatedAt: summary.generatedAt,
    averageConfidence: summary.averageConfidence,
    questionsAnswered: summary.questionsAnswered,
    totalQuestions: summary.totalQuestions,
    questions: summary.questions,
    revisionStats: summary.revisionStats,
  }
}

function normalizeText(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function stripClusterPrefix(label: string | null | undefined) {
  return String(label || '').replace(/^(True|False|Uncertain):\s*/i, '').trim()
}

function parseAnalysis(value: Record<string, unknown> | null | undefined) {
  if (!value || typeof value !== 'object') return null
  const raw = value as SessionRoundAnalysis
  if (!Array.isArray(raw.per_question)) return null
  return raw
}

function getStoredQuestionExplanationMap(value: Record<string, unknown> | null | undefined) {
  if (!value || typeof value !== 'object') return new Map<string, string>()
  const raw = value as Record<string, unknown>
  const items = Array.isArray(raw.student_question_explanations) ? raw.student_question_explanations : []

  return new Map(
    items
      .map((item) => {
        const record = item as Record<string, unknown>
        const questionId = typeof record.questionId === 'string' ? record.questionId : null
        const explanation = typeof record.explanation === 'string' ? record.explanation.trim() : null
        if (!questionId || !explanation) return null
        return [questionId, explanation] as const
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry))
  )
}

function getQuestionMap(analysis: SessionRoundAnalysis | null) {
  return new Map((analysis?.per_question || []).map((question) => [question.question_id, question]))
}

function getResponseLabelMap(analysis: SessionRoundAnalysis | null) {
  const labels = Array.isArray(analysis?.response_labels) ? analysis.response_labels : []
  return new Map(labels.map((label) => [label.response_id, label]))
}

function exactCorrectMatch(question: SessionQuestion, response: Response | null) {
  if (!response) return null
  const correctAnswer = normalizeText(question.correct_answer)
  if (!correctAnswer) return null
  return normalizeText(response.answer) === correctAnswer
}

function getResponseStatus(question: SessionQuestion, response: Response | null, label: ResponseLabelLite | undefined): ResponseStatus {
  if (!response) return 'unknown'
  if (label?.is_correct === true || response.is_correct === true) return 'correct'
  if (label?.is_correct === false || response.is_correct === false) return 'incorrect'

  const understanding = String(label?.understanding_level || '').trim().toLowerCase()
  const evaluation = String(label?.evaluation_category || '').trim().toLowerCase()

  if (understanding === 'correct') return 'correct'
  if (understanding === 'mostly_correct' || understanding === 'partially_correct') return 'partial'
  if (understanding === 'incorrect') return 'incorrect'
  if (evaluation === 'fully_correct') return 'correct'
  if (evaluation === 'partially_correct' || evaluation === 'relevant_incomplete') return 'partial'
  if (evaluation === 'misconception') return 'incorrect'
  if (evaluation === 'unclear' || understanding === 'unclear') return 'unclear'

  const exactMatch = exactCorrectMatch(question, response)
  return exactMatch === true ? 'correct' : 'unknown'
}

function getStatusScore(status: ResponseStatus) {
  if (status === 'correct') return 3
  if (status === 'partial') return 2
  if (status === 'incorrect') return 1
  if (status === 'unclear') return 0
  return -1
}

function getConfidenceDirection(initial: number | null, revised: number | null) {
  if (initial === null || revised === null) return 'unknown' as const
  if (revised > initial) return 'increased' as const
  if (revised < initial) return 'decreased' as const
  return 'same' as const
}

function buildClassroomPattern(
  questionAnalysis: QuestionAnalysis | null | undefined,
  fallbackResponses: Response[]
) {
  const responseCount = questionAnalysis?.submission_count ?? fallbackResponses.length
  const averageConfidence =
    questionAnalysis?.avg_confidence ??
    roundToOneDecimal(
      fallbackResponses.length > 0
        ? fallbackResponses.reduce((sum, response) => sum + Number(response.confidence || 0), 0) / fallbackResponses.length
        : null
    )
  const percentCorrect =
    typeof questionAnalysis?.percent_correct === 'number' && Number.isFinite(questionAnalysis.percent_correct)
      ? Math.round(questionAnalysis.percent_correct)
      : null
  const topMisconception = stripClusterPrefix(questionAnalysis?.top_misconceptions?.[0]?.label ?? null)

  if (responseCount <= 0) {
    return 'No class responses were available for this question.'
  }

  if (percentCorrect !== null && topMisconception) {
    return `${responseCount} classmates submitted. About ${percentCorrect}% reached the target reasoning, and a common misconception pattern was ${topMisconception}. Average confidence was ${averageConfidence?.toFixed(1) ?? '—'}/5.`
  }

  if (percentCorrect !== null) {
    return `${responseCount} classmates submitted. About ${percentCorrect}% reached the target reasoning. Average confidence was ${averageConfidence?.toFixed(1) ?? '—'}/5.`
  }

  if (topMisconception) {
    return `${responseCount} classmates submitted. A common misconception pattern was ${topMisconception}. Average confidence was ${averageConfidence?.toFixed(1) ?? '—'}/5.`
  }

  return `${responseCount} classmates submitted. Average confidence was ${averageConfidence?.toFixed(1) ?? '—'}/5.`
}

function buildLocalExplanation(question: SessionQuestion) {
  if (question.correct_answer && question.correct_answer.trim()) {
    return `The reference answer is ${question.correct_answer.trim()}. Compare your explanation to the key relationship the question is asking about.`
  }
  return 'Compare your explanation to the target reasoning and the main relationship the question is asking about.'
}

function buildChangeText(
  initialStatus: ResponseStatus,
  revisedStatus: ResponseStatus,
  confidenceDirection: ReturnType<typeof getConfidenceDirection>,
  submittedInitial: boolean,
  submittedRevised: boolean
) {
  if (!submittedInitial && !submittedRevised) return { kind: 'skipped' as const, text: 'No answer was submitted for this question.' }
  if (submittedInitial && !submittedRevised) return { kind: 'submitted' as const, text: 'Your first response is the only answer on record for this question.' }
  if (!submittedInitial && submittedRevised) return { kind: 'revised' as const, text: 'You added a response during the revision step.' }

  const initialScore = getStatusScore(initialStatus)
  const revisedScore = getStatusScore(revisedStatus)

  if (revisedStatus === 'correct' && initialStatus !== 'correct') {
    return {
      kind: 'improved' as const,
      text:
        confidenceDirection === 'increased'
          ? 'Your revision moved closer to the target reasoning, and your confidence increased.'
          : 'Your revision moved closer to the target reasoning.',
    }
  }

  if (initialStatus === 'correct' && revisedStatus !== 'correct' && revisedScore < initialScore) {
    return {
      kind: 'regressed' as const,
      text:
        confidenceDirection === 'decreased'
          ? 'Your revised answer became less aligned with the target reasoning, and your confidence also dropped.'
          : 'Your revised answer became less aligned with the target reasoning.',
    }
  }

  if (revisedScore > initialScore) {
    return {
      kind: 'improved' as const,
      text:
        confidenceDirection === 'increased'
          ? 'Your revision became more complete and more confident.'
          : 'Your revision became more complete.',
    }
  }

  if (revisedStatus === 'correct' && initialStatus === 'correct') {
    return { kind: 'stayed_correct' as const, text: 'Your answer stayed aligned with the target reasoning across both attempts.' }
  }

  if (revisedStatus === 'incorrect' && initialStatus === 'incorrect') {
    return { kind: 'stayed_incorrect' as const, text: 'Your main idea stayed similar across both attempts and still needs review.' }
  }

  if (revisedScore < initialScore) {
    return {
      kind: 'regressed' as const,
      text:
        confidenceDirection === 'decreased'
          ? 'Your revised answer became less precise, with lower confidence.'
          : 'Your revised answer became less precise than your first answer.',
    }
  }

  return { kind: 'same' as const, text: 'Your core idea stayed similar across both attempts.' }
}

function buildQuestionSuggestion(args: {
  changeKind: QuestionChangeKind
  latestStatus: ResponseStatus
  latestAnswer: string | null
  misconceptionLabel: string | null
  latestConfidence: number | null
}) {
  if (args.changeKind === 'improved') {
    return 'Your revision moved closer to the target reasoning. Keep naming the key relationship step by step.'
  }
  if (args.changeKind === 'stayed_incorrect' && args.misconceptionLabel) {
    return `Review this misconception pattern: ${stripClusterPrefix(args.misconceptionLabel)}. Try stating the rule in one clear sentence next time.`
  }
  if (args.changeKind === 'regressed') {
    return 'Compare your first and revised answers carefully, and keep the definition or rule in view while revising.'
  }
  if (args.latestStatus === 'correct' && args.latestConfidence !== null && getConfidenceLevel(args.latestConfidence) === 'low') {
    return 'Your answer matched the target idea; practise explaining why in one confident sentence.'
  }
  if (!args.latestAnswer || !args.latestAnswer.trim()) {
    return 'Try writing the key relationship explicitly next time, even if you are unsure at first.'
  }
  if (args.latestStatus === 'incorrect') {
    return 'Focus on the target reasoning and check whether each step follows the definition, not just the final terms.'
  }
  if (args.latestStatus === 'partial') {
    return 'You are close to the target reasoning; add the missing connection between the main ideas.'
  }
  return 'Keep using precise reasoning language so your explanation clearly shows how the answer follows.'
}

function buildRevisionStats(questions: StudentQuestionSummary[]): RevisionStats {
  const comparable = questions.filter((question) => question.submitted.initial && question.submitted.revised)
  const totalComparableQuestions = comparable.length
  let improvedCount = 0
  let correctToIncorrectCount = 0
  let incorrectToCorrectCount = 0
  let stayedCorrectCount = 0
  let stayedIncorrectCount = 0

  for (const question of comparable) {
    const initialScore = getStatusScore(question.status.initial)
    const revisedScore = getStatusScore(question.status.revised)

    if (question.status.initial !== 'correct' && question.status.revised === 'correct') incorrectToCorrectCount += 1
    if (question.status.initial === 'correct' && question.status.revised !== 'correct') correctToIncorrectCount += 1
    if (question.status.initial === 'correct' && question.status.revised === 'correct') stayedCorrectCount += 1
    if (question.status.initial === 'incorrect' && question.status.revised === 'incorrect') stayedIncorrectCount += 1
    if (revisedScore > initialScore) improvedCount += 1
  }

  const suggestion =
    incorrectToCorrectCount > 0
      ? 'Your revisions often moved closer to the target reasoning. Keep checking each definition against your final wording.'
      : correctToIncorrectCount > 0
        ? 'When revising, compare your new answer against your first idea so you do not drop a key piece of correct reasoning.'
        : stayedIncorrectCount > 0
          ? 'Use revision time to test one definition or rule directly against your answer before resubmitting.'
          : 'Your revision pattern was steady. Keep explaining the key relationship explicitly when you revise.'

  return {
    totalComparableQuestions,
    improvedCount,
    improvedPercent: toPercent(improvedCount, totalComparableQuestions),
    correctToIncorrectCount,
    correctToIncorrectPercent: toPercent(correctToIncorrectCount, totalComparableQuestions),
    incorrectToCorrectCount,
    incorrectToCorrectPercent: toPercent(incorrectToCorrectCount, totalComparableQuestions),
    stayedCorrectCount,
    stayedCorrectPercent: toPercent(stayedCorrectCount, totalComparableQuestions),
    stayedIncorrectCount,
    stayedIncorrectPercent: toPercent(stayedIncorrectCount, totalComparableQuestions),
    suggestion,
  }
}

async function generateAIExplanations(questions: StudentQuestionSummary[]): Promise<Map<string, string> | null> {
  const items = questions
    .filter((question) => question.referenceAnswer)
    .map((question) => ({
      questionId: question.questionId,
      prompt: question.prompt,
      referenceAnswer: question.referenceAnswer,
      studentAnswer: question.yourRevisedAnswer || question.yourFirstAnswer || question.yourAnswer,
      classroomPattern: question.classroomPatternAfterRevision || question.classroomPattern,
      whatChanged: question.whatChanged,
    }))

  if (items.length === 0) return null

  const result = await openaiChatJson({
    timeoutMs: 20000,
    maxTokens: 800,
    messages: [
      {
        role: 'system',
        content:
          `You write short, encouraging student-facing explanations for end-of-session review.

Return JSON only with:
- items: [{ questionId: string, explanation: string }]

Rules:
- One sentence per explanation
- Maximum 25 words each
- Explain why the reference answer is the target reasoning
- Be supportive, precise, and non-judgmental
- Do not mention scores, failure, or grades
`,
      },
      {
        role: 'user',
        content: JSON.stringify({ items }),
      },
    ],
  })

  if (!result.ok) return null
  const rawItems = Array.isArray(result.json?.items) ? result.json.items : []
  return new Map(
    rawItems
      .map((item: unknown) => {
        const record = item as Record<string, unknown>
        const questionId = typeof record.questionId === 'string' ? record.questionId : null
        const explanation = typeof record.explanation === 'string' ? record.explanation.trim() : null
        if (!questionId || !explanation) return null
        return [questionId, explanation] as const
      })
      .filter((entry: readonly [string, string] | null): entry is readonly [string, string] => Boolean(entry))
  )
}

async function getOrCreateSharedQuestionExplanations(args: {
  run: AnalysisRun | null
  questions: StudentQuestionSummary[]
}) {
  const existing = getStoredQuestionExplanationMap(args.run?.summary_json as Record<string, unknown> | null | undefined)
  const neededQuestions = args.questions.filter((question) => question.referenceAnswer && !existing.has(question.questionId))

  if (neededQuestions.length === 0) {
    return existing
  }

  const generated = await generateAIExplanations(neededQuestions).catch(() => null)
  if (!generated || generated.size === 0) {
    return existing
  }

  const merged = new Map(existing)
  for (const [questionId, explanation] of generated.entries()) {
    merged.set(questionId, explanation)
  }

  if (args.run?.analysis_run_id) {
    const adminSupabase = createAdminClient()
    const currentSummaryJson =
      args.run.summary_json && typeof args.run.summary_json === 'object'
        ? { ...(args.run.summary_json as Record<string, unknown>) }
        : {}

    currentSummaryJson.student_question_explanations = Array.from(merged.entries()).map(([questionId, explanation]) => ({
      questionId,
      explanation,
    }))

    const { error } = await adminSupabase
      .from('analysis_runs')
      .update({ summary_json: currentSummaryJson })
      .eq('analysis_run_id', args.run.analysis_run_id)

    if (error) {
      console.error('Failed to store shared student question explanations', error)
    }
  }

  return merged
}

export async function generateStudentSessionSummary(sessionId: string): Promise<StudentSessionSummaryPayload> {
  const [{ participation, responses }, session, questions, round1Run, round2Run, cached] = await Promise.all([
    getSessionResponsesForStudentSummary(sessionId),
    getSession(sessionId),
    getSessionQuestions(sessionId),
    getLatestCompletedAnalysisRunForStudent(sessionId, 1),
    getLatestCompletedAnalysisRunForStudent(sessionId, 2),
    getStudentSessionSummaryRecord(sessionId),
  ])

  if (session.status !== 'closed' && session.live_phase !== 'session_completed') {
    throw new Error('Student summary is only available after the session has ended.')
  }

  const round1Analysis = parseAnalysis(round1Run?.summary_json as Record<string, unknown> | null | undefined)
  const round2Analysis = parseAnalysis(round2Run?.summary_json as Record<string, unknown> | null | undefined)
  const sharedExplanationRun = round2Run ?? round1Run
  const round1QuestionMap = getQuestionMap(round1Analysis)
  const round2QuestionMap = getQuestionMap(round2Analysis)
  const round1LabelMap = getResponseLabelMap(round1Analysis)
  const round2LabelMap = getResponseLabelMap(round2Analysis)

  const allStudentResponses = responses.filter(
    (response) => response.session_participant_id === participation.session_participant_id
  )
  const averageConfidence =
    allStudentResponses.length > 0
      ? roundToOneDecimal(
          allStudentResponses.reduce((sum, response) => sum + Number(response.confidence || 0), 0) / allStudentResponses.length
        )
      : null

  const questionInputs = questions
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((question) => {
      const initialResponse =
        allStudentResponses.find((response) => response.question_id === question.question_id && response.attempt_type === 'initial') || null
      const revisedResponse =
        allStudentResponses.find((response) => response.question_id === question.question_id && response.attempt_type === 'revision') || null
      const initialLabel = initialResponse ? round1LabelMap.get(initialResponse.response_id) : undefined
      const revisedLabel = revisedResponse ? round2LabelMap.get(revisedResponse.response_id) : undefined
      const initialStatus = getResponseStatus(question, initialResponse, initialLabel)
      const revisedStatus = getResponseStatus(question, revisedResponse, revisedLabel)
      const confidenceDirection = getConfidenceDirection(initialResponse?.confidence ?? null, revisedResponse?.confidence ?? null)
      const change = buildChangeText(
        initialStatus,
        revisedStatus,
        confidenceDirection,
        Boolean(initialResponse),
        Boolean(revisedResponse)
      )
      const latestResponse = revisedResponse || initialResponse
      const latestLabel = revisedLabel || initialLabel
      const revisionQuestionAnalysis = round2QuestionMap.get(question.question_id)
      const initialQuestionAnalysis = round1QuestionMap.get(question.question_id)
      const initialClassResponses = responses.filter(
        (response) => response.question_id === question.question_id && response.attempt_type === 'initial'
      )
      const revisedClassResponses = responses.filter(
        (response) => response.question_id === question.question_id && response.attempt_type === 'revision'
      )

      return {
        questionId: question.question_id,
        position: question.position,
        prompt: question.prompt,
        yourAnswer: latestResponse?.answer ?? null,
        yourFirstAnswer: initialResponse?.answer ?? null,
        yourRevisedAnswer: revisedResponse?.answer ?? null,
        classroomPattern: buildClassroomPattern(initialQuestionAnalysis, initialClassResponses),
        classroomPatternAfterRevision: session.condition === 'treatment'
          ? buildClassroomPattern(revisionQuestionAnalysis, revisedClassResponses)
          : null,
        referenceAnswer: question.correct_answer?.trim() || null,
        explanation: buildLocalExplanation(question),
        suggestion: buildQuestionSuggestion({
          changeKind: change.kind,
          latestStatus: revisedResponse ? revisedStatus : initialStatus,
          latestAnswer: latestResponse?.answer ?? null,
          misconceptionLabel: latestLabel?.misconception_label ?? null,
          latestConfidence: latestResponse?.confidence ?? null,
        }),
        confidence: {
          initial: initialResponse?.confidence ?? null,
          revised: revisedResponse?.confidence ?? null,
          direction: confidenceDirection,
        },
        status: {
          initial: initialStatus,
          revised: revisedResponse ? revisedStatus : initialStatus,
        },
        submitted: {
          initial: Boolean(initialResponse),
          revised: Boolean(revisedResponse),
        },
        whatChanged: session.condition === 'treatment' ? change.text : null,
        changeKind: change.kind,
      } satisfies StudentQuestionSummary
    })

  let source: SummarySource = 'local'
  const aiExplanations = await getOrCreateSharedQuestionExplanations({
    run: sharedExplanationRun,
    questions: questionInputs,
  })
  if (aiExplanations && aiExplanations.size > 0) {
    source = 'mixed'
    for (const question of questionInputs) {
      const explanation = aiExplanations.get(question.questionId)
      if (explanation) question.explanation = explanation
    }
  }

  const inputHash = sha256(
    JSON.stringify({
      sessionId,
      condition: session.condition,
      student: participation.session_participant_id,
      round1SummaryVersion: round1Run?.created_at ?? null,
      round2SummaryVersion: round2Run?.created_at ?? null,
      sharedExplanationRunId: sharedExplanationRun?.analysis_run_id ?? null,
      questionInputs: questionInputs.map((question) => ({
        questionId: question.questionId,
        yourAnswer: question.yourAnswer,
        yourFirstAnswer: question.yourFirstAnswer,
        yourRevisedAnswer: question.yourRevisedAnswer,
        classroomPattern: question.classroomPattern,
        classroomPatternAfterRevision: question.classroomPatternAfterRevision,
        referenceAnswer: question.referenceAnswer,
        explanation: question.explanation,
        suggestion: question.suggestion,
        whatChanged: question.whatChanged,
        confidence: question.confidence,
        status: question.status,
      })),
    })
  )

  if (cached?.input_hash === inputHash) {
    const parsed = parseStoredStudentSummary(cached.summary_json, cached.source)
    if (parsed) return parsed
  }

  const summary: StudentSessionSummaryPayload = {
    sessionId,
    sessionCode: session.session_code,
    condition: session.condition,
    studentLabel: participation.anonymized_label,
    source,
    generatedAt: new Date().toISOString(),
    averageConfidence,
    questionsAnswered: questionInputs.filter((question) => question.submitted.initial || question.submitted.revised).length,
    totalQuestions: questions.length,
    questions: questionInputs,
    revisionStats: session.condition === 'treatment' ? buildRevisionStats(questionInputs) : null,
  }

  await upsertStudentSessionSummaryRecord({
    sessionId,
    inputHash,
    summaryJson: toStoredStudentSummary(summary) as Record<string, unknown>,
    source,
  })

  return summary
}
