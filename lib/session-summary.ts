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
  confidenceIncreasedPercentage: number | null
  confidenceStayedPercentage: number | null
  confidenceDecreasedPercentage: number | null
}

/** One student's response as evidence for a pattern — every response in the
 * cluster, not just a truncated sample. */
export type PatternResponseEvidence = {
  responseId: string
  answer: string
  confidence: number
  participantLabel: string | null
}

/**
 * A single neutral response-pattern cluster as produced by the live question
 * clustering pipeline (lib/ai/live-question-clustering.ts). This is descriptive
 * only — it carries no correctness/misconception judgment. `rank` is assigned
 * by prevalence (1 = most common) purely for display as "Pattern N", matching
 * the same convention used by the live cluster view (lib/live-cluster-rendering.ts).
 * `responses` holds every response belonging to this cluster (resolved from
 * `responseIds` against the session's full response list), not just the top
 * few the clustering model picked as representative — the UI is responsible
 * for scrolling/paginating, not for silently dropping entries.
 */
export type ResponsePattern = {
  clusterId: string
  rank: number
  label: string
  summary: string | null
  count: number
  percentage: number | null
  averageConfidence: number | null
  responseIds: string[]
  responses: PatternResponseEvidence[]
}

export type QuestionAttemptSummary = {
  responseCount: number
  averageConfidence: number | null
  patterns: ResponsePattern[]
  source: SessionSummarySource | null
  fallbackReason: string | null
}

export type SessionQuestionSummary = {
  questionId: string
  position: number
  prompt: string
  initial: QuestionAttemptSummary
  revision: QuestionAttemptSummary | null
}

export type SessionSummaryPayload = {
  metrics: SessionSummaryMetrics
  questionSummaries: SessionQuestionSummary[]
  recurringPatterns: string[]
  sessionTakeaway: string
  nextTeachingRecommendation: string
  source: SessionSummarySource
}

// Bump whenever ResponsePattern (or anything nested under questionSummaries)
// gains/loses a field — a stored summary from an older version is silently
// missing that field at runtime despite matching the TS type, and the guard
// below only catches a version mismatch, not partial drift within a version.
const SESSION_SUMMARY_SCHEMA_VERSION = 3

export type StoredSessionSummaryPayload = {
  schemaVersion: typeof SESSION_SUMMARY_SCHEMA_VERSION
  metrics: SessionSummaryMetrics
  questionSummaries: SessionQuestionSummary[]
  recurringPatterns: string[]
  sessionTakeaway: string
  nextTeachingRecommendation: string
}

/** Pattern shape available before response evidence is resolved — everything
 * except `responses`, which requires the attempt's full response list. */
type ParsedPattern = Omit<ResponsePattern, 'responses'>

type ParsedLiveAnalysis = {
  attemptType: AttemptType
  totalResponses: number
  weightedAverageConfidence: number | null
  source: SessionSummarySource | null
  fallbackReason: string | null
  patterns: ParsedPattern[]
}

function roundToOneDecimal(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null
  return Math.round(value * 10) / 10
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

/**
 * Cosmetic cleanup only — strips legacy "True:"/"False:"/"Uncertain:" prefixes
 * that may linger on older stored clusters. This is not a correctness
 * categorization: it never changes ordering, grouping, or which data survives.
 */
function stripLegacyClusterPrefix(label: string) {
  return String(label || '').replace(/^(True|False|Uncertain):\s*/i, '').trim()
}

type RawParsedCluster = {
  clusterId: string
  label: string
  summary: string | null
  count: number
  averageConfidence: number | null
  responseIds: string[]
}

function parseRawCluster(value: unknown, index: number): RawParsedCluster | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  if (!label) return null

  const responseIds = Array.isArray(raw.response_ids)
    ? raw.response_ids.map((id) => String(id || '')).filter(Boolean)
    : []
  const count = Number(raw.count)
  const averageConfidence = Number(raw.average_confidence)

  return {
    clusterId:
      typeof raw.cluster_id === 'string' && raw.cluster_id.trim() ? raw.cluster_id.trim() : `cluster_${index + 1}`,
    label: stripLegacyClusterPrefix(label) || `Pattern ${index + 1}`,
    summary: typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.trim() : null,
    count: Number.isFinite(count) && count > 0 ? Math.round(count) : responseIds.length,
    averageConfidence: Number.isFinite(averageConfidence) ? roundToOneDecimal(averageConfidence) : null,
    responseIds,
  }
}

/**
 * Parses a live_question_analyses row into the neutral response-pattern shape
 * the teacher summary renders. Every cluster the clustering pipeline produced
 * is preserved (no correctness filtering) and ranked by prevalence only.
 */
