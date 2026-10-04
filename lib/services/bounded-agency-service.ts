import { createAdminClient } from '@/lib/supabase/server'
import type { LiveQuestionClusterAnalysis, LiveCluster } from '@/lib/ai/live-question-clustering'
import { compareCurrentPatternsWithHistory } from '@/lib/services/longitudinal-comparator'
import { getLecturerAnnotationsForSession, logAgentAction } from '@/lib/services/pattern-memory-service'
import { sanitizeNonEvaluativeText } from '@/lib/ai/cluster-guardrail'
import { getMonitoringGoals, type MonitoringGoal } from '@/lib/services/monitoring-goals-service'
import { openaiChatJson } from '@/lib/ai/openai-json'

export async function getActiveMonitoringGoalsForBoundedAgent(teacherId = 'default_teacher'): Promise<MonitoringGoal[]> {
  const allGoals = await getMonitoringGoals(teacherId)
  return allGoals.filter((g) => g.status === 'active')
}

export type BoundedAgentObservation = {
  observationId: string
  sessionId: string
  questionId: string
  type: 'new_pattern' | 'recurring_pattern' | 'prevalence_shift' | 'prior_discussion_focus' | 'goal_conditioned_focus'
  triggerType: string
  decisionRuleExecuted: string
  actionTaken: string
  humanCheckpointStatus: 'pending' | 'accepted' | 'dismissed' | 'overridden'
  title: string
  description: string
  clusterId: string
  prevalencePercentage: number
  priorSessionId?: string | null
  goalId?: string | null
  candidateKey?: string | null
  triggerDetails?: {
    goalTitle: string
    candidateKey: string
    prevalence: number
    thresholdPercentage: number
    clusterLabel: string
  }
  supportingClusters?: Array<{
    clusterId: string
    label: string
    summary?: string
    count: number
    percentage: number
    averageConfidence: number
    evidenceQuotes: Array<{ response_id: string; exact_quote: string }>
  }>
  longitudinalDetails?: {
    priorSessionId?: string | null
    priorSessionCode?: string | null
    priorSessionDate?: string | null
    priorTopicDomain?: string | null
    priorQuestionId?: string | null
    priorPatternLabel?: string | null
    priorPrevalence?: number | null
    currentPrevalence?: number | null
    prevalenceDelta?: number | null
    priorLecturerAction?: string | null
    descriptiveNote?: string | null
  }
  monitoringGoal?: {
    id: string
    title: string
    description: string
  }
  evidenceResponseIds: string[]
  evidenceQuotes: Array<{ response_id: string; exact_quote: string; confidence?: number }>
  timestamp: string
}

type StudentResponseForEval = {
  response_id: string
  answer: string
  confidence: number
  cluster_id: string
}

async function getResponsesForEvaluation(
  sessionId: string,
  questionId: string,
  clusters: LiveCluster[]
): Promise<StudentResponseForEval[]> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('responses')
      .select('response_id, answer, confidence, explanation')
      .eq('session_id', sessionId)
      .eq('question_id', questionId)

    if (data && data.length > 0) {
      return data.map((r) => {
        const matchingCluster = clusters.find((c) => c.response_ids?.includes(r.response_id))
        return {
          response_id: r.response_id,
          answer: String(r.answer || r.explanation || '').trim(),
          confidence: typeof r.confidence === 'number' ? r.confidence : 3,
          cluster_id: matchingCluster?.cluster_id || 'unclustered',
        }
      })
    }
  } catch (e) {
    console.error('[bounded-agency] DB fetch for responses failed, building from clusters', e)
  }

  const fallbackResponses: StudentResponseForEval[] = []
  for (const cluster of clusters) {
    const ids = cluster.response_ids || []
    const reps = cluster.representative_answers || []
    ids.forEach((id, idx) => {
      fallbackResponses.push({
        response_id: id,
        answer: reps[idx % reps.length] || cluster.label || 'Student response',
        confidence: Math.round(cluster.average_confidence || 3),
        cluster_id: cluster.cluster_id,
      })
    })
  }
  return fallbackResponses
}

type BatchedGoalEvaluationResult = {
  goal_id: string
  response_evaluations: Array<{
    response_id: string
    match: 'match' | 'no_match' | 'unclear'
    evidence: string
  }>
}

