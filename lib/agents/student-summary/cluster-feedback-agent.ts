import { openaiChatJson } from '@/lib/ai/openai-json'
import { createAdminClient } from '@/lib/supabase/server'
import type { AttemptType } from '@/lib/types/database'
import type { ClusterFeedbackCard, ParsedCluster } from './types'
import { ClusterFeedbackSchema, parseClusterFeedbackOrFallback } from './schemas'
import { retryOpenAIJson } from './reliability'

const STUDENT_SUMMARY_MODEL_VERSION = 'cluster_feedback_v1'

function fallbackCard(input: {
  sessionId: string
  questionId: string
  attemptType: AttemptType
  cluster: ParsedCluster
  modelVersion: string
  fallbackReason?: string | null
}): Omit<ClusterFeedbackCard, 'id'> {
  const label = String(input.cluster.label || '').toLowerCase()
  const summary = String(input.cluster.summary || '').toLowerCase()
  const noReasoning = label.includes('answer only') || summary.includes('no reasoning') || summary.includes('bare')
  const unclear =
    input.cluster.understandingBucket === 'unclear' ||
    label.includes('unclear') ||
    label.includes('irrelevant') ||
    summary.includes('unclear') ||
    summary.includes('not related')
  const feedback = ClusterFeedbackSchema.parse({
    student_title: 'Review this reasoning pattern',
    reasoning_pattern: input.cluster.label || 'This answer follows a common reasoning pattern.',
    what_you_understood: noReasoning
      ? 'No reasoning was provided, so the system could not infer understanding from this response.'
      : unclear
        ? 'The response was unclear or not related enough to generate specific feedback.'
        : 'Your answer shows an attempt to use the relevant concept.',
    likely_gap: noReasoning || unclear
      ? 'There is not enough explanation here to identify the reasoning clearly.'
      : input.cluster.summary || 'AI feedback was unavailable for this cluster. Please review your answer and compare it with the class explanation.',
    micro_hint: noReasoning || unclear
      ? 'Add one sentence explaining why your answer should be true.'
      : 'Check the key condition in the question and explain why it applies.',
    try_again_prompt: noReasoning || unclear
      ? 'Try rewriting your answer with the reason included.'
      : 'Try rewriting your answer with one extra sentence explaining the final step.',
    counterexample: 'Compare your answer with a case where the key condition changes the outcome.',
    confidence_check: 'Before trusting the answer, check whether each step is supported by the question.',
    teacher_note: 'Fallback cluster feedback was used because AI feedback generation failed or returned invalid JSON.',
    safety_notes: 'Fallback analysis used. Evidence may be limited.',
  })
  return {
    session_id: input.sessionId,
    question_id: input.questionId,
    attempt_type: input.attemptType,
    cluster_id: input.cluster.clusterId,
    cluster_label: input.cluster.label,
    student_title: feedback.student_title,
    reasoning_pattern: feedback.reasoning_pattern,
    what_you_understood: feedback.what_you_understood,
    likely_gap: feedback.likely_gap,
    micro_hint: feedback.micro_hint,
    try_again_prompt: feedback.try_again_prompt,
    counterexample: feedback.counterexample,
    confidence_check: feedback.confidence_check,
    teacher_note: input.cluster.teacherNote || feedback.teacher_note,
    safety_notes: feedback.safety_notes,
    model_version: input.modelVersion,
    fallback_used: true,
    fallback_reason: input.fallbackReason || 'fallback_card',
  }
}

