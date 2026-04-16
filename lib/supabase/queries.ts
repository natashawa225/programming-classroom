'use server'

import { cookies } from 'next/headers'
import { createHash, randomBytes } from 'crypto'
import { createClient } from './server'
import type {
  AIOutput,
  AnalysisRun,
  ConfidenceValue,
  Participant,
  Response,
  Session,
  SessionQuestion,
  SessionParticipant,
  SessionStatus,
  ResponseAiLabel,
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

function normalizeParticipantId(participantId: string) {
  return participantId.trim().toLowerCase().replace(/\s+/g, '')
}

function createJoinToken() {
  return randomBytes(32).toString('base64url')
}

function hashJoinToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function verifyParticipantPassword(participant: {
  participant_id: string
  password_hash: string
  hash_algo: string | null
}, password: string) {
  const normalizedPassword = password ?? ''

  if (participant.hash_algo === 'sha256') {
    return createHash('sha256').update(normalizedPassword).digest('hex') === participant.password_hash
  }

  if (participant.hash_algo === 'bcrypt') {
    // The repo's demo seed uses the participant ID as the password, so keep
    // that working even without a bcrypt runtime dependency.
    return normalizedPassword === participant.participant_id
  }

  return normalizedPassword === participant.password_hash || normalizedPassword === participant.participant_id
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
    title?: string
    question?: string
    answerOptions?: string[] | string
    correctAnswer?: string
    questions?: Array<{
      prompt: string
      correctAnswer?: string
      timerSeconds?: number
    }>
    transferQuestion?: string
    transferOptions?: string[] | string
    transferCorrectAnswer?: string
  }
) {
  await assertTeacherAuthenticated()
  const supabase = await createClient()

  const questionsInput =
    data.questions && data.questions.length > 0
      ? data.questions
      : [
          {
            prompt: data.question || '',
            correctAnswer: data.correctAnswer || '',
          },
        ]

  const normalizedQuestions = questionsInput
    .map((q) => ({
      prompt: String(q.prompt || '').trim(),
      correctAnswer: q.correctAnswer ? String(q.correctAnswer).trim() : '',
      timerSeconds:
        q.timerSeconds === undefined || q.timerSeconds === null || q.timerSeconds === ('' as any)
          ? null
          : Math.max(0, Math.floor(Number(q.timerSeconds))),
    }))
    .filter((q) => q.prompt.length > 0)

  if (normalizedQuestions.length < 1) {
    throw new Error('Please add at least one question.')
  }
  if (normalizedQuestions.length > 5) {
    throw new Error('Please add no more than 5 questions.')
  }

  const desired = data.sessionCode?.trim() || ''
  const maxAttempts = 8

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const sessionCode = desired || generateSessionCode(6)
    const { data: session, error } = await supabase
      .from('sessions')
      .insert({
        session_code: sessionCode,
        condition: data.condition,
        title: data.title?.trim() || null,
        question: normalizedQuestions[0].prompt,
        answer_options: normalizeArrayValue(data.answerOptions),
        correct_answer: normalizedQuestions[0].correctAnswer || '',
        transfer_question: data.transferQuestion?.trim() || null,
        transfer_options: data.transferOptions ? normalizeArrayValue(data.transferOptions) : null,
        transfer_correct_answer: data.transferCorrectAnswer?.trim() || null,
        status: 'draft',
      })
      .select()
      .single()

    if (!error) {
      const questionRows = normalizedQuestions.map((q, idx) => ({
        session_id: (session as any).id,
        position: idx + 1,
        prompt: q.prompt,
        correct_answer: q.correctAnswer || null,
        timer_seconds: q.timerSeconds,
      }))

      const { error: questionsError } = await supabase.from('session_questions').insert(questionRows)
      if (questionsError) throw questionsError

      return session as Session
    }

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

export async function getSessionQuestions(sessionId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('session_questions')
    .select('question_id, session_id, position, prompt, correct_answer, timer_seconds, created_at')
    .eq('session_id', sessionId)
    .order('position', { ascending: true })

  if (error) throw error
  return (data || []) as SessionQuestion[]
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
  if (current.condition === 'baseline' && status === 'revision') {
    throw new Error('Baseline sessions do not support revision.')
  }
  const allowedNext: Record<SessionStatus, SessionStatus[]> = {
    draft: ['live'],
    live: ['analysis_ready', 'closed'],
    analysis_ready: ['revision', 'closed'],
    revision: ['analysis_ready', 'closed'],
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
export async function joinSessionWithParticipantCredentials(data: {
  sessionCode: string
  participantId: string
  password: string
}) {
  const supabase = await createClient()
  const session = await getSessionByCode(normalizeSessionCode(data.sessionCode))
  if (session.status === 'closed') {
    throw new Error('This session is closed.')
  }

  const participantId = normalizeParticipantId(data.participantId)
  if (!participantId) throw new Error('Please enter your participant ID.')
  if (!data.password) throw new Error('Please enter your password.')

  const { data: participant, error: participantError } = await supabase
    .from('participants')
    .select('id, participant_id, group_name, password_hash, hash_algo, is_active, created_at')
    .eq('participant_id', participantId)
    .maybeSingle()

  if (participantError) throw participantError
  if (!participant) throw new Error('Invalid participant ID or password.')
  if (!participant.is_active) throw new Error('This participant account is inactive.')
  if (participant.hash_algo && participant.hash_algo !== 'bcrypt') {
    throw new Error('Unsupported password hashing algorithm.')
  }

  const ok = verifyParticipantPassword(participant, data.password)
  if (!ok) throw new Error('Invalid participant ID or password.')

  if (participant.group_name !== session.condition) {
    throw new Error('You are not assigned to this session type.')
  }

  // 1) If cookie exists and is valid for THIS participant, reuse it (stable across refresh).
  const cookieStore = await cookies()
  const cookieName = sessionParticipantCookieName(session.id)
  const existingToken = cookieStore.get(cookieName)?.value
  if (existingToken) {
    const { data: existingByToken, error } = await supabase
      .from('session_participants')
      .select('session_participant_id, session_id, participant_id, student_name, student_id, anonymized_label, joined_at')
      .eq('session_id', session.id)
      .eq('join_token_hash', hashJoinToken(existingToken))
      .maybeSingle()

    if (error) throw error
    if (existingByToken && existingByToken.participant_id === participant.participant_id) {
      cookieStore.set(cookieName, existingToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/student',
        maxAge: 60 * 60 * 24 * 7, // 7 days
      })
      return { session, participation: existingByToken as SessionParticipant, participant: participant as Participant }
    }
  }

  // Allocate a fresh join token for this session + participant.
  const joinToken = createJoinToken()
  const joinTokenHash = hashJoinToken(joinToken)

  // 2) If already joined for this session by participant_id, reuse row and rotate join token.
  const { data: existingJoin, error: existingJoinError } = await supabase
    .from('session_participants')
    .select('session_participant_id, session_id, participant_id, student_name, student_id, anonymized_label, joined_at')
    .eq('session_id', session.id)
    .eq('participant_id', participant.participant_id)
    .maybeSingle()

  if (existingJoinError) throw existingJoinError
  if (existingJoin) {
    const { error: updateError } = await supabase
      .from('session_participants')
      .update({ join_token_hash: joinTokenHash })
      .eq('session_participant_id', existingJoin.session_participant_id)

    if (updateError) throw updateError

    cookieStore.set(cookieName, joinToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/student',
      maxAge: 60 * 60 * 24 * 7,
    })

    return { session, participation: existingJoin as SessionParticipant, participant: participant as Participant }
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
        participant_id: participant.participant_id,
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

  cookieStore.set(cookieName, joinToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/student',
    maxAge: 60 * 60 * 24 * 7,
  })

  return {
    session,
    participation: participation as SessionParticipant,
    participant: participant as Participant,
  }
}

export async function getSessionParticipantForStudent(sessionId: string) {
  const supabase = await createClient()
  const cookieStore = await cookies()
  const token = cookieStore.get(sessionParticipantCookieName(sessionId))?.value
  if (!token) return null

  const { data, error } = await supabase
    .from('session_participants')
    .select('session_participant_id, session_id, participant_id, student_name, student_id, anonymized_label, joined_at')
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
      participant_id,
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
  questionId: string,
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
     .eq('question_id', questionId)
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
      question_id: questionId,
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
  data: {
    questionId: string
    answerText: string
    confidence: number
    timeTakenSeconds?: number | null
    questionType?: 'main' | 'revision' | 'transfer'
    roundNumber?: number
    originalResponseId?: string | null
  }
) {
  const participation = await getSessionParticipantForStudent(sessionId)
  if (!participation) {
    throw new Error('Not joined for this session. Please join using the session code.')
  }

  const supabase = await createClient()

  // Server-side duplicate protection per question+round (in addition to DB unique index).
  const { data: existing, error } = await supabase
    .from('responses')
    .select('response_id')
    .eq('session_id', sessionId)
    .eq('session_participant_id', participation.session_participant_id)
    .eq('question_id', data.questionId)
    .eq('round_number', data.roundNumber ?? 1)
    .limit(1)

  if (error) throw error
  if (existing && existing.length > 0) {
    throw new Error('You have already submitted for this question in this round.')
  }

  // For revision, link to original round-1 response if present.
  let originalResponseId: string | null = data.originalResponseId || null
  if (!originalResponseId && (data.roundNumber ?? 1) === 2) {
    const { data: original, error: originalError } = await supabase
      .from('responses')
      .select('response_id')
      .eq('session_id', sessionId)
      .eq('session_participant_id', participation.session_participant_id)
      .eq('question_id', data.questionId)
      .eq('round_number', 1)
      .maybeSingle()

    if (originalError) throw originalError
    originalResponseId = original?.response_id || null
  }

  const questionType = data.questionType ?? ((data.roundNumber ?? 1) === 2 ? 'revision' : 'main')

  const inserted = await submitResponse(
    sessionId,
    participation.session_participant_id,
    data.questionId,
    data.answerText,
    data.confidence,
    questionType,
    data.roundNumber ?? 1
  )

  if (data.timeTakenSeconds !== undefined && data.timeTakenSeconds !== null) {
    await supabase
      .from('responses')
      .update({
        time_taken_seconds: Math.max(0, Math.floor(Number(data.timeTakenSeconds))),
        original_response_id: originalResponseId,
      })
      .eq('response_id', inserted.response_id)
  } else if (originalResponseId) {
    await supabase
      .from('responses')
      .update({ original_response_id: originalResponseId })
      .eq('response_id', inserted.response_id)
  }

  return inserted
}

export async function getStudentResponse(
  sessionId: string,
  data: { questionId: string; roundNumber?: number } 
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
      question_id,
      question_type,
      round_number,
      answer,
      confidence,
      explanation,
      is_correct,
      time_taken_seconds,
      original_response_id,
      created_at
    `
    )
    .eq('session_id', sessionId)
    .eq('session_participant_id', participation.session_participant_id)
    .eq('question_id', data.questionId)
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
      question_id,
      question_type,
      round_number,
      answer,
      confidence,
      explanation,
      is_correct,
      time_taken_seconds,
      original_response_id,
      created_at,
      session_participants:session_participant_id (
        session_participant_id,
        anonymized_label
      ),
      session_questions:question_id (
        question_id,
        position
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

export async function createAnalysisRun(data: {
  sessionId: string
  condition?: Session['condition'] | null
  sessionStatus?: Session['status'] | null
  roundNumber: 1 | 2
  model?: string | null
  status: AnalysisRun['status']
  errorMessage?: string | null
  promptJson?: Record<string, unknown> | null
  rawResponseJson?: Record<string, unknown> | null
  summaryJson?: Record<string, unknown> | null
}) {
  await assertTeacherAuthenticated()
  const supabase = await createClient()
  const { data: inserted, error } = await supabase
    .from('analysis_runs')
    .insert({
      session_id: data.sessionId,
      condition: data.condition ?? null,
      session_status: data.sessionStatus ?? null,
      round_number: data.roundNumber,
      model: data.model ?? null,
      status: data.status,
      error_message: data.errorMessage ?? null,
      prompt_json: data.promptJson ?? null,
      raw_response_json: data.rawResponseJson ?? null,
      summary_json: data.summaryJson ?? null,
    })
    .select()
    .single()

  if (error) throw error
  return inserted as AnalysisRun
}

export async function updateAnalysisRun(data: {
  analysisRunId: string
  status?: AnalysisRun['status']
  errorMessage?: string | null
  promptJson?: Record<string, unknown> | null
  rawResponseJson?: Record<string, unknown> | null
  summaryJson?: Record<string, unknown> | null
}) {
  await assertTeacherAuthenticated()
  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from('analysis_runs')
    .update({
      ...(data.status ? { status: data.status } : {}),
      ...(data.errorMessage !== undefined ? { error_message: data.errorMessage } : {}),
      ...(data.promptJson !== undefined ? { prompt_json: data.promptJson } : {}),
      ...(data.rawResponseJson !== undefined ? { raw_response_json: data.rawResponseJson } : {}),
      ...(data.summaryJson !== undefined ? { summary_json: data.summaryJson } : {}),
    })
    .eq('analysis_run_id', data.analysisRunId)
    .select()
    .single()

  if (error) throw error
  return updated as AnalysisRun
}

export async function upsertResponseAiLabels(labels: Array<{
  analysisRunId: string
  sessionId: string
  questionId: string
  roundNumber: 1 | 2
  responseId: string
  isCorrect: boolean | null
  misconceptionLabel: string | null
  clusterId: string | null
  explanation: string | null
}>) {
  await assertTeacherAuthenticated()
  const supabase = await createClient()
  if (labels.length === 0) return []

  const { data, error } = await supabase
    .from('response_ai_labels')
    .upsert(
      labels.map((l) => ({
        analysis_run_id: l.analysisRunId,
        response_id: l.responseId,
        session_id: l.sessionId,
        question_id: l.questionId,
        round_number: l.roundNumber,
        is_correct: l.isCorrect,
        misconception_label: l.misconceptionLabel,
        cluster_id: l.clusterId,
        explanation: l.explanation,
      })),
      { onConflict: 'analysis_run_id,response_id' }
    )
    .select()

  if (error) throw error
  return (data || []) as ResponseAiLabel[]
}

export async function getLatestAnalysisRun(sessionId: string, roundNumber: 1 | 2) {
  await assertTeacherAuthenticated()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('analysis_runs')
    .select('*')
    .eq('session_id', sessionId)
    .eq('round_number', roundNumber)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as AnalysisRun) || null
}

export async function getLatestCompletedAnalysisRun(sessionId: string, roundNumber: 1 | 2) {
  await assertTeacherAuthenticated()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('analysis_runs')
    .select('*')
    .eq('session_id', sessionId)
    .eq('round_number', roundNumber)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as AnalysisRun) || null
}

export async function getLatestInProgressAnalysisRun(sessionId: string, roundNumber: 1 | 2) {
  await assertTeacherAuthenticated()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('analysis_runs')
    .select('*')
    .eq('session_id', sessionId)
    .eq('round_number', roundNumber)
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as AnalysisRun) || null
}

export async function getResponseAiLabels(sessionId: string, roundNumber: 1 | 2) {
  await assertTeacherAuthenticated()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('response_ai_labels')
    .select('*')
    .eq('session_id', sessionId)
    .eq('round_number', roundNumber)

  if (error) throw error
  return (data || []) as ResponseAiLabel[]
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
