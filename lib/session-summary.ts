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
import {
  getAgentActionsForSession,
  getLecturerAnnotationsForSession,
  getPatternHistoryForSession,
  getSessionMemory,
} from '@/lib/services/pattern-memory-service'
import { getMonitoringGoals, type MonitoringGoal } from '@/lib/services/monitoring-goals-service'
import type {
  AgentAction,
  AttemptType,
  LecturerAnnotation,
  LiveQuestionAnalysis,
  PatternHistory,
  Response,
  SessionMemory,
  SessionQuestion,
} from '@/lib/types/database'

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

export type PatternResponseEvidence = {
  responseId: string
  answer: string
  confidence: number
  participantLabel: string | null
}

export type ReferenceAlignment = {
  alignedReferenceIds?: string[]
  alignmentLevel?: 'strong' | 'partial' | 'limited' | 'unclear'
  explanation?: string
}

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
  referenceAlignment?: ReferenceAlignment | null
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

export type SynthesizedAgentObservation = {
  id: string
  questionId?: string | null
  title: string
  findingDescription: string
  prevalencePercentage: number
  responseCount: number
  sampleQuotes: Array<{ responseId: string; quote: string; confidence?: number }>
  monitoringGoalTitle?: string | null
  monitoringGoalDescription?: string | null
  configuredThreshold?: number | null
  triggerType: string
  triggerReason: string
  evaluationCount: number
  humanCheckpointStatus: 'pending' | 'accepted' | 'dismissed' | 'overridden'
  lecturerAction?: string | null
  lecturerInterpretation?: string | null
  historicalProvenanceNote?: string | null
}

export type SynthesizedTeacherDecision = {
  id: string
  questionId: string
  questionPosition: number
  clusterId: string
  patternLabel: string
  questionPrompt: string
  actionTypes: string[]
  synthesizedActionText: string
  lecturerInterpretation: string | null
  lecturerDecisionNote: string | null
  hasSubstantiveAction: boolean
  createdAt: string
}

export type DeterministicAgentActivityItem = {
  actionId: string
  questionId?: string | null
  agentRole: string
  triggerType: string
  decisionRuleExecuted: string
  actionTaken: string
  humanCheckpointStatus: 'pending' | 'accepted' | 'dismissed' | 'overridden'
  createdAt: string
  observationData: Record<string, unknown>
  matchedGoalTitle?: string | null
  historicalProvenance?: {
    priorSessionId?: string | null
    priorLecturerAction?: string | null
    priorPrevalence?: number | null
    currentPrevalence?: number | null
  } | null
}

export type DeterministicMonitoringGoalItem = {
  id: string
  candidateKey: string
  title: string
  description: string
  status: 'active' | 'paused' | 'completed'
  originType: string
  createdAt: string
}

export type DeterministicLecturerAnnotationItem = {
  annotationId: string
  questionId: string
  clusterId: string
  actionType: string
  lecturerInterpretation: string | null
  lecturerDecision: string | null
  customLabel: string | null
  createdAt: string
}

export type DeterministicLongitudinalContextItem = {
  clusterId: string
  patternLabel: string
  priorSessionId: string
  priorPrevalence: number
  priorLecturerAction: string | null
  currentPrevalence: number
  prevalenceDelta: number
  descriptiveNote: string
}

export type DeterministicCarriesForwardItem = {
  id: string
  type: 'active_monitoring_goal' | 'watchlist_item' | 'lecturer_selected_focus'
  title: string
  description: string
  status: string
  nextSessionRole: string
}

export type QualitativeRevisionAnalysis = {
  persistedPatterns: string[]
  changedPatterns: string[]
  emergedPatterns: string[]
  summaryNote: string
}

export type SessionSummaryPayload = {
  metrics: SessionSummaryMetrics
  questionSummaries: SessionQuestionSummary[]
  synthesizedObservations: SynthesizedAgentObservation[]
  synthesizedTeacherDecisions: SynthesizedTeacherDecision[]
  agentActivity: DeterministicAgentActivityItem[]
  monitoringGoals: DeterministicMonitoringGoalItem[]
  lecturerAnnotations: DeterministicLecturerAnnotationItem[]
  longitudinalContext: DeterministicLongitudinalContextItem[]
  carriesForward: DeterministicCarriesForwardItem[]
  qualitativeRevisionAnalysis: QualitativeRevisionAnalysis | null
  recurringPatterns: string[]
  sessionTakeaway: string
  nextTeachingRecommendation: string
  qualitativeRevisionNote?: string | null
  source: SessionSummarySource
}

const SESSION_SUMMARY_SCHEMA_VERSION = 6

