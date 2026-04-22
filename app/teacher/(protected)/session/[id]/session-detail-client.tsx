'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  completeSession,
  moveToNextQuestion,
  openQuestionRevision,
  startCurrentQuestion,
} from '@/lib/supabase/queries'
import { teacherLogout } from '@/app/teacher/auth-actions'
import type {
  AttemptType,
  LiveQuestionAnalysis,
  Response,
  Session,
  SessionParticipant,
  SessionQuestion,
} from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

type Props = {
  initialSession: Session
  initialQuestions: SessionQuestion[]
  initialParticipants: SessionParticipant[]
  initialResponses: Response[]
  initialLiveQuestionAnalyses: LiveQuestionAnalysis[]
}

type LiveAnalysisPayload = {
  version: 'live_question_clusters_v1'
  question_prompt: string
  attempt_type: AttemptType
  total_responses: number
  cluster_count: number
  source: 'openai' | 'fallback'
  clusters: Array<{
    cluster_id: string
    label: string
    summary: string
    count: number
    average_confidence: number
    representative_answers: string[]
    response_ids: string[]
  }>
}

function mergeById<T extends Record<string, any>>(items: T[], item: T, idKey: keyof T) {
  const index = items.findIndex((row) => row[idKey] === item[idKey])
  if (index === -1) return [...items, item]
  const next = items.slice()
  next[index] = { ...next[index], ...item }
  return next
}

function mergeByKey<T>(items: T[], item: T, keyOf: (value: T) => string) {
  const key = keyOf(item)
  const index = items.findIndex((row) => keyOf(row) === key)
  if (index === -1) return [...items, item]
  const next = items.slice()
  next[index] = item
  return next
}

function parseAnalysis(value: LiveQuestionAnalysis | null | undefined): LiveAnalysisPayload | null {
  const raw = value?.analysis_json
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).clusters)) return null
  return raw as unknown as LiveAnalysisPayload
}

function getPhaseLabel(session: Session) {
  switch (session.live_phase) {
    case 'not_started':
      return 'Not started'
    case 'question_initial_open':
      return 'Initial question live'
    case 'question_initial_closed':
      return 'Initial question closed'
    case 'question_revision_open':
      return 'Revision live'
    case 'question_revision_closed':
      return 'Revision closed'
    case 'session_completed':
      return 'Session completed'
    default:
      return session.live_phase
  }
}

function getCurrentAttemptType(session: Session): AttemptType {
  return session.live_phase === 'question_revision_open' || session.live_phase === 'question_revision_closed'
    ? 'revision'
    : 'initial'
}

function isQuestionOpen(session: Session) {
  return session.live_phase === 'question_initial_open' || session.live_phase === 'question_revision_open'
}

