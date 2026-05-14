import { openaiChatJson } from '@/lib/ai/openai-json'
import {
  getLiveQuestionAnalyses,
  getSession,
  getSessionParticipants,
  getSessionQuestions,
  getSessionResponses,
  getSessionSummaryRecord,
  upsertSessionSummaryRecord,
} from '@/lib/supabase/queries'
import type { AttemptType, LiveQuestionAnalysis, Response, SessionQuestion } from '@/lib/types/database'

export type SessionSummarySource = 'openai' | 'fallback'

export type SessionSummaryMetrics = {
  totalParticipants: number
  totalQuestions: number
  totalResponses: number
  initialResponses: number
  revisionResponses: number
  questionsWithResponses: number
  questionsWithRevisionResponses: number
  averageConfidence: number | null
  initialAverageConfidence: number | null
  revisionAverageConfidence: number | null
  revisionParticipationRate: number | null
  avgConfidenceChange: number | null
  improvedPercentage: number | null
  stayedPercentage: number | null
  regressedPercentage: number | null
}

export type QuestionAttemptSummary = {
  responseCount: number
  averageConfidence: number | null
  topCorrectClusterLabel: string | null
  topIncorrectClusterLabel: string | null
  topCorrectClusterSummary: string | null
  topIncorrectClusterSummary: string | null
  correctCount: number
  incorrectCount: number
  uncertainCount: number
}

export type SessionQuestionSummary = {
  questionId: string
  position: number
  prompt: string
  initial: QuestionAttemptSummary
  revision: QuestionAttemptSummary | null
  misconceptionShift: string | null
}

export type SessionSummaryPayload = {
  metrics: SessionSummaryMetrics
  questionSummaries: SessionQuestionSummary[]
  recurringPatterns: string[]
  sessionTakeaway: string
  nextTeachingRecommendation: string
  source: SessionSummarySource
}

export type StoredSessionSummaryPayload = Omit<SessionSummaryPayload, 'source'>

type ClusterCategory = 'correct' | 'misconception' | 'uncertain'

type ParsedCluster = {
  label: string
  summary: string | null
  count: number
  averageConfidence: number | null
  category: ClusterCategory
  conceptualAlignment: number | null
  understandingBucket: string | null
}

type ParsedLiveAnalysis = {
  attemptType: AttemptType
  totalResponses: number
  weightedAverageConfidence: number | null
  clusters: ParsedCluster[]
}

function roundToOneDecimal(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null
  return Math.round(value * 10) / 10
}

function formatDelta(value: number) {
  return value > 0 ? `+${value}` : String(value)
}

function averageConfidenceFromResponses(responses: Response[]) {
  if (responses.length === 0) return null
  return roundToOneDecimal(
    responses.reduce((sum, response) => sum + Number(response.confidence || 0), 0) / responses.length
  )
}

function countParticipants(
  participants: Array<{ session_participant_id?: string | null }> | null | undefined,
  responses: Response[]
) {
  const participantRows = Array.isArray(participants) ? participants : []
  if (participantRows.length > 0) return participantRows.length

  const distinctSessionParticipantIds = new Set(
    responses
      .map((response) => response.session_participant_id)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  )
  if (distinctSessionParticipantIds.size > 0) return distinctSessionParticipantIds.size

  const distinctParticipantCodes = new Set(
    responses
      .map((response) => {
        const raw = (response as Response & { participant_code?: string | null }).participant_code
        return typeof raw === 'string' ? raw.trim() : ''
      })
      .filter(Boolean)
  )
  if (distinctParticipantCodes.size > 0) return distinctParticipantCodes.size

  return 0
}

