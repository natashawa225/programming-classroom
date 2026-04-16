'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

/**
 * Lightweight student logout.
 *
 * Clears all session-scoped join cookies for this browser (sd_sp_<sessionId>).
 * This does not affect teacher auth cookies.
 */
export async function studentLogout() {
  const cookieStore = await cookies()
  const all = cookieStore.getAll()

  for (const c of all) {
    if (c.name.startsWith('sd_sp_')) {
      cookieStore.set(c.name, '', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/student',
        maxAge: 0,
      })
    }
  }

  redirect('/student/join')
}

