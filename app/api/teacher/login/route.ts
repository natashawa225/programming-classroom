import { NextRequest, NextResponse } from 'next/server'
import { setTeacherSessionCookie, verifyTeacherCredentials } from '@/lib/teacher-auth'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const username = String(body?.username || '').trim()
    const password = String(body?.password || '')

    const ok = verifyTeacherCredentials({ username, password })
    if (!ok) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    await setTeacherSessionCookie(username || undefined)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('teacher login error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sign in.' },
      { status: 500 }
    )
  }
}