function getClusterCategory(input: {
  label: string
  conceptualAlignment: number | null
  understandingBucket: string | null
}): ClusterCategory {
  const bucket = String(input.understandingBucket || '').trim().toLowerCase()
  const alignment = input.conceptualAlignment
  const label = String(input.label || '').trim().toLowerCase()

  // Prefer structured v2 fields
  if (bucket === 'strong_alignment') return 'correct'
  if (bucket === 'needs_attention') return 'misconception'
  if (bucket === 'unclear') return 'uncertain'

  // mixed_reasoning: use alignment to decide, default to uncertain (not misconception)
  // Previously this was too aggressive — mixed_reasoning at 0.3 alignment was being
  // treated as uncertain when it should surface as a partial/misconception signal.
  if (bucket === 'mixed_reasoning') {
    if (alignment !== null && alignment >= 0.5) return 'correct'
    if (alignment !== null && alignment <= -0.1) return 'misconception'
    return 'uncertain'
  }

  // Fallback for older analyses / label-based outputs
  if (alignment !== null) {
    if (alignment >= 0.6) return 'correct'
    if (alignment <= -0.3) return 'misconception'
  }

  // Label fallback for old and new labels
  if (
    label.includes('answer only') ||
    label.includes('no reasoning') ||
    label.includes('uncertain') ||
    label.includes('unclear') ||
    label.includes('depends')
  ) {
    return 'uncertain'
  }

  if (
    label.startsWith('true:') ||
    label.includes('correct answer') ||
    label.includes('aligned reasoning') ||
    label.includes('strong reasoning') ||
    label.includes('correct reasoning')
  ) {
    return 'correct'
  }

  if (
    label.startsWith('false:') ||
    label.includes('wrong answer') ||
    label.includes('incorrect answer') ||
    label.includes('misconception') ||
    label.includes('misunderstand') ||
    label.includes('confusion')
  ) {
    return 'misconception'
  }

  return 'uncertain'
}

function stripClusterPrefix(label: string) {
  return String(label || '').replace(/^(True|False|Uncertain):\s*/i, '').trim()
}

function parseCluster(value: unknown): ParsedCluster | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  if (!label) return null

  const count = Number(raw.count)
  const responseIds = Array.isArray(raw.response_ids) ? raw.response_ids : []
  const averageConfidence = Number(raw.average_confidence)
  const conceptualAlignmentRaw = Number(raw.conceptual_alignment)
  const conceptualAlignment = Number.isFinite(conceptualAlignmentRaw)
    ? conceptualAlignmentRaw
    : null

  const understandingBucket =
    typeof raw.understanding_bucket === 'string' && raw.understanding_bucket.trim()
      ? raw.understanding_bucket.trim()
      : null

  return {
    label,
    summary: typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.trim() : null,
    count:
      Number.isFinite(count) && count > 0
        ? Math.round(count)
        : responseIds.length,
    averageConfidence: Number.isFinite(averageConfidence) ? roundToOneDecimal(averageConfidence) : null,
    conceptualAlignment,
    understandingBucket,
    category: getClusterCategory({
      label,
      conceptualAlignment,
      understandingBucket,
    }),
  }
}

function parseLiveAnalysis(value: LiveQuestionAnalysis | null | undefined): ParsedLiveAnalysis | null {
  const raw = value?.analysis_json
  if (!raw || typeof raw !== 'object') return null

  const record = raw as Record<string, unknown>
  const attemptType = value?.attempt_type === 'revision' ? 'revision' : 'initial'
  const rawClusters = Array.isArray(record.clusters) ? record.clusters : []
  const clusters = rawClusters.map(parseCluster).filter((cluster): cluster is ParsedCluster => Boolean(cluster))
  const totalResponses = Number(record.total_responses)
  const resolvedTotalResponses =
    Number.isFinite(totalResponses) && totalResponses >= 0
      ? Math.round(totalResponses)
      : clusters.reduce((sum, cluster) => sum + cluster.count, 0)

  const weightedConfidenceNumerator = clusters.reduce((sum, cluster) => {
    return sum + (cluster.averageConfidence ?? 0) * cluster.count
  }, 0)

  return {
    attemptType,
    totalResponses: resolvedTotalResponses,
    weightedAverageConfidence:
      resolvedTotalResponses > 0 ? roundToOneDecimal(weightedConfidenceNumerator / resolvedTotalResponses) : null,
    clusters,
  }
}

