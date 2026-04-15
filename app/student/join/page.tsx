'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { joinSessionByCode } from '@/lib/supabase/queries'

export default function StudentJoin() {
  const router = useRouter()
  const [sessionCode, setSessionCode] = useState('')
  const [studentName, setStudentName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { session, participation } = await joinSessionByCode(sessionCode, {
        studentName,
        studentId,
      })

      sessionStorage.setItem('anonymizedLabel', participation.anonymized_label)
      sessionStorage.setItem('sessionId', session.id)
      sessionStorage.setItem('sessionCode', session.session_code)
      if (studentName.trim()) sessionStorage.setItem('studentName', studentName.trim())
      if (studentId.trim()) sessionStorage.setItem('studentId', studentId.trim())

      router.push(`/student/respond/${session.id}`)
    } catch (err) {
      console.error('Error joining:', err)
      setError(err instanceof Error ? err.message : 'An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-md px-4">
        {/* Header */}
        <div className="mb-12 text-center">
          <Link href="/" className="inline-block mb-8">
            <span className="text-2xl font-bold text-primary">SMART-Draft</span>
          </Link>
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Join a Session
          </h1>
          <p className="text-lg text-foreground/70">
            Enter the session code plus your name or student ID
          </p>
        </div>

        {/* Form Card */}
        <Card className="p-8">
          <form onSubmit={handleJoin} className="space-y-6">
            <div>
              <label htmlFor="sessionCode" className="block text-sm font-medium text-foreground mb-3">
                Session Code
              </label>
              <Input
                id="sessionCode"
                type="text"
                value={sessionCode}
                onChange={(e) => setSessionCode(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                placeholder="e.g., DATA-STRUCTURES-01"
                className="w-full text-center text-lg tracking-widest"
                disabled={loading}
                required
              />
            </div>

            <div>
              <label htmlFor="studentId" className="block text-sm font-medium text-foreground mb-3">
                Student ID (recommended)
              </label>
              <Input
                id="studentId"
                type="text"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                placeholder="e.g., 2026001234"
                className="w-full"
                disabled={loading}
              />
              <p className="text-xs text-foreground/60 mt-2">
                Using a student ID prevents duplicates (e.g., two students named “John”).
              </p>
            </div>

            <div>
              <label htmlFor="studentName" className="block text-sm font-medium text-foreground mb-3">
                Name (optional)
              </label>
              <Input
                id="studentName"
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="e.g., John"
                className="w-full"
                disabled={loading}
              />
            </div>

            {error && (
              <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={loading || !sessionCode || (!studentId.trim() && !studentName.trim())}
              size="lg"
            >
              {loading ? 'Joining...' : 'Join Session'}
            </Button>
          </form>

          <div className="mt-8 pt-8 border-t border-border/40">
            <p className="text-sm text-foreground/60 text-center">
              Ask your instructor for the session code.
            </p>
          </div>
        </Card>

        {/* Back Link */}
        <div className="mt-8 text-center">
          <Link href="/role-select" className="text-foreground/60 hover:text-foreground transition-colors">
            ← Back to Role Selection
          </Link>
        </div>
      </div>
    </main>
  )
}