export async function generateClusterFeedbackCard(input: {
  sessionId: string
  questionId: string
  attemptType: AttemptType
  questionText: string
  correctAnswer?: string | null
  cluster: ParsedCluster
}) {
  const supabase = createAdminClient()
  const { data: cached, error: cachedError } = await supabase
    .from('cluster_feedback_cards')
    .select('*')
    .eq('session_id', input.sessionId)
    .eq('question_id', input.questionId)
    .eq('attempt_type', input.attemptType)
    .eq('cluster_id', input.cluster.clusterId)
    .maybeSingle()

  if (cachedError) throw cachedError
  if (cached) return { card: cached as ClusterFeedbackCard, created: false, fallbackUsed: Boolean((cached as any).fallback_used) }

  let card = fallbackCard({
    sessionId: input.sessionId,
    questionId: input.questionId,
    attemptType: input.attemptType,
    cluster: input.cluster,
    modelVersion: STUDENT_SUMMARY_MODEL_VERSION,
  })

  const messages = [
    {
      role: 'system' as const,
      content: [
          'You generate short, supportive feedback for ONE anonymized cluster of student answers.',
          '',
          'Your job is to describe the reasoning pattern, not judge individual students.',
          'Write for students first, but include one private teacher-facing note.',
          'Do not infer more than the answer supports. If the answer is too short, vague, or ambiguous, say the pattern is unclear and suggest a specific self-check.',
          '',
          'Rules:',
          '- Return valid JSON only. No markdown. No extra text.',
          '- Do not mention student names, IDs, participant codes, or exact counts.',
          '- Do not say "you are wrong", "incorrect", "failed", or "misunderstood".',
          '- Do not reveal or quote another student directly unless the answer is anonymized and short.',
          '- Do not give away the full final answer if the student is expected to revise.',
          '- Be specific to the question and cluster pattern.',
          '- If the cluster is unclear, say what is uncertain instead of overclaiming.',
          '- Keep student-facing text concise, warm, and actionable.',
          '- Use simple language suitable for undergraduate students.',
          '',
          'Pedagogical style:',
          '- First acknowledge what the reasoning seems to capture.',
          '- Then identify the smallest missing idea or next step.',
          '- Then give one micro-hint or self-check question.',
          '- Prefer "check whether..." or "try explaining..." over direct correction.',
      ].join('\n'),
    },
    {
      role: 'user' as const,
      content: [
          `Question:\n${input.questionText}`,
          '',
          `Reference answer / expected concept:\n${input.correctAnswer || 'Not provided'}`,
          '',
          `Cluster label:\n${input.cluster.label || input.cluster.clusterId}`,
          '',
          `Cluster summary:\n${input.cluster.summary || 'Not provided'}`,
          '',
          `Understanding bucket:\n${input.cluster.understandingBucket || 'Not provided'}`,
          '',
          `Conceptual alignment score:\n${input.cluster.conceptualAlignment ?? 'Not provided'}`,
          '',
          `Representative anonymized answers:\n${input.cluster.representativeAnswers.slice(0, 4).join('\n') || 'Not provided'}`,
          '',
          'Return exactly this JSON shape:',
          JSON.stringify({
            student_title: 'max 8 words; friendly title for this feedback card',
            reasoning_pattern: '1 sentence describing the shared reasoning pattern in this cluster',
            what_you_understood: '1 sentence on what this answer pattern seems to understand',
            likely_gap: '1 sentence on the most important missing, mixed, or fragile idea',
            micro_hint: '1 short hint that helps the student revise without simply giving the final answer',
            try_again_prompt: '1 short self-check or revision prompt',
            counterexample: 'optional; a tiny check/counterexample if useful, otherwise empty string',
            confidence_check: '1 sentence connecting confidence to self-checking; do not shame the student',
            teacher_note: 'private teacher-facing note: what this cluster suggests and how teacher might respond',
            safety_notes: 'uncertainty/limits, e.g. if representative answers are too short or mixed'
          }, null, 2),
      ].join('\n'),
    },
  ]

  const result = await retryOpenAIJson(
    () => openaiChatJson({
      maxTokens: 2000,
      timeoutMs: 60000,
      messages,
    }),
    {
      operation: 'cluster_feedback',
      sessionId: input.sessionId,
      questionId: input.questionId,
      clusterId: input.cluster.clusterId,
    }
  )

  if (result.ok) {
    const fallbackFeedback = {
      student_title: card.student_title || 'Review this reasoning pattern',
      reasoning_pattern: card.reasoning_pattern || 'This answer follows a common reasoning pattern.',
      what_you_understood: card.what_you_understood || 'Your answer shows an attempt to use the relevant concept.',
      likely_gap: card.likely_gap || 'One part of the reasoning may need more evidence.',
      micro_hint: card.micro_hint || 'Check the key condition in the question and explain why it applies.',
      try_again_prompt: card.try_again_prompt || 'Try rewriting your answer with one extra sentence explaining the final step.',
      counterexample: card.counterexample || 'Compare your answer with a case where the key condition changes the outcome.',
      confidence_check: card.confidence_check || 'Before trusting the answer, check whether each step is supported by the question.',
      teacher_note: card.teacher_note || 'Fallback feedback was used or evidence was limited.',
      safety_notes: card.safety_notes || 'Generated from limited cluster evidence.',
    }
    const parsed = parseClusterFeedbackOrFallback(result.json, fallbackFeedback)
    card = {
      ...card,
      ...parsed.data,
      fallback_used: parsed.fallbackUsed,
      fallback_reason: parsed.reason,
    }
  } else {
    console.warn('[student-summary] using fallback cluster feedback', {
      sessionId: input.sessionId,
      questionId: input.questionId,
      attemptType: input.attemptType,
      clusterId: input.cluster.clusterId,
      error: result.error,
    })
    card = fallbackCard({
      sessionId: input.sessionId,
      questionId: input.questionId,
      attemptType: input.attemptType,
      cluster: input.cluster,
      modelVersion: STUDENT_SUMMARY_MODEL_VERSION,
      fallbackReason: result.error,
    })
  }

  const { data: saved, error: saveError } = await supabase
    .from('cluster_feedback_cards')
    .upsert(
      {
        ...card,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'session_id,question_id,attempt_type,cluster_id' }
    )
    .select('*')
    .single()

  if (saveError) throw saveError
  return { card: saved as ClusterFeedbackCard, created: true, fallbackUsed: Boolean((saved as any).fallback_used) }
}
