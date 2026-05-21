'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { StudentLogoutButton } from '@/components/student-logout-button'

type StudentHistorySession = {
  sessionParticipantId: string
  sessionId: string
  sessionCode: string
  title: string
  question: string
  condition: 'baseline' | 'treatment'
  status: string
  livePhase: string
  joinedAt: string
  questionCount: number
  responseCount: number
  revisionResponseCount: number
  questions: Array<{
    questionId: string
    position: number
    prompt: string
    initialAnswer: StudentHistoryAnswer | null
    revisionAnswer: StudentHistoryAnswer | null
  }>
}

type StudentHistoryAnswer = {
  responseId: string
  answer: string
  confidence: number
  createdAt: string
}

type StudentSummary = {
  headline: string
  overall_summary: string
  strengths: string[]
  needs_practice: string[]
  confidence_insight: string
  question_cards: Array<{
    question_id: string
    question_text: string
    initial_answer: string | null
    revision_answer: string | null
    initial_confidence: number | null
    revision_confidence: number | null
    cluster_feedback: {
      student_title: string | null
      reasoning_pattern: string | null
      what_you_understood: string | null
      likely_gap: string | null
      micro_hint: string | null
      try_again_prompt: string | null
      counterexample: string | null
      confidence_check: string | null
    } | null
    improvement: {
      movement_label: string
      alignment_delta: number | null
      confidence_delta: number | null
      short_interpretation: string
    }
  }>
  recommended_next_steps: string[]
  analysis_status: 'ok' | 'fallback' | 'partial'
  fallback_used: boolean
  fallback_reason: string | null
  warnings: string[]
}

function formatDate(value: string) {
  if (!value) return 'Unknown date'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatStatus(session: StudentHistorySession) {
  if (session.livePhase === 'session_completed' || session.status === 'closed') return 'Completed'
  if (session.status === 'live' || session.status === 'revision') return 'Active'
  return session.status ? session.status.charAt(0).toUpperCase() + session.status.slice(1) : 'Active'
}

function movementDisplayLabel(value: string) {
  const labels: Record<string, string> = {
    strong_improvement: 'Strong improvement',
    partial_improvement: 'Partly improved',
    stable_strong: 'Stable and strong',
    stable_needs_review: 'Review again',
    possible_regression: 'Compare attempts',
    confidence_miscalibration: 'Confidence check',
    no_revision: 'No revision',
    no_response: 'No response',
    unclear: 'Unclear',
  }
  return labels[value] || 'Unclear'
}

function AnswerPreview({ label, answer }: { label: string; answer: StudentHistoryAnswer | null }) {
  if (!answer) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 p-3 text-sm text-foreground/45">
        {label}: not submitted
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-secondary/35 p-3 text-sm">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-foreground/45">
        <span>{label}</span>
        <span>Confidence {answer.confidence}/5</span>
      </div>
      <p className="whitespace-pre-wrap text-foreground/75">{answer.answer}</p>
    </div>
  )
}

