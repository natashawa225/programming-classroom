'use server'

import { cookies } from 'next/headers'
import { createHash, randomBytes } from 'crypto'
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
import { assertTeacherAuthenticated } from '@/lib/teacher-auth'

function sessionParticipantCookieName(sessionId: string) {
  return `sd_sp_${sessionId}`
}

function normalizeSessionCode(sessionCode: string) {
  return sessionCode.trim().toUpperCase().replace(/\s+/g, '')
}

function createJoinToken() {
  return randomBytes(32).toString('base64url')
}

function hashJoinToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

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
  await assertTeacherAuthenticated()
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
        status: 'draft',
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
  await assertTeacherAuthenticated()
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
    .in('status', ['live', 'revision'])
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
  const normalized = normalizeSessionCode(sessionCode)
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('session_code', normalized)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Session code not found')
  return data as Session
}

export async function updateSessionStatus(
  sessionId: string,
  status: SessionStatus
) {
  await assertTeacherAuthenticated()
  const supabase = await createClient()

  const current = await getSession(sessionId)
  const allowedNext: Record<SessionStatus, SessionStatus[]> = {
    draft: ['live'],
    live: ['revision', 'closed'],
    revision: ['closed'],
    closed: [],
  }

  if (!allowedNext[current.status].includes(status)) {
    throw new Error(`Invalid status transition: ${current.status} -> ${status}`)
  }

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
  const session = await getSessionByCode(normalizeSessionCode(sessionCode))
  if (session.status === 'closed') {
    throw new Error('This session is closed.')
  }

  // 1) If cookie exists and is valid, reuse that session_participant (stable across refresh).
  const cookieStore = await cookies()
  const cookieName = sessionParticipantCookieName(session.id)
  const existingToken = cookieStore.get(cookieName)?.value
  if (existingToken) {
    const { data: existingByToken, error } = await supabase
      .from('session_participants')
      .select('session_participant_id, session_id, student_name, student_id, anonymized_label, joined_at')
      .eq('session_id', session.id)
      .eq('join_token_hash', hashJoinToken(existingToken))
      .maybeSingle()

    if (error) throw error
    if (existingByToken) {
      cookieStore.set(cookieName, existingToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/student',
        maxAge: 60 * 60 * 24 * 7, // 7 days
      })
      return { session, participation: existingByToken as SessionParticipant }
    }
  }

  const studentName = data.studentName?.trim() || null
  const studentId = data.studentId?.trim() || null
  if (!studentName && !studentId) {
    throw new Error('Please enter your name or student ID.')
  }

  // Duplicate prevention (best-effort):
  // - If student_id is present: enforce single join per session by student_id.
  // - Else: fall back to (session_id + student_name) match.
  const joinToken = createJoinToken()
  const joinTokenHash = hashJoinToken(joinToken)

  if (studentId) {
    const { data: existingById, error } = await supabase
      .from('session_participants')
      .select('session_participant_id, session_id, student_name, student_id, anonymized_label, joined_at')
      .eq('session_id', session.id)
      .eq('student_id', studentId)
      .limit(1)

    if (error) throw error
    if (existingById && existingById.length > 0) {
      const existing = existingById[0] as SessionParticipant
      const { error: updateError } = await supabase
        .from('session_participants')
        .update({ join_token_hash: joinTokenHash })
        .eq('session_participant_id', existing.session_participant_id)

      if (updateError) throw updateError

      cookieStore.set(sessionParticipantCookieName(session.id), joinToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/student',
        maxAge: 60 * 60 * 24 * 7,
      })

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
      const existing = existingByName[0] as SessionParticipant
      const { error: updateError } = await supabase
        .from('session_participants')
        .update({ join_token_hash: joinTokenHash })
        .eq('session_participant_id', existing.session_participant_id)

      if (updateError) throw updateError

      cookieStore.set(sessionParticipantCookieName(session.id), joinToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/student',
        maxAge: 60 * 60 * 24 * 7,
      })

      return { session, participation: existingByName[0] as SessionParticipant }
    }
  }

  // Allocate anonymized label P01, P02, ... in join order.
  let participation: any = null
  for (let attempt = 0; attempt < 6; attempt++) {
    const { count, error: countError } = await supabase
      .from('session_participants')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', session.id)

    if (countError) throw countError
    const anonymizedLabel = formatAnonymizedLabel((count ?? 0) + 1 + attempt)

    const { data: inserted, error: insertError } = await supabase
      .from('session_participants')
      .insert({
        session_id: session.id,
        student_name: studentName,
        student_id: studentId,
        anonymized_label: anonymizedLabel,
        join_token_hash: joinTokenHash,
      })
      .select()
      .single()

    if (!insertError) {
      participation = inserted
      break
    }

    // Label collision under concurrent joins: retry.
    if (insertError.code === '23505') continue
    throw insertError
  }

  if (!participation) throw new Error('Unable to join session. Please try again.')

  cookieStore.set(sessionParticipantCookieName(session.id), joinToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/student',
    maxAge: 60 * 60 * 24 * 7,
  })

  return {
    session,
    participation: participation as SessionParticipant,
  }
}

