'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { Response, Session, SessionParticipant } from '@/lib/types/database'
import { createClient } from '@/lib/supabase/client'
import { updateSessionStatus } from '@/lib/supabase/queries'
import { teacherLogout } from '@/app/teacher/auth-actions'

type Props = {
  initialSession: Session
  initialParticipants: SessionParticipant[]
  initialResponses: Response[]
}

function formatTimestampUtc(isoLike: string) {
  const date = new Date(isoLike)
  if (Number.isNaN(date.getTime())) return isoLike
  return date.toISOString().replace('T', ' ').replace('Z', ' UTC')
}

function mergeById<T extends Record<string, any>>(
  items: T[],
  item: T,
  idKey: keyof T
): T[] {
  const id = item[idKey]
  if (!id) return items
  const index = items.findIndex(r => r[idKey] === id)
  if (index === -1) return [...items, item]
  const next = items.slice()
  next[index] = { ...items[index], ...item }
  return next
}

const Header = memo(function Header({ session }: { session: Session }) {
  return (
    <header className="border-b border-border/40 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{session.session_code}</h1>
          <p className="text-sm text-foreground/60 mt-1">{session.question}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/teacher/dashboard">
            <Button variant="outline">Back</Button>
          </Link>
          <form action={teacherLogout}>
            <Button variant="outline" type="submit">Log Out</Button>
          </form>
        </div>
      </div>
    </header>
  )
})

const Overview = memo(function Overview({
  status,
  conditionLabel,
  respondingCount,
  totalParticipants,
  responseRate,
}: {
  status: string
  conditionLabel: string
  respondingCount: number
  totalParticipants: number
  responseRate: number
}) {
  return (
    <div className="grid md:grid-cols-4 gap-4 mb-8">
      <Card className="p-6">
        <p className="text-sm text-foreground/60 mb-2">Status</p>
        <p className="text-2xl font-bold text-primary capitalize">{status}</p>
      </Card>
      <Card className="p-6">
        <p className="text-sm text-foreground/60 mb-2">Condition</p>
        <p className="text-2xl font-bold text-accent">{conditionLabel}</p>
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
  )
})

const Controls = memo(function Controls({
  sessionId,
  status,
  condition,
  actionLoading,
  onChangeStatus,
}: {
  sessionId: string
  status: Session['status']
  condition: Session['condition']
  actionLoading: boolean
  onChangeStatus: (next: Session['status']) => void
}) {
  const isDraft = status === 'draft'
  const isLive = status === 'live'
  const isAnalysisReady = status === 'analysis_ready'
  const isRevision = status === 'revision'
  const isClosed = status === 'closed'

  if (isDraft) {
    return (
      <Card className="p-6 mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-4">Session Controls</h2>
        <Button
          onClick={() => onChangeStatus('live')}
          disabled={actionLoading}
          className="w-full md:w-auto"
        >
          {actionLoading ? 'Starting...' : 'Start Session'}
        </Button>
      </Card>
    )
  }

  if (isLive) {
    return (
      <Card className="p-6 mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-4">Session Controls</h2>
        <div className="flex flex-col md:flex-row gap-4">
          <Button disabled variant="secondary" className="flex-1">
            Session Live
          </Button>
          <Button
            onClick={() => onChangeStatus('analysis_ready')}
            disabled={actionLoading}
            variant="outline"
            className="flex-1"
          >
            {actionLoading ? 'Updating...' : 'End Round 1'}
          </Button>
          <Button
            onClick={() => onChangeStatus('closed')}
            disabled={actionLoading}
            variant="outline"
            className="flex-1"
          >
            {actionLoading ? 'Closing...' : 'Close'}
          </Button>
          <Link href={`/teacher/session/${sessionId}/analysis`} className="flex-1">
            <Button className="w-full">View AI Analysis</Button>
          </Link>
        </div>
      </Card>
    )
  }

  if (isAnalysisReady) {
    return (
      <Card className="p-6 mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-4">Round 1 Closed</h2>
        <div className="flex flex-col md:flex-row gap-4">
          <Button disabled variant="secondary" className="flex-1">
            Analysis Ready
          </Button>
          {condition === 'treatment' && (
            <Button
              onClick={() => onChangeStatus('revision')}
              disabled={actionLoading}
              variant="outline"
              className="flex-1"
            >
              {actionLoading ? 'Opening...' : 'Open Revision'}
            </Button>
          )}
          <Button
            onClick={() => onChangeStatus('closed')}
            disabled={actionLoading}
            variant="outline"
            className="flex-1"
          >
            {actionLoading ? 'Closing...' : condition === 'baseline' ? 'End Baseline' : 'Close'}
          </Button>
          <Link href={`/teacher/session/${sessionId}/analysis`} className="flex-1">
            <Button className="w-full">Generate Analysis</Button>
          </Link>
        </div>
      </Card>
    )
  }

  if (isRevision) {
    return (
      <Card className="p-6 mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-4">Session Controls</h2>
        <div className="flex flex-col md:flex-row gap-4">
          <Button disabled variant="secondary" className="flex-1">
            Revision Open
          </Button>
          <Button
            onClick={() => onChangeStatus('analysis_ready')}
            disabled={actionLoading}
            variant="outline"
            className="flex-1"
          >
            {actionLoading ? 'Updating...' : 'End Revision'}
          </Button>
          <Button
            onClick={() => onChangeStatus('closed')}
            disabled={actionLoading}
            variant="outline"
            className="flex-1"
          >
            {actionLoading ? 'Closing...' : 'Close'}
          </Button>
          <Link href={`/teacher/session/${sessionId}/analysis`} className="flex-1">
            <Button className="w-full">View AI Analysis</Button>
          </Link>
        </div>
      </Card>
    )
  }

  if (isClosed) {
    return (
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
    )
  }

  return null
})