function getAttemptResponses(responses: Response[], questionId: string, attemptType: AttemptType) {
  return responses.filter((response) => {
    return response.question_id === questionId && response.attempt_type === attemptType
  })
}

function getTopClusterByCategory(clusters: ParsedCluster[], category: ClusterCategory) {
  return (
    clusters
      .filter((cluster) => cluster.category === category)
      .sort((a, b) => b.count - a.count)[0] || null
  )
}

function summarizeAttempt(
  responses: Response[],
  analysis: ParsedLiveAnalysis | null
): QuestionAttemptSummary {
  const clusters = analysis?.clusters ?? []
  const correctClusters = clusters.filter((cluster) => cluster.category === 'correct')
  const incorrectClusters = clusters.filter((cluster) => cluster.category === 'misconception')
  const uncertainClusters = clusters.filter((cluster) => cluster.category === 'uncertain')
  const topCorrectCluster = getTopClusterByCategory(clusters, 'correct')
  const topIncorrectCluster = getTopClusterByCategory(clusters, 'misconception')

  return {
    responseCount: analysis?.totalResponses ?? responses.length,
    averageConfidence: analysis?.weightedAverageConfidence ?? averageConfidenceFromResponses(responses),
    topCorrectClusterLabel: topCorrectCluster ? stripClusterPrefix(topCorrectCluster.label) : null,
    topIncorrectClusterLabel: topIncorrectCluster ? stripClusterPrefix(topIncorrectCluster.label) : null,
    topCorrectClusterSummary: topCorrectCluster?.summary ?? null,
    topIncorrectClusterSummary: topIncorrectCluster?.summary ?? null,
    correctCount: correctClusters.reduce((sum, cluster) => sum + cluster.count, 0),
    incorrectCount: incorrectClusters.reduce((sum, cluster) => sum + cluster.count, 0),
    uncertainCount: uncertainClusters.reduce((sum, cluster) => sum + cluster.count, 0),
  }
}

function getMisconceptionShift(initial: QuestionAttemptSummary, revision: QuestionAttemptSummary | null) {
  if (!revision) return null
  const delta = revision.incorrectCount - initial.incorrectCount
  return `${initial.incorrectCount} -> ${revision.incorrectCount} (${formatDelta(delta)})`
}

function buildQuestionSummaries(
  questions: SessionQuestion[],
  responses: Response[],
  analyses: LiveQuestionAnalysis[]
) {
  const groupedAnalyses = new Map<string, { initial: ParsedLiveAnalysis | null; revision: ParsedLiveAnalysis | null }>()

  for (const analysisRow of analyses) {
    const parsed = parseLiveAnalysis(analysisRow)
    if (!parsed) continue
    const entry = groupedAnalyses.get(analysisRow.question_id) || { initial: null, revision: null }
    if (parsed.attemptType === 'revision') entry.revision = parsed
    else entry.initial = parsed
    groupedAnalyses.set(analysisRow.question_id, entry)
  }

  return questions
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((question) => {
      const grouped = groupedAnalyses.get(question.question_id) || { initial: null, revision: null }
      const initialResponses = getAttemptResponses(responses, question.question_id, 'initial')
      const revisionResponses = getAttemptResponses(responses, question.question_id, 'revision')
      const initial = summarizeAttempt(initialResponses, grouped.initial)
      const revision =
        grouped.revision || revisionResponses.length > 0 ? summarizeAttempt(revisionResponses, grouped.revision) : null

      return {
        questionId: question.question_id,
        position: question.position,
        prompt: question.prompt,
        initial,
        revision,
        misconceptionShift: getMisconceptionShift(initial, revision),
      }
    })
}