export async function getSessionParticipantForStudent(sessionId: string) {
  const supabase = await createClient()
  const cookieStore = await cookies()
  const token = cookieStore.get(sessionParticipantCookieName(sessionId))?.value
  if (!token) return null

  const { data, error } = await supabase
    .from('session_participants')
    .select('session_participant_id, session_id, student_name, student_id, anonymized_label, joined_at')
    .eq('session_id', sessionId)
    .eq('join_token_hash', hashJoinToken(token))
    .maybeSingle()

  if (error) throw error
  return (data as SessionParticipant) || null
}

export async function getSessionParticipants(sessionId: string) {
  await assertTeacherAuthenticated()
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
  confidence: number,
  questionType: 'main' | 'revision' | 'transfer' = 'main',
  roundNumber = 1
) {
  const supabase = await createClient()

  const session = await getSession(sessionId)
  if (questionType === 'main' && session.status !== 'live') {
    throw new Error('This session is not live yet.')
  }
  if (questionType === 'revision' && session.status !== 'revision') {
    throw new Error('This session is not in revision yet.')
  }
  if (session.status === 'closed') {
    throw new Error('This session is closed.')
  }

  const { data: existingResponse, error: responseLookupError } = await supabase
    .from('responses')
    .select('response_id')
    .eq('session_id', session.id)
    .eq('session_participant_id', sessionParticipantId)
    .eq('question_type', questionType)
    .eq('round_number', roundNumber)
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
      question_type: questionType,
      round_number: roundNumber,
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

export async function submitStudentResponse(
  sessionId: string,
  data: { answerText: string; confidence: number; questionType?: 'main' | 'revision' | 'transfer'; roundNumber?: number }
) {
  const participation = await getSessionParticipantForStudent(sessionId)
  if (!participation) {
    throw new Error('Not joined for this session. Please join using the session code.')
  }

  return submitResponse(
    sessionId,
    participation.session_participant_id,
    data.answerText,
    data.confidence,
    data.questionType ?? 'main',
    data.roundNumber ?? 1
  )
}

export async function getStudentResponse(
  sessionId: string,
  data: { questionType?: 'main' | 'revision' | 'transfer'; roundNumber?: number } = {}
) {
  const supabase = await createClient()
  const participation = await getSessionParticipantForStudent(sessionId)
  if (!participation) return null

  const { data: response, error } = await supabase
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
      created_at
    `
    )
    .eq('session_id', sessionId)
    .eq('session_participant_id', participation.session_participant_id)
    .eq('question_type', data.questionType ?? 'main')
    .eq('round_number', data.roundNumber ?? 1)
    .maybeSingle()

  if (error) throw error
  return response as Response | null
}

export async function getSessionResponses(sessionId: string) {
  await assertTeacherAuthenticated()
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
  await assertTeacherAuthenticated()
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
  await assertTeacherAuthenticated()
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
  await assertTeacherAuthenticated()
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
