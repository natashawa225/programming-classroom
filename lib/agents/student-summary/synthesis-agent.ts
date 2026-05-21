import { createHash } from 'crypto'
import { openaiChatJson } from '@/lib/ai/openai-json'
import { createAdminClient } from '@/lib/supabase/server'
import type { ClusterFeedbackCard, StudentSummaryJson } from './types'
import { computeStudentImprovement } from './improvement-agent'
import { parseStudentSummaryPolishOrFallback } from './schemas'
import { retryOpenAIJson } from './reliability'

export const STUDENT_SUMMARY_SCHEMA_VERSION = '2026-05-22-v2'
const SUMMARY_MODEL_VERSION = 'student_summary_template_v2'

function hashInput(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function compact<T>(items: Array<T | null | undefined>) {
  return items.filter(Boolean) as T[]
}

function shouldUseLlmPolish() {
  return String(process.env.ENABLE_STUDENT_SUMMARY_LLM_POLISH || 'false').toLowerCase() === 'true'
}

export async function getOrCreateStudentSummary(input: {
  sessionId: string
  participantId: string
}) {
  const supabase = createAdminClient()
  const [{ data: responses, error: responsesError }, { data: memberships, error: membershipsError }, { data: cards, error: cardsError }, { data: studentMemory, error: memoryError }] =
    await Promise.all([
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
      supabase
        .from('cluster_feedback_cards')
        .select('*')
        .eq('session_id', input.sessionId),
      supabase
        .from('student_misconception_memory')
        .select('*')
        .eq('participant_id', input.participantId),
    ])

  if (responsesError) throw responsesError
  if (membershipsError) throw membershipsError
  if (cardsError) throw cardsError
  if (memoryError) throw memoryError

  const ownResponses = (responses || []).filter((response: any) => {
    const joined = Array.isArray(response.session_participants)
      ? response.session_participants[0]
      : response.session_participants
    return joined?.participant_id === input.participantId
  })

  const improvements = await computeStudentImprovement(input)
  const cardsByKey = new Map((cards || []).map((card: any) => [
    `${card.question_id}:${card.attempt_type}:${card.cluster_id}`,
    card as ClusterFeedbackCard,
  ]))
  const missingFeedback = improvements.some((item) => {
    const hasResponse = Boolean(item.initial_answer || item.revision_answer)
    const hasCard =
      (item.revision_cluster_id && cardsByKey.has(`${item.question_id}:revision:${item.revision_cluster_id}`)) ||
      (item.initial_cluster_id && cardsByKey.has(`${item.question_id}:initial:${item.initial_cluster_id}`))
    return hasResponse && !hasCard
  })

  const generatedFromHash = hashInput({
    responses: ownResponses,
    memberships,
    cards,
    studentMemory,
    movementLabels: improvements.map((item) => item.movement_label),
    llmPolish: shouldUseLlmPolish(),
    schemaVersion: STUDENT_SUMMARY_SCHEMA_VERSION,
    modelVersion: SUMMARY_MODEL_VERSION,
  })

  const { data: existing, error: existingError } = await supabase
    .from('student_summary_snapshots')
    .select('*')
    .eq('session_id', input.sessionId)
    .eq('participant_id', input.participantId)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing?.generated_from_hash === generatedFromHash) {
    return { summary: existing.summary_json as StudentSummaryJson, created: false }
  }

  let usedFallbackClusterFeedback = false
  const questionCards = improvements.map((item) => {
    const feedback =
      (item.revision_cluster_id
        ? cardsByKey.get(`${item.question_id}:revision:${item.revision_cluster_id}`)
        : null) ||
      (item.initial_cluster_id
        ? cardsByKey.get(`${item.question_id}:initial:${item.initial_cluster_id}`)
        : null) ||
      null
    if (feedback?.fallback_used) usedFallbackClusterFeedback = true

    return {
      question_id: item.question_id,
      question_text: item.question_text,
      initial_answer: item.initial_answer,
      revision_answer: item.revision_answer,
      initial_confidence: item.initial_confidence,
      revision_confidence: item.revision_confidence,
      initial_cluster_label: item.initial_cluster_label,
      revision_cluster_label: item.revision_cluster_label,
      initial_alignment: item.initial_alignment,
      revision_alignment: item.revision_alignment,
      cluster_feedback: feedback
        ? {
            student_title: feedback.student_title,
            reasoning_pattern: feedback.reasoning_pattern,
            what_you_understood: feedback.what_you_understood,
            likely_gap: feedback.likely_gap,
            micro_hint: feedback.micro_hint,
            try_again_prompt: feedback.try_again_prompt,
            counterexample: feedback.counterexample,
            confidence_check: feedback.confidence_check,
          }
        : null,
      improvement: {
        movement_label: item.movement_label,
        alignment_delta: item.alignment_delta,
        confidence_delta: item.confidence_delta,
        cluster_moved: item.cluster_moved,
        short_interpretation: item.short_interpretation,
      },
    }
  })

  const improvedCount = improvements.filter((item) => ['strong_improvement', 'partial_improvement'].includes(item.movement_label)).length
  const needsReview = improvements.filter((item) => ['stable_needs_review', 'possible_regression', 'confidence_miscalibration'].includes(item.movement_label))
  const answeredCount = improvements.filter((item) => item.initial_answer || item.revision_answer).length
  const revisedCount = improvements.filter((item) => item.revision_answer).length
  const confidenceDeltas = improvements.map((item) => item.confidence_delta).filter((value): value is number => value !== null)
  const avgConfidenceDelta =
    confidenceDeltas.length > 0
      ? Math.round((confidenceDeltas.reduce((sum, value) => sum + value, 0) / confidenceDeltas.length) * 10) / 10
      : null

  const warnings = compact([
    missingFeedback ? 'Cluster feedback is not available yet because analysis has not been generated for this session.' : null,
    usedFallbackClusterFeedback ? 'Some feedback used fallback analysis because AI output was unavailable.' : null,
  ])
  let analysisStatus: StudentSummaryJson['analysis_status'] = usedFallbackClusterFeedback ? 'fallback' : missingFeedback ? 'partial' : 'ok'
  let fallbackUsed = false
  let fallbackReason: string | null = null

  let summary: StudentSummaryJson = {
    session_id: input.sessionId,
    participant_id: input.participantId,
    headline: improvedCount > 0 ? 'You used revision to strengthen some reasoning.' : 'Your answers are ready for review.',
    overall_summary: `You answered ${answeredCount} question${answeredCount === 1 ? '' : 's'}. ${
      improvedCount > 0
        ? `${improvedCount} question${improvedCount === 1 ? '' : 's'} showed movement toward stronger alignment.`
        : 'Use the question cards below to review your reasoning patterns.'
    }`,
    strengths: compact([
      answeredCount > 0 ? 'You participated in the session questions.' : null,
      improvedCount > 0 ? 'At least one revision moved toward stronger reasoning.' : null,
      revisedCount > 0 ? 'You used revision opportunities where available.' : null,
    ]),
    needs_practice: needsReview.length > 0
      ? needsReview.slice(0, 3).map((item) => `Review: ${item.question_text}`)
      : ['For each answer, practice adding the reason or condition that supports it.'],
    confidence_insight:
      avgConfidenceDelta === null
        ? 'No confidence change is available for this session.'
        : avgConfidenceDelta > 0
          ? `Your confidence increased by ${avgConfidenceDelta.toFixed(1)} on average across comparable attempts.`
          : avgConfidenceDelta < 0
            ? `Your confidence decreased by ${Math.abs(avgConfidenceDelta).toFixed(1)} on average, which can reflect more careful self-checking.`
            : 'Your confidence stayed about the same across comparable attempts.',
    pattern_noticed: null,
    question_cards: questionCards,
    recommended_next_steps: [
      'Pick one question and rewrite your answer with the reason included.',
      'Compare your confidence with the feedback card and note where you may need more evidence.',
      'Ask your teacher about any cluster feedback that does not match what you intended.',
    ],
    analysis_status: analysisStatus,
    fallback_used: usedFallbackClusterFeedback || fallbackUsed,
    fallback_reason: usedFallbackClusterFeedback ? 'Some cluster feedback used fallback analysis because AI output was unavailable.' : fallbackReason,
    warnings,
    safety_notes: 'Generated from your answers, confidence, cluster memberships, cached cluster feedback, and student-level misconception memory.',
  }

  if (shouldUseLlmPolish()) {
    const summaryInput = {
      session_id: input.sessionId,
      participant_id: input.participantId,
      answered_count: answeredCount,
      revised_count: revisedCount,
      improved_count: improvedCount,
      average_confidence_delta: avgConfidenceDelta,
      questions: improvements.map((item) => {
        const feedback =
          (item.revision_cluster_id
            ? cardsByKey.get(`${item.question_id}:revision:${item.revision_cluster_id}`)
            : null) ||
          (item.initial_cluster_id
            ? cardsByKey.get(`${item.question_id}:initial:${item.initial_cluster_id}`)
            : null) ||
          null
        return {
          question_id: item.question_id,
          question_text: item.question_text,
          initial_answer: item.initial_answer,
          revision_answer: item.revision_answer,
          initial_confidence: item.initial_confidence,
          revision_confidence: item.revision_confidence,
          initial_cluster_label: item.initial_cluster_label,
          revision_cluster_label: item.revision_cluster_label,
          movement_label: item.movement_label,
          confidence_delta: item.confidence_delta,
          alignment_delta: item.alignment_delta,
          short_interpretation: item.short_interpretation,
          cluster_feedback: feedback
            ? {
                student_title: feedback.student_title,
                reasoning_pattern: feedback.reasoning_pattern,
                what_you_understood: feedback.what_you_understood,
                likely_gap: feedback.likely_gap,
                micro_hint: feedback.micro_hint,
                try_again_prompt: feedback.try_again_prompt,
                confidence_check: feedback.confidence_check,
              }
            : null,
        }
      }),
      student_misconception_memory: studentMemory || [],
    }
    const messages = [
      {
        role: 'system' as const,
        content: [
            'You write concise student-facing learning summaries from structured quiz evidence.',
            'You are not grading the student. You are helping them reflect and decide what to practice next.',
            'Rules:',
            '- Return valid JSON only.',
            '- Do not mention other students, class rankings, IDs, or private teacher notes.',
            '- Do not say "wrong", "failed", "bad", or "misunderstood".',
            '- Do not overclaim. Use "seems", "suggests", or "may" when evidence is limited.',
            '- Use only the provided evidence.',
            '- Do not invent scores, topics, or misconceptions.',
            '- Keep the tone supportive, specific, and brief.',
            '- Mention confidence only when it is useful for reflection.',
            '- Prefer actionable next steps over generic encouragement.',
            '- Point out one strength.',
            '- Point out one review priority.',
            '- Explain how revision changed the reasoning when revision data exists.',
            '- Give 2-3 concrete next steps.',
        ].join('\n'),
      },
      {
        role: 'user' as const,
        content: [
            `Structured student evidence:\n${JSON.stringify(summaryInput, null, 2)}`,
            'Return exactly this JSON shape:',
            JSON.stringify({
              headline: 'one friendly sentence summarizing the session',
              overall_summary: '2-3 sentences maximum',
              strengths: ['specific strength based on evidence'],
              needs_practice: ['specific review priority based on evidence'],
              confidence_insight: '1-2 sentences about confidence calibration, or empty string if not enough evidence',
              pattern_noticed: {
                title: 'short title',
                explanation: '1-2 sentences about a repeated reasoning pattern, or empty string if none',
                self_check: 'one self-check question',
              },
              recommended_next_steps: ['specific action 1', 'specific action 2', 'specific action 3'],
              safety_notes: 'uncertainty or limits',
            }, null, 2),
        ].join('\n\n'),
      },
    ]
    const result = await retryOpenAIJson(
      () => openaiChatJson({
        maxTokens: 800,
        timeoutMs: 60000,
        messages,
      }),
      {
        operation: 'student_summary_polish',
        sessionId: input.sessionId,
        participantId: input.participantId,
      }
    )

    if (result.ok) {
      const parsed = parseStudentSummaryPolishOrFallback(result.json)
      if (parsed.data) {
        summary = {
          ...summary,
          headline: parsed.data.headline,
          overall_summary: parsed.data.overall_summary,
          strengths: parsed.data.strengths,
          needs_practice: parsed.data.needs_practice,
          confidence_insight: parsed.data.confidence_insight,
          pattern_noticed: parsed.data.pattern_noticed,
          recommended_next_steps: parsed.data.recommended_next_steps,
          safety_notes: parsed.data.safety_notes,
        }
      } else {
        fallbackUsed = true
        fallbackReason = parsed.reason
      }
    } else {
      fallbackUsed = true
      fallbackReason = result.error
      console.warn('[student-summary] using deterministic participant summary fallback', {
        sessionId: input.sessionId,
        participantId: input.participantId,
        error: result.error,
      })
    }
  }

  if (fallbackUsed) {
    analysisStatus = 'fallback'
    summary = {
      ...summary,
      analysis_status: 'fallback',
      fallback_used: true,
      fallback_reason: fallbackReason || 'LLM polish failed; deterministic summary used.',
      warnings: [...summary.warnings, 'Fallback analysis used.'],
    }
  }

  const { data: saved, error: saveError } = await supabase
    .from('student_summary_snapshots')
    .upsert(
      {
        session_id: input.sessionId,
        participant_id: input.participantId,
        summary_json: summary,
        generated_from_hash: generatedFromHash,
        model_version: `${SUMMARY_MODEL_VERSION}:${STUDENT_SUMMARY_SCHEMA_VERSION}`,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'session_id,participant_id' }
    )
    .select('*')
    .single()

  if (saveError) throw saveError
  return { summary: saved.summary_json as StudentSummaryJson, created: !existing }
}