export type StoredSessionSummaryPayload = {
  schemaVersion: typeof SESSION_SUMMARY_SCHEMA_VERSION
  metrics: SessionSummaryMetrics
  questionSummaries: SessionQuestionSummary[]
  synthesizedObservations: SynthesizedAgentObservation[]
  synthesizedTeacherDecisions: SynthesizedTeacherDecision[]
  agentActivity: DeterministicAgentActivityItem[]
  monitoringGoals: DeterministicMonitoringGoalItem[]
  lecturerAnnotations: DeterministicLecturerAnnotationItem[]
  longitudinalContext: DeterministicLongitudinalContextItem[]
  carriesForward: DeterministicCarriesForwardItem[]
  qualitativeRevisionAnalysis: QualitativeRevisionAnalysis | null
  recurringPatterns: string[]
  sessionTakeaway: string
  nextTeachingRecommendation: string
  qualitativeRevisionNote?: string | null
}

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
  referenceAlignment: ReferenceAlignment | null
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

  let referenceAlignment: ReferenceAlignment | null = null
  if (raw.reference_alignment && typeof raw.reference_alignment === 'object') {
    const ref = raw.reference_alignment as Record<string, unknown>
    const alignmentLevel =
      typeof ref.alignment_level === 'string' ? (ref.alignment_level as ReferenceAlignment['alignmentLevel']) : undefined
    const explanation = typeof ref.explanation === 'string' ? ref.explanation : undefined
    const alignedReferenceIds = Array.isArray(ref.aligned_reference_ids)
      ? ref.aligned_reference_ids.map((id) => String(id || ''))
      : undefined
    referenceAlignment = { alignmentLevel, explanation, alignedReferenceIds }
  }

  return {
    clusterId:
      typeof raw.cluster_id === 'string' && raw.cluster_id.trim() ? raw.cluster_id.trim() : `cluster_${index + 1}`,
    label: stripLegacyClusterPrefix(label) || `Pattern ${index + 1}`,
    summary: typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary.trim() : null,
    count: Number.isFinite(count) && count > 0 ? Math.round(count) : responseIds.length,
    averageConfidence: Number.isFinite(averageConfidence) ? roundToOneDecimal(averageConfidence) : null,
    responseIds,
    referenceAlignment,
  }
}

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
    referenceAlignment: cluster.referenceAlignment,
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
): SessionQuestionSummary[] {
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
        prompt: question.prompt, // Full prompt retained!
        initial,
        revision,
      }
    })
}

function classifyConfidenceShift(initial: QuestionAttemptSummary, revision: QuestionAttemptSummary) {
  if (initial.averageConfidence === null || revision.averageConfidence === null) return null
  const delta = revision.averageConfidence - initial.averageConfidence
  if (delta > 0) return 'increased'
  if (delta < 0) return 'decreased'
  return 'stayed'
}

