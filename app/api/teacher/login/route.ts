import { NextRequest, NextResponse } from 'next/server'
import { setTeacherSessionCookie, verifyTeacherCredentials } from '@/lib/teacher-auth'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const username = String(body?.username || '').trim()
    const password = String(body?.password || '')

    const teacher = await verifyTeacherCredentials({ username, password })
    if (!teacher) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    await setTeacherSessionCookie(teacher)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('teacher login error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sign in.' },
      { status: 500 }
    )
  }
}
