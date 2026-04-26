'use client'

import { useMemo, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getSessionsByTeacher } from '@/lib/supabase/queries'
import type { Session } from '@/lib/types/database'
import { usePostgresChanges } from '@/hooks/use-postgres-changes'
import { teacherLogout } from '@/app/teacher/auth-actions'

function formatDateUtc(isoLike: string) {
  const date = new Date(isoLike)
  if (Number.isNaN(date.getTime())) return isoLike
  return date.toISOString().slice(0, 10)
}

export default function TeacherDashboard() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const realtimeTables = useMemo(
    () => [{ table: 'sessions', event: '*' as const }],
    []
  )

  const loadSessions = useCallback(async () => {
    try {
      setLoading(true)
      // For now, use a demo teacher ID
      const teacherId = 'demo-teacher-001'
      const data = await getSessionsByTeacher(teacherId)
      setSessions(data)
    } catch (err) {
      console.error('Error loading sessions:', err)
      setError('Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  usePostgresChanges({
    tables: realtimeTables,
    onChange: loadSessions,
    pollMs: 8000,
    debugLabel: 'teacher-dashboard',
  })

  const getStatusBadge = (status: string) => {
    const colors = {
      draft: 'bg-muted text-muted-foreground',
      live: 'bg-primary/20 text-primary',
      analysis_ready: 'bg-secondary/50 text-foreground',
      revision: 'bg-accent/20 text-accent',
      closed: 'bg-destructive/20 text-destructive',
    }
    return colors[status as keyof typeof colors] || colors.draft
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Teacher Dashboard</h1>
            <p className="text-sm text-foreground/60 mt-1">Manage your classroom sessions</p>
          </div>
          <form action={teacherLogout}>
            <Button variant="outline" type="submit">Log Out</Button>
          </form>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Action Buttons */}
        <div className="mb-12">
          <Link href="/teacher/create-session">
            <Button size="lg">
              Create New Session
            </Button>
          </Link>
        </div>

        {/* Sessions List */}
        <div>
          <h2 className="text-2xl font-bold text-foreground mb-6">Your Sessions</h2>

          {loading && (
            <div className="text-center py-12">
              <p className="text-foreground/60">Loading sessions...</p>
            </div>
          )}

          {error && (
            <Card className="p-6 border-destructive/30 bg-destructive/5">
              <p className="text-destructive">{error}</p>
            </Card>
          )}

          {!loading && !error && sessions.length === 0 && (
            <Card className="p-12 text-center">
              <div className="text-5xl mb-4">📚</div>
              <h3 className="text-xl font-semibold text-foreground mb-2">No sessions yet</h3>
              <p className="text-foreground/60 mb-6">Create your first session to get started</p>
              <Link href="/teacher/create-session">
                <Button>Create Your First Session</Button>
              </Link>
            </Card>
          )}

          {!loading && sessions.length > 0 && (
            <div className="grid gap-6">
              {sessions.map((session) => (
                <Card key={session.id} className="p-6 transition-colors hover:border-primary/50">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <Link
                        href={`/teacher/session/${session.id}`}
                        className="inline-block text-xl font-semibold text-foreground transition-colors hover:text-primary"
                      >
                        {session.session_code}
                      </Link>
                      <p className="text-sm text-foreground/60 mt-1">{session.question}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusBadge(session.status)}`}>
                      {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
                    </span>
                  </div>

                  <div className="space-y-2 text-sm text-foreground/70 mb-4">
                    <p>
                      <span className="font-medium">Answer Options:</span> {' '}
                      {session.answer_options.length > 0 ? session.answer_options.join(', ') : 'Free response'}
                    </p>
                    <p>
                      <span className="font-medium">Condition:</span> {' '}
                      {session.condition === 'baseline' ? 'Baseline (Direct Feedback)' : 'Treatment (Misconception Analysis)'}
                    </p>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <p className="text-foreground/60">
                      Created {formatDateUtc(session.created_at)}
                    </p>
                    <Link
                      href={`/teacher/session/${session.id}`}
                      className="font-medium text-primary transition-colors hover:text-primary/80"
                    >
                      View Details →
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
