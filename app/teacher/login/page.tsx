import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { getTeacherSession, isTeacherUsernameRequired } from '@/lib/teacher-auth'
import TeacherLoginForm from '@/app/teacher/login/login-form'

export default async function TeacherLoginPage() {
  const existing = await getTeacherSession()
  if (existing) redirect('/teacher/dashboard')

  const showUsername = isTeacherUsernameRequired()

  return (
    <main className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-md px-4">
        <div className="mb-10 text-center">

          <h1 className="text-3xl font-bold text-foreground mb-2">Teacher Login</h1>
          <p className="text-sm text-foreground/70">Enter the dashboard password to continue</p>
        </div>

        <Card className="p-8">
          <TeacherLoginForm showUsername={showUsername} />

          <div className="mt-8 pt-6 border-t border-border/40 text-center">
            <Link href="/" className="text-sm text-foreground/60 hover:text-foreground transition-colors">
              ← Back to Home
            </Link>
          </div>
        </Card>
      </div>
    </main>
  )
}
