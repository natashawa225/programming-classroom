'use client'

import { useMemo, useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getSession, getSessionParticipants, getSessionResponses, updateSessionStatus } from '@/lib/supabase/queries'
import type { Session } from '@/lib/types/database'
import { usePostgresChanges } from '@/hooks/use-postgres-changes'

export default function SessionDetail() {
  const params = useParams()
  const sessionId = params.id as string

  const [session, setSession] = useState<Session | null>(null)
  const [participants, setParticipants] = useState<any[]>([])
  const [responses, setResponses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const realtimeTables = useMemo(
    () => [
      { table: 'responses', event: '*' as const, filter: `session_id=eq.${sessionId}` },
      { table: 'session_participants', event: '*' as const, filter: `session_id=eq.${sessionId}` },
      { table: 'sessions', event: '*' as const, filter: `id=eq.${sessionId}` },
    ],
    [sessionId]
  )

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [sessionData, participantsData, responsesData] = await Promise.all([
        getSession(sessionId),
        getSessionParticipants(sessionId),
        getSessionResponses(sessionId),
      ])
      setSession(sessionData)
      setParticipants(participantsData || [])
      setResponses(responsesData || [])
    } catch (err) {
      console.error('Error loading session:', err)
      setError('Failed to load session data')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    loadData()
  }, [loadData])

  usePostgresChanges({
    tables: realtimeTables,
    onChange: loadData,
  })

  const handleStatusChange = async (newStatus: 'active' | 'complete') => {
    if (!session) return

    try {
      setActionLoading(true)
      const updated = await updateSessionStatus(sessionId, newStatus)
      setSession(updated)
    } catch (err) {
      console.error('Error updating session:', err)
      setError('Failed to update session status')
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-foreground/60">Loading session...</p>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Card className="p-6 text-center">
            <p className="text-destructive mb-4">Session not found</p>
            <Link href="/teacher/dashboard">
              <Button variant="outline">Back to Dashboard</Button>
            </Link>
          </Card>
        </div>
      </main>
    )
  }

  const respondingCount = responses.length
  const totalParticipants = participants.length
  const responseRate = totalParticipants > 0 ? Math.round((respondingCount / totalParticipants) * 100) : 0
  const isWaiting = session.status === 'waiting'
  const isActive = session.status === 'active'
  const isComplete = session.status === 'complete'

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{session.session_code}</h1>
            <p className="text-sm text-foreground/60 mt-1">{session.question}</p>
          </div>
          <Link href="/teacher/dashboard">
            <Button variant="outline">Back</Button>
          </Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {error && (
          <Card className="mb-6 p-4 border-destructive/30 bg-destructive/5">
            <p className="text-destructive text-sm">{error}</p>
          </Card>
        )}

        {/* Session Overview */}
        <div className="grid md:grid-cols-4 gap-4 mb-8">
          <Card className="p-6">
            <p className="text-sm text-foreground/60 mb-2">Status</p>
            <p className="text-2xl font-bold text-primary capitalize">{session.status}</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-foreground/60 mb-2">Condition</p>
            <p className="text-2xl font-bold text-accent">
              {session.condition === 'baseline' ? 'Baseline' : 'Treatment'}
            </p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-foreground/60 mb-2">Responses</p>
            <p className="text-2xl font-bold">{respondingCount}/{totalParticipants}</p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-foreground/60 mb-2">Response Rate</p>
            <p className="text-2xl font-bold">{responseRate}%</p>
          </Card>
        </div>

        {/* Session Controls */}
        {isWaiting && (
          <Card className="p-6 mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-4">Session Controls</h2>
            <Button
              onClick={() => handleStatusChange('active')}
              disabled={actionLoading}
              className="w-full md:w-auto"
            >
              {actionLoading ? 'Starting...' : 'Start Session'}
            </Button>
          </Card>
        )}

        {isActive && (
          <Card className="p-6 mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-4">Session Controls</h2>
            <div className="flex flex-col md:flex-row gap-4">
              <Button disabled variant="secondary" className="flex-1">
                Session Active
              </Button>
              <Button
                onClick={() => handleStatusChange('complete')}
                disabled={actionLoading}
                variant="outline"
                className="flex-1"
              >
                {actionLoading ? 'Closing...' : 'Close Session'}
              </Button>
              <Link href={`/teacher/session/${sessionId}/analysis`} className="flex-1">
                <Button className="w-full">View AI Analysis</Button>
              </Link>
            </div>
          </Card>
        )}

        {isComplete && (
          <Card className="p-6 mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-4">Session Closed</h2>
            <div className="flex flex-col md:flex-row gap-4">
              <Link href={`/teacher/session/${sessionId}/analysis`} className="flex-1">
                <Button className="w-full">View AI Analysis</Button>
              </Link>
              <Link href={`/teacher/session/${sessionId}/export`} className="flex-1">
                <Button variant="outline" className="w-full">Export Data</Button>
              </Link>
            </div>
          </Card>
        )}

        {/* Question Details */}
        <Card className="p-6 mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-4">Question</h2>
          <p className="text-foreground mb-6">{session.question}</p>
          {session.answer_options.length > 0 && (
            <div className="mb-6">
              <p className="text-sm text-foreground/60 mb-2">Answer Options:</p>
              <ul className="space-y-2">
                {session.answer_options.map((option, idx) => (
                  <li key={idx} className="px-4 py-2 rounded-lg bg-secondary/30 text-foreground">
                    {option}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="bg-primary/10 p-4 rounded-lg">
            <p className="text-sm text-foreground/60 mb-2">Correct Answer:</p>
            <p className="text-foreground font-medium">{session.correct_answer}</p>
          </div>
        </Card>

        {/* Responses List */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Student Responses</h2>
          
          {responses.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-foreground/60">No responses yet</p>
              {session.status === 'waiting' && (
                <p className="text-sm text-foreground/60 mt-2">Start the session to allow students to respond</p>
              )}
            </Card>
          ) : (
            <div className="grid gap-4">
              {responses.map((response, idx) => (
                <Card key={response.response_id} className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="font-semibold text-foreground">
                        {response.session_participants?.anonymized_label || `Participant ${idx + 1}`}
                      </p>
                      <p className="text-sm text-foreground/60">Session participant</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-foreground/60">Confidence</p>
                      <p className="text-lg font-semibold text-accent">{response.confidence}/5</p>
                    </div>
                  </div>
                  <div className="bg-secondary/30 p-3 rounded-lg">
                    <p className="text-sm text-foreground/60 mb-2">Answer:</p>
                    <p className="text-foreground">{response.answer}</p>
                  </div>
                  <p className="text-xs text-foreground/60 mt-3">
                    Submitted {new Date(response.created_at).toLocaleString()}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