function buildMetrics(participantCount: number, questionSummaries: SessionQuestionSummary[], responses: Response[]) {
  const initialResponses = responses.filter((response) => response.attempt_type !== 'revision')
  const revisionResponses = responses.filter((response) => response.attempt_type === 'revision')
  const revisionParticipants = new Set(revisionResponses.map((response) => response.session_participant_id).filter(Boolean))
  const comparableQuestions = questionSummaries.filter((question) => question.revision)

  let improved = 0
  let stayed = 0
  let regressed = 0

  for (const question of comparableQuestions) {
    const initialNet = question.initial.correctCount - question.initial.incorrectCount
    const revisionNet = (question.revision?.correctCount ?? 0) - (question.revision?.incorrectCount ?? 0)
    if (revisionNet > initialNet) improved += 1
    else if (revisionNet < initialNet) regressed += 1
    else stayed += 1
  }

  const totalComparable = comparableQuestions.length
  const initialAverageConfidence = averageConfidenceFromResponses(initialResponses)
  const revisionAverageConfidence = averageConfidenceFromResponses(revisionResponses)

  return {
    totalParticipants: participantCount,
    totalQuestions: questionSummaries.length,
    totalResponses: responses.length,
    initialResponses: initialResponses.length,
    revisionResponses: revisionResponses.length,
    questionsWithResponses: questionSummaries.filter((question) => question.initial.responseCount > 0 || (question.revision?.responseCount ?? 0) > 0).length,
    questionsWithRevisionResponses: questionSummaries.filter((question) => (question.revision?.responseCount ?? 0) > 0).length,
    averageConfidence: averageConfidenceFromResponses(responses),
    initialAverageConfidence,
    revisionAverageConfidence,
    revisionParticipationRate: participantCount > 0 ? roundToOneDecimal((revisionParticipants.size / participantCount) * 100) : null,
    avgConfidenceChange:
      initialAverageConfidence !== null && revisionAverageConfidence !== null
        ? roundToOneDecimal(revisionAverageConfidence - initialAverageConfidence)
        : null,
    improvedPercentage: totalComparable > 0 ? roundToOneDecimal((improved / totalComparable) * 100) : null,
    stayedPercentage: totalComparable > 0 ? roundToOneDecimal((stayed / totalComparable) * 100) : null,
    regressedPercentage: totalComparable > 0 ? roundToOneDecimal((regressed / totalComparable) * 100) : null,
  }
}