function parseLiveAnalysis(value: LiveQuestionAnalysis | null | undefined): ParsedLiveAnalysis | null {
  const raw = value?.analysis_json
  if (!raw || typeof raw !== 'object') return null

  const record = raw as Record<string, unknown>
  const attemptType = value?.attempt_type === 'revision' ? 'revision' : 'initial'
  const rawClusters = Array.isArray(record.clusters) ? record.clusters : []
  const parsedClusters = rawClusters
    .map((cluster, index) => parseRawCluster(cluster, index))
    .filter((cluster): cluster is RawParsedCluster => Boolean(cluster))

  const totalResponsesRaw = Number(record.total_responses)
  const resolvedTotalResponses =
    Number.isFinite(totalResponsesRaw) && totalResponsesRaw >= 0
      ? Math.round(totalResponsesRaw)
      : parsedClusters.reduce((sum, cluster) => sum + cluster.count, 0)

  const sortedClusters = parsedClusters.slice().sort((a, b) => b.count - a.count)
  const patterns: ParsedPattern[] = sortedClusters.map((cluster, index) => ({
    clusterId: cluster.clusterId,
    rank: index + 1,
    label: cluster.label,
    summary: cluster.summary,
    count: cluster.count,
    percentage:
      resolvedTotalResponses > 0 ? roundToOneDecimal((cluster.count / resolvedTotalResponses) * 100) : null,
    averageConfidence: cluster.averageConfidence,
    responseIds: cluster.responseIds,
  }))

  const weightedConfidenceNumerator = patterns.reduce((sum, pattern) => {
    return sum + (pattern.averageConfidence ?? 0) * pattern.count
  }, 0)

  const source: SessionSummarySource | null =
    record.source === 'fallback' ? 'fallback' : record.source === 'openai' ? 'openai' : null
  const fallbackReason =
    typeof record.fallback_reason === 'string' && record.fallback_reason.trim()
      ? record.fallback_reason.trim()
      : null

  return {
    attemptType,
    totalResponses: resolvedTotalResponses,
    weightedAverageConfidence:
      resolvedTotalResponses > 0 ? roundToOneDecimal(weightedConfidenceNumerator / resolvedTotalResponses) : null,
    source,
    fallbackReason,
    patterns,
  }
}

function getAttemptResponses(responses: Response[], questionId: string, attemptType: AttemptType) {
  return responses.filter((response) => {
    return response.question_id === questionId && response.attempt_type === attemptType
  })
}

/** Resolves a pattern's response_ids into full response evidence (answer,
 * confidence, participant label) — every one of them, not a truncated sample. */
function buildPatternEvidence(responseIds: string[], responseMap: Map<string, Response>): PatternResponseEvidence[] {
  return responseIds
    .map((id) => responseMap.get(id))
    .filter((response): response is Response => Boolean(response))
    .map((response) => ({
      responseId: response.response_id,
      answer: response.answer,
      confidence: Number(response.confidence) || 0,
      participantLabel: response.session_participants?.anonymized_label ?? null,
    }))
}

function summarizeAttempt(responses: Response[], analysis: ParsedLiveAnalysis | null): QuestionAttemptSummary {
  const responseMap = new Map(responses.map((response) => [response.response_id, response]))
  const patterns: ResponsePattern[] = (analysis?.patterns ?? []).map((pattern) => ({
    ...pattern,
    responses: buildPatternEvidence(pattern.responseIds, responseMap),
  }))

  return {
    responseCount: analysis?.totalResponses ?? responses.length,
    averageConfidence: analysis?.weightedAverageConfidence ?? averageConfidenceFromResponses(responses),
    patterns,
    source: analysis?.source ?? null,
    fallbackReason: analysis?.fallbackReason ?? null,
  }
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
      }
    })
}

/**
 * Neutral confidence-shift classification between initial and revision
 * attempts. This is purely about self-reported confidence movement — it makes
 * no claim about whether a student's answer became more or less correct.
 */
function classifyConfidenceShift(initial: QuestionAttemptSummary, revision: QuestionAttemptSummary) {
  if (initial.averageConfidence === null || revision.averageConfidence === null) return null
  const delta = revision.averageConfidence - initial.averageConfidence
  if (delta > 0) return 'increased'
  if (delta < 0) return 'decreased'
  return 'stayed'
}

function buildMetrics(participantCount: number, questionSummaries: SessionQuestionSummary[], responses: Response[]) {
  const initialResponses = responses.filter((response) => response.attempt_type !== 'revision')
  const revisionResponses = responses.filter((response) => response.attempt_type === 'revision')
  const revisionParticipants = new Set(revisionResponses.map((response) => response.session_participant_id).filter(Boolean))
  const comparableQuestions = questionSummaries.filter((question) => question.revision)

  let increased = 0
  let stayed = 0
  let decreased = 0
  let confidenceComparableCount = 0

  for (const question of comparableQuestions) {
    const shift = classifyConfidenceShift(question.initial, question.revision!)
    if (shift === null) continue
    confidenceComparableCount += 1
    if (shift === 'increased') increased += 1
    else if (shift === 'decreased') decreased += 1
    else stayed += 1
  }

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
    confidenceIncreasedPercentage:
      confidenceComparableCount > 0 ? roundToOneDecimal((increased / confidenceComparableCount) * 100) : null,
    confidenceStayedPercentage:
      confidenceComparableCount > 0 ? roundToOneDecimal((stayed / confidenceComparableCount) * 100) : null,
    confidenceDecreasedPercentage:
      confidenceComparableCount > 0 ? roundToOneDecimal((decreased / confidenceComparableCount) * 100) : null,
  }
}

