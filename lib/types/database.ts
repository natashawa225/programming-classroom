export type SessionStatus = 'draft' | 'live' | 'revision' | 'closed'
export type QuestionType = 'main' | 'revision' | 'transfer'
export type ConfidenceValue = 1 | 2 | 3 | 4 | 5

export interface Session {
  id: string
  session_code: string
  condition: 'baseline' | 'treatment'
  question: string
  answer_options: string[]
  correct_answer: string
  transfer_question: string | null
  transfer_options: string[] | null
  transfer_correct_answer: string | null
  status: SessionStatus
  created_at: string
}

export interface SessionParticipant {
  session_participant_id: string
  session_id: string
  student_name: string | null
  student_id: string | null
  anonymized_label: string
  joined_at: string
}

export interface Response {
  response_id: string
  session_id: string
  session_participant_id: string
  question_type: QuestionType
  round_number: number
  answer: string
  confidence: ConfidenceValue
  explanation: string | null
  is_correct: boolean | null
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

export interface TeacherAction {
  id: string
  session_id: string
  action_type: 'session_created' | 'session_started' | 'session_closed' | 'ai_analysis_triggered'
  action_data: Record<string, unknown>
  created_at: string
}