function BubbleClusterView({
  analysis,
  selectedClusterId,
  onSelectCluster,
  title,
}: {
  analysis: LiveAnalysisPayload | null
  selectedClusterId: string | null
  onSelectCluster: (clusterId: string) => void
  title: string
}) {
  const selectedCluster =
    analysis?.clusters.find((cluster) => cluster.cluster_id === selectedClusterId) || analysis?.clusters[0] || null

  if (!analysis || analysis.clusters.length === 0) {
    return (
      <Card className="p-6">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="mt-2 text-sm text-foreground/60">No cluster result yet.</p>
      </Card>
    )
  }

  const maxCount = Math.max(...analysis.clusters.map((cluster) => cluster.count), 1)

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <Card className="p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-foreground">{title}</p>
            <p className="text-sm text-foreground/60">{analysis.cluster_count} clusters</p>
          </div>
          <Badge variant="outline">{analysis.source === 'openai' ? 'AI clustered' : 'Fallback clustered'}</Badge>
        </div>

        <div className="mt-6 flex flex-wrap gap-4">
          {analysis.clusters.map((cluster) => {
            const size = 96 + (cluster.count / maxCount) * 72
            const opacity = 0.22 + (cluster.average_confidence / 5) * 0.45
            const isSelected = cluster.cluster_id === (selectedClusterId || analysis.clusters[0]?.cluster_id)

            return (
              <button
                key={cluster.cluster_id}
                type="button"
                onClick={() => onSelectCluster(cluster.cluster_id)}
                className={`flex shrink-0 flex-col items-center justify-center rounded-full border text-center transition ${
                  isSelected ? 'border-primary ring-2 ring-primary/25' : 'border-border/60'
                }`}
                style={{
                  width: `${size}px`,
                  height: `${size}px`,
                  backgroundColor: `rgba(59, 130, 246, ${opacity})`,
                }}
              >
                <span className="px-3 text-xs font-semibold text-foreground">{cluster.label}</span>
                <span className="mt-1 text-lg font-bold text-foreground">{cluster.count}</span>
                <span className="text-[11px] text-foreground/70">{cluster.average_confidence.toFixed(1)}/5</span>
              </button>
            )
          })}
        </div>
      </Card>

      <Card className="p-6">
        {selectedCluster ? (
          <>
            <p className="text-sm text-foreground/60">Selected cluster</p>
            <h3 className="mt-1 text-xl font-semibold text-foreground">{selectedCluster.label}</h3>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-secondary/25 p-3">
                <p className="text-foreground/60">Students</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{selectedCluster.count}</p>
              </div>
              <div className="rounded-lg bg-secondary/25 p-3">
                <p className="text-foreground/60">Avg confidence</p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {selectedCluster.average_confidence.toFixed(1)}/5
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-lg bg-secondary/20 p-4">
              <p className="text-sm font-medium text-foreground">Neutral summary</p>
              <p className="mt-2 text-sm leading-6 text-foreground/80">{selectedCluster.summary}</p>
            </div>

            <div className="mt-4">
              <p className="text-sm font-medium text-foreground">Representative answers</p>
              <div className="mt-2 space-y-2">
                {selectedCluster.representative_answers.map((answer, index) => (
                  <div key={`${selectedCluster.cluster_id}-${index}`} className="rounded-lg border border-border/60 p-3 text-sm text-foreground/80">
                    {answer}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-foreground/60">Select a cluster to inspect it.</p>
        )}
      </Card>
    </div>
  )
}

export default function SessionDetailClient({
  initialSession,
  initialQuestions,
  initialParticipants,
  initialResponses,
  initialLiveQuestionAnalyses,
}: Props) {
  const sessionId = initialSession.id
  const [session, setSession] = useState(initialSession)
  const [participants, setParticipants] = useState(initialParticipants)
  const [responses, setResponses] = useState(initialResponses)
  const [liveQuestionAnalyses, setLiveQuestionAnalyses] = useState(initialLiveQuestionAnalyses)
  const [timerInput, setTimerInput] = useState('')
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null)
  const [selectedInitialClusterId, setSelectedInitialClusterId] = useState<string | null>(null)
  const [selectedRevisionClusterId, setSelectedRevisionClusterId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const questions = useMemo(() => initialQuestions.slice().sort((a, b) => a.position - b.position), [initialQuestions])
  const supabase = useMemo(() => createClient(), [])

  const currentQuestion =
    questions.find((question) => question.position === session.current_question_position) || questions[0] || null
  const isLastQuestion = Boolean(currentQuestion && currentQuestion.position === questions.length)
  const attemptType = getCurrentAttemptType(session)

  const currentResponses = useMemo(() => {
    if (!currentQuestion) return []
    return responses.filter((response) => {
      return response.question_id === currentQuestion.question_id && response.attempt_type === attemptType
    })
  }, [attemptType, currentQuestion, responses])

  const initialAnalysis = useMemo(() => {
    if (!currentQuestion) return null
    return parseAnalysis(
      liveQuestionAnalyses.find((analysis) => {
        return analysis.question_id === currentQuestion.question_id && analysis.attempt_type === 'initial'
      }) || null
    )
  }, [currentQuestion, liveQuestionAnalyses])

  const revisionAnalysis = useMemo(() => {
    if (!currentQuestion) return null
    return parseAnalysis(
      liveQuestionAnalyses.find((analysis) => {
        return analysis.question_id === currentQuestion.question_id && analysis.attempt_type === 'revision'
      }) || null
    )
  }, [currentQuestion, liveQuestionAnalyses])

  const showSingleInitialCluster =
    session.live_phase === 'question_initial_closed' ||
    session.live_phase === 'question_revision_open' ||
    (session.live_phase === 'session_completed' && (!revisionAnalysis || session.condition === 'baseline'))

  useEffect(() => {
    setTimerInput(
      session.current_timer_seconds !== null && session.current_timer_seconds !== undefined
        ? String(session.current_timer_seconds)
        : currentQuestion?.timer_seconds
          ? String(currentQuestion.timer_seconds)
          : ''
    )
  }, [currentQuestion?.question_id, currentQuestion?.timer_seconds, session.current_timer_seconds])

  useEffect(() => {
    if (!isQuestionOpen(session) || !session.timer_started_at || !session.current_timer_seconds) {
      setSecondsRemaining(null)
      return
    }

    const tick = () => {
      const elapsed = Math.floor((Date.now() - new Date(session.timer_started_at as string).getTime()) / 1000)
      const remaining = Math.max(0, session.current_timer_seconds! - elapsed)
      setSecondsRemaining(remaining)
    }

    tick()
    const interval = window.setInterval(tick, 1000)
    return () => window.clearInterval(interval)
  }, [session.current_timer_seconds, session.timer_started_at, session.live_phase])

  useEffect(() => {
    const channel = supabase.channel(`teacher-live-session:${sessionId}`)

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
      (payload) => {
        const updated = payload.new as Session
        if (updated?.id) setSession((prev) => ({ ...prev, ...updated }))
      }
    )

    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'session_participants', filter: `session_id=eq.${sessionId}` },
      (payload) => {
        const inserted = payload.new as SessionParticipant
        if (inserted?.session_participant_id) {
          setParticipants((prev) => mergeById(prev, inserted, 'session_participant_id'))
        }
      }
    )

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'responses', filter: `session_id=eq.${sessionId}` },
      (payload) => {
        const next = payload.new as Response
        if (next?.response_id) {
          setResponses((prev) => mergeById(prev, next, 'response_id'))
        }
      }
    )

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'live_question_analyses', filter: `session_id=eq.${sessionId}` },
      (payload) => {
        const next = payload.new as LiveQuestionAnalysis
        if (next?.live_question_analysis_id) {
          setLiveQuestionAnalyses((prev) =>
            mergeByKey(prev, next, (row) => `${row.question_id}:${row.attempt_type}`)
          )
        }
      }
    )

    channel.subscribe()
    return () => {
      void channel.unsubscribe()
      supabase.removeChannel(channel)
    }
  }, [sessionId, supabase])

  const runAction = async (label: string, action: () => Promise<void>) => {
    try {
      setActionLoading(label)
      setError(null)
      await action()
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Action failed.')
    } finally {
      setActionLoading(null)
    }
  }

  const getTimerValue = () => {
    const trimmed = timerInput.trim()
    if (!trimmed) return null
    return Math.max(0, Math.floor(Number(trimmed) || 0))
  }

  const handleAnalyzeAndClose = async (nextAttemptType: AttemptType) => {
    await runAction(`analyze-${nextAttemptType}`, async () => {
      const response = await fetch('/api/live-question-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, attemptType: nextAttemptType }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to analyze this question.')
      }

      setSession((prev) => ({
        ...prev,
        live_phase: nextAttemptType === 'revision' ? 'question_revision_closed' : 'question_initial_closed',
        current_timer_seconds: null,
        timer_started_at: null,
      }))
      if (payload?.saved) {
        setLiveQuestionAnalyses((prev) =>
          mergeByKey(prev, payload.saved, (row) => `${row.question_id}:${row.attempt_type}`)
        )
      }
    })
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border/40 sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{session.session_code}</h1>
            <p className="mt-1 text-sm text-foreground/60">Live classroom control</p>
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

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        {error && (
          <Card className="mb-6 border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm text-destructive">{error}</p>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-5">
          <Card className="p-5">
            <p className="text-sm text-foreground/60">Condition</p>
            <div className="mt-2">
              <Badge variant="outline" className="capitalize">{session.condition}</Badge>
            </div>
          </Card>
          <Card className="p-5">
            <p className="text-sm text-foreground/60">Phase</p>
            <p className="mt-2 text-lg font-semibold text-foreground">{getPhaseLabel(session)}</p>
          </Card>
          <Card className="p-5">
            <p className="text-sm text-foreground/60">Joined</p>
            <p className="mt-2 text-3xl font-bold text-foreground">{participants.length}</p>
          </Card>
          <Card className="p-5">
            <p className="text-sm text-foreground/60">
              {attemptType === 'revision' ? 'Revision submissions' : 'Initial submissions'}
            </p>
            <p className="mt-2 text-3xl font-bold text-foreground">{currentResponses.length}</p>
          </Card>
          <Card className="p-5">
            <p className="text-sm text-foreground/60">Timer</p>
            <p className="mt-2 text-3xl font-bold text-foreground">
              {secondsRemaining === null ? '—' : `${secondsRemaining}s`}
            </p>
          </Card>
        </div>

        <Card className="mt-6 p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-4xl">
              <p className="text-sm font-medium uppercase tracking-wide text-foreground/55">
                Question {currentQuestion?.position || 1} of {questions.length}
              </p>
              <p className="mt-4 text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
                {currentQuestion?.prompt || 'No question configured.'}
              </p>
            </div>

            <div className="w-full max-w-sm space-y-3">
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Timer for next open state (seconds)</label>
                <Input
                  type="number"
                  min={0}
                  value={timerInput}
                  onChange={(event) => setTimerInput(event.target.value)}
                  placeholder="Optional"
                />
              </div>

              {session.live_phase === 'not_started' && (
                <Button
                  className="w-full"
                  disabled={actionLoading !== null}
                  onClick={() => runAction('start-question', async () => {
                    const updated = await startCurrentQuestion(sessionId, getTimerValue())
                    setSession(updated)
                  })}
                >
                  {actionLoading === 'start-question' ? 'Starting...' : 'Start Question'}
                </Button>
              )}

              {session.live_phase === 'question_initial_open' && (
                <Button
                  className="w-full"
                  disabled={actionLoading !== null}
                  onClick={() => void handleAnalyzeAndClose('initial')}
                >
                  {actionLoading === 'analyze-initial' ? 'Ending question...' : 'End Question and Cluster'}
                </Button>
              )}

              {session.live_phase === 'question_initial_closed' && session.condition === 'treatment' && (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={actionLoading !== null}
                  onClick={() => runAction('open-revision', async () => {
                    const updated = await openQuestionRevision(sessionId, getTimerValue())
                    setSession(updated)
                  })}
                >
                  {actionLoading === 'open-revision' ? 'Opening revision...' : 'Open Revision'}
                </Button>
              )}

              {session.live_phase === 'question_revision_open' && (
                <Button
                  className="w-full"
                  disabled={actionLoading !== null}
                  onClick={() => void handleAnalyzeAndClose('revision')}
                >
                  {actionLoading === 'analyze-revision' ? 'Ending revision...' : 'End Revision and Cluster'}
                </Button>
              )}

              {(session.live_phase === 'question_initial_closed' || session.live_phase === 'question_revision_closed') && !isLastQuestion && (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={actionLoading !== null}
                  onClick={() => runAction('next-question', async () => {
                    const updated = await moveToNextQuestion(sessionId, getTimerValue())
                    setSession(updated)
                  })}
                >
                  {actionLoading === 'next-question' ? 'Opening next question...' : 'Next Question'}
                </Button>
              )}

              {(session.live_phase === 'question_initial_closed' || session.live_phase === 'question_revision_closed' || session.live_phase === 'session_completed') && (
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={actionLoading !== null}
                  onClick={() => runAction('complete-session', async () => {
                    const updated = await completeSession(sessionId)
                    setSession(updated)
                  })}
                >
                  {actionLoading === 'complete-session' ? 'Ending session...' : 'End Session'}
                </Button>
              )}

              {session.live_phase === 'session_completed' && (
                <div className="grid gap-3">
                  <Link href={`/teacher/session/${sessionId}/analysis`}>
                    <Button className="w-full">Full Session Analysis</Button>
                  </Link>
                  <Link href={`/teacher/session/${sessionId}/export`}>
                    <Button variant="outline" className="w-full">Export Session Data</Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </Card>

        <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <Card className="p-6">
            <p className="text-lg font-semibold text-foreground">Current response feed</p>
            <p className="mt-1 text-sm text-foreground/60">
              {attemptType === 'revision' ? 'Revision attempts for this question' : 'Initial attempts for this question'}
            </p>
            <div className="mt-4 space-y-3">
              {currentResponses.length === 0 ? (
                <p className="text-sm text-foreground/60">No submissions yet for this question attempt.</p>
              ) : (
                currentResponses
                  .slice()
                  .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
                  .map((response) => (
                    <div key={response.response_id} className="rounded-lg border border-border/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-foreground">
                          {response.session_participants?.anonymized_label || 'Participant'}
                        </p>
                        <p className="text-sm text-foreground/60">Confidence {response.confidence}/5</p>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-foreground/80">{response.answer}</p>
                    </div>
                  ))
              )}
            </div>
          </Card>

          <div className="space-y-6">
            {showSingleInitialCluster && (
              <BubbleClusterView
                analysis={initialAnalysis}
                selectedClusterId={selectedInitialClusterId}
                onSelectCluster={setSelectedInitialClusterId}
                title="Initial clustering"
              />
            )}

            {(session.live_phase === 'question_revision_closed' || session.live_phase === 'session_completed') && session.condition === 'treatment' && revisionAnalysis && (
              <div className="grid gap-6 xl:grid-cols-2">
                <BubbleClusterView
                  analysis={initialAnalysis}
                  selectedClusterId={selectedInitialClusterId}
                  onSelectCluster={setSelectedInitialClusterId}
                  title="Initial clustering"
                />
                <BubbleClusterView
                  analysis={revisionAnalysis}
                  selectedClusterId={selectedRevisionClusterId}
                  onSelectCluster={setSelectedRevisionClusterId}
                  title="Revision clustering"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
