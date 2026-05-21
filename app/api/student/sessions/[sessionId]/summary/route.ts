import { NextRequest, NextResponse } from 'next/server'
import { getOrCreateStudentSummary } from '@/lib/agents/student-summary'
import { createAdminClient } from '@/lib/supabase/server'
import { getLoggedInParticipantForStudent } from '@/lib/supabase/queries'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await context.params
    const participant = await getLoggedInParticipantForStudent()
    if (!participant) {
      return NextResponse.json({ ok: false, error: 'Please log in to view this summary.' }, { status: 401 })
    }

    const supabase = createAdminClient()
    const { data: participation, error: participationError } = await supabase
      .from('session_participants')
      .select('session_participant_id')
      .eq('session_id', sessionId)
      .eq('participant_id', participant.participant_id)
      .maybeSingle()

    if (participationError) throw participationError
    if (!participation) {
      return NextResponse.json({ ok: false, error: 'You did not participate in this session.' }, { status: 403 })
    }

    const result = await getOrCreateStudentSummary({
      sessionId,
      participantId: participant.participant_id,
    })

    return NextResponse.json({ ok: true, summary: result.summary })
  } catch (error) {
    console.error('student session summary error', { error, route: '/api/student/sessions/[sessionId]/summary' })
    return NextResponse.json(
      {
        ok: false,
        error: 'Could not load summary. Please try again later, or ask your teacher to generate student summaries for this session.',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    )
  }
}
