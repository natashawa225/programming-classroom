export type SessionStatus = 'draft' | 'live' | 'analysis_ready' | 'revision' | 'closed'
export type QuestionType = 'main' | 'revision' | 'transfer'
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
  round_number: number
  answer: string
  confidence: ConfidenceValue
  explanation: string | null
  is_correct: boolean | null
  time_taken_seconds: number | null
  original_response_id: string | null
  created_at: string
  session_participants?: Pick<SessionParticipant, 'session_participant_id' | 'anonymized_label'> | null
}

export interface AIOutput {
  id: string
  session_id: string
  round_number: number
  condition: 'baseline' | 'treatment'
  teacher_summary: Record<string, unknown> | null
  student_summary: Record<string, unknown> | null
  raw_response: string | null
  created_at: string
}

export interface AnalysisRun {
  analysis_run_id: string
  session_id: string
  condition: 'baseline' | 'treatment' | null
  session_status: SessionStatus | null
  round_number: 1 | 2
  model: string | null
  status: 'queued' | 'running' | 'completed' | 'failed'
  error_message: string | null
  prompt_json: Record<string, unknown> | null
  raw_response_json: Record<string, unknown> | null
  summary_json: Record<string, unknown> | null
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
