'use server'

import { redirect } from 'next/navigation'
import { clearTeacherSessionCookie, setTeacherSessionCookie, verifyTeacherCredentials } from '@/lib/teacher-auth'

/**
 * Server actions for the lightweight teacher password gate.
 * The password is validated server-side against env vars and never sent to the client.
 */

export type TeacherLoginState = { error: string | null }

export async function teacherLogin(_prevState: TeacherLoginState, formData: FormData): Promise<TeacherLoginState> {
  const username = String(formData.get('username') || '').trim()
  const password = String(formData.get('password') || '')

  const ok = verifyTeacherCredentials({ username, password })
  if (!ok) {
    // Keep error generic (don't reveal whether username or password was wrong).
    return { error: 'Invalid credentials' }
  }

  await setTeacherSessionCookie(username || undefined)
  redirect('/teacher/dashboard')
}

export async function teacherLogout() {
  await clearTeacherSessionCookie()
  redirect('/teacher/login')
}
