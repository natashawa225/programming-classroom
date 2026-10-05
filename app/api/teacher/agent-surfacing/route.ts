import { NextRequest, NextResponse } from 'next/server'
import { getTeacherSession } from '@/lib/teacher-auth'
import { getAgentActionsForSession } from '@/lib/services/pattern-memory-service'
import type { BoundedAgentObservation } from '@/lib/services/bounded-agency-service'

const OBSERVATION_TRIGGER_TYPES = new Set([
  'active_monitoring_goal_match',
  'longitudinal_lecturer_focus_match',
  'longitudinal_prevalence_shift',
])

export async function POST(request: NextRequest) {
  try {
    const teacherSession = await getTeacherSession()
    if (!teacherSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const sessionId = String(body?.sessionId || '').trim()
    const questionId = String(body?.questionId || '').trim()

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const actions = await getAgentActionsForSession(sessionId)

    const filteredActions = actions.filter((action) => {
      if (!OBSERVATION_TRIGGER_TYPES.has(action.trigger_type)) return false
      if (questionId && action.question_id && action.question_id !== questionId) return false
      return true
    })

    const observations: BoundedAgentObservation[] = filteredActions.map((action) => {
      const data = (action.observation_data || {}) as Record<string, any>
      if (data.observationId) {
        return {
          ...data,
          humanCheckpointStatus: action.human_checkpoint_status || data.humanCheckpointStatus || 'pending',
          timestamp: action.created_at || data.timestamp,
        } as BoundedAgentObservation
      }

      return {
        observationId: data.observationId || `obs-${action.action_id}`,
        sessionId: action.session_id,
        questionId: action.question_id || questionId || '',
        type:
          data.type ||
          (action.trigger_type === 'active_monitoring_goal_match'
            ? 'goal_conditioned_focus'
            : action.trigger_type === 'longitudinal_lecturer_focus_match'
            ? 'prior_discussion_focus'
            : 'prevalence_shift'),
        triggerType: action.trigger_type,
        decisionRuleExecuted: action.decision_rule_executed,
        actionTaken: action.action_taken,
        humanCheckpointStatus: action.human_checkpoint_status || 'pending',
        title: String(data.title || data.goalTitle || 'Observed Reasoning Pattern'),
        description: String(data.description || action.action_taken),
        clusterId: String(data.clusterId || ''),
        prevalencePercentage: Number(data.prevalencePercentage || data.prevalence || 0),
        evidenceResponseIds: Array.isArray(data.evidenceResponseIds) ? data.evidenceResponseIds : [],
        evidenceQuotes: Array.isArray(data.evidenceQuotes) ? data.evidenceQuotes : [],
        timestamp: action.created_at,
      } as BoundedAgentObservation
    })

    return NextResponse.json({ observations })
  } catch (error) {
    console.error('[agent-surfacing-api] error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to retrieve observations' },
      { status: 500 }
    )
  }
}
