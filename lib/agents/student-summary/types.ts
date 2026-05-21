import type { AttemptType } from '@/lib/types/database'

export type StudentSummaryAttemptType = AttemptType

export type UnderstandingBucket =
  | 'strong_alignment'
  | 'mostly_aligned'
  | 'mixed_reasoning'
  | 'needs_attention'
  | 'unclear'

export type StudentMovementLabel =
  | 'strong_improvement'
  | 'partial_improvement'
  | 'stable_strong'
  | 'stable_needs_review'
  | 'possible_regression'
  | 'confidence_miscalibration'
  | 'no_revision'
  | 'no_response'
  | 'unclear'

export type ClusterFeedbackCard = {
  id?: string
  session_id: string
  question_id: string
  attempt_type: StudentSummaryAttemptType
  cluster_id: string
  cluster_label: string | null

  /**
   * Student-facing reusable feedback card.
   * Generated once per cluster, reused across student summaries.
   */
  student_title: string | null
  reasoning_pattern: string | null
  what_you_understood: string | null
  likely_gap: string | null
  micro_hint: string | null
  try_again_prompt: string | null
  counterexample: string | null
  confidence_check: string | null

  /**
   * Teacher-facing / system-facing notes.
   * Do not expose teacher_note directly in student UI.
   */
  teacher_note: string | null
  safety_notes: string | null
  model_version: string | null
  fallback_used?: boolean | null
  fallback_reason?: string | null
}

export type StudentClusterMembership = {
  session_id: string
  question_id: string
  participant_id: string
  response_id: string | null
  attempt_type: StudentSummaryAttemptType
  cluster_id: string
  cluster_label: string | null
  conceptual_alignment: number | null
  understanding_bucket: UnderstandingBucket | null
  confidence: number | null
}

export type ParsedCluster = {
  clusterId: string
  label: string | null
  summary: string | null
  misconceptionType: string | null
  conceptualAlignment: number | null
  understandingBucket: UnderstandingBucket | null
  averageConfidence: number | null
  teacherNote: string | null
  studentSafeSummary: string | null
  representativeAnswers: string[]
  responseIds: string[]
  raw: Record<string, unknown>
}

export type StudentImprovementQuestion = {
  question_id: string
  question_text: string

  initial_answer: string | null
  initial_confidence: number | null
  initial_cluster_id: string | null
  initial_cluster_label: string | null
  initial_alignment: number | null
  initial_understanding_bucket: UnderstandingBucket | null

  revision_answer: string | null
  revision_confidence: number | null
  revision_cluster_id: string | null
  revision_cluster_label: string | null
  revision_alignment: number | null
  revision_understanding_bucket: UnderstandingBucket | null

  confidence_delta: number | null
  alignment_delta: number | null
  cluster_moved: boolean

  movement_label: StudentMovementLabel
  short_interpretation: string
}

export type StudentSummaryJson = {
  session_id: string
  participant_id: string

  headline: string
  overall_summary: string

  strengths: string[]
  needs_practice: string[]
  confidence_insight: string

  pattern_noticed: {
    title: string
    explanation: string
    self_check: string
  } | null

  question_cards: Array<{
    question_id: string
    question_text: string

    initial_answer: string | null
    revision_answer: string | null

    initial_confidence: number | null
    revision_confidence: number | null

    initial_cluster_label: string | null
    revision_cluster_label: string | null

    initial_alignment: number | null
    revision_alignment: number | null

    cluster_feedback: {
      student_title: string | null
      reasoning_pattern: string | null
      what_you_understood: string | null
      likely_gap: string | null
      micro_hint: string | null
      try_again_prompt: string | null
      counterexample: string | null
      confidence_check: string | null
    } | null

    improvement: {
      movement_label: StudentMovementLabel
      alignment_delta: number | null
      confidence_delta: number | null
      cluster_moved: boolean
      short_interpretation: string
    }
  }>

  recommended_next_steps: string[]
  analysis_status: 'ok' | 'fallback' | 'partial'
  fallback_used: boolean
  fallback_reason: string | null
  warnings: string[]

  /**
   * For transparency/debugging only.
   * Do not show prominently in student UI.
   */
  safety_notes?: string | null
}

export type GenerateStudentSummariesResult = {
  ok: boolean
  analysis_status: 'ok' | 'fallback' | 'partial'
  memberships_upserted: number
  cluster_feedback_cards_created: number
  summaries_created: number
  fallback_cards_created: number
  warnings: string[]
  errors: string[]
}
