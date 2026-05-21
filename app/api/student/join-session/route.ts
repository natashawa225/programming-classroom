import { NextRequest, NextResponse } from 'next/server'
import { joinSessionWithLoggedInParticipant } from '@/lib/supabase/queries'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const sessionCode = String(body?.sessionCode || '')

    const result = await joinSessionWithLoggedInParticipant({ sessionCode })

    console.info(
      `[student-join-session] success session_id=${result.session.id} session_code=${result.session.session_code} participant_id=${result.participant.participant_id}`
    )

    return NextResponse.json({
      session: result.session,
      participation: result.participation,
    })
  } catch (error) {
    console.error('student join-session error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to join session.' },
      { status: 400 }
    )
  }
}
