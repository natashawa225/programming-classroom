import { NextResponse } from 'next/server'
import { getStudentSessionHistory } from '@/lib/supabase/queries'

export async function GET() {
  try {
    const sessions = await getStudentSessionHistory()
    return NextResponse.json({ sessions })
  } catch (error) {
    console.error('student session-history error', error)
    const message = error instanceof Error ? error.message : 'Failed to load previous sessions.'
    const isAuthError = message.toLowerCase().includes('log in')

    return NextResponse.json(
      { error: isAuthError ? message : 'Failed to load previous sessions.' },
      { status: isAuthError ? 401 : 500 }
    )
  }
}
