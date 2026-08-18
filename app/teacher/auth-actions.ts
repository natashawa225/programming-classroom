'use server'

import { redirect } from 'next/navigation'
import { clearTeacherSessionCookie, setTeacherSessionCookie, verifyTeacherCredentials } from '@/lib/teacher-auth'

/**
 * Server actions for the per-teacher login.
 * Credentials are validated server-side against the `teachers` table and never sent to the client.
 */

export type TeacherLoginState = { error: string | null }

export async function teacherLogin(_prevState: TeacherLoginState, formData: FormData): Promise<TeacherLoginState> {
  const username = String(formData.get('username') || '').trim()
  const password = String(formData.get('password') || '')

  const teacher = await verifyTeacherCredentials({ username, password })
  if (!teacher) {
    // Keep error generic (don't reveal whether the username or password was wrong).
    return { error: 'Invalid credentials' }
  }

  await setTeacherSessionCookie(teacher)
  redirect('/teacher/dashboard')
}

export async function teacherLogout() {
  await clearTeacherSessionCookie()
  redirect('/teacher/login')
}
