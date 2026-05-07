import { NextResponse } from 'next/server'
import { getActiveSessions } from '@/lib/supabase/queries'

export async function GET() {
  try {
    const sessions = await getActiveSessions()
    return NextResponse.json({ sessions })
  } catch (error) {
    console.error('student active-sessions error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load active sessions.' },
      { status: 500 }
    )
  }
}
