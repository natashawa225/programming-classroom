import { NextResponse } from 'next/server'
import { getSessionsByTeacher } from '@/lib/supabase/queries'

export async function GET() {
  try {
    const sessions = await getSessionsByTeacher('demo-teacher-001')
    return NextResponse.json({ sessions })
  } catch (error) {
    console.error('teacher sessions error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load sessions.' },
      { status: 500 }
    )
  }
}
