'use server'

import { createClient } from './server'
import type {
  AIOutput,
  ConfidenceValue,
  Response,
  Session,
  SessionParticipant,
  SessionStatus,
  TeacherAction,
} from '@/lib/types/database'
import { formatAnonymizedLabel, generateSessionCode } from '@/lib/utils/codes'

function normalizeConfidence(confidence: number): ConfidenceValue {
  const rounded = Math.round(confidence)
  if (rounded <= 1) return 1
  if (rounded >= 5) return 5
  return rounded as ConfidenceValue
}

function normalizeArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item)).filter(Boolean)
  }

  if (typeof value === 'string' && value.trim()) {
    return value
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean)
  }

  return []
}

// Sessions
export async function createSession(
  data: {
    sessionCode?: string
    condition: 'baseline' | 'treatment'
    question: string
    answerOptions?: string[] | string
    correctAnswer: string
    transferQuestion?: string
    transferOptions?: string[] | string
    transferCorrectAnswer?: string
  }
) {
  const supabase = await createClient()

  const desired = data.sessionCode?.trim() || ''
  const maxAttempts = 8

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const sessionCode = desired || generateSessionCode(6)
    const { data: session, error } = await supabase
      .from('sessions')
      .insert({
        session_code: sessionCode,
        condition: data.condition,
        question: data.question,
        answer_options: normalizeArrayValue(data.answerOptions),
        correct_answer: data.correctAnswer,
        transfer_question: data.transferQuestion?.trim() || null,
        transfer_options: data.transferOptions ? normalizeArrayValue(data.transferOptions) : null,
        transfer_correct_answer: data.transferCorrectAnswer?.trim() || null,
        status: 'waiting',
      })
      .select()
      .single()

    if (!error) return session as Session

    // If the teacher provided a code and it's taken, don't retry with the same value.
    if (desired) throw error

    // Retry on unique violations (session_code collision).
    if (error.code === '23505') continue
    throw error
  }

  throw new Error('Unable to generate a unique session code. Please try again.')
}

export async function getSessionsByTeacher(_teacherId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as Session[]
}

export async function getActiveSessions() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .in('status', ['active', 'transfer'])
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as Session[]
}

export async function getSession(sessionId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Session not found')
  return data as Session
}

export async function getSessionByCode(sessionCode: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('session_code', sessionCode.trim())
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Session code not found')
  return data as Session
}

export async function updateSessionStatus(
  sessionId: string,
  status: SessionStatus
) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sessions')
    .update({ status })
    .eq('id', sessionId)
    .select()
    .single()

  if (error) throw error
  return data as Session
}

// Session Participants (students join with session_code + student_id or name)
export async function joinSessionByCode(
  sessionCode: string,
  data: { studentName?: string | null; studentId?: string | null }
) {
  const supabase = await createClient()
  const session = await getSessionByCode(sessionCode)

  const studentName = data.studentName?.trim() || null
  const studentId = data.studentId?.trim() || null
  if (!studentName && !studentId) {
    throw new Error('Please enter your name or student ID.')
  }

  // Duplicate prevention (best-effort):
  // - If student_id is present: enforce single join per session by student_id.
  // - Else: fall back to (session_id + student_name) match.
  if (studentId) {
    const { data: existingById, error } = await supabase
      .from('session_participants')
      .select('session_participant_id, session_id, student_name, student_id, anonymized_label, joined_at')
      .eq('session_id', session.id)
      .eq('student_id', studentId)
      .limit(1)

    if (error) throw error
    if (existingById && existingById.length > 0) {
      return { session, participation: existingById[0] as SessionParticipant }
    }
  } else if (studentName) {
    const { data: existingByName, error } = await supabase
      .from('session_participants')
      .select('session_participant_id, session_id, student_name, student_id, anonymized_label, joined_at')
      .eq('session_id', session.id)
      .eq('student_name', studentName)
      .limit(1)

    if (error) throw error
    if (existingByName && existingByName.length > 0) {
      return { session, participation: existingByName[0] as SessionParticipant }
    }
  }

  // Allocate anonymized label P01, P02, ... in join order.
  const { count, error: countError } = await supabase
    .from('session_participants')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', session.id)

  if (countError) throw countError
  const anonymizedLabel = formatAnonymizedLabel((count ?? 0) + 1)

  const { data: participation, error: insertError } = await supabase
    .from('session_participants')
    .insert({
      session_id: session.id,
      student_name: studentName,
      student_id: studentId,
      anonymized_label: anonymizedLabel,
    })
    .select()
    .single()

  if (insertError) throw insertError

  return {
    session,
    participation: participation as SessionParticipant,
  }
}

