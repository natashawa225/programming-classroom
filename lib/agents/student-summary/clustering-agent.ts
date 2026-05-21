import { createAdminClient } from '@/lib/supabase/server'
import type { AttemptType } from '@/lib/types/database'
import type { ParsedCluster } from './types'

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function stringList(value: unknown) {
  return asArray(value)
    .map((entry) => (typeof entry === 'string' ? entry.trim() : null))
    .filter(Boolean) as string[]
}

export function parseLiveAnalysisClusters(analysisJson: Record<string, unknown> | null | undefined): ParsedCluster[] {
  const clusters = asArray(analysisJson?.clusters)
  return clusters.map((rawCluster, index) => {
    const cluster = (rawCluster && typeof rawCluster === 'object' ? rawCluster : {}) as Record<string, unknown>
    const members = asArray(cluster.responses)
      .concat(asArray(cluster.members))
      .map((member) => (member && typeof member === 'object' ? member as Record<string, unknown> : null))
      .filter(Boolean) as Record<string, unknown>[]

    const responseIds = Array.from(new Set([
      ...stringList(cluster.response_ids),
      ...stringList(cluster.student_ids),
      ...members
        .map((member) => asString(member.response_id) || asString(member.id))
        .filter(Boolean),
    ])) as string[]

    return {
      clusterId:
        asString(cluster.cluster_id) ||
        asString(cluster.id) ||
        `cluster_${index + 1}`,
      label:
        asString(cluster.label) ||
        asString(cluster.cluster_label) ||
        asString(cluster.title),
      summary: asString(cluster.summary),
      misconceptionType: asString(cluster.misconception_type),
      conceptualAlignment: asNumber(cluster.conceptual_alignment),
      understandingBucket: asString(cluster.understanding_bucket) as ParsedCluster['understandingBucket'],
      averageConfidence: asNumber(cluster.average_confidence),
      teacherNote: asString(cluster.teacher_note),
      studentSafeSummary: asString(cluster.student_safe_summary),
      representativeAnswers: stringList(cluster.representative_answers).slice(0, 4),
      responseIds,
      raw: cluster,
    }
  })
}

export async function syncStudentClusterMembershipsForQuestion(input: {
  sessionId: string
  questionId: string
  attemptType: AttemptType
}) {
  const supabase = createAdminClient()
  const warnings: string[] = []

  const { data: analysis, error: analysisError } = await supabase
    .from('live_question_analyses')
    .select('analysis_json')
    .eq('session_id', input.sessionId)
    .eq('question_id', input.questionId)
    .eq('attempt_type', input.attemptType)
    .maybeSingle()

  if (analysisError) throw analysisError
  if (!analysis?.analysis_json) {
    return { upserted: 0, clusters: [] as ParsedCluster[], warnings: [`No live clustering analysis found for ${input.questionId} ${input.attemptType}.`] }
  }

  const clusters = parseLiveAnalysisClusters(analysis.analysis_json as Record<string, unknown>)
  const responseIds = Array.from(new Set(clusters.flatMap((cluster) => cluster.responseIds)))
  if (responseIds.length === 0) {
    return { upserted: 0, clusters, warnings: [`No response_ids found in clustering analysis for ${input.questionId} ${input.attemptType}.`] }
  }

  const { data: responses, error: responsesError } = await supabase
    .from('responses')
    .select('response_id, session_id, question_id, attempt_type, confidence, session_participants:session_participant_id (participant_id)')
    .in('response_id', responseIds)

  if (responsesError) throw responsesError

  const responseMap = new Map((responses || []).map((response: any) => [response.response_id as string, response]))
  const rows = clusters.flatMap((cluster) => {
    return cluster.responseIds.flatMap((responseId) => {
      const response = responseMap.get(responseId)
      const joined = Array.isArray(response?.session_participants)
        ? response.session_participants[0]
        : response?.session_participants
      const participantId = joined?.participant_id
      if (!participantId) {
        warnings.push(`Could not map response ${responseId} to a participant.`)
        return []
      }

      return [{
        session_id: input.sessionId,
        question_id: input.questionId,
        participant_id: participantId,
        response_id: responseId,
        attempt_type: input.attemptType,
        cluster_id: cluster.clusterId,
        cluster_label: cluster.label,
        conceptual_alignment: cluster.conceptualAlignment,
        understanding_bucket: cluster.understandingBucket,
        confidence: response?.confidence ?? null,
      }]
    })
  })

  if (rows.length === 0) return { upserted: 0, clusters, warnings }

  const { error: upsertError } = await supabase
    .from('student_cluster_memberships')
    .upsert(rows, { onConflict: 'session_id,question_id,participant_id,attempt_type' })

  if (upsertError) throw upsertError
  return { upserted: rows.length, clusters, warnings }
}
