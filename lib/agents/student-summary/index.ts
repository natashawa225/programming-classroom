// Local TypeScript orchestrator for student summaries.
// TODO: A LangGraph supervisor can later replace this coordinator while keeping
// the same agent boundaries: clustering -> feedback -> memory -> improvement -> synthesis.
import { createAdminClient } from '@/lib/supabase/server'
import type { AttemptType } from '@/lib/types/database'
import { generateClusterFeedbackCard } from './cluster-feedback-agent'
import { syncStudentClusterMembershipsForQuestion } from './clustering-agent'
import { updateMisconceptionMemoryFromSession } from './misconception-memory-agent'
import { getOrCreateStudentSummary } from './synthesis-agent'
import type { GenerateStudentSummariesResult } from './types'
import { formatAgentError, runWithConcurrency } from './reliability'

export { syncStudentClusterMembershipsForQuestion } from './clustering-agent'
export { generateClusterFeedbackCard } from './cluster-feedback-agent'
export { updateMisconceptionMemoryFromSession } from './misconception-memory-agent'
export { computeStudentImprovement } from './improvement-agent'
export { getOrCreateStudentSummary } from './synthesis-agent'

export async function generateStudentSummariesForSession(sessionId: string): Promise<GenerateStudentSummariesResult> {
  const supabase = createAdminClient()
  const warnings: string[] = []
  const errors: string[] = []
  let membershipsUpserted = 0
  let cardsCreated = 0
  let fallbackCardsCreated = 0
  let fallbackCardsUsed = 0
  let summariesCreated = 0

  const [{ data: questions, error: questionsError }, { data: analyses, error: analysesError }] = await Promise.all([
    supabase
      .from('session_questions')
      .select('question_id, position, prompt, correct_answer')
      .eq('session_id', sessionId)
      .order('position', { ascending: true }),
    supabase
      .from('live_question_analyses')
      .select('*')
      .eq('session_id', sessionId),
  ])

  if (questionsError) throw questionsError
  if (analysesError) throw analysesError
  if (!analyses || analyses.length === 0) {
    warnings.push('Cluster feedback is not available yet because analysis has not been generated for this session.')
  }

  for (const analysis of analyses || []) {
    const question = (questions || []).find((entry: any) => entry.question_id === analysis.question_id)
    if (!question) {
      warnings.push(`Analysis references missing question ${analysis.question_id}.`)
      continue
    }
    const attemptType = analysis.attempt_type as AttemptType
    const sync = await syncStudentClusterMembershipsForQuestion({
      sessionId,
      questionId: analysis.question_id,
      attemptType,
    })
    membershipsUpserted += sync.upserted
    warnings.push(...sync.warnings)

    const clusterResults = await runWithConcurrency(sync.clusters, 2, async (cluster) => {
      const result = await generateClusterFeedbackCard({
        sessionId,
        questionId: analysis.question_id,
        attemptType,
        questionText: question.prompt,
        correctAnswer: question.correct_answer,
        cluster,
      })
      return { cluster, result }
    })

    for (const [index, settled] of clusterResults.entries()) {
      if (settled.status === 'fulfilled') {
        const { result } = settled.value
        if (result.created) cardsCreated += 1
        if (result.fallbackUsed) fallbackCardsUsed += 1
        if (result.created && result.fallbackUsed) fallbackCardsCreated += 1
      } else {
        const error = settled.reason
        const message = formatAgentError(error)
        console.error('[student-summary] cluster feedback generation failed', {
          sessionId,
          questionId: analysis.question_id,
          attemptType,
          clusterId: sync.clusters[index]?.clusterId,
          error,
          message,
        })
        errors.push(`Feedback generation failed for ${analysis.question_id}/${sync.clusters[index]?.clusterId || 'unknown_cluster'}: ${message}`)
        warnings.push('Some cluster feedback could not be generated and may be unavailable for student summaries.')
      }
    }
  }

  await updateMisconceptionMemoryFromSession(sessionId)

  const { data: participants, error: participantsError } = await supabase
    .from('session_participants')
    .select('participant_id')
    .eq('session_id', sessionId)
    .not('participant_id', 'is', null)

  if (participantsError) throw participantsError

  const participantRows = (participants || []).filter((participant: any) => participant.participant_id)
  const participantResults = await runWithConcurrency(participantRows, 2, async (participant: any) => {
    const result = await getOrCreateStudentSummary({
      sessionId,
      participantId: participant.participant_id,
    })
    return { participantId: participant.participant_id, result }
  })

  for (const [index, settled] of participantResults.entries()) {
    if (settled.status === 'fulfilled') {
      const { result } = settled.value
      if (result.created) summariesCreated += 1
    } else {
      const participantId = participantRows[index]?.participant_id || 'unknown'
      const message = formatAgentError(settled.reason)
      console.error('[student-summary] participant summary generation failed', {
        sessionId,
        participantId,
        error: settled.reason,
        message,
      })
      errors.push(`Summary failed for participant ${participantId}: ${message}`)
    }
  }

  const analysisStatus =
    fallbackCardsUsed > 0
      ? 'fallback'
      : warnings.length > 0 || errors.length > 0
        ? 'partial'
        : 'ok'

  return {
    ok: true,
    analysis_status: analysisStatus,
    source: fallbackCardsUsed > 0 ? 'mixed' : analysisStatus === 'fallback' ? 'fallback' : 'openai',
    memberships_upserted: membershipsUpserted,
    cluster_feedback_cards_created: cardsCreated,
    summaries_created: summariesCreated,
    fallback_cards_created: fallbackCardsCreated,
    fallback_warnings: warnings.filter((warning) => warning.toLowerCase().includes('fallback')),
    warnings,
    errors,
  }
}
