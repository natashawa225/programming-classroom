import { NextResponse } from 'next/server'
import { clearTeacherSessionCookie } from '@/lib/teacher-auth'

export async function POST() {
  try {
    await clearTeacherSessionCookie()
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('teacher logout error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to log out.' },
      { status: 500 }
    )
  }
}