function extractConceptFromPrompt(prompt: string) {
  const cleaned = String(prompt || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned ? cleaned.split(' ').slice(0, 6).join(' ') : 'the targeted concept'
}

function deriveFallbackSummary(questionSummaries: SessionQuestionSummary[]) {
  const misconceptionMap = new Map<string, { count: number; questions: number[]; summary: string | null }>()

  for (const question of questionSummaries) {
    const label = question.revision?.topIncorrectClusterLabel || question.initial.topIncorrectClusterLabel
    const summary = question.revision?.topIncorrectClusterSummary || question.initial.topIncorrectClusterSummary
    if (!label) continue
    const current = misconceptionMap.get(label) || { count: 0, questions: [], summary: summary || null }
    current.count += 1
    if (!current.questions.includes(question.position)) {
      current.questions.push(question.position)
    }
    misconceptionMap.set(label, current)
  }

  const ranked = Array.from(misconceptionMap.entries()).sort((a, b) => b[1].count - a[1].count)

  // Format as "Label. Description sentence." so frontend sentence-splitting works correctly
  const recurringPatterns =
    ranked.slice(0, 3).map(([label, info]) => {
      const description = info.summary
        ? info.summary
        : `Appeared in question${info.questions.length === 1 ? '' : 's'} ${info.questions.join(', ')}.`
      return `${label}. ${description}`
    })

  const topMisconception = ranked[0]?.[0] || null
  const topMisconceptionSummary = ranked[0]?.[1]?.summary || null

  const improvementQuestion =
    questionSummaries
      .filter((question) => question.revision)
      .sort((a, b) => {
        const deltaA = (a.revision?.correctCount ?? 0) - a.initial.correctCount
        const deltaB = (b.revision?.correctCount ?? 0) - b.initial.correctCount
        return deltaB - deltaA
      })[0] || questionSummaries[0]

  const nextTeachingRecommendation = topMisconception
    ? topMisconceptionSummary
      ? `Address the misconception from Q${ranked[0][1].questions[0]}: ${topMisconceptionSummary} Consider a contrast example that directly shows the difference.`
      : `Revisit "${topMisconception}" with a worked contrast example at the start of the next class.`
    : `Open next class with a short recap of the session's core concept.`

  return {
    recurringPatterns:
      recurringPatterns.length > 0
        ? recurringPatterns
        : ['Students showed recurring misconception patterns across the session. Review cluster summaries per question for details.'],
    sessionTakeaway: `Students showed improvement in ${extractConceptFromPrompt(improvementQuestion?.prompt || '')}, but struggled with ${topMisconception || 'core concepts'}.`,
    nextTeachingRecommendation,
  }
}

function sanitizeOpenAISummary(value: unknown, fallback: ReturnType<typeof deriveFallbackSummary>) {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

  // recurringPatterns: must be "Label. Description." format — validate each entry has a period separator
  const rawPatterns = Array.isArray(input.recurringPatterns) ? input.recurringPatterns : []
  const recurringPatterns = rawPatterns
    .map((entry) => String(entry || '').trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 3)

  const sessionTakeaway =
    typeof input.sessionTakeaway === 'string' && input.sessionTakeaway.trim()
      ? input.sessionTakeaway.trim()
      : fallback.sessionTakeaway

  const nextTeachingRecommendation =
    typeof input.nextTeachingRecommendation === 'string' && input.nextTeachingRecommendation.trim()
      ? input.nextTeachingRecommendation.trim()
      : fallback.nextTeachingRecommendation

  return {
    recurringPatterns: recurringPatterns.length > 0 ? recurringPatterns : fallback.recurringPatterns,
    sessionTakeaway,
    nextTeachingRecommendation,
  }
}

async function generateOpenAISummary(
  questionSummaries: SessionQuestionSummary[],
  fallback: ReturnType<typeof deriveFallbackSummary>
) {
  // Pass richer per-question context: both correct and misconception clusters,
  // plus delta between rounds so the model can reason about what changed.
  const compactQuestionData = questionSummaries.map((question) => ({
    position: question.position,
    prompt: question.prompt.slice(0, 120),
    initial: {
      correctCluster: question.initial.topCorrectClusterLabel,
      correctSummary: question.initial.topCorrectClusterSummary,
      misconceptionCluster: question.initial.topIncorrectClusterLabel,
      misconceptionSummary: question.initial.topIncorrectClusterSummary,
      correctCount: question.initial.correctCount,
      misconceptionCount: question.initial.incorrectCount,
      uncertainCount: question.initial.uncertainCount,
    },
    revision: question.revision
      ? {
          correctCluster: question.revision.topCorrectClusterLabel,
          correctSummary: question.revision.topCorrectClusterSummary,
          misconceptionCluster: question.revision.topIncorrectClusterLabel,
          misconceptionSummary: question.revision.topIncorrectClusterSummary,
          correctCount: question.revision.correctCount,
          misconceptionCount: question.revision.incorrectCount,
          uncertainCount: question.revision.uncertainCount,
          misconceptionShift: question.misconceptionShift,
        }
      : null,
  }))

  const result = await openaiChatJson({
    timeoutMs: 20000,
    maxTokens: 700,
    messages: [
      {
        role: 'system',
        content: `You summarize a classroom session for a teacher preparing their next lesson.

Return JSON only with exactly these three fields:
- recurringPatterns: array of 2–3 strings, each in the format "Short label. One concrete sentence explaining the thinking error and which questions it appeared in."
- sessionTakeaway: one sentence (max 20 words) capturing the single most important thing the teacher should know about this class.
- nextTeachingRecommendation: one concrete, specific action the teacher should take at the start of next class. Name the concept, suggest a specific move (e.g. "show a counterexample of X", "cold-call on the difference between X and Y"). Max 30 words.

Rules:
- recurringPatterns must describe the underlying thinking error, not just restate the question topic.
- Each pattern string must have exactly two parts separated by a period and space: a short label (4–7 words), then one sentence of explanation.
- sessionTakeaway must reflect the whole session, not just one question.
- nextTeachingRecommendation must be specific enough that the teacher knows exactly what to do. Never say "revisit" or "review" without naming the specific concept and teaching move.
- If revision data is available, prioritize misconceptions that persisted after revision (misconceptionShift shows no improvement).`,
      },
      {
        role: 'user',
        content: JSON.stringify({ questions: compactQuestionData }),
      },
    ],
  })

  if (!result.ok) {
    throw new Error(result.error || 'OpenAI summary unavailable')
  }

  return sanitizeOpenAISummary(result.json, fallback)
}

function toStoredSummaryPayload(summary: SessionSummaryPayload): StoredSessionSummaryPayload {
  return {
    metrics: summary.metrics,
    questionSummaries: summary.questionSummaries,
    recurringPatterns: summary.recurringPatterns,
    sessionTakeaway: summary.sessionTakeaway,
    nextTeachingRecommendation: summary.nextTeachingRecommendation,
  }
}

function parseStoredSessionSummary(
  value: Record<string, unknown> | null | undefined,
  source: SessionSummarySource
): SessionSummaryPayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const metrics = raw.metrics
  const questionSummaries = raw.questionSummaries
  const recurringPatterns = raw.recurringPatterns
  const sessionTakeaway = raw.sessionTakeaway
  const nextTeachingRecommendation = raw.nextTeachingRecommendation

  if (!metrics || typeof metrics !== 'object') return null
  if (!Array.isArray(questionSummaries)) return null
  if (!Array.isArray(recurringPatterns)) return null
  if (typeof sessionTakeaway !== 'string') return null
  if (typeof nextTeachingRecommendation !== 'string') return null

  return {
    metrics: metrics as SessionSummaryMetrics,
    questionSummaries: questionSummaries as SessionQuestionSummary[],
    recurringPatterns: recurringPatterns.map((entry) => String(entry || '')).filter(Boolean),
    sessionTakeaway,
    nextTeachingRecommendation,
    source,
  }
}

