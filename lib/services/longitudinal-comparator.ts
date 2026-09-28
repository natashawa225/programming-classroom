import { createAdminClient } from '@/lib/supabase/server'
import type { LiveCluster } from '@/lib/ai/live-question-clustering'
import type { LecturerAnnotation, PatternHistory } from '@/lib/types/database'

export type LongitudinalComparisonResult = {
  clusterId: string
  currentPrevalence: number
  hasMatch: boolean
  matchType?: 'potential_recurrence' | 'prevalence_shift' | 'previously_discussed'
  priorSessionId?: string
  priorPrevalence?: number
  priorLecturerAction?: string | null
  descriptiveNote?: string
}

function computeWordOverlapSimilarity(strA: string, strB: string): number {
  const normA = new Set(strA.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean))
  const normB = new Set(strB.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean))

  if (normA.size === 0 || normB.size === 0) return 0

  let intersection = 0
  for (const word of normA) {
    if (normB.has(word)) intersection += 1
  }

  const union = new Set([...normA, ...normB]).size
  return union > 0 ? intersection / union : 0
}

export async function compareCurrentPatternsWithHistory(input: {
  sessionId: string
  questionId: string
  clusters: LiveCluster[]
  totalResponses: number
}): Promise<LongitudinalComparisonResult[]> {
  const results: LongitudinalComparisonResult[] = []
  const { sessionId, questionId, clusters, totalResponses } = input

  if (!clusters || clusters.length === 0) return results

  try {
    const supabase = createAdminClient()

    // 1. Fetch prior pattern history (excluding current session)
    const { data: priorPatternsData } = await supabase
      .from('pattern_history')
      .select('*')
      .neq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(50)

    // 2. Fetch prior lecturer annotations for those sessions
    const { data: priorAnnotationsData } = await supabase
      .from('lecturer_annotations')
      .select('*')
      .neq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(50)

    const priorPatterns = (priorPatternsData || []) as PatternHistory[]
    const priorAnnotations = (priorAnnotationsData || []) as LecturerAnnotation[]

    for (const cluster of clusters) {
      const currentPrevalence = totalResponses > 0
        ? Math.round((cluster.count / totalResponses) * 100)
        : 0

      let bestMatch: PatternHistory | null = null
      let highestSimilarity = 0

      for (const prior of priorPatterns) {
        const sim = computeWordOverlapSimilarity(cluster.label, prior.pattern_label)
        if (sim > highestSimilarity && sim >= 0.35) {
          highestSimilarity = sim
          bestMatch = prior
        }
      }

      if (bestMatch) {
        // Find if lecturer previously acted on this matched pattern in the prior session/question
        const lecturerAction = priorAnnotations.find(
          (ann) =>
            ann.session_id === bestMatch!.session_id &&
            ann.question_id === bestMatch!.question_id &&
            ['selected_for_discussion', 'pinned', 'monitored', 'annotated'].includes(ann.action_type)
        )

        const priorPrevalence = Number(bestMatch.prevalence_percentage) || 0
        let matchType: LongitudinalComparisonResult['matchType'] = 'potential_recurrence'
        let note = `A similar reasoning pattern ("${bestMatch.pattern_label}") was observed in a previous session (${priorPrevalence}% prevalence).`

        if (lecturerAction && ['selected_for_discussion', 'pinned', 'monitored'].includes(lecturerAction.action_type)) {
          matchType = 'previously_discussed'
          note = `A similar reasoning pattern was previously observed in a prior session and selected by the lecturer for discussion.`
        } else if (Math.abs(currentPrevalence - priorPrevalence) >= 15) {
          matchType = 'prevalence_shift'
          note = `The proportion of responses exhibiting a similar reasoning pattern shifted from ${priorPrevalence}% in a prior session to ${currentPrevalence}% in the current session.`
        }

        results.push({
          clusterId: cluster.cluster_id,
          currentPrevalence,
          hasMatch: true,
          matchType,
          priorSessionId: bestMatch.session_id,
          priorPrevalence,
          priorLecturerAction: lecturerAction?.action_type || null,
          descriptiveNote: note,
        })
      } else {
        results.push({
          clusterId: cluster.cluster_id,
          currentPrevalence,
          hasMatch: false,
        })
      }
    }

    return results
  } catch (err) {
    console.error('[longitudinal-comparator] error comparing patterns', err)
    return clusters.map((cluster) => ({
      clusterId: cluster.cluster_id,
      currentPrevalence: totalResponses > 0 ? Math.round((cluster.count / totalResponses) * 100) : 0,
      hasMatch: false,
    }))
  }
}