export async function getSessionParticipants(sessionId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('session_participants')
    .select(
      `
      session_participant_id,
      session_id,
      student_name,
      student_id,
      anonymized_label,
      joined_at
    `
    )
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true })

  if (error) throw error
  return data as SessionParticipant[]
}

// Responses
export async function submitResponse(
  sessionId: string,
  sessionParticipantId: string,
  answerText: string,
  confidence: number
) {
  const supabase = await createClient()

  const session = await getSession(sessionId)

  const { data: existingResponse, error: responseLookupError } = await supabase
    .from('responses')
    .select('response_id')
    .eq('session_id', session.id)
    .eq('session_participant_id', sessionParticipantId)
    .eq('question_type', 'main')
    .eq('round_number', 1)
    .limit(1)

  if (responseLookupError) throw responseLookupError
  if (existingResponse && existingResponse.length > 0) {
    throw new Error('You have already submitted for this session.')
  }

  const { data: participation, error: participationError } = await supabase
    .from('session_participants')
    .select('session_participant_id')
    .eq('session_id', session.id)
    .eq('session_participant_id', sessionParticipantId)
    .limit(1)

  if (participationError) throw participationError
  if (!participation || participation.length === 0) {
    throw new Error('Join not found for this session. Please re-join using the session code.')
  }

  const { data, error } = await supabase
    .from('responses')
    .insert({
      session_id: sessionId,
      session_participant_id: sessionParticipantId,
      question_type: 'main',
      round_number: 1,
      answer: answerText,
      confidence: normalizeConfidence(confidence),
      explanation: null,
      is_correct: null,
    })
    .select()
    .single()

  if (error) throw error
  return data as Response
}

export async function getSessionResponses(sessionId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('responses')
    .select(
      `
      response_id,
      session_id,
      session_participant_id,
      question_type,
      round_number,
      answer,
      confidence,
      explanation,
      is_correct,
      created_at,
      session_participants:session_participant_id (
        session_participant_id,
        anonymized_label
      )
    `
    )
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data as Response[]
}

// AI Outputs
export async function createAIOutput(
  sessionId: string,
  condition: 'baseline' | 'treatment',
  outputType: 'feedback' | 'misconception_card' | 'confidence_matrix' | 'teaching_suggestion',
  content: Record<string, unknown>,
  roundNumber = 1
) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ai_outputs')
    .insert({
      session_id: sessionId,
      round_number: roundNumber,
      condition,
      teacher_summary:
        outputType === 'feedback' ? null : { type: outputType, ...content },
      student_summary:
        outputType === 'feedback' ? { type: outputType, ...content } : null,
      raw_response: JSON.stringify({ type: outputType, content }),
    })
    .select()
    .single()

  if (error) throw error
  return data as AIOutput
}

export async function getSessionAIOutputs(sessionId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ai_outputs')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data as AIOutput[]
}

// Teacher Actions (logging)
export async function logTeacherAction(
  sessionId: string,
  actionType: TeacherAction['action_type'],
  metadata: Record<string, unknown> = {}
) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('teacher_actions')
    .insert({
      session_id: sessionId,
      action_type: actionType,
      action_data: metadata,
    })
    .select()
    .single()

  if (error) throw error
  return data as TeacherAction
}
