import { redirect } from 'next/navigation'
import { getTeacherSession } from '@/lib/teacher-auth'

export default async function TeacherIndexPage() {
  const session = await getTeacherSession()
  redirect(session ? '/teacher/dashboard' : '/teacher/login')
}

