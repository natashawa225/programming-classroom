import { createAdminClient } from '@/lib/supabase/server'
import type { LiveQuestionClusterAnalysis } from '@/lib/ai/live-question-clustering'
import { compareCurrentPatternsWithHistory } from '@/lib/services/longitudinal-comparator'
import { logAgentAction } from '@/lib/services/pattern-memory-service'
import { sanitizeNonEvaluativeText } from '@/lib/ai/cluster-guardrail'

export type BoundedAgentObservation = {
  observationId: string
  sessionId: string
  questionId: string
  type: 'new_pattern' | 'recurring_pattern' | 'prevalence_shift' | 'prior_discussion_focus'
  title: string
  description: string
  clusterId: string
  prevalencePercentage: number
  priorSessionId?: string | null
  evidenceResponseIds: string[]
  evidenceQuotes: Array<{ response_id: string; exact_quote: string }>
  timestamp: string
}

export async function evaluateBoundedAgentObservations(input: {
  sessionId: string
  questionId: string
  questionPrompt: string
  analysis: LiveQuestionClusterAnalysis
}): Promise<BoundedAgentObservation[]> {
  const observations: BoundedAgentObservation[] = []
  const { sessionId, questionId, analysis } = input

  if (!analysis?.clusters || analysis.clusters.length === 0) {
    return observations
  }

  // 1. Run independent longitudinal comparison on completed current clusters
  const longitudinalMatches = await compareCurrentPatternsWithHistory({
    sessionId,
    questionId,
    clusters: analysis.clusters,
    totalResponses: analysis.total_responses,
  })

  // 2. Evaluate Bounded Agency Rules
  for (const cluster of analysis.clusters) {
    const prevalence = analysis.total_responses > 0
      ? Math.round((cluster.count / analysis.total_responses) * 100)
      : 0

    const match = longitudinalMatches.find((m) => m.clusterId === cluster.cluster_id)

    // RULE 1 (Adaptation Loop): Prior Lecturer Action Reappeared
    // This autonomous alert fires SPECIFICALLY because of a prior lecturer decision in Session N!
    if (match?.hasMatch && match.matchType === 'previously_discussed') {
      const obsId = `obs-prior-focus-${questionId}-${cluster.cluster_id}`
      const obs: BoundedAgentObservation = {
        observationId: obsId,
        sessionId,
        questionId,
        type: 'prior_discussion_focus',
        title: 'Prior Discussion Focus Observed',
        description: match.descriptiveNote || `A similar reasoning pattern was previously observed and selected by the lecturer for discussion.`,
        clusterId: cluster.cluster_id,
        prevalencePercentage: prevalence,
        priorSessionId: match.priorSessionId,
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
          currentPrevalence: prevalence,
          priorSessionId: match.priorSessionId,
          priorLecturerAction: match.priorLecturerAction,
        },
        decisionRuleExecuted: 'ADAPTIVE_TRIGGER: PRIOR_LECTURER_FOCUS_REAPPEARED',
        actionTaken: `Surfaced observation: ${obs.description}`,
        humanCheckpointStatus: 'pending',
      })
      continue
    }

    // RULE 2: Significant Prevalence Shift across sessions
    if (match?.hasMatch && match.matchType === 'prevalence_shift') {
      const obsId = `obs-shift-${questionId}-${cluster.cluster_id}`
      const obs: BoundedAgentObservation = {
        observationId: obsId,
        sessionId,
        questionId,
        type: 'prevalence_shift',
        title: 'Pattern Prevalence Shift',
        description: match.descriptiveNote || `The proportion of responses exhibiting a similar reasoning pattern shifted across sessions.`,
        clusterId: cluster.cluster_id,
        prevalencePercentage: prevalence,
        priorSessionId: match.priorSessionId,
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
          currentPrevalence: prevalence,
          priorPrevalence: match.priorPrevalence,
        },
        decisionRuleExecuted: 'LONGITUDINAL_PREVALENCE_SHIFT (>=15% delta)',
        actionTaken: `Surfaced prevalence shift: ${obs.description}`,
        humanCheckpointStatus: 'pending',
      })
      continue
    }

    // RULE 3: Emerging High Prevalence Pattern in Current Session
    if (prevalence >= 30) {
      const sanitized = sanitizeNonEvaluativeText(cluster.label).sanitized
      const obsId = `obs-emerging-${questionId}-${cluster.cluster_id}`
      const obs: BoundedAgentObservation = {
        observationId: obsId,
        sessionId,
        questionId,
        type: 'new_pattern',
        title: 'Prominent Reasoning Pattern Observed',
        description: `${prevalence}% of current responses share the reasoning pattern "${sanitized}".`,
        clusterId: cluster.cluster_id,
        prevalencePercentage: prevalence,
        evidenceResponseIds: cluster.response_ids || [],
        evidenceQuotes: cluster.evidence_spans || [],
        timestamp: new Date().toISOString(),
      }
      observations.push(obs)

      await logAgentAction({
        sessionId,
        questionId,
        agentRole: 'classroom_reasoning_observer',
        triggerType: 'stream_prevalence_threshold',
        observationData: { clusterId: cluster.cluster_id, prevalence },
        decisionRuleExecuted: 'PREVALENCE_THRESHOLD_EXCEEDED (>=30%)',
        actionTaken: `Surfaced prominent pattern: ${obs.description}`,
        humanCheckpointStatus: 'pending',
      })
    }
  }

  return observations
}
