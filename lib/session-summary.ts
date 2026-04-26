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

function getClusterCategory(label: string): ClusterCategory {
  const normalized = String(label || '').trim().toLowerCase()
  if (normalized.startsWith('true:')) return 'correct'
  if (normalized.startsWith('false:')) return 'misconception'
  if (normalized.includes('uncertain') || normalized.includes('depends')) return 'uncertain'
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
  const averageConfidence = Number(raw.average_confidence)

  return {
    label,
    summary: typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.trim() : null,
    count: Number.isFinite(count) && count > 0 ? Math.round(count) : 0,
    averageConfidence: Number.isFinite(averageConfidence) ? roundToOneDecimal(averageConfidence) : null,
    category: getClusterCategory(label),
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
  const misconceptionMap = new Map<string, { count: number; questions: number[] }>()

  for (const question of questionSummaries) {
    const label = question.revision?.topIncorrectClusterLabel || question.initial.topIncorrectClusterLabel
    if (!label) continue
    const current = misconceptionMap.get(label) || { count: 0, questions: [] }
    current.count += 1
    if (!current.questions.includes(question.position)) {
      current.questions.push(question.position)
    }
    misconceptionMap.set(label, current)
  }

  const ranked = Array.from(misconceptionMap.entries()).sort((a, b) => b[1].count - a[1].count)
  const recurringPatterns =
    ranked.slice(0, 3).map(([label, info]) => {
      return `${label} appeared in question${info.questions.length === 1 ? '' : 's'} ${info.questions.join(', ')}.`
    }) || []

  const topMisconception = ranked[0]?.[0] || 'the main misconception'
  const improvementQuestion =
    questionSummaries
      .filter((question) => question.revision)
      .sort((a, b) => {
        const deltaA = (a.revision?.correctCount ?? 0) - a.initial.correctCount
        const deltaB = (b.revision?.correctCount ?? 0) - b.initial.correctCount
        return deltaB - deltaA
      })[0] || questionSummaries[0]

  return {
    recurringPatterns:
      recurringPatterns.length > 0
        ? recurringPatterns
        : ['Student answers showed a small set of recurring misconception patterns across the session.'],
    sessionTakeaway: `Students showed improvement in ${extractConceptFromPrompt(improvementQuestion?.prompt || '')}, but struggled with ${topMisconception}.`,
    nextTeachingRecommendation: `Revisit ${topMisconception} with a contrast example.`,
  }
}

function sanitizeOpenAISummary(value: unknown, fallback: ReturnType<typeof deriveFallbackSummary>) {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const recurringPatterns = Array.isArray(input.recurringPatterns)
    ? input.recurringPatterns.map((entry) => String(entry || '').trim()).filter(Boolean).slice(0, 3)
    : []
  const sessionTakeaway =
    typeof input.sessionTakeaway === 'string' && input.sessionTakeaway.trim()
      ? input.sessionTakeaway.trim()
      : fallback.sessionTakeaway

  return {
    recurringPatterns: recurringPatterns.length > 0 ? recurringPatterns : fallback.recurringPatterns,
    sessionTakeaway,
    nextTeachingRecommendation: fallback.nextTeachingRecommendation,
  }
}

async function generateOpenAISummary(questionSummaries: SessionQuestionSummary[], fallback: ReturnType<typeof deriveFallbackSummary>) {
  const compactQuestionData = questionSummaries.map((question) => ({
    position: question.position,
    topMisconception: question.revision?.topIncorrectClusterLabel || question.initial.topIncorrectClusterLabel,
    misconceptionSummary: question.revision?.topIncorrectClusterSummary || question.initial.topIncorrectClusterSummary,
  }))

  const result = await openaiChatJson({
    timeoutMs: 18000,
    maxTokens: 500,
    messages: [
      {
        role: 'system',
        content:
          `You summarize a classroom session for a teacher.

Return JSON only with:
- recurringPatterns: 2–3 short conceptual misconceptions shared across questions
- sessionTakeaway: one short sentence capturing the core misunderstanding

Rules:
- Focus on underlying thinking errors, not question-specific wording
- Use abstract, reusable labels (e.g., "direct-only thinking", "local vs global confusion")
- Do NOT repeat question text
- Do NOT describe individual questions
- Do NOT restate student answers
- Keep each pattern under 10 words
- Keep the takeaway under 15 words
- Prioritize patterns that affect multiple questions
`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          questions: compactQuestionData,
          fallbackReference: {
            recurringPatterns: fallback.recurringPatterns,
            sessionTakeaway: fallback.sessionTakeaway,
          },
        }),
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
