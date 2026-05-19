import { NextRequest, NextResponse } from 'next/server'
import { submitStudentResponse } from '@/lib/supabase/queries'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const sessionId = String(body?.sessionId || '')

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const attemptType = body?.attemptType === 'revision' || body?.attemptType === 'initial'
      ? body.attemptType
      : null
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug('[student-submit-api] received', {
        sessionId,
        questionId: String(body?.questionId || ''),
        attemptType,
        answerLength: String(body?.answerText || '').trim().length,
        answerPreview: String(body?.answerText || '').trim().slice(0, 80),
        confidence: Number(body?.confidence),
        originalResponseId: body?.originalResponseId ?? null,
      })
    }

    const response = await submitStudentResponse(sessionId, {
      questionId: String(body?.questionId || ''),
      answerText: String(body?.answerText || ''),
      confidence: Number(body?.confidence),
      attemptType,
      timeTakenSeconds: body?.timeTakenSeconds ?? null,
      originalResponseId: body?.originalResponseId ?? null,
    })

    return NextResponse.json({ response })
  } catch (error) {
    console.error('student submit-response error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to submit student response.' },
      { status: 500 }
    )
  }
}
