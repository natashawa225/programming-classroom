import { redirect } from 'next/navigation'
import { getTeacherSession } from '@/lib/teacher-auth'

/**
 * Server-side protection for all teacher routes under /teacher/* (except /teacher/login).
 *
 * This is not "middleware-only" protection: the auth check happens on the server
 * during rendering and blocks data access even if someone knows the URL.
 */
export default async function TeacherProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await getTeacherSession()
  if (!session) redirect('/teacher/login')
  return <>{children}</>
}

