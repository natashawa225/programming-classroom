import { z } from 'zod'
import type { ParsedCluster } from './types'

export const ClusterFeedbackSchema = z.object({
  student_title: z.string().default('Feedback for this reasoning pattern'),
  reasoning_pattern: z.string().default('This answer follows a recognizable reasoning pattern.'),
  what_you_understood: z.string().default('This response shows some useful thinking.'),
  likely_gap: z.string().default('One part of the reasoning may need checking.'),
  micro_hint: z.string().default('Review the key condition in the question.'),
  try_again_prompt: z.string().default('Try explaining the final step in one sentence.'),
  counterexample: z.string().default('Consider a similar case where the final condition changes the result.'),
  confidence_check: z.string().default('Check whether your confidence matches the evidence in your answer.'),
  teacher_note: z.string().default('Fallback feedback was used or evidence was limited.'),
  safety_notes: z.string().default('Generated from limited cluster evidence.'),
})

export const StudentSummaryPolishSchema = z.object({
  headline: z.string(),
  overall_summary: z.string(),
  strengths: z.array(z.string()).default([]),
  needs_practice: z.array(z.string()).default([]),
  confidence_insight: z.string().default(''),
  pattern_noticed: z.object({
    title: z.string().default('Pattern noticed'),
    explanation: z.string().default(''),
    self_check: z.string().default('What condition should I check before finalising my answer?'),
  }),
  question_cards: z.array(z.object({
    question_id: z.string(),
    title: z.string(),
    progress_label: z.string(),
    what_changed: z.string(),
    feedback: z.string(),
    next_step: z.string(),
  })).default([]),
  recommended_next_steps: z.array(z.string()).default([]),
  safety_notes: z.string().default(''),
})

export const ClusterSchema = z.object({
  cluster_id: z.string(),
  label: z.string(),
  summary: z.string(),
  misconception_type: z.string().default(''),
  understanding_bucket: z.enum([
    'strong_alignment',
    'mostly_aligned',
    'mixed_reasoning',
    'needs_attention',
    'unclear',
  ]),
  conceptual_alignment: z.number().min(0).max(1),
  average_confidence: z.number().min(0).max(5).nullable().optional(),
  response_ids: z.array(z.string()).default([]),
  representative_answers: z.array(z.string()).default([]),
  teacher_note: z.string().default(''),
  student_safe_summary: z.string().default(''),
})

export function parseClusterFeedbackOrFallback(value: unknown, fallback: z.infer<typeof ClusterFeedbackSchema>) {
  const parsed = ClusterFeedbackSchema.safeParse(value)
  return parsed.success
    ? { data: parsed.data, fallbackUsed: false, reason: null as string | null }
    : { data: fallback, fallbackUsed: true, reason: parsed.error.message }
}

export function parseStudentSummaryPolishOrFallback(value: unknown) {
  const parsed = StudentSummaryPolishSchema.safeParse(value)
  return parsed.success
    ? { data: parsed.data, fallbackUsed: false, reason: null as string | null }
    : { data: null, fallbackUsed: true, reason: parsed.error.message }
}

export function parseClusterOrFallback(value: unknown, fallback: ParsedCluster) {
  const parsed = ClusterSchema.safeParse(value)
  if (!parsed.success) return { data: fallback, fallbackUsed: true, reason: parsed.error.message }
  return {
    data: {
      ...fallback,
      clusterId: parsed.data.cluster_id,
      label: parsed.data.label,
      summary: parsed.data.summary,
      misconceptionType: parsed.data.misconception_type,
      conceptualAlignment: parsed.data.conceptual_alignment,
      understandingBucket: parsed.data.understanding_bucket,
      averageConfidence: parsed.data.average_confidence ?? null,
      teacherNote: parsed.data.teacher_note,
      studentSafeSummary: parsed.data.student_safe_summary,
      representativeAnswers: parsed.data.representative_answers,
      responseIds: parsed.data.response_ids,
    },
    fallbackUsed: false,
    reason: null as string | null,
  }
}