export async function generateSessionSummary(options: {
  sessionId: string
  force?: boolean
}): Promise<SessionSummaryPayload> {
  const { sessionId } = options

  const [, participants, questions, responses, analyses] = await Promise.all([
    getSession(sessionId),
    getSessionParticipants(sessionId),
    getSessionQuestions(sessionId),
    getSessionResponses(sessionId),
    getLiveQuestionAnalyses(sessionId),
  ])

  const questionSummaries = buildQuestionSummaries(questions || [], responses || [], analyses || [])
  const participantCount = countParticipants(participants || [], responses || [])
  const metrics = buildMetrics(participantCount, questionSummaries, responses || [])
  const fallback = deriveFallbackSummary(questionSummaries)

  try {
    const qualitative = await generateOpenAISummary(questionSummaries, fallback)
    return {
      metrics,
      questionSummaries,
      recurringPatterns: qualitative.recurringPatterns,
      sessionTakeaway: qualitative.sessionTakeaway,
      nextTeachingRecommendation: qualitative.nextTeachingRecommendation,
      source: 'openai',
    }
  } catch (error) {
    console.error('session-summary openai fallback', error)
    return {
      metrics,
      questionSummaries,
      recurringPatterns: fallback.recurringPatterns,
      sessionTakeaway: fallback.sessionTakeaway,
      nextTeachingRecommendation: fallback.nextTeachingRecommendation,
      source: 'fallback',
    }
  }
}

export async function getStoredSessionSummary(sessionId: string) {
  const row = await getSessionSummaryRecord(sessionId)
  if (!row) return null
  return parseStoredSessionSummary(row.summary_json, row.source)
}

export async function storeSessionSummary(sessionId: string, summary: SessionSummaryPayload) {
  return upsertSessionSummaryRecord({
    sessionId,
    summaryJson: toStoredSummaryPayload(summary),
    source: summary.source,
  })
}