export default function StudentSessions() {
  const router = useRouter()
  const [participantId, setParticipantId] = useState<string | null>(null)
  const [history, setHistory] = useState<StudentHistorySession[]>([])
  const [sessionCode, setSessionCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const [summaryBySessionId, setSummaryBySessionId] = useState<Record<string, StudentSummary>>({})
  const [summaryLoadingId, setSummaryLoadingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadDashboard = async () => {
      try {
        setLoading(true)
        setError(null)

        const accountResponse = await fetch('/api/student/account', { cache: 'no-store' })
        const accountPayload = await accountResponse.json().catch(() => null)
        if (!accountResponse.ok) {
          throw new Error(accountPayload?.error || 'Failed to load student account.')
        }
        if (!accountPayload?.participant) {
          router.replace('/student/join')
          return
        }

        const historyResponse = await fetch('/api/student/sessions', { cache: 'no-store' })
        const historyPayload = await historyResponse.json().catch(() => null)
        if (!historyResponse.ok) {
          throw new Error(historyPayload?.error || 'Failed to load previous sessions.')
        }

        if (!cancelled) {
          setParticipantId(accountPayload.participant.participant_id)
          setHistory((historyPayload?.sessions || []) as StudentHistorySession[])
        }
      } catch (err) {
        console.error('Error loading student dashboard:', err)
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load your dashboard.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadDashboard()
    return () => {
      cancelled = true
    }
  }, [router])

  const handleJoinSession = async (e: React.FormEvent) => {
    e.preventDefault()
    setJoining(true)
    setError(null)

    try {
      const response = await fetch('/api/student/join-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionCode }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to join session.')
      }

      router.push(`/student/respond/${payload.session.id}`)
    } catch (err) {
      console.error('Error joining session:', err)
      setError(err instanceof Error ? err.message : 'Unable to join that session.')
    } finally {
      setJoining(false)
    }
  }

  const handleViewSession = async (session: StudentHistorySession) => {
    const nextExpanded = expandedSessionId === session.sessionParticipantId ? null : session.sessionParticipantId
    setExpandedSessionId(nextExpanded)
    if (!nextExpanded || summaryBySessionId[session.sessionId]) return

    try {
      setSummaryLoadingId(session.sessionParticipantId)
      const response = await fetch(`/api/student/sessions/${session.sessionId}/summary`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to load this student summary.')
      }
      const summary = payload?.summary as StudentSummary | undefined
      if (!summary) {
        throw new Error('Summary data was not returned.')
      }
      setSummaryBySessionId((current) => ({
        ...current,
        [session.sessionId]: summary,
      }))
    } catch (err) {
      console.error('Error loading student summary:', err)
      setError(err instanceof Error ? err.message : 'Unable to load this session summary.')
    } finally {
      setSummaryLoadingId(null)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-foreground/60">Loading...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border/40 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Student Dashboard</h1>
            <p className="text-sm text-foreground/60 mt-1">
              Logged in as <span className="font-medium text-foreground">{participantId}</span>
            </p>
          </div>
          <StudentLogoutButton />
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <Card className="p-6 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-foreground/50">Join session</p>
              <h2 className="mt-2 text-3xl font-bold text-foreground">Enter your class code</h2>
              <p className="mt-2 text-foreground/65">
                Your account can join either baseline or treatment sessions. The session code controls the activity flow.
              </p>
            </div>
            <form onSubmit={handleJoinSession} className="w-full max-w-md space-y-3">
              <label htmlFor="sessionCode" className="sr-only">
                Session code
              </label>
              <Input
                id="sessionCode"
                type="text"
                value={sessionCode}
                onChange={(event) => setSessionCode(event.target.value.toUpperCase().replace(/\s+/g, ''))}
                placeholder="SESSION CODE"
                className="h-14 text-center text-lg tracking-widest"
                disabled={joining}
                required
              />
              <Button type="submit" size="lg" className="w-full" disabled={joining || !sessionCode.trim()}>
                {joining ? 'Joining...' : 'Join Session'}
              </Button>
            </form>
          </div>

          {error && (
            <div className="mt-6 rounded-lg border border-destructive/20 bg-destructive/10 p-4">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </Card>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Previous sessions</h2>
              <p className="text-sm text-foreground/60">Newest sessions appear first.</p>
            </div>
          </div>

          {history.length === 0 ? (
            <Card className="p-8 text-center">
              <h3 className="text-lg font-semibold text-foreground">No previous sessions yet.</h3>
              <p className="mt-2 text-sm text-foreground/60">Enter a session code above when your teacher starts class.</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {history.map((session) => (
                <Card key={session.sessionParticipantId} className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-lg font-semibold text-foreground">{session.title}</h3>
                        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium capitalize text-foreground/70">
                          {session.condition}
                        </span>
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                          {formatStatus(session)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-foreground/55">
                        Code {session.sessionCode} · Joined {formatDate(session.joinedAt)}
                      </p>
                      {session.question && (
                        <p className="mt-2 line-clamp-2 text-sm text-foreground/70">{session.question}</p>
                      )}
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="grid grid-cols-2 gap-2 text-sm sm:w-56">
                        <div className="rounded-lg bg-secondary/40 px-3 py-2">
                          <p className="text-foreground/50">Initial</p>
                          <p className="text-lg font-semibold text-foreground">{session.responseCount}</p>
                        </div>
                        <div className="rounded-lg bg-secondary/40 px-3 py-2">
                          <p className="text-foreground/50">Revisions</p>
                          <p className="text-lg font-semibold text-foreground">{session.revisionResponseCount}</p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleViewSession(session)}
                      >
                        {summaryLoadingId === session.sessionParticipantId
                          ? 'Loading...'
                          : expandedSessionId === session.sessionParticipantId
                            ? 'Hide Session'
                            : 'View Session'}
                      </Button>
                    </div>
                  </div>
                  {expandedSessionId === session.sessionParticipantId && (
                    <div className="mt-4 space-y-4 rounded-lg border border-border/60 bg-background/60 p-4">
                      {summaryBySessionId[session.sessionId] ? (
                        <div className="rounded-xl bg-primary/5 p-4">
                          {summaryBySessionId[session.sessionId].analysis_status === 'fallback' && (
                            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                              <p className="font-semibold">Fallback analysis used</p>
                              <p className="mt-1">
                                We could not generate the full AI summary, so this page is using a safer template-based summary from your saved answers, confidence, and cluster labels.
                              </p>
                            </div>
                          )}
                          {summaryBySessionId[session.sessionId].analysis_status === 'partial' && (
                            <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                              <p className="font-semibold">Some analysis is not available yet</p>
                              <p className="mt-1">
                                Your answers and revisions are shown, but cluster feedback may be missing because the teacher has not generated analysis for this session yet.
                              </p>
                            </div>
                          )}
                          <p className="text-xs font-medium uppercase tracking-wide text-primary/70">Your summary</p>
                          <h4 className="mt-2 text-xl font-semibold text-foreground">
                            {summaryBySessionId[session.sessionId].headline}
                          </h4>
                          <p className="mt-2 text-sm leading-6 text-foreground/70">
                            {summaryBySessionId[session.sessionId].overall_summary}
                          </p>
                          <div className="mt-4 grid gap-3 lg:grid-cols-3">
                            <div className="rounded-lg bg-background/80 p-3">
                              <p className="text-xs font-medium uppercase tracking-wide text-foreground/45">Strengths</p>
                              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-foreground/70">
                                {summaryBySessionId[session.sessionId].strengths.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                            <div className="rounded-lg bg-background/80 p-3">
                              <p className="text-xs font-medium uppercase tracking-wide text-foreground/45">Needs practice</p>
                              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-foreground/70">
                                {summaryBySessionId[session.sessionId].needs_practice.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                            <div className="rounded-lg bg-background/80 p-3">
                              <p className="text-xs font-medium uppercase tracking-wide text-foreground/45">Confidence</p>
                              <p className="mt-2 text-sm leading-6 text-foreground/70">
                                {summaryBySessionId[session.sessionId].confidence_insight}
                              </p>
                            </div>
                          </div>
                          {summaryBySessionId[session.sessionId].warnings.length > 0 && (
                            <details className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                              <summary className="cursor-pointer font-medium">Summary notes</summary>
                              <ul className="mt-2 list-disc space-y-1 pl-4">
                                {summaryBySessionId[session.sessionId].warnings.map((warning) => (
                                  <li key={warning}>{warning}</li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          <p className="font-semibold">
                            {summaryLoadingId === session.sessionParticipantId ? 'Loading your summary...' : 'Could not load summary'}
                          </p>
                          <p className="mt-1">
                            {summaryLoadingId === session.sessionParticipantId
                              ? 'Please wait while we prepare your saved answers and feedback.'
                              : 'Please try again later, or ask your teacher to generate student summaries for this session.'}
                          </p>
                        </div>
                      )}

                      <h4 className="text-sm font-medium text-foreground">
                        {session.questionCount} question{session.questionCount === 1 ? '' : 's'} and your answers
                      </h4>
                      {session.questions.length === 0 ? (
                        <p className="text-sm text-foreground/55">No question details are available for this session.</p>
                      ) : (
                        <div className="space-y-4">
                          {session.questions.map((question) => {
                            const summaryCard = summaryBySessionId[session.sessionId]?.question_cards.find(
                              (card) => card.question_id === question.questionId
                            )
                            return (
                              <div key={question.questionId} className="rounded-xl border border-border/50 p-4">
                                <p className="text-sm font-semibold text-foreground">Q{question.position}</p>
                                <p className="mt-1 text-sm text-foreground/70">{question.prompt}</p>
                                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                                  <AnswerPreview label="Initial" answer={question.initialAnswer} />
                                  {session.condition === 'treatment' && (
                                    <AnswerPreview label="Revision" answer={question.revisionAnswer} />
                                  )}
                                </div>
                                {summaryCard?.cluster_feedback ? (
                                  <div className="mt-3 rounded-lg border border-primary/10 bg-primary/5 p-3">
                                    <p className="text-sm font-semibold text-foreground">
                                      {summaryCard.cluster_feedback.student_title || 'Cluster feedback'}
                                    </p>
                                    {summaryCard.cluster_feedback.reasoning_pattern && (
                                      <p className="mt-2 text-sm leading-6 text-foreground/70">
                                        {summaryCard.cluster_feedback.reasoning_pattern}
                                      </p>
                                    )}
                                    <p className="mt-2 text-sm leading-6 text-foreground/70">
                                      {summaryCard.cluster_feedback.what_you_understood}
                                    </p>
                                    <div className="mt-3 grid gap-2 lg:grid-cols-2">
                                      <p className="rounded-md bg-background/80 p-2 text-sm text-foreground/65">
                                        <span className="font-medium text-foreground">Try:</span>{' '}
                                        {summaryCard.cluster_feedback.try_again_prompt || summaryCard.cluster_feedback.micro_hint}
                                      </p>
                                      <p className="rounded-md bg-background/80 p-2 text-sm text-foreground/65">
                                        <span className="font-medium text-foreground">Movement:</span>{' '}
                                        {movementDisplayLabel(summaryCard.improvement.movement_label)}. {summaryCard.improvement.short_interpretation}
                                      </p>
                                    </div>
                                    {summaryCard.cluster_feedback.confidence_check && (
                                      <p className="mt-2 rounded-md bg-background/80 p-2 text-sm text-foreground/65">
                                        <span className="font-medium text-foreground">Confidence check:</span>{' '}
                                        {summaryCard.cluster_feedback.confidence_check}
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  <p className="mt-3 rounded-lg border border-dashed border-border/70 p-3 text-sm text-foreground/50">
                                    Cluster feedback is not available yet.
                                  </p>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
