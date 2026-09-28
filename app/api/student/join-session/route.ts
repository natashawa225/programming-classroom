import { NextRequest, NextResponse } from 'next/server'
import {
  joinSessionWithNickname,
  joinSessionWithLoggedInParticipant,
} from '@/lib/supabase/queries'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const sessionCode = String(body?.sessionCode || '')
    const nickname = String(body?.nickname || '')

    const result = nickname.trim()
      ? await joinSessionWithNickname({ sessionCode, nickname })
      : await joinSessionWithLoggedInParticipant({ sessionCode })

    console.info(
      `[student-join-session] success session_id=${result.session.id} session_code=${result.session.session_code} label=${result.participation.anonymized_label}`
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
