import { createAdminClient } from '@/lib/supabase/server'
import type { StudentImprovementQuestion } from './types'

function roundDelta(value: number | null) {
  return value === null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100
}

function movementFromDeltas(input: {
  initialAlignment: number | null
  revisionAlignment: number | null
  initialBucket: string | null
  revisionBucket: string | null
  initialConfidence: number | null
  revisionConfidence: number | null
}) {
  if (input.initialAlignment === null && input.revisionAlignment === null) {
    return 'unclear' as const
  }

  if (input.revisionAlignment === null) {
    if ((input.initialAlignment ?? 0) >= 0.7) return 'stable_strong' as const
    return 'no_revision' as const
  }

  if (input.initialAlignment === null) {
    if (input.revisionAlignment >= 0.7) return 'partial_improvement' as const
    return 'unclear' as const
  }

  const alignmentDelta = input.revisionAlignment - input.initialAlignment
  const confidenceDelta =
    input.initialConfidence !== null && input.revisionConfidence !== null
      ? input.revisionConfidence - input.initialConfidence
      : null

  if (alignmentDelta >= 0.35) return 'strong_improvement' as const
  if (alignmentDelta >= 0.15) return 'partial_improvement' as const

  if (alignmentDelta <= -0.15) {
    if (confidenceDelta !== null && confidenceDelta > 0) {
      return 'confidence_miscalibration' as const
    }
    return 'possible_regression' as const
  }

  if (input.revisionAlignment >= 0.75) return 'stable_strong' as const

  if (
    confidenceDelta !== null &&
    confidenceDelta > 0 &&
    input.revisionAlignment < 0.5
  ) {
    return 'confidence_miscalibration' as const
  }

  return 'stable_needs_review' as const
}

export const interpretationByMovement = {
  strong_improvement:
    'Your revision moved clearly toward a stronger reasoning pattern.',
  partial_improvement:
    'Your revision improved part of the reasoning, but one idea may still need checking.',
  stable_strong:
    'Your reasoning stayed stable and aligned with the expected concept.',
  stable_needs_review:
    'Your reasoning stayed similar, so this is a good question to review once more.',
  possible_regression:
    'Your revision may have moved away from the expected reasoning, so compare both attempts carefully.',
  confidence_miscalibration:
    'Your confidence increased while the reasoning alignment did not improve, so this is worth double-checking.',
  no_revision:
    'No revision was recorded for this question.',
  no_response:
    'No response was recorded for this question.',
  unclear:
    'There is not enough evidence to compare the reasoning clearly.',
}

export async function computeStudentImprovement(input: {
  sessionId: string
  participantId: string
}): Promise<StudentImprovementQuestion[]> {
  const supabase = createAdminClient()
  const [{ data: questions, error: questionsError }, { data: responses, error: responsesError }, { data: memberships, error: membershipsError }] =
    await Promise.all([
      supabase
        .from('session_questions')
        .select('question_id, position, prompt')
        .eq('session_id', input.sessionId)
        .order('position', { ascending: true }),
      supabase
        .from('responses')
        .select('response_id, question_id, attempt_type, answer, confidence, created_at, session_participants:session_participant_id (participant_id)')
        .eq('session_id', input.sessionId)
        .order('created_at', { ascending: true }),
      supabase
        .from('student_cluster_memberships')
        .select('*')
        .eq('session_id', input.sessionId)
        .eq('participant_id', input.participantId),
    ])

  if (questionsError) throw questionsError
  if (responsesError) throw responsesError
  if (membershipsError) throw membershipsError

  const ownResponses = (responses || []).filter((response: any) => {
    const joined = Array.isArray(response.session_participants)
      ? response.session_participants[0]
      : response.session_participants
    return joined?.participant_id === input.participantId
  })

  function responseFor(questionId: string, attemptType: 'initial' | 'revision') {
    return ownResponses.find((response: any) => response.question_id === questionId && response.attempt_type === attemptType) || null
  }

  function membershipFor(questionId: string, attemptType: 'initial' | 'revision') {
    return (memberships || []).find((membership: any) => membership.question_id === questionId && membership.attempt_type === attemptType) || null
  }

  return (questions || []).map((question: any) => {
    const initialResponse = responseFor(question.question_id, 'initial')
    const revisionResponse = responseFor(question.question_id, 'revision')
    const initialMembership = membershipFor(question.question_id, 'initial')
    const revisionMembership = membershipFor(question.question_id, 'revision')
    const initialAlignment = initialMembership?.conceptual_alignment === null || initialMembership?.conceptual_alignment === undefined
      ? null
      : Number(initialMembership.conceptual_alignment)
    const revisionAlignment = revisionMembership?.conceptual_alignment === null || revisionMembership?.conceptual_alignment === undefined
      ? null
      : Number(revisionMembership.conceptual_alignment)
    const confidenceDelta =
      initialResponse && revisionResponse
        ? Number(revisionResponse.confidence) - Number(initialResponse.confidence)
        : null
    const alignmentDelta =
      initialAlignment !== null && revisionAlignment !== null
        ? revisionAlignment - initialAlignment
        : null
    const movement = !initialResponse && !revisionResponse
      ? 'no_response'
      : movementFromDeltas({
          initialAlignment,
          revisionAlignment,
          initialBucket: initialMembership?.understanding_bucket || null,
        revisionBucket: revisionMembership?.understanding_bucket || null,
        initialConfidence: initialResponse?.confidence ?? null,
        revisionConfidence: revisionResponse?.confidence ?? null,
      })
    const clusterMoved = Boolean(
      initialMembership?.cluster_id &&
      revisionMembership?.cluster_id &&
      initialMembership.cluster_id !== revisionMembership.cluster_id
    )

    const shortInterpretation = interpretationByMovement[movement]

    return {
      question_id: question.question_id,
      question_text: question.prompt,
      initial_answer: initialResponse?.answer ?? null,
      initial_confidence: initialResponse?.confidence ?? null,
      initial_cluster_id: initialMembership?.cluster_id ?? null,
      initial_cluster_label: initialMembership?.cluster_label ?? null,
      initial_alignment: initialAlignment,
      initial_understanding_bucket: initialMembership?.understanding_bucket ?? null,
      revision_answer: revisionResponse?.answer ?? null,
      revision_confidence: revisionResponse?.confidence ?? null,
      revision_cluster_id: revisionMembership?.cluster_id ?? null,
      revision_cluster_label: revisionMembership?.cluster_label ?? null,
      revision_alignment: revisionAlignment,
      revision_understanding_bucket: revisionMembership?.understanding_bucket ?? null,
      confidence_delta: roundDelta(confidenceDelta),
      alignment_delta: roundDelta(alignmentDelta),
      cluster_moved: clusterMoved,
      movement_label: movement,
      short_interpretation: shortInterpretation,
    }
  })
}
