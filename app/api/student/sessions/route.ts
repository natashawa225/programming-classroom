import { NextResponse } from 'next/server'
import { getStudentSessionHistory } from '@/lib/supabase/queries'

export async function GET() {
  try {
    const sessions = await getStudentSessionHistory()
    return NextResponse.json({ sessions })
  } catch (error) {
    console.error('student sessions error', error)
    const message = error instanceof Error ? error.message : 'Failed to load student sessions.'
    return NextResponse.json(
      { error: message.toLowerCase().includes('log in') ? message : 'Failed to load student sessions.' },
      { status: message.toLowerCase().includes('log in') ? 401 : 500 }
    )
  }
}
