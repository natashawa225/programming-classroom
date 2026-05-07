import { NextRequest, NextResponse } from 'next/server'
import {
  getLatestCompletedAnalysisRun,
  getLatestInProgressAnalysisRun,
  getSession,
  getSessionParticipants,
  getSessionQuestions,
  getSessionResponses,
} from '@/lib/supabase/queries'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const sessionId = String(body?.sessionId || '')

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const [
      session,
      participants,
      questions,
      responses,
      completedRound1,
      completedRound2,
      inProgressRound1,
      inProgressRound2,
    ] = await Promise.all([
      getSession(sessionId),
      getSessionParticipants(sessionId),
      getSessionQuestions(sessionId),
      getSessionResponses(sessionId),
      getLatestCompletedAnalysisRun(sessionId, 1),
      getLatestCompletedAnalysisRun(sessionId, 2),
      getLatestInProgressAnalysisRun(sessionId, 1),
      getLatestInProgressAnalysisRun(sessionId, 2),
    ])

    return NextResponse.json({
      session,
      participants,
      questions,
      responses,
      completedRound1,
      completedRound2,
      inProgressRound1,
      inProgressRound2,
    })
  } catch (error) {
    console.error('teacher analysis-state error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load analysis state.' },
      { status: 500 }
    )
  }
}
