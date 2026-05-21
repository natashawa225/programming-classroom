import { NextRequest, NextResponse } from 'next/server'
import { loginStudentParticipant } from '@/lib/supabase/queries'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const participant = await loginStudentParticipant({
      participantId: String(body?.participantId || ''),
      password: String(body?.password || ''),
    })

    return NextResponse.json({
      participant: {
        participant_id: participant.participant_id,
      },
    })
  } catch (error) {
    console.error('student login error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to log in.' },
      { status: 401 }
    )
  }
}