function buildMetrics(participantCount: number, questionSummaries: SessionQuestionSummary[], responses: Response[]): SessionSummaryMetrics {
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

function buildSynthesizedObservations(
  agentActions: AgentAction[],
  goals: MonitoringGoal[],
  annotations: LecturerAnnotation[],
  questionSummaries: SessionQuestionSummary[]
): SynthesizedAgentObservation[] {
  if (!agentActions || agentActions.length === 0) return []

  const goalsByKey = new Map(goals.map((g) => [g.candidateKey, g]))
  const goalsById = new Map(goals.map((g) => [g.id, g]))
  const annotationsByCluster = new Map(annotations.map((a) => [a.cluster_id, a]))

  const grouped = new Map<string, { actions: AgentAction[]; latest: AgentAction }>()

  for (const action of agentActions) {
    const obs = action.observation_data || {}
    const key = `${action.question_id || 'q'}:${obs.candidateKey || obs.goalId || obs.clusterId || action.trigger_type}`
    const existing = grouped.get(key)
    if (existing) {
      existing.actions.push(action)
      existing.latest = action
    } else {
      grouped.set(key, { actions: [action], latest: action })
    }
  }

  const result: SynthesizedAgentObservation[] = []

  for (const [groupKey, entry] of grouped.entries()) {
    const latest = entry.latest
    const obs = latest.observation_data || {}
    const candidateKey = String(obs.candidateKey || '')
    const goalId = String(obs.goalId || '')
    const matchedGoal = goalsById.get(goalId) || goalsByKey.get(candidateKey)
    const clusterId = String(obs.clusterId || '')
    const annotation = annotationsByCluster.get(clusterId)

    const prevalence = typeof obs.prevalence === 'number' ? obs.prevalence : typeof obs.currentPrevalence === 'number' ? obs.currentPrevalence : 0
    const threshold = typeof obs.threshold === 'number' ? obs.threshold : 30

    let title = 'Prominent student reasoning pattern observed'
    let description = 'A distinct conceptual approach was identified across student responses.'

    if (candidateKey === 'explanation_depth') {
      title = 'Some responses provided a conclusion without explaining the underlying mechanism'
      description = 'Students stated final outputs or outcomes without detailing the key traversal or evaluation steps.'
    } else if (candidateKey === 'examples_vs_principles') {
      title = 'Students explained algorithms using concrete examples rather than general invariants'
      description = 'Responses relied on plug-in calculation examples rather than stating structural or algebraic rules.'
    } else if (candidateKey === 'confidence_and_reasoning_variation') {
      title = 'Confidence varied significantly across contrasting student reasoning models'
      description = 'Students expressed high confidence (4-5/5) while holding opposing interpretations.'
    } else if (obs.clusterLabel) {
      const cleanLabel = String(obs.clusterLabel).replace(/^(True|False|Uncertain):\s*/i, '').trim()
      title = `Reasoning pattern: "${cleanLabel}"`
      description = `${prevalence}% of responses exhibited this reasoning approach.`
    } else if (latest.trigger_type === 'longitudinal_lecturer_focus_match') {
      title = 'A reasoning pattern previously selected by the lecturer reappeared'
      description = 'Student responses matched a reasoning focus that was discussed in a prior session.'
    } else if (latest.trigger_type === 'longitudinal_prevalence_shift') {
      title = 'Significant shift in reasoning pattern prevalence across sessions'
      description = `The proportion of responses matching this pattern shifted from ${obs.priorPrevalence || 0}% in a prior session to ${prevalence}%.`
    }

    let sampleQuotes: Array<{ responseId: string; quote: string; confidence?: number }> = []
    let responseCount = 0
    if (latest.question_id) {
      const qSummary = questionSummaries.find((q) => q.questionId === latest.question_id)
      if (qSummary) {
        const attempt = qSummary.revision || qSummary.initial
        const cluster = attempt.patterns.find((p) => p.clusterId === clusterId)
        if (cluster) {
          responseCount = cluster.count
          sampleQuotes = cluster.responses.slice(0, 3).map((r) => ({
            responseId: r.responseId,
            quote: r.answer,
            confidence: r.confidence,
          }))
        }
      }
    }

    let triggerReason = `${prevalence}% of responses met the condition.`
    if (matchedGoal) {
      triggerReason = `Observed prevalence of ${prevalence}% met the ≥${threshold}% threshold for monitored dimension "${matchedGoal.title}".`
    } else if (latest.trigger_type === 'longitudinal_lecturer_focus_match') {
      triggerReason = `A similar pattern was previously selected for discussion by the lecturer in Session ${obs.priorSessionId || 'history'}.`
    }

    let historicalProvNote: string | null = null
    if (obs.priorSessionId) {
      historicalProvNote = `Matched prior lecturer action "${obs.priorLecturerAction || 'selected'}" in Session ${obs.priorSessionId}.`
    }

    result.push({
      id: `synth-obs-${groupKey}`,
      questionId: latest.question_id,
      title,
      findingDescription: description,
      prevalencePercentage: prevalence,
      responseCount,
      sampleQuotes,
      monitoringGoalTitle: matchedGoal?.title || (obs.goalTitle ? String(obs.goalTitle) : null),
      monitoringGoalDescription: matchedGoal?.description || null,
      configuredThreshold: threshold,
      triggerType: latest.trigger_type,
      triggerReason,
      evaluationCount: entry.actions.length,
      humanCheckpointStatus: latest.human_checkpoint_status || 'pending',
      lecturerAction: annotation?.action_type || null,
      lecturerInterpretation: annotation?.lecturer_interpretation || null,
      historicalProvenanceNote: historicalProvNote,
    })
  }

  return result
}

function isSyntheticConfirmationString(text: string | null | undefined): boolean {
  if (!text) return true
  const str = text.trim()
  if (/\bprevalence observation pinned\b/i.test(str)) return true
  if (/^Inspected evidence for autonomous observation checkpoint/i.test(str)) return true
  if (/^Action '.*' recorded/i.test(str)) return true
  if (/^Teacher note added to AI observation/i.test(str)) return true
  if (/^Recorded lecturer action/i.test(str)) return true
  return false
}

function buildSynthesizedTeacherDecisions(
  annotations: LecturerAnnotation[],
  questionSummaries: SessionQuestionSummary[]
): SynthesizedTeacherDecision[] {
  if (!annotations || annotations.length === 0) return []

  const groupedMap = new Map<string, LecturerAnnotation[]>()

  for (const ann of annotations) {
    const key = `${ann.question_id}:${ann.cluster_id}`
    const existing = groupedMap.get(key) || []
    existing.push(ann)
    groupedMap.set(key, existing)
  }

  const result: SynthesizedTeacherDecision[] = []

  for (const [groupKey, anns] of groupedMap.entries()) {
    const first = anns[0]
    const questionId = first.question_id
    const clusterId = first.cluster_id

    const qSummary = questionSummaries.find((q) => q.questionId === questionId)
    const qPosition = qSummary ? qSummary.position : 1
    const qPrompt = qSummary ? qSummary.prompt : ''

    let resolvedLabel = ''
    if (qSummary) {
      const attempt = qSummary.revision || qSummary.initial
      const pattern = attempt.patterns.find((p) => p.clusterId === clusterId)
      if (pattern && pattern.label && !/^cluster_/i.test(pattern.label)) {
        resolvedLabel = pattern.label
      } else if (pattern && pattern.summary) {
        resolvedLabel = pattern.summary
      }
    }

    const customLabelAnn = anns.find((a) => a.custom_label && !/^Pattern cluster_/i.test(a.custom_label))
    if (customLabelAnn?.custom_label) {
      resolvedLabel = customLabelAnn.custom_label
    }

    if (!resolvedLabel || /^cluster_/i.test(resolvedLabel)) {
      resolvedLabel = `Question ${qPosition} Reasoning Pattern`
    }

    const patternLabel = `Q${qPosition}: ${resolvedLabel}`

    const actionTypesSet = new Set(anns.map((a) => a.action_type))
    const actionTypes = Array.from(actionTypesSet)

    let synthesizedActionText = 'You reviewed this pattern.'
    if (actionTypesSet.has('pinned') && actionTypesSet.has('selected_for_discussion')) {
      synthesizedActionText = 'You pinned this pattern for future attention and selected it for class discussion.'
    } else if (actionTypesSet.has('selected_for_discussion')) {
      synthesizedActionText = 'You selected this pattern for class discussion.'
    } else if (actionTypesSet.has('pinned')) {
      synthesizedActionText = 'You pinned this pattern for future attention.'
    } else if (actionTypesSet.has('monitored')) {
      synthesizedActionText = 'You added this pattern to your longitudinal watchlist.'
    } else if (actionTypesSet.has('annotated')) {
      synthesizedActionText = 'You recorded a teacher note for this pattern.'
    } else if (actionTypesSet.has('inspected')) {
      synthesizedActionText = 'You reviewed the student evidence for this pattern.'
    }

    const noteAnn = anns.find((a) => a.lecturer_interpretation && a.lecturer_interpretation.trim().length > 0)
    const lecturerInterpretation = noteAnn?.lecturer_interpretation ? noteAnn.lecturer_interpretation.trim() : null

    const decisionAnn = anns.find(
      (a) => a.lecturer_decision && !isSyntheticConfirmationString(a.lecturer_decision)
    )
    const lecturerDecisionNote = decisionAnn?.lecturer_decision ? decisionAnn.lecturer_decision.trim() : null

    const hasSubstantiveAction =
      actionTypesSet.has('selected_for_discussion') ||
      actionTypesSet.has('pinned') ||
      actionTypesSet.has('monitored') ||
      Boolean(lecturerInterpretation) ||
      Boolean(lecturerDecisionNote)

    result.push({
      id: `synth-dec-${groupKey}`,
      questionId,
      questionPosition: qPosition,
      clusterId,
      patternLabel,
      questionPrompt: qPrompt,
      actionTypes,
      synthesizedActionText,
      lecturerInterpretation,
      lecturerDecisionNote,
      hasSubstantiveAction,
      createdAt: first.created_at,
    })
  }

  result.sort((a, b) => (b.hasSubstantiveAction ? 1 : 0) - (a.hasSubstantiveAction ? 1 : 0))

  return result
}

function buildDeterministicAgentActivity(
  agentActions: AgentAction[],
  goals: MonitoringGoal[]
): DeterministicAgentActivityItem[] {
  const goalsByKey = new Map(goals.map((g) => [g.candidateKey, g]))
  const goalsById = new Map(goals.map((g) => [g.id, g]))

  return agentActions.map((action) => {
    const obsData = action.observation_data || {}
    const candidateKey = String(obsData.candidateKey || '')
    const goalId = String(obsData.goalId || '')
    const matchedGoal = goalsById.get(goalId) || goalsByKey.get(candidateKey)

    let historicalProv: DeterministicAgentActivityItem['historicalProvenance'] = null
    if (obsData.priorSessionId) {
      historicalProv = {
        priorSessionId: String(obsData.priorSessionId || ''),
        priorLecturerAction: obsData.priorLecturerAction ? String(obsData.priorLecturerAction) : null,
        priorPrevalence: typeof obsData.priorPrevalence === 'number' ? obsData.priorPrevalence : null,
        currentPrevalence: typeof obsData.currentPrevalence === 'number' ? obsData.currentPrevalence : null,
      }
    }

    return {
      actionId: action.action_id,
      questionId: action.question_id,
      agentRole: action.agent_role || 'classroom_reasoning_observer',
      triggerType: action.trigger_type,
      decisionRuleExecuted: action.decision_rule_executed,
      actionTaken: action.action_taken,
      humanCheckpointStatus: action.human_checkpoint_status || 'pending',
      createdAt: action.created_at,
      observationData: obsData,
      matchedGoalTitle: matchedGoal?.title || (obsData.goalTitle ? String(obsData.goalTitle) : null),
      historicalProvenance: historicalProv,
    }
  })
}

function buildDeterministicMonitoringGoals(goals: MonitoringGoal[]): DeterministicMonitoringGoalItem[] {
  return goals.map((goal) => ({
    id: goal.id,
    candidateKey: goal.candidateKey,
    title: goal.title,
    description: goal.description,
    status: goal.status,
    originType: goal.originType,
    createdAt: goal.createdAt,
  }))
}

function buildDeterministicLecturerAnnotations(annotations: LecturerAnnotation[]): DeterministicLecturerAnnotationItem[] {
  return annotations.map((ann) => ({
    annotationId: ann.annotation_id,
    questionId: ann.question_id,
    clusterId: ann.cluster_id,
    actionType: ann.action_type,
    lecturerInterpretation: ann.lecturer_interpretation,
    lecturerDecision: ann.lecturer_decision,
    customLabel: ann.custom_label,
    createdAt: ann.created_at,
  }))
}

function buildDeterministicLongitudinalContext(
  agentActions: AgentAction[],
  patternHistory: PatternHistory[]
): DeterministicLongitudinalContextItem[] {
  const items: DeterministicLongitudinalContextItem[] = []

  for (const action of agentActions) {
    const obs = action.observation_data || {}
    if (action.trigger_type === 'longitudinal_lecturer_focus_match' || action.trigger_type === 'longitudinal_prevalence_shift') {
      const priorSessionId = String(obs.priorSessionId || '')
      const priorPrevalence = Number(obs.priorPrevalence || 0)
      const currentPrevalence = Number(obs.currentPrevalence || 0)
      items.push({
        clusterId: String(obs.clusterId || ''),
        patternLabel: String(obs.clusterLabel || 'Reasoning Pattern'),
        priorSessionId,
        priorPrevalence,
        priorLecturerAction: obs.priorLecturerAction ? String(obs.priorLecturerAction) : null,
        currentPrevalence,
        prevalenceDelta: currentPrevalence - priorPrevalence,
        descriptiveNote: action.action_taken || 'Reappeared reasoning pattern matched from a prior session.',
      })
    }
  }

  for (const ph of patternHistory) {
    if (ph.longitudinal_status === 'reappeared' || ph.longitudinal_status === 'changed_prevalence') {
      const exists = items.some((item) => item.patternLabel.toLowerCase() === ph.pattern_label.toLowerCase())
      if (!exists) {
        items.push({
          clusterId: ph.pattern_key,
          patternLabel: ph.pattern_label,
          priorSessionId: ph.first_observed_session_id || ph.session_id,
          priorPrevalence: Number(ph.prevalence_percentage || 0),
          priorLecturerAction: null,
          currentPrevalence: Number(ph.prevalence_percentage || 0),
          prevalenceDelta: 0,
          descriptiveNote: `Pattern "${ph.pattern_label}" was previously observed in session history.`,
        })
      }
    }
  }

  return items
}

function buildDeterministicCarriesForward(
  monitoringGoals: MonitoringGoal[],
  sessionMemory: SessionMemory | null,
  annotations: LecturerAnnotation[]
): DeterministicCarriesForwardItem[] {
  const items: DeterministicCarriesForwardItem[] = []

  for (const goal of monitoringGoals) {
    if (goal.status === 'active') {
      items.push({
        id: `goal-${goal.id}`,
        type: 'active_monitoring_goal',
        title: goal.title,
        description: goal.description,
        status: 'Active Goal',
        nextSessionRole: 'MeshQuiz will check future classroom evidence for matching patterns.',
      })
    }
  }

  if (sessionMemory?.watchlist_items && Array.isArray(sessionMemory.watchlist_items)) {
    for (const item of sessionMemory.watchlist_items) {
      items.push({
        id: item.item_id || `watch-${Date.now()}`,
        type: 'watchlist_item',
        title: item.pattern_label,
        description: item.observation_target,
        status: item.status || 'pending',
        nextSessionRole: 'Persisted to session memory watchlist for next-session comparison.',
      })
    }
  }

  for (const ann of annotations) {
    if (['selected_for_discussion', 'pinned', 'monitored'].includes(ann.action_type)) {
      items.push({
        id: `ann-${ann.annotation_id}`,
        type: 'lecturer_selected_focus',
        title: ann.custom_label || `Pattern ${ann.cluster_id}`,
        description: ann.lecturer_interpretation || ann.lecturer_decision || `Lecturer action: ${ann.action_type}`,
        status: ann.action_type,
        nextSessionRole: 'Saved as lecturer discussion focus to inform future adaptive surfacing.',
      })
    }
  }

  return items
}

function buildQualitativeRevisionAnalysis(
  questionSummaries: SessionQuestionSummary[],
  allResponses: Response[] = []
): QualitativeRevisionAnalysis | null {
  const questionsWithRevision = questionSummaries.filter((q) => q.revision && q.revision.patterns.length > 0)
  if (questionsWithRevision.length === 0) return null

  const persistentInterpretations: string[] = []
  const refinedExplanations: string[] = []
  const newReasoningDirections: string[] = []

  for (const q of questionsWithRevision) {
    const initialPatterns = q.initial.patterns
    const revisionPatterns = q.revision!.patterns

    const qResponses = allResponses.filter((r) => r.question_id === q.questionId)
    const initialRespMap = new Map(
      qResponses
        .filter((r) => r.attempt_type === 'initial')
        .map((r) => [r.session_participant_id, r])
    )
    const revisionRespMap = new Map(
      qResponses
        .filter((r) => r.attempt_type === 'revision')
        .map((r) => [r.session_participant_id, r])
    )

    let refinedCount = 0

    for (const [partId, revResp] of revisionRespMap.entries()) {
      const initResp = initialRespMap.get(partId)
      if (initResp) {
        const initLen = (initResp.answer || '').trim().length
        const revLen = (revResp.answer || '').trim().length
        const confChange = (revResp.confidence || 0) - (initResp.confidence || 0)

        if (revLen > initLen + 10 || confChange > 0) {
          refinedCount++
        }
      }
    }

    for (const pRev of revisionPatterns) {
      const cleanLabel = pRev.label.replace(/^(True|False|Uncertain):\s*/i, '').trim()
      const matchingInitPattern = initialPatterns.find(
        (pInit) =>
          pInit.label.toLowerCase() === pRev.label.toLowerCase() ||
          (pInit.summary && pRev.summary && pInit.summary.toLowerCase() === pRev.summary.toLowerCase())
      )

      if (matchingInitPattern) {
        persistentInterpretations.push(
          `Q${q.position}: Students maintained the interpretation "${cleanLabel}" (${pRev.percentage ?? 0}% of revision responses).`
        )
      } else {
        newReasoningDirections.push(
          `Q${q.position}: Students introduced a new reasoning direction "${cleanLabel}" during revision (${pRev.percentage ?? 0}% of responses).`
        )
      }
    }

    for (const pInit of initialPatterns) {
      const cleanInitLabel = pInit.label.replace(/^(True|False|Uncertain):\s*/i, '').trim()
      const stillPresent = revisionPatterns.some(
        (pRev) =>
          pRev.label.toLowerCase() === pInit.label.toLowerCase() ||
          (pInit.summary && pRev.summary && pInit.summary.toLowerCase() === pRev.summary.toLowerCase())
      )

      if (!stillPresent) {
        refinedExplanations.push(
          `Q${q.position}: Initial reasoning around "${cleanInitLabel}" was refined or integrated into updated explanations.`
        )
      }
    }

    if (refinedCount > 0) {
      refinedExplanations.push(
        `Q${q.position}: ${refinedCount} student(s) expanded their explanations with more detailed mechanisms or higher confidence in revision.`
      )
    }
  }

  const summaryNote = `Synthesized response-level conceptual shifts across ${questionsWithRevision.length} question(s). Identified ${persistentInterpretations.length} persistent interpretation(s), ${refinedExplanations.length} refined explanation(s), and ${newReasoningDirections.length} new reasoning direction(s).`

  return {
    persistedPatterns: persistentInterpretations,
    changedPatterns: refinedExplanations,
    emergedPatterns: newReasoningDirections,
    summaryNote,
  }
}

function deriveFallbackSummary(
  questionSummaries: SessionQuestionSummary[],
  qualitativeRevision: QualitativeRevisionAnalysis | null
) {
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
    'Consider reviewing the response pattern distribution for each question to explore student reasoning differences.'

  return {
    recurringPatterns:
      recurringPatterns.length > 0
        ? recurringPatterns
        : ['No distinct response patterns were available for this session.'],
    sessionTakeaway,
    nextTeachingRecommendation,
    qualitativeRevisionNote: qualitativeRevision?.summaryNote || null,
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

  const qualitativeRevisionNote =
    typeof input.qualitativeRevisionNote === 'string' && input.qualitativeRevisionNote.trim()
      ? input.qualitativeRevisionNote.trim()
      : fallback.qualitativeRevisionNote

  return {
    recurringPatterns: recurringPatterns.length > 0 ? recurringPatterns : fallback.recurringPatterns,
    sessionTakeaway,
    nextTeachingRecommendation,
    qualitativeRevisionNote,
  }
}

async function generateOpenAISummary(
  questionSummaries: SessionQuestionSummary[],
  synthesizedObs: SynthesizedAgentObservation[],
  monitoringGoals: DeterministicMonitoringGoalItem[],
  lecturerAnnotations: DeterministicLecturerAnnotationItem[],
  longitudinalContext: DeterministicLongitudinalContextItem[],
  qualitativeRevision: QualitativeRevisionAnalysis | null,
  fallback: ReturnType<typeof deriveFallbackSummary>
) {
  const compactQuestionData = questionSummaries.map((question) => ({
    position: question.position,
    prompt: question.prompt, // FULL PROMPT — NO TRUNCATION!
    initial: {
      totalResponses: question.initial.responseCount,
      patterns: question.initial.patterns.map((pattern) => ({
        label: pattern.label,
        summary: pattern.summary,
        count: pattern.count,
        percentage: pattern.percentage,
        meanStudentConfidence: pattern.averageConfidence,
        referenceAlignment: pattern.referenceAlignment
          ? {
              level: pattern.referenceAlignment.alignmentLevel,
              explanation: pattern.referenceAlignment.explanation,
            }
          : null,
        sampleStudentQuotes: pattern.responses.slice(0, 3).map((r) => r.answer.slice(0, 150)),
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
            referenceAlignment: pattern.referenceAlignment
              ? {
                  level: pattern.referenceAlignment.alignmentLevel,
                  explanation: pattern.referenceAlignment.explanation,
                }
              : null,
            sampleStudentQuotes: pattern.responses.slice(0, 3).map((r) => r.answer.slice(0, 150)),
          })),
        }
      : null,
  }))

  const result = await openaiChatJson({
    timeoutMs: 22000,
    maxTokens: 850,
    messages: [
      {
        role: 'system',
        content: `You synthesize classroom reasoning patterns, agent observations, teacher interactions, and revision movements for a lecturer's end-of-session evaluation report.

For each question, you are given neutral clusters of student responses ("patterns"), each with count, percentage, mean student confidence, reference alignment, and sample student quotes. You also receive agent observations, active teacher monitoring goals, teacher notes, and revision pattern movements.

Return JSON only with these exact fields:
- recurringPatterns: array of 2-3 strings, each in format "Short neutral label. Descriptive sentence outlining prevalence and context."
- sessionTakeaway: 1-2 neutral sentences (max 40 words) describing overall reasoning pattern distribution across student responses and rounds.
- nextTeachingRecommendation: 1-2 neutral, evidence-grounded sentences (max 40 words) framed as "Possible next-session considerations" (e.g. suggesting class discussion of key pattern differences without diagnosing learning deficits or prescribing reteaching).
- qualitativeRevisionNote: 1-2 neutral sentences (max 40 words) describing how student reasoning patterns evolved between initial and revision rounds without judging correctness or claiming learning gains.

Strict rules:
- Maintain non-evaluative, neutral framing.
- Never state or imply that any pattern is correct, incorrect, a misconception, a failure, or a learning deficit.
- Never use terms like "correct", "incorrect", "wrong", "misconception", "misunderstand", "should have", "failed to", or "learning gap".
- Reference alignment means alignment relative to the supplied reference answer — it does NOT mean absolute correctness.
- The teacher is the sole pedagogical decision-maker; frame recommendations as considerations for teacher discussion.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          questions: compactQuestionData,
          agentObservationsSummary: synthesizedObs.map((a) => ({
            title: a.title,
            prevalence: a.prevalencePercentage,
            matchedGoal: a.monitoringGoalTitle,
            status: a.humanCheckpointStatus,
          })),
          monitoringGoalsSummary: monitoringGoals.map((g) => ({ title: g.title, status: g.status })),
          teacherNotesSummary: lecturerAnnotations.map((a) => ({
            actionType: a.actionType,
            customLabel: a.customLabel,
            note: a.lecturerInterpretation,
          })),
          longitudinalSummary: longitudinalContext.map((l) => ({
            pattern: l.patternLabel,
            priorPrevalence: l.priorPrevalence,
            currentPrevalence: l.currentPrevalence,
          })),
          qualitativeRevisionOverview: qualitativeRevision,
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
    schemaVersion: SESSION_SUMMARY_SCHEMA_VERSION,
    metrics: summary.metrics,
    questionSummaries: summary.questionSummaries,
    synthesizedObservations: summary.synthesizedObservations,
    synthesizedTeacherDecisions: summary.synthesizedTeacherDecisions,
    agentActivity: summary.agentActivity,
    monitoringGoals: summary.monitoringGoals,
    lecturerAnnotations: summary.lecturerAnnotations,
    longitudinalContext: summary.longitudinalContext,
    carriesForward: summary.carriesForward,
    qualitativeRevisionAnalysis: summary.qualitativeRevisionAnalysis,
    recurringPatterns: summary.recurringPatterns,
    sessionTakeaway: summary.sessionTakeaway,
    nextTeachingRecommendation: summary.nextTeachingRecommendation,
    qualitativeRevisionNote: summary.qualitativeRevisionNote ?? null,
  }
}

function parseStoredSessionSummary(
  value: Record<string, unknown> | null | undefined,
  source: SessionSummarySource
): SessionSummaryPayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>

  if (raw.schemaVersion !== SESSION_SUMMARY_SCHEMA_VERSION) return null

  const metrics = raw.metrics
  const questionSummaries = raw.questionSummaries
  const synthesizedObservations = raw.synthesizedObservations
  const synthesizedTeacherDecisions = raw.synthesizedTeacherDecisions
  const agentActivity = raw.agentActivity
  const monitoringGoals = raw.monitoringGoals
  const lecturerAnnotations = raw.lecturerAnnotations
  const longitudinalContext = raw.longitudinalContext
  const carriesForward = raw.carriesForward
  const qualitativeRevisionAnalysis = raw.qualitativeRevisionAnalysis
  const recurringPatterns = raw.recurringPatterns
  const sessionTakeaway = raw.sessionTakeaway
  const nextTeachingRecommendation = raw.nextTeachingRecommendation
  const qualitativeRevisionNote = typeof raw.qualitativeRevisionNote === 'string' ? raw.qualitativeRevisionNote : null

  if (!metrics || typeof metrics !== 'object') return null
  if (!Array.isArray(questionSummaries)) return null
  if (!Array.isArray(recurringPatterns)) return null
  if (typeof sessionTakeaway !== 'string') return null
  if (typeof nextTeachingRecommendation !== 'string') return null

  return {
    metrics: metrics as SessionSummaryMetrics,
    questionSummaries: questionSummaries as SessionQuestionSummary[],
    synthesizedObservations: Array.isArray(synthesizedObservations) ? (synthesizedObservations as SynthesizedAgentObservation[]) : [],
    synthesizedTeacherDecisions: Array.isArray(synthesizedTeacherDecisions) ? (synthesizedTeacherDecisions as SynthesizedTeacherDecision[]) : [],
    agentActivity: Array.isArray(agentActivity) ? (agentActivity as DeterministicAgentActivityItem[]) : [],
    monitoringGoals: Array.isArray(monitoringGoals) ? (monitoringGoals as DeterministicMonitoringGoalItem[]) : [],
    lecturerAnnotations: Array.isArray(lecturerAnnotations) ? (lecturerAnnotations as DeterministicLecturerAnnotationItem[]) : [],
    longitudinalContext: Array.isArray(longitudinalContext) ? (longitudinalContext as DeterministicLongitudinalContextItem[]) : [],
    carriesForward: Array.isArray(carriesForward) ? (carriesForward as DeterministicCarriesForwardItem[]) : [],
    qualitativeRevisionAnalysis: qualitativeRevisionAnalysis ? (qualitativeRevisionAnalysis as QualitativeRevisionAnalysis) : null,
    recurringPatterns: recurringPatterns.map((entry) => String(entry || '')).filter(Boolean),
    sessionTakeaway,
    nextTeachingRecommendation,
    qualitativeRevisionNote,
    source,
  }
}

export async function generateSessionSummary(options: {
  sessionId: string
  force?: boolean
}): Promise<SessionSummaryPayload> {
  const { sessionId } = options

  const [
    sessionRow,
    participants,
    questions,
    responses,
    analyses,
    agentActions,
    monitoringGoals,
    annotations,
    sessionMemory,
    patternHistory,
  ] = await Promise.all([
    getSession(sessionId),
    getSessionParticipants(sessionId),
    getSessionQuestions(sessionId),
    getSessionResponses(sessionId),
    getLiveQuestionAnalyses(sessionId),
    getAgentActionsForSession(sessionId),
    getMonitoringGoals('default_teacher'),
    getLecturerAnnotationsForSession(sessionId),
    getSessionMemory(sessionId),
    getPatternHistoryForSession(sessionId),
  ])

  const questionSummaries = buildQuestionSummaries(questions || [], responses || [], analyses || [])
  const participantCount = countParticipants(participants || [], responses || [])
  const metrics = buildMetrics(participantCount, questionSummaries, responses || [])

  const synthesizedObservations = buildSynthesizedObservations(agentActions || [], monitoringGoals || [], annotations || [], questionSummaries)
  const synthesizedTeacherDecisions = buildSynthesizedTeacherDecisions(annotations || [], questionSummaries)
  const agentActivity = buildDeterministicAgentActivity(agentActions || [], monitoringGoals || [])
  const deterministicMonitoringGoals = buildDeterministicMonitoringGoals(monitoringGoals || [])
  const deterministicAnnotations = buildDeterministicLecturerAnnotations(annotations || [])
  const longitudinalContext = buildDeterministicLongitudinalContext(agentActions || [], patternHistory || [])
  const carriesForward = buildDeterministicCarriesForward(monitoringGoals || [], sessionMemory, annotations || [])
  const qualitativeRevision = buildQualitativeRevisionAnalysis(questionSummaries, responses || [])

  const fallback = deriveFallbackSummary(questionSummaries, qualitativeRevision)

  try {
    const qualitative = await generateOpenAISummary(
      questionSummaries,
      synthesizedObservations,
      deterministicMonitoringGoals,
      deterministicAnnotations,
      longitudinalContext,
      qualitativeRevision,
      fallback
    )

    const allPatternsToPersist: Array<{
      questionId: string
      patternLabel: string
      patternDescription: string
      prevalencePercentage: number
      responseCount: number
      averageConfidence: number | null
      representativeResponseIds: string[]
      evidenceQuotes: Array<{ response_id: string; exact_quote: string }>
    }> = []

    for (const qSummary of questionSummaries) {
      const targetAttempt = qSummary.revision || qSummary.initial
      for (const pattern of targetAttempt.patterns) {
        allPatternsToPersist.push({
          questionId: qSummary.questionId,
          patternLabel: pattern.label,
          patternDescription: pattern.summary || 'Students expressed a similar line of reasoning.',
          prevalencePercentage: pattern.percentage || 0,
          responseCount: pattern.count,
          averageConfidence: pattern.averageConfidence,
          representativeResponseIds: pattern.responseIds.slice(0, 3),
          evidenceQuotes: pattern.responses.slice(0, 3).map((r) => ({
            response_id: r.responseId,
            exact_quote: r.answer.slice(0, 150),
          })),
        })
      }
    }

    const { saveSessionMemoryBridge } = await import('@/lib/services/pattern-memory-service')
    await saveSessionMemoryBridge({
      sessionId,
      summaryNarrative: qualitative.sessionTakeaway,
      watchlistItems: [
        {
          item_id: `watch-${sessionId}-1`,
          pattern_label: qualitative.recurringPatterns[0] || 'Primary reasoning pattern',
          observation_target: 'Monitor whether this reasoning pattern persists in future sessions.',
          status: 'pending',
        },
      ],
      patterns: allPatternsToPersist,
    })

    return {
      metrics,
      questionSummaries,
      synthesizedObservations,
      synthesizedTeacherDecisions,
      agentActivity,
      monitoringGoals: deterministicMonitoringGoals,
      lecturerAnnotations: deterministicAnnotations,
      longitudinalContext,
      carriesForward,
      qualitativeRevisionAnalysis: qualitativeRevision,
      recurringPatterns: qualitative.recurringPatterns,
      sessionTakeaway: qualitative.sessionTakeaway,
      nextTeachingRecommendation: qualitative.nextTeachingRecommendation,
      qualitativeRevisionNote: qualitative.qualitativeRevisionNote,
      source: 'openai',
    }
  } catch (error) {
    console.error('session-summary openai fallback', error)
    return {
      metrics,
      questionSummaries,
      synthesizedObservations,
      synthesizedTeacherDecisions,
      agentActivity,
      monitoringGoals: deterministicMonitoringGoals,
      lecturerAnnotations: deterministicAnnotations,
      longitudinalContext,
      carriesForward,
      qualitativeRevisionAnalysis: qualitativeRevision,
      recurringPatterns: fallback.recurringPatterns,
      sessionTakeaway: fallback.sessionTakeaway,
      nextTeachingRecommendation: fallback.nextTeachingRecommendation,
      qualitativeRevisionNote: fallback.qualitativeRevisionNote,
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