async function evaluateBatchedMonitoringGoals(input: {
  questionPrompt: string
  responses: StudentResponseForEval[]
  activeGoals: MonitoringGoal[]
}): Promise<BatchedGoalEvaluationResult[]> {
  if (input.activeGoals.length === 0 || input.responses.length === 0) {
    return []
  }

  const systemPrompt = `You are an objective, non-evaluative pedagogical reasoning observer in MeshQuiz.
Your task is to evaluate student responses against active teacher monitoring goals.

CRITICAL INSTRUCTIONS:
1. Do NOT judge correctness, award marks, or grade students.
2. Evaluate whether each response provides evidence for each active goal.
3. For relational goals like "Confidence and reasoning variation", consider the relationship between expressed self-reported confidence (1-5) and contrasting reasoning patterns across the whole set of responses.
4. Allowed match values: "match", "no_match", "unclear". Assign "match" ONLY if clear evidence exists in the response.
5. Return strict JSON matching the schema:
{
  "evaluations": [
    {
      "goal_id": "<goal_id_or_candidate_key>",
      "response_evaluations": [
        {
          "response_id": "<response_id>",
          "match": "match" | "no_match" | "unclear",
          "evidence": "<short non-evaluative explanation of evidence if match>"
        }
      ]
    }
  ]
}`

  const userPrompt = `QUESTION PROMPT:
${input.questionPrompt}

ACTIVE MONITORING GOALS:
${input.activeGoals
  .map(
    (g) => `Goal ID: ${g.id} (key: ${g.candidateKey})
Title: ${g.title}
Description: ${g.description}`
  )
  .join('\n\n')}

STUDENT RESPONSES TO EVALUATE:
${input.responses
  .map(
    (r) => `Response ID: ${r.response_id}
Confidence: ${r.confidence}/5
Cluster: ${r.cluster_id}
Answer text: ${r.answer}`
  )
  .join('\n\n')}

Evaluate all active monitoring goals for each student response and output the JSON object.`

  const result = await openaiChatJson({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  if (!result.ok || !result.json?.evaluations) {
    console.warn('[bounded-agency] Batched monitoring evaluation failed or returned invalid format', result)
    return []
  }

  return result.json.evaluations as BatchedGoalEvaluationResult[]
}

export async function evaluateBoundedAgentObservations(input: {
  sessionId: string
  questionId: string
  questionPrompt: string
  analysis: LiveQuestionClusterAnalysis
  teacherId?: string
}): Promise<BoundedAgentObservation[]> {
  const observations: BoundedAgentObservation[] = []
  const { sessionId, questionId, analysis, teacherId = 'default_teacher' } = input

  if (!analysis?.clusters || analysis.clusters.length === 0) {
    return observations
  }

  // 0. Fetch active teacher-authored monitoring goals and session annotations
  const [activeGoals, currentAnnotations] = await Promise.all([
    getActiveMonitoringGoalsForBoundedAgent(teacherId),
    getLecturerAnnotationsForSession(sessionId),
  ])

  const annotatedClusterIds = new Set(
    currentAnnotations
      .filter((ann) => ['pinned', 'annotated', 'inspected', 'selected_for_discussion'].includes(ann.action_type))
      .map((ann) => ann.cluster_id)
  )

  const isQuestionAnnotated = currentAnnotations.some((ann) => ann.question_id === questionId)

  // 1. Run independent longitudinal comparison on completed current clusters
  const longitudinalMatches = await compareCurrentPatternsWithHistory({
    sessionId,
    questionId,
    clusters: analysis.clusters,
    totalResponses: analysis.total_responses,
  })

  const surfacedClusterIds = new Set<string>()

  // 2. Evaluate RULE 0 (Goal-Conditioned Autonomous Surfacing): ONE batched LLM evaluation call per question/cycle
  if (activeGoals.length > 0) {
    const studentResponses = await getResponsesForEvaluation(sessionId, questionId, analysis.clusters)

    if (studentResponses.length > 0) {
      const batchedEvaluations = await evaluateBatchedMonitoringGoals({
        questionPrompt: input.questionPrompt,
        responses: studentResponses,
        activeGoals,
      })

      for (const goal of activeGoals) {
        const goalEval = batchedEvaluations.find(
          (e) => e.goal_id === goal.id || e.goal_id === goal.candidateKey
        )
        if (!goalEval) continue

        // Strictly count 'match' responses ONLY. 'unclear' is NOT included in numerator.
        const matchedEvals = (goalEval.response_evaluations || []).filter((r) => r.match === 'match')
        const matchedResponseIds = Array.from(new Set(matchedEvals.map((r) => r.response_id)))
        const matchedCount = matchedResponseIds.length
        const totalResponses = analysis.total_responses || studentResponses.length

        // Local TypeScript prevalence calculation
        const goalPrevalence = totalResponses > 0 ? Math.round((matchedCount / totalResponses) * 100) : 0
        const threshold = 30

        if (matchedCount > 0 && goalPrevalence >= threshold) {
          const matchingClusters = analysis.clusters.filter((c) =>
            c.response_ids?.some((id) => matchedResponseIds.includes(id))
          )
          const primaryCluster = matchingClusters.length > 0
            ? matchingClusters.reduce((max, c) => (c.count > max.count ? c : max), matchingClusters[0])
            : analysis.clusters[0]

          surfacedClusterIds.add(primaryCluster.cluster_id)

          let findingTitle = `Monitored Reasoning Dimension Observed: ${goal.title}`
          let descriptionText = `${goalPrevalence}% of current responses (${matchedCount} of ${totalResponses} students) exhibit evidence matching "${goal.title}".`

          if (goal.candidateKey === 'explanation_depth') {
            findingTitle = `Bare outcomes stated without explaining underlying conceptual mechanisms`
            descriptionText = `${goalPrevalence}% of responses (${matchedCount} of ${totalResponses} students) state conclusions without articulating step-by-step mechanisms.`
          } else if (goal.candidateKey === 'examples_vs_principles') {
            findingTitle = `Reasoning relies primarily on specific arithmetic examples rather than general principles`
            descriptionText = `${goalPrevalence}% of responses (${matchedCount} of ${totalResponses} students) evaluate specific numeric instances rather than stating general invariants.`
          } else if (goal.candidateKey === 'confidence_and_reasoning_variation') {
            findingTitle = `High student confidence accompanies contrasting reasoning models`
            descriptionText = `${goalPrevalence}% of responses (${matchedCount} of ${totalResponses} students) express high confidence across distinct reasoning models.`
          }

          const isAnnotated = annotatedClusterIds.has(primaryCluster.cluster_id) || isQuestionAnnotated
          const checkpointStatus: BoundedAgentObservation['humanCheckpointStatus'] = isAnnotated ? 'accepted' : 'pending'

          const obsId = `obs-goal-${goal.candidateKey}-${questionId}-${primaryCluster.cluster_id}`
          const decisionRule = `TRANSPARENT_RULE: MONITORING_GOAL_MATCHED ("${goal.title}", Prevalence ${goalPrevalence}% >= 30%)`
          const actionTakenText = `Surfaced goal-conditioned observation to teacher checkpoint: ${goalPrevalence}% of responses match monitored goal "${goal.title}"`

          const supportingQuotes = matchedEvals
            .filter((r) => r.evidence)
            .map((r) => {
              const studentResp = studentResponses.find((sr) => sr.response_id === r.response_id)
              return {
                response_id: r.response_id,
                exact_quote: r.evidence,
                confidence: studentResp?.confidence,
              }
            })

          const obs: BoundedAgentObservation = {
            observationId: obsId,
            sessionId,
            questionId,
            type: 'goal_conditioned_focus',
            triggerType: 'active_monitoring_goal_match',
            decisionRuleExecuted: decisionRule,
            actionTaken: actionTakenText,
            humanCheckpointStatus: checkpointStatus,
            title: findingTitle,
            description: descriptionText,
            clusterId: primaryCluster.cluster_id,
            prevalencePercentage: goalPrevalence,
            goalId: goal.id,
            candidateKey: goal.candidateKey,
            monitoringGoal: {
              id: goal.id,
              title: goal.title,
              description: goal.description,
            },
            triggerDetails: {
              goalTitle: goal.title,
              candidateKey: goal.candidateKey,
              prevalence: goalPrevalence,
              thresholdPercentage: 30,
              clusterLabel: sanitizeNonEvaluativeText(primaryCluster.label).sanitized,
            },
            supportingClusters: matchingClusters.map((c) => ({
              clusterId: c.cluster_id,
              label: sanitizeNonEvaluativeText(c.label).sanitized,
              summary: c.summary ? sanitizeNonEvaluativeText(c.summary).sanitized : undefined,
              count: c.count,
              percentage: analysis.total_responses > 0 ? Math.round((c.count / analysis.total_responses) * 100) : 0,
              averageConfidence: c.average_confidence,
              evidenceQuotes: c.evidence_spans || [],
            })),
            evidenceResponseIds: matchedResponseIds,
            evidenceQuotes: supportingQuotes.length > 0 ? supportingQuotes : (primaryCluster.evidence_spans || []),
            timestamp: new Date().toISOString(),
          }
          observations.push(obs)

          await logAgentAction({
            sessionId,
            questionId,
            agentRole: 'classroom_reasoning_observer',
            triggerType: 'active_monitoring_goal_match',
            observationData: {
              goalId: goal.id,
              candidateKey: goal.candidateKey,
              goalTitle: goal.title,
              clusterId: primaryCluster.cluster_id,
              prevalence: goalPrevalence,
              threshold: 30,
              clusterLabel: primaryCluster.label,
              matchedResponseCount: matchedCount,
            },
            decisionRuleExecuted: decisionRule,
            actionTaken: actionTakenText,
            humanCheckpointStatus: checkpointStatus,
          })
        }
      }
    }
  }

  // 3. Evaluate Rule 1 & 2: Longitudinal Adaptation & Prevalence Shifts per cluster
  for (const cluster of analysis.clusters) {
    const prevalence = analysis.total_responses > 0
      ? Math.round((cluster.count / analysis.total_responses) * 100)
      : 0

    const isAnnotated = annotatedClusterIds.has(cluster.cluster_id)
    const defaultStatus: BoundedAgentObservation['humanCheckpointStatus'] = isAnnotated ? 'accepted' : 'pending'
    const match = longitudinalMatches.find((m) => m.clusterId === cluster.cluster_id)

    // RULE 1: Prior Lecturer Action Reappeared
    if (match?.hasMatch && match.matchType === 'previously_discussed') {
      surfacedClusterIds.add(cluster.cluster_id)
      const obsId = `obs-prior-focus-${questionId}-${cluster.cluster_id}`
      const decisionRule = 'ADAPTIVE_TRIGGER: PRIOR_LECTURER_FOCUS_REAPPEARED'
      const desc = match.descriptiveNote || `A similar reasoning pattern was previously observed and selected by the lecturer for discussion.`
      const actionTakenText = `Surfaced observation: ${desc}`

      const obs: BoundedAgentObservation = {
        observationId: obsId,
        sessionId,
        questionId,
        type: 'prior_discussion_focus',
        triggerType: 'longitudinal_lecturer_focus_match',
        decisionRuleExecuted: decisionRule,
        actionTaken: actionTakenText,
        humanCheckpointStatus: defaultStatus,
        title: `Prior Lecturer Discussion Focus Reappeared`,
        description: desc,
        clusterId: cluster.cluster_id,
        prevalencePercentage: prevalence,
        priorSessionId: match.priorSessionId,
        supportingClusters: [
          {
            clusterId: cluster.cluster_id,
            label: sanitizeNonEvaluativeText(cluster.label).sanitized,
            summary: cluster.summary ? sanitizeNonEvaluativeText(cluster.summary).sanitized : undefined,
            count: cluster.count,
            percentage: prevalence,
            averageConfidence: cluster.average_confidence,
            evidenceQuotes: cluster.evidence_spans || [],
          },
        ],
        longitudinalDetails: {
          priorSessionId: match.priorSessionId,
          priorSessionCode: match.priorSessionCode,
          priorSessionDate: match.priorSessionDate,
          priorTopicDomain: match.priorTopicDomain,
          priorQuestionId: match.priorQuestionId,
          priorPatternLabel: match.priorPatternLabel,
          priorPrevalence: match.priorPrevalence,
          currentPrevalence: prevalence,
          prevalenceDelta: match.prevalenceDelta,
          priorLecturerAction: match.priorLecturerAction || 'Selected for discussion',
          descriptiveNote: match.descriptiveNote,
        },
        evidenceResponseIds: cluster.response_ids || [],
        evidenceQuotes: cluster.evidence_spans || [],
        timestamp: new Date().toISOString(),
      }
      observations.push(obs)

      await logAgentAction({
        sessionId,
        questionId,
        agentRole: 'classroom_reasoning_observer',
        triggerType: 'longitudinal_lecturer_focus_match',
        observationData: {
          clusterId: cluster.cluster_id,
          clusterLabel: sanitizeNonEvaluativeText(cluster.label).sanitized,
          patternLabel: match.priorPatternLabel ? sanitizeNonEvaluativeText(match.priorPatternLabel).sanitized : sanitizeNonEvaluativeText(cluster.label).sanitized,
          currentPrevalence: prevalence,
          priorSessionId: match.priorSessionId,
          priorLecturerAction: match.priorLecturerAction,
        },
        decisionRuleExecuted: decisionRule,
        actionTaken: actionTakenText,
        humanCheckpointStatus: defaultStatus,
      })
      continue
    }

    // RULE 2: Significant Prevalence Shift across sessions
    if (match?.hasMatch && match.matchType === 'prevalence_shift') {
      surfacedClusterIds.add(cluster.cluster_id)
      const obsId = `obs-shift-${questionId}-${cluster.cluster_id}`
      const decisionRule = 'LONGITUDINAL_PREVALENCE_SHIFT (>=15% delta)'
      const desc = match.descriptiveNote || `The proportion of responses exhibiting a similar reasoning pattern shifted across sessions.`
      const actionTakenText = `Surfaced prevalence shift: ${desc}`

      const obs: BoundedAgentObservation = {
        observationId: obsId,
        sessionId,
        questionId,
        type: 'prevalence_shift',
        triggerType: 'longitudinal_prevalence_shift',
        decisionRuleExecuted: decisionRule,
        actionTaken: actionTakenText,
        humanCheckpointStatus: defaultStatus,
        title: `Pattern Prevalence Shift Across Sessions`,
        description: desc,
        clusterId: cluster.cluster_id,
        prevalencePercentage: prevalence,
        priorSessionId: match.priorSessionId,
        supportingClusters: [
          {
            clusterId: cluster.cluster_id,
            label: sanitizeNonEvaluativeText(cluster.label).sanitized,
            summary: cluster.summary ? sanitizeNonEvaluativeText(cluster.summary).sanitized : undefined,
            count: cluster.count,
            percentage: prevalence,
            averageConfidence: cluster.average_confidence,
            evidenceQuotes: cluster.evidence_spans || [],
          },
        ],
        longitudinalDetails: {
          priorSessionId: match.priorSessionId,
          priorSessionCode: match.priorSessionCode,
          priorSessionDate: match.priorSessionDate,
          priorTopicDomain: match.priorTopicDomain,
          priorQuestionId: match.priorQuestionId,
          priorPatternLabel: match.priorPatternLabel,
          priorPrevalence: match.priorPrevalence,
          currentPrevalence: prevalence,
          prevalenceDelta: match.prevalenceDelta,
          priorLecturerAction: match.priorLecturerAction,
          descriptiveNote: match.descriptiveNote,
        },
        evidenceResponseIds: cluster.response_ids || [],
        evidenceQuotes: cluster.evidence_spans || [],
        timestamp: new Date().toISOString(),
      }
      observations.push(obs)

      await logAgentAction({
        sessionId,
        questionId,
        agentRole: 'classroom_reasoning_observer',
        triggerType: 'longitudinal_prevalence_shift',
        observationData: {
          clusterId: cluster.cluster_id,
          clusterLabel: sanitizeNonEvaluativeText(cluster.label).sanitized,
          patternLabel: match.priorPatternLabel ? sanitizeNonEvaluativeText(match.priorPatternLabel).sanitized : sanitizeNonEvaluativeText(cluster.label).sanitized,
          currentPrevalence: prevalence,
          priorPrevalence: match.priorPrevalence,
          prevalenceDelta: match.prevalenceDelta,
        },
        decisionRuleExecuted: decisionRule,
        actionTaken: actionTakenText,
        humanCheckpointStatus: defaultStatus,
      })
      continue
    }
  }

  return observations
}
