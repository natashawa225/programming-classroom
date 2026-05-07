import { NextRequest, NextResponse } from 'next/server'
import { getRevisionPrefillResponse, getStudentResponse } from '@/lib/supabase/queries'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const sessionId = String(body?.sessionId || '')
    const questionId = String(body?.questionId || '')
    const mode = String(body?.mode || 'initial')

    if (!sessionId || !questionId) {
      return NextResponse.json({ error: 'Missing sessionId or questionId' }, { status: 400 })
    }

    if (mode === 'revision') {
      const prefill = await getRevisionPrefillResponse(sessionId, { questionId })
      return NextResponse.json({ prefill })
    }

    const response = await getStudentResponse(sessionId, {
      questionId,
      attemptType: mode === 'revision' ? 'revision' : 'initial',
    })

    return NextResponse.json({ response })
  } catch (error) {
    console.error('student current-response error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load student response.' },
      { status: 500 }
    )
  }
}