/**
 * Deterministic, non-LLM fallback narrative. Purely descriptive: it reports
 * which response patterns were most prevalent, never which ones are right,
 * wrong, or a misconception.
 */
function deriveFallbackSummary(questionSummaries: SessionQuestionSummary[]) {
  const topPatternsByQuestion = questionSummaries
    .map((question) => {
      const attempt = question.revision ?? question.initial
      const top = attempt.patterns[0]
      if (!top) return null
      return { position: question.position, pattern: top }
    })
    .filter((entry): entry is { position: number; pattern: ResponsePattern } => Boolean(entry))
    .sort((a, b) => b.pattern.count - a.pattern.count)

  const recurringPatterns = topPatternsByQuestion.slice(0, 3).map(({ position, pattern }) => {
    const prevalence = pattern.percentage !== null ? `${pattern.percentage}% of Q${position}` : `Q${position}`
    const description = pattern.summary
      ? pattern.summary
      : `This was the most common response pattern (${prevalence}).`
    return `${pattern.label}. ${description}`
  })

  const totalPatternCount = questionSummaries.reduce((sum, question) => {
    return sum + question.initial.patterns.length + (question.revision?.patterns.length ?? 0)
  }, 0)

  const sessionTakeaway =
    questionSummaries.length > 0
      ? `The class produced ${totalPatternCount} distinct response pattern${totalPatternCount === 1 ? '' : 's'} across ${questionSummaries.length} question${questionSummaries.length === 1 ? '' : 's'}.`
      : 'No response data is available for this session yet.'

  const nextTeachingRecommendation =
    'Review the response patterns for each question and decide which ones are worth discussing or clarifying with the class.'

  return {
    recurringPatterns:
      recurringPatterns.length > 0
        ? recurringPatterns
        : ['No distinct response patterns were available for this session.'],
    sessionTakeaway,
    nextTeachingRecommendation,
  }
}

function sanitizeOpenAISummary(value: unknown, fallback: ReturnType<typeof deriveFallbackSummary>) {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

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
  const compactQuestionData = questionSummaries.map((question) => ({
    position: question.position,
    prompt: question.prompt.slice(0, 120),
    initial: {
      totalResponses: question.initial.responseCount,
      patterns: question.initial.patterns.map((pattern) => ({
        label: pattern.label,
        summary: pattern.summary,
        count: pattern.count,
        percentage: pattern.percentage,
        meanStudentConfidence: pattern.averageConfidence,
      })),
    },
    revision: question.revision
      ? {
          totalResponses: question.revision.responseCount,
          patterns: question.revision.patterns.map((pattern) => ({
            label: pattern.label,
            summary: pattern.summary,
            count: pattern.count,
            percentage: pattern.percentage,
            meanStudentConfidence: pattern.averageConfidence,
          })),
        }
      : null,
  }))

  const result = await openaiChatJson({
    timeoutMs: 20000,
    maxTokens: 700,
    messages: [
      {
        role: 'system',
        content: `You describe response patterns from a classroom session for a teacher. For each question you are given neutral clusters of student responses ("patterns") — each one is a group of students who reasoned about the question in a similar way, along with how many students are in it, what percentage of the class that represents, and their mean self-reported confidence.

Return JSON only with exactly these three fields:
- recurringPatterns: array of 2-3 strings, each in the format "Short neutral label. One sentence describing the response pattern and which question(s) it appeared in."
- sessionTakeaway: one neutral sentence (max 20 words) describing the overall distribution of response patterns across the session.
- nextTeachingRecommendation: one concrete, specific follow-up suggestion (e.g. "discuss the difference between the two most common response patterns on Q3 as a class"). Max 30 words.

Strict rules:
- Describe WHAT patterns exist and HOW prevalent they are (count, percentage, confidence). Never state or imply that any pattern is correct, incorrect, a misconception, or a misunderstanding.
- Never use words or phrases like "correct", "incorrect", "wrong", "misconception", "misunderstand", "should have", "failed to", or "need to improve".
- Never diagnose a learning gap. You are summarizing response patterns, not grading them — the teacher decides what a pattern means.
- Each recurringPatterns string must have exactly two parts separated by a period and space: a short neutral label (4-7 words), then one neutral descriptive sentence.
- sessionTakeaway must reflect the whole session's pattern distribution, not just one question.
- nextTeachingRecommendation may suggest a discussion or clarification move, but must not assume any pattern is wrong — frame it as helping the teacher explore or discuss the differences, not correct them.
- If revision data is available, you may note whether the same patterns persisted or new ones emerged, without judging them.`,
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
    schemaVersion: SESSION_SUMMARY_SCHEMA_VERSION,
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

  // Reject summaries stored under the previous correctness-oriented shape so
  // they get regenerated in the current neutral response-pattern shape.
  if (raw.schemaVersion !== SESSION_SUMMARY_SCHEMA_VERSION) return null

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
