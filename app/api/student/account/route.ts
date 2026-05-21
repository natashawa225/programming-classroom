import { NextResponse } from 'next/server'
import { getLoggedInParticipantForStudent } from '@/lib/supabase/queries'

export async function GET() {
  try {
    const participant = await getLoggedInParticipantForStudent()

    return NextResponse.json({
      participant: participant
        ? {
            participant_id: participant.participant_id,
          }
        : null,
    })
  } catch (error) {
    console.error('student account error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load student account.' },
      { status: 500 }
    )
  }
}
