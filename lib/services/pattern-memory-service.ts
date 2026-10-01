import { createAdminClient } from '@/lib/supabase/server'
import type { AgentAction, LecturerAnnotation, PatternHistory, SessionMemory } from '@/lib/types/database'
import { sanitizeNonEvaluativeText } from '@/lib/ai/cluster-guardrail'

export function generatePatternKey(label: string): string {
  const normalized = String(label || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return normalized || 'general-pattern'
}

export async function logAgentAction(input: {
  sessionId: string
  questionId?: string | null
  agentRole?: string
  triggerType: string
  observationData: Record<string, unknown>
  decisionRuleExecuted: string
  actionTaken: string
  humanCheckpointStatus?: 'pending' | 'accepted' | 'dismissed' | 'overridden'
}): Promise<AgentAction | null> {
  const maxRetries = 3
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const supabase = createAdminClient()
      const { data, error } = await supabase
        .from('agent_actions')
        .insert({
          session_id: input.sessionId,
          question_id: input.questionId ?? null,
          agent_role: input.agentRole || 'classroom_reasoning_observer',
          trigger_type: input.triggerType,
          observation_data: input.observationData,
          decision_rule_executed: input.decisionRuleExecuted,
          action_taken: input.actionTaken,
          human_checkpoint_status: input.humanCheckpointStatus || 'pending',
        })
        .select()
        .single()

      if (error) {
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 200 * attempt))
          continue
        }
        console.error('[pattern-memory-service] logAgentAction error', error)
        return null
      }

      return data as AgentAction
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt))
        continue
      }
      console.error('[pattern-memory-service] logAgentAction exception', err)
      return null
    }
  }
  return null
}

export async function saveLecturerAnnotation(input: {
  sessionId: string
  questionId: string
  clusterId: string
  actionType: LecturerAnnotation['action_type']
  lecturerInterpretation?: string | null
  lecturerDecision?: string | null
  customLabel?: string | null
}): Promise<LecturerAnnotation | null> {
  const maxRetries = 3
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const supabase = createAdminClient()
      const { data, error } = await supabase
        .from('lecturer_annotations')
        .insert({
          session_id: input.sessionId,
          question_id: input.questionId,
          cluster_id: input.clusterId,
          action_type: input.actionType,
          lecturer_interpretation: input.lecturerInterpretation ? sanitizeNonEvaluativeText(input.lecturerInterpretation).sanitized : null,
          lecturer_decision: input.lecturerDecision ? sanitizeNonEvaluativeText(input.lecturerDecision).sanitized : null,
          custom_label: input.customLabel ? sanitizeNonEvaluativeText(input.customLabel).sanitized : null,
        })
        .select()
        .single()

      if (error) {
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 200 * attempt))
          continue
        }
        console.error('[pattern-memory-service] saveLecturerAnnotation error', error)
        return null
      }

      // Log the corresponding human interaction step in agent_actions
      await logAgentAction({
        sessionId: input.sessionId,
        questionId: input.questionId,
        triggerType: 'lecturer_interaction',
        observationData: { clusterId: input.clusterId, actionType: input.actionType },
        decisionRuleExecuted: 'RECORD_HUMAN_INTERPRETATION',
        actionTaken: `Recorded lecturer action '${input.actionType}' for cluster ${input.clusterId}`,
        humanCheckpointStatus: 'accepted',
      })

      return data as LecturerAnnotation
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt))
        continue
      }
      console.error('[pattern-memory-service] saveLecturerAnnotation exception', err)
      return null
    }
  }
  return null
}

export async function getPriorSessionPatternsForQuestion(
  sessionId: string,
  questionPrompt: string
): Promise<PatternHistory[]> {
  try {
    const supabase = createAdminClient()

    // Find previous sessions (excluding current)
    const { data: previousPatterns, error } = await supabase
      .from('pattern_history')
      .select('*')
      .neq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error || !previousPatterns) return []

    return previousPatterns as PatternHistory[]
  } catch (err) {
    console.error('[pattern-memory-service] getPriorSessionPatternsForQuestion exception', err)
    return []
  }
}

