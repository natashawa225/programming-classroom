'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()

  const handleTeacherClick = () => {
    router.push('/teacher/dashboard')
  }

  const handleStudentClick = () => {
    router.push('/student/join')
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-4xl px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="mb-16 text-center">
          <Link href="/" className="inline-block mb-8">
            <span className="text-2xl font-bold text-primary">SMART-Draft</span>
          </Link>
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
            Select Your Role
          </h1>
          <p className="text-xl text-foreground/70">
            Choose whether you&apos;re a teacher or student to continue
          </p>
        </div>

        {/* Role Cards */}
        <div className="grid md:grid-cols-2 gap-8 max-w-2xl mx-auto">
          {/* Teacher Card */}
          <div className="bg-card rounded-2xl border-2 border-border/40 p-8 hover:border-primary/50 transition-colors cursor-pointer group" onClick={handleTeacherClick}>
            <div className="mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors mb-4">
                <span className="text-4xl">👨‍🏫</span>
              </div>
              <h2 className="text-2xl font-bold text-foreground">Teacher</h2>
            </div>

            <p className="text-foreground/70 mb-8 leading-relaxed">
              Create sessions, manage student responses, and leverage AI analysis to identify misconceptions and guide instruction.
            </p>

            <ul className="space-y-3 mb-8">
              <li className="flex items-start gap-3 text-foreground/70">
                <span className="text-primary font-bold mt-0.5">✓</span>
                <span>Create and manage classroom sessions</span>
              </li>
              <li className="flex items-start gap-3 text-foreground/70">
                <span className="text-primary font-bold mt-0.5">✓</span>
                <span>View real-time student responses</span>
              </li>
              <li className="flex items-start gap-3 text-foreground/70">
                <span className="text-primary font-bold mt-0.5">✓</span>
                <span>Get AI-powered analysis</span>
              </li>
              <li className="flex items-start gap-3 text-foreground/70">
                <span className="text-primary font-bold mt-0.5">✓</span>
                <span>Export session data</span>
              </li>
            </ul>

            <Button className="w-full" onClick={handleTeacherClick}>
              Continue as Teacher
            </Button>
          </div>

          {/* Student Card */}
          <div className="bg-card rounded-2xl border-2 border-border/40 p-8 hover:border-accent/50 transition-colors cursor-pointer group" onClick={handleStudentClick}>
            <div className="mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-accent/10 group-hover:bg-accent/20 transition-colors mb-4">
                <span className="text-4xl">👤</span>
              </div>
              <h2 className="text-2xl font-bold text-foreground">Student</h2>
            </div>

            <p className="text-foreground/70 mb-8 leading-relaxed">
              Join a session using the teacher’s session code, submit your response, and receive feedback based on your answer.
            </p>

            <ul className="space-y-3 mb-8">
              <li className="flex items-start gap-3 text-foreground/70">
                <span className="text-accent font-bold mt-0.5">✓</span>
                <span>Join with session code</span>
              </li>
              <li className="flex items-start gap-3 text-foreground/70">
                <span className="text-accent font-bold mt-0.5">✓</span>
                <span>Submit your answers</span>
              </li>
              <li className="flex items-start gap-3 text-foreground/70">
                <span className="text-accent font-bold mt-0.5">✓</span>
                <span>Rate your confidence</span>
              </li>
              <li className="flex items-start gap-3 text-foreground/70">
                <span className="text-accent font-bold mt-0.5">✓</span>
                <span>Receive instant feedback</span>
              </li>
            </ul>

            <Button variant="outline" className="w-full" onClick={handleStudentClick}>
              Continue as Student
            </Button>
          </div>
        </div>
      </div>
    </main>
  )
}
