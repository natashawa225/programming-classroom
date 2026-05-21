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

    for (const cluster of sync.clusters) {
      try {
        const result = await generateClusterFeedbackCard({
          sessionId,
          questionId: analysis.question_id,
          attemptType,
          questionText: question.prompt,
          correctAnswer: question.correct_answer,
          cluster,
        })
        if (result.created) cardsCreated += 1
        if (result.fallbackUsed) fallbackCardsUsed += 1
        if (result.created && result.fallbackUsed) fallbackCardsCreated += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown cluster feedback error'
        errors.push(`Feedback generation failed for ${analysis.question_id}/${cluster.clusterId}: ${message}`)
        warnings.push(`Fallback feedback was needed for ${cluster.label || cluster.clusterId}.`)
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

  for (const participant of participants || []) {
    if (!participant.participant_id) continue
    try {
      const result = await getOrCreateStudentSummary({
        sessionId,
        participantId: participant.participant_id,
      })
      if (result.created) summariesCreated += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown student summary error'
      errors.push(`Summary failed for participant ${participant.participant_id}: ${message}`)
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
    memberships_upserted: membershipsUpserted,
    cluster_feedback_cards_created: cardsCreated,
    summaries_created: summariesCreated,
    fallback_cards_created: fallbackCardsCreated,
    warnings,
    errors,
  }
}