export default function SessionDetailClient({
  initialSession,
  initialParticipants,
  initialResponses,
}: Props) {
  const sessionId = initialSession.id
  const [session, setSession] = useState<Session>(initialSession)
  const [participants, setParticipants] = useState<SessionParticipant[]>(initialParticipants)
  const [responses, setResponses] = useState<Response[]>(initialResponses)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [recentResponseIds, setRecentResponseIds] = useState<Set<string>>(new Set())

  const supabase = useMemo(() => createClient(), [])
  const recentTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const participantsRef = useRef<SessionParticipant[]>(initialParticipants)

  const respondingCount = responses.length
  const totalParticipants = participants.length
  const responseRate = totalParticipants > 0 ? Math.round((respondingCount / totalParticipants) * 100) : 0
  const conditionLabel = session.condition === 'baseline' ? 'Baseline' : 'Treatment'

  useEffect(() => {
    return () => {
      recentTimeouts.current.forEach(timeout => clearTimeout(timeout))
      recentTimeouts.current.clear()
    }
  }, [])

  useEffect(() => {
    participantsRef.current = participants
  }, [participants])

  useEffect(() => {
    const channel = supabase.channel(`teacher-session:${sessionId}`)

    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'responses', filter: `session_id=eq.${sessionId}` },
      (payload) => {
        const inserted = payload.new as Partial<Response> & Record<string, any>
        const responseId = String(inserted.response_id || '')
        if (!responseId) return

        const participantId = String(inserted.session_participant_id || '')
        const label = participantId
          ? participantsRef.current.find(p => p.session_participant_id === participantId)?.anonymized_label
          : undefined

        const nextRow = {
          ...inserted,
          ...(label
            ? { session_participants: { session_participant_id: participantId, anonymized_label: label } }
            : {}),
        } as Response

        setResponses(prev => mergeById(prev, nextRow, 'response_id'))

        setRecentResponseIds(prev => {
          const next = new Set(prev)
          next.add(responseId)
          return next
        })

        const timeout = setTimeout(() => {
          setRecentResponseIds(prev => {
            const next = new Set(prev)
            next.delete(responseId)
            return next
          })
          recentTimeouts.current.delete(responseId)
        }, 1200)
        recentTimeouts.current.set(responseId, timeout)
      }
    )

    channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'responses', filter: `session_id=eq.${sessionId}` },
      (payload) => {
        const updated = payload.new as Partial<Response> & Record<string, any>
        const responseId = String(updated.response_id || '')
        if (!responseId) return
        setResponses(prev => mergeById(prev, updated as Response, 'response_id'))
      }
    )

    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'session_participants', filter: `session_id=eq.${sessionId}` },
      (payload) => {
        const inserted = payload.new as Partial<SessionParticipant> & Record<string, any>
        const participantId = inserted.session_participant_id
        if (!participantId) return
        setParticipants(prev => mergeById(prev, inserted as SessionParticipant, 'session_participant_id'))
      }
    )

    channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
      (payload) => {
        const updated = payload.new as Partial<Session> & Record<string, any>
        if (!updated || !updated.id) return
        setSession(prev => ({ ...prev, ...updated }))
      }
    )

    channel.subscribe()

    return () => {
      void channel.unsubscribe()
      supabase.removeChannel(channel)
    }
  }, [supabase, sessionId])

  const handleStatusChange = async (newStatus: Session['status']) => {
    try {
      setActionLoading(true)
      setError(null)
      const updated = await updateSessionStatus(sessionId, newStatus)
      setSession(updated)
    } catch (err) {
      console.error('Error updating session status:', err)
      setError('Failed to update session status')
    } finally {
      setActionLoading(false)
    }
  }

  const responsesSorted = useMemo(() => {
    return [...responses].sort((a, b) => {
      const at = a.created_at ? new Date(a.created_at).getTime() : 0
      const bt = b.created_at ? new Date(b.created_at).getTime() : 0
      if (at !== bt) return at - bt
      return String(a.response_id).localeCompare(String(b.response_id))
    })
  }, [responses])

  return (
    <main className="min-h-screen bg-background">
      <Header session={session} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {error && (
          <Card className="mb-6 p-4 border-destructive/30 bg-destructive/5">
            <p className="text-destructive text-sm">{error}</p>
          </Card>
        )}

        <Overview
          status={session.status}
          conditionLabel={conditionLabel}
          respondingCount={respondingCount}
          totalParticipants={totalParticipants}
          responseRate={responseRate}
        />

        <Controls
          sessionId={sessionId}
          status={session.status}
          condition={session.condition}
          actionLoading={actionLoading}
          onChangeStatus={handleStatusChange}
        />

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

          {responsesSorted.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-foreground/60">No responses yet</p>
              {session.status === 'draft' && (
                <p className="text-sm text-foreground/60 mt-2">Start the session to allow students to respond</p>
              )}
            </Card>
          ) : (
            <div className="grid gap-4">
              {responsesSorted.map((response, idx) => {
                const responseId = String(response.response_id)
                const isRecent = recentResponseIds.has(responseId)
                return (
                  <Card
                    key={responseId}
                    className={[
                      'p-6 transition-colors',
                      isRecent ? 'ring-1 ring-primary/25 bg-primary/5 animate-in fade-in duration-300' : '',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <p className="font-semibold text-foreground">
                          {response.session_participants?.anonymized_label || `Participant ${idx + 1}`}
                        </p>
                        <p className="text-sm text-foreground/60">
                          {response.session_questions?.position ? `Q${response.session_questions.position}` : 'Question'} • R{response.round_number}
                        </p>
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
                      Submitted {formatTimestampUtc(response.created_at)}
                    </p>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
