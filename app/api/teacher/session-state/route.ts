import { NextRequest, NextResponse } from 'next/server'
import {
  getCurrentQuestionRespondentCount,
  getLiveQuestionAnalyses,
  getSession,
  getSessionParticipantCount,
  getSessionParticipants,
  getSessionQuestions,
  getSessionResponses,
} from '@/lib/supabase/queries'
import { getTeacherSession } from '@/lib/teacher-auth'

export async function POST(request: NextRequest) {
  try {
    const teacherSession = await getTeacherSession()
    if (!teacherSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const sessionId = String(body?.sessionId || '')

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const session = await getSession(sessionId)
    const [
      joinedParticipantCountResult,
      currentQuestionRespondentCountResult,
      participantsResult,
      questionsResult,
      responsesResult,
      liveQuestionAnalysesResult,
    ] = await Promise.allSettled([
      getSessionParticipantCount(sessionId),
      getCurrentQuestionRespondentCount(sessionId),
      getSessionParticipants(sessionId),
      getSessionQuestions(sessionId),
      getSessionResponses(sessionId),
      getLiveQuestionAnalyses(sessionId),
    ])

    const joinedParticipantCount =
      joinedParticipantCountResult.status === 'fulfilled' ? joinedParticipantCountResult.value : 0
    const currentQuestionRespondent =
      currentQuestionRespondentCountResult.status === 'fulfilled'
        ? currentQuestionRespondentCountResult.value
        : { currentQuestionId: null, attemptType: null, respondentCount: 0 }
    const participants = participantsResult.status === 'fulfilled' ? participantsResult.value : []
    const questions = questionsResult.status === 'fulfilled' ? questionsResult.value : []
    const responses = responsesResult.status === 'fulfilled' ? responsesResult.value : []
    const liveQuestionAnalyses =
      liveQuestionAnalysesResult.status === 'fulfilled' ? liveQuestionAnalysesResult.value : []

    if (joinedParticipantCountResult.status === 'rejected') {
      console.error('teacher session-state joined count warning', joinedParticipantCountResult.reason)
    }
    if (currentQuestionRespondentCountResult.status === 'rejected') {
      console.error('teacher session-state respondent count warning', currentQuestionRespondentCountResult.reason)
    }
    if (participantsResult.status === 'rejected') {
      console.error('teacher session-state participants warning', participantsResult.reason)
    }
    if (questionsResult.status === 'rejected') {
      console.error('teacher session-state questions warning', questionsResult.reason)
    }
    if (responsesResult.status === 'rejected') {
      console.error('teacher session-state responses warning', responsesResult.reason)
    }
    if (liveQuestionAnalysesResult.status === 'rejected') {
      console.error('teacher session-state analyses warning', liveQuestionAnalysesResult.reason)
    }

    console.info(
      `[teacher-session-state] session_id=${sessionId} joined_count=${joinedParticipantCount} current_question_id=${currentQuestionRespondent.currentQuestionId || 'none'} response_count=${currentQuestionRespondent.respondentCount} participants=${participants.length} responses=${responses.length} analyses=${liveQuestionAnalyses.length}`
    )

    return NextResponse.json({
      session,
      joinedParticipantCount,
      currentQuestionRespondentCount: currentQuestionRespondent.respondentCount,
      currentQuestionRespondentAttemptType: currentQuestionRespondent.attemptType,
      currentQuestionId: currentQuestionRespondent.currentQuestionId,
      participants,
      questions,
      responses,
      liveQuestionAnalyses,
    })
  } catch (error) {
    console.error('teacher session-state error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load teacher session state.' },
      { status: 500 }
    )
  }
}