export async function getLecturerAnnotationsForSession(sessionId: string): Promise<LecturerAnnotation[]> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('lecturer_annotations')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })

    if (error || !data) return []
    return data as LecturerAnnotation[]
  } catch (err) {
    console.error('[pattern-memory-service] getLecturerAnnotationsForSession exception', err)
    return []
  }
}

export async function getAgentActionsForSession(sessionId: string): Promise<AgentAction[]> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('agent_actions')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })

    if (error || !data) return []
    return data as AgentAction[]
  } catch (err) {
    console.error('[pattern-memory-service] getAgentActionsForSession exception', err)
    return []
  }
}

export async function getSessionMemory(sessionId: string): Promise<SessionMemory | null> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('session_memory')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle()

    if (error || !data) return null
    return data as SessionMemory
  } catch (err) {
    console.error('[pattern-memory-service] getSessionMemory exception', err)
    return null
  }
}

export async function getPatternHistoryForSession(sessionId: string): Promise<PatternHistory[]> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('pattern_history')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })

    if (error || !data) return []
    return data as PatternHistory[]
  } catch (err) {
    console.error('[pattern-memory-service] getPatternHistoryForSession exception', err)
    return []
  }
}


export async function saveSessionMemoryBridge(input: {
  sessionId: string
  summaryNarrative: string
  watchlistItems: SessionMemory['watchlist_items']
  patterns: Array<{
    questionId: string
    patternLabel: string
    patternDescription: string
    prevalencePercentage: number
    responseCount: number
    averageConfidence: number | null
    representativeResponseIds: string[]
    evidenceQuotes: Array<{ response_id: string; exact_quote: string }>
  }>
}): Promise<SessionMemory | null> {
  try {
    const supabase = createAdminClient()

    // 1. Upsert session memory record
    const { data: memoryRecord, error: memoryError } = await supabase
      .from('session_memory')
      .upsert(
        {
          session_id: input.sessionId,
          summary_narrative: sanitizeNonEvaluativeText(input.summaryNarrative).sanitized,
          watchlist_items: input.watchlistItems,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'session_id' }
      )
      .select()
      .single()

    if (memoryError || !memoryRecord) {
      console.error('[pattern-memory-service] saveSessionMemoryBridge memory insert error', memoryError)
      return null
    }

    // 2. Save individual patterns to pattern_history
    for (const pattern of input.patterns) {
      const patternKey = generatePatternKey(pattern.patternLabel)

      // Check if this pattern key was seen in prior sessions
      const { data: priorMatches } = await supabase
        .from('pattern_history')
        .select('session_id')
        .eq('pattern_key', patternKey)
        .neq('session_id', input.sessionId)
        .limit(1)

      const longitudinalStatus =
        priorMatches && priorMatches.length > 0 ? 'reappeared' : 'observed'

      await supabase.from('pattern_history').insert({
        memory_id: memoryRecord.memory_id,
        session_id: input.sessionId,
        question_id: pattern.questionId,
        pattern_key: patternKey,
        pattern_label: sanitizeNonEvaluativeText(pattern.patternLabel).sanitized,
        pattern_description: sanitizeNonEvaluativeText(pattern.patternDescription).sanitized,
        prevalence_percentage: pattern.prevalencePercentage,
        response_count: pattern.responseCount,
        average_confidence: pattern.averageConfidence,
        representative_response_ids: pattern.representativeResponseIds,
        evidence_quotes: pattern.evidenceQuotes,
        longitudinal_status: longitudinalStatus,
      })
    }

    return memoryRecord as SessionMemory
  } catch (err) {
    console.error('[pattern-memory-service] saveSessionMemoryBridge exception', err)
    return null
  }
}
