export type SessionStatus = 'draft' | 'live' | 'analysis_ready' | 'revision' | 'closed'
export type SessionLivePhase =
  | 'not_started'
  | 'question_initial_open'
  | 'question_initial_closed'
  | 'question_revision_open'
  | 'question_revision_closed'
  | 'session_completed'
export type QuestionType = 'main' | 'revision' | 'transfer'
export type AttemptType = 'initial' | 'revision'
export type ConfidenceValue = 1 | 2 | 3 | 4 | 5

export interface Participant {
  id: string
  participant_id: string
  group_name: 'baseline' | 'treatment'
  password_hash: string
  hash_algo: 'bcrypt' | string
  is_active: boolean
  created_at: string
}

export interface Session {
  id: string
  session_code: string
  condition: 'baseline' | 'treatment'
  title?: string | null
  question: string
  answer_options: string[]
  correct_answer: string
  transfer_question: string | null
  transfer_options: string[] | null
  transfer_correct_answer: string | null
  status: SessionStatus
  live_phase: SessionLivePhase
  current_question_position: number
  current_timer_seconds: number | null
  timer_started_at: string | null
  created_at: string
}

export interface SessionQuestion {
  question_id: string
  session_id: string
  position: number
  prompt: string
  correct_answer: string | null
  timer_seconds: number | null
  created_at: string
}

export interface SessionParticipant {
  session_participant_id: string
  session_id: string
  participant_id: string | null
  student_name: string | null
  student_id: string | null
  anonymized_label: string
  joined_at: string
}

export interface Response {
  response_id: string
  session_id: string
  session_participant_id: string
  question_id: string | null
  question_type: QuestionType
  attempt_type: AttemptType | null
  round_number: number
  answer: string
  confidence: ConfidenceValue
  explanation: string | null
  is_correct: boolean | null
  time_taken_seconds: number | null
  original_response_id: string | null
  created_at: string
  session_participants?: Pick<SessionParticipant, 'session_participant_id' | 'anonymized_label'> | null
  session_questions?: Pick<SessionQuestion, 'question_id' | 'position'> | null
}

export interface LiveQuestionAnalysis {
  live_question_analysis_id: string
  session_id: string
  question_id: string
  attempt_type: AttemptType
  analysis_json: Record<string, unknown>
  generated_at: string
}

export interface SessionSummaryRecord {
  id: string
  session_id: string
  summary_json: Record<string, unknown>
  source: 'openai' | 'fallback'
  created_at: string
  updated_at: string
}

export interface StudentSessionSummaryRecord {
  id: string
  session_id: string
  session_participant_id: string
  input_hash: string
  summary_json: Record<string, unknown>
  source: 'local' | 'mixed'
  created_at: string
  updated_at: string
}

export interface AnalysisRun {
  analysis_run_id: string
  session_id: string
  question_id: string | null
  condition: 'baseline' | 'treatment' | null
  session_status: SessionStatus | null
  round_number: 1 | 2
  model: string | null
  model_name: string | null
  status: 'queued' | 'running' | 'completed' | 'failed'
  error_message: string | null
  prompt_json: Record<string, unknown> | null
  raw_response_json: Record<string, unknown> | null
  analysis_json: Record<string, unknown> | null
  summary_json: Record<string, unknown> | null
  created_at: string
}

export interface SessionEvent {
  id: string
  session_id: string
  question_id: string | null
  event_type:
    | 'session_started'
    | 'question_opened'
    | 'question_closed'
    | 'revision_opened'
    | 'revision_closed'
    | 'analysis_generated'
  round_number: 1 | 2
  created_at: string
}

export interface ResponseAiLabel {
  response_ai_label_id: string
  analysis_run_id: string
  response_id: string
  session_id: string
  question_id: string
  round_number: 1 | 2
  understanding_level: 'correct' | 'mostly_correct' | 'partially_correct' | 'incorrect' | 'unclear' | null
  evaluation_category: 'fully_correct' | 'partially_correct' | 'relevant_incomplete' | 'misconception' | 'unclear' | null
  is_correct: boolean | null
  misconception_label: string | null
  cluster_id: string | null
  reasoning_summary: string | null
  explanation: string | null
  created_at: string
}

export interface TeacherAction {
  id: string
  session_id: string
  action_type: 'session_created' | 'session_started' | 'session_closed' | 'ai_analysis_triggered'
  action_data: Record<string, unknown>
  created_at: string
}
