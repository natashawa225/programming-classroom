import { NextRequest, NextResponse } from 'next/server'
import { joinSessionWithParticipantCredentials } from '@/lib/supabase/queries'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const sessionCode = String(body?.sessionCode || '')
    const participantId = String(body?.participantId || '')

    console.info(
      `[student-join] attempt session_code=${sessionCode.trim().toUpperCase()} participant_id=${participantId.trim().toLowerCase()}`
    )

    const result = await joinSessionWithParticipantCredentials({
      sessionCode,
      participantId,
      password: String(body?.password || ''),
    })

    console.info(
      `[student-join] success session_id=${result.session.id} session_code=${result.session.session_code} participant_id=${result.participant.participant_id}`
    )

    return NextResponse.json({
      session: result.session,
      participation: result.participation,
    })
  } catch (error) {
    console.error('student join error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to join session.' },
      { status: 500 }
    )
  }
}
