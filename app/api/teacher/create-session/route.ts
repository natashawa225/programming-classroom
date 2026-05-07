import { NextRequest, NextResponse } from 'next/server'
import { createSession } from '@/lib/supabase/queries'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))

    const session = await createSession({
      condition: body?.condition,
      title: body?.title,
      answerOptions: body?.answerOptions,
      questions: body?.questions,
      transferQuestion: body?.transferQuestion,
      transferOptions: body?.transferOptions,
      transferCorrectAnswer: body?.transferCorrectAnswer,
    })

    return NextResponse.json({ session })
  } catch (error) {
    console.error('teacher create-session error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create session.' },
      { status: 500 }
    )
  }
}
