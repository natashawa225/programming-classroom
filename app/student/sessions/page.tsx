'use client'

import type React from 'react'
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

const palette = {
  yellow: {
    fill: 'rgba(255, 228, 144, 0.28)',
    border: 'rgba(255, 199, 84, 0.55)',
    dot: '#F0B93B',
    badgeBg: 'rgba(255, 246, 220, 1)',
    badgeText: '#A97800',
  },
  blue: {
    fill: 'rgba(216, 232, 243, 0.38)',
    border: 'rgba(123, 175, 212, 0.45)',
    dot: '#7BAFD4',
    badgeBg: 'rgba(238, 244, 249, 1)',
    badgeText: '#4E7FA2',
  },
  purple: {
    fill: 'rgba(231, 223, 255, 0.35)',
    border: 'rgba(169, 119, 255, 0.38)',
    dot: '#A977FF',
    badgeBg: 'rgba(243, 236, 255, 1)',
    badgeText: '#8A57FF',
  },
}

type PaletteTone = keyof typeof palette

function toneStyle(tone: PaletteTone): React.CSSProperties {
  return {
    backgroundColor: palette[tone].fill,
    borderColor: palette[tone].border,
  }
}

function badgeStyle(tone: PaletteTone): React.CSSProperties {
  return {
    backgroundColor: palette[tone].badgeBg,
    color: palette[tone].badgeText,
    borderColor: palette[tone].border,
  }
}

function statusTone(status: string): PaletteTone {
  return status === 'Completed' ? 'blue' : 'yellow'
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

function AnswerPreview({
  label,
  answer,
  emptyText,
  tone = 'blue',
}: {
  label: string
  answer: StudentHistoryAnswer | null
  emptyText?: string
  tone?: PaletteTone
}) {
  if (!answer) {
    return (
      <div className="rounded-xl border border-dashed p-3 text-sm text-foreground/50" style={{ borderColor: 'rgba(148, 163, 184, 0.35)' }}>
        {emptyText || `${label}: not submitted`}
      </div>
    )
  }

  return (
    <div className="rounded-xl border p-3 text-sm" style={toneStyle(tone)}>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-foreground/45">
        <span>{label}</span>
        <span>Confidence {answer.confidence}/5</span>
      </div>
      <p className="whitespace-pre-wrap text-foreground/75">{answer.answer}</p>
    </div>
  )
}

function ResponseBadge({ children, tone = 'blue' }: { children: React.ReactNode; tone?: PaletteTone }) {
  return (
    <span className="rounded-full border px-2.5 py-1 text-xs font-medium" style={badgeStyle(tone)}>
      {children}
    </span>
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

  const handleExportPdf = () => {
    window.print()
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center" style={{ backgroundColor: '#fbfbfa' }}>
        <div className="rounded-2xl border px-5 py-4 text-sm" style={toneStyle('yellow')}>
          <p style={{ color: palette.yellow.badgeText }}>Loading...</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen" style={{ backgroundColor: '#fbfbfa' }}>
      <header className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur-sm" style={{ borderColor: 'rgba(148, 163, 184, 0.18)' }}>
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
        <Card className="rounded-2xl border p-6 shadow-sm sm:p-8" style={{ ...toneStyle('blue'), backgroundColor: 'rgba(246, 250, 252, 0.96)' }}>
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
                style={{ borderColor: palette.blue.border }}
                disabled={joining}
                required
              />
              <Button
                type="submit"
                size="lg"
                className="w-full border-0 shadow-sm"
                style={{ backgroundColor: palette.blue.dot, color: '#ffffff' }}
                disabled={joining || !sessionCode.trim()}
              >
                {joining ? 'Joining...' : 'Join Session'}
              </Button>
            </form>
          </div>

          {error && (
            <div className="mt-6 rounded-xl border p-4" style={toneStyle('yellow')}>
              <p className="text-sm" style={{ color: palette.yellow.badgeText }}>{error}</p>
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
            <Card className="rounded-2xl border bg-white p-8 text-center shadow-sm" style={{ borderColor: 'rgba(148, 163, 184, 0.18)' }}>
              <h3 className="text-lg font-semibold text-foreground">No previous sessions yet.</h3>
              <p className="mt-2 text-sm text-foreground/60">Enter a session code above when your teacher starts class.</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {history.map((session) => (
                <Card key={session.sessionParticipantId} className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: 'rgba(148, 163, 184, 0.18)' }}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-lg font-semibold text-foreground">{session.title}</h3>
                        <span
                          className="rounded-full border px-2.5 py-1 text-xs font-medium capitalize"
                          style={badgeStyle(session.condition === 'treatment' ? 'purple' : 'blue')}
                        >
                          {session.condition}
                        </span>
                        <span
                          className="rounded-full border px-2.5 py-1 text-xs font-medium"
                          style={badgeStyle(statusTone(formatStatus(session)))}
                        >
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
                      <div className={`grid gap-2 text-sm ${session.condition === 'treatment' ? 'grid-cols-2 sm:w-56' : 'grid-cols-1 sm:w-32'}`}>
                        <div className="rounded-xl border px-3 py-2" style={toneStyle('blue')}>
                          <p className="text-foreground/50">{session.condition === 'baseline' ? 'Responses' : 'Initial'}</p>
                          <p className="text-lg font-semibold text-foreground">{session.responseCount}</p>
                        </div>
                        {session.condition === 'treatment' && (
                          <div className="rounded-xl border px-3 py-2" style={toneStyle('purple')}>
                            <p className="text-foreground/50">Revisions</p>
                            <p className="text-lg font-semibold text-foreground">{session.revisionResponseCount}</p>
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleViewSession(session)}
                        style={badgeStyle('blue')}
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
                    <div className="student-summary-print-root mt-4 space-y-5 rounded-2xl border p-4 print:border-0 print:bg-white print:p-0">
                      <div className="rounded-2xl border bg-white p-5 print:border-0 print:p-0" style={{ borderColor: palette.purple.border }}>
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-foreground/45">Student session summary</p>
                            <h4 className="mt-2 text-2xl font-semibold text-foreground">{session.title}</h4>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <ResponseBadge tone="blue">Participant {participantId || '—'}</ResponseBadge>
                              <ResponseBadge tone="blue">Code {session.sessionCode}</ResponseBadge>
                              <ResponseBadge tone={statusTone(formatStatus(session))}>{formatStatus(session)}</ResponseBadge>
                              <ResponseBadge tone="blue">Joined {formatDate(session.joinedAt)}</ResponseBadge>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleExportPdf}
                            className="student-summary-print-hide w-full lg:w-auto"
                            style={badgeStyle('purple')}
                          >
                            Export as PDF
                          </Button>
                        </div>
                      </div>
                      {summaryBySessionId[session.sessionId] ? (
                        <div className="rounded-2xl border p-4 print:border print:border-gray-200 print:bg-white">
                          {summaryBySessionId[session.sessionId].analysis_status === 'fallback' && (
                            <div className="mb-4 rounded-xl border p-3 text-sm" style={{ ...toneStyle('yellow'), color: palette.yellow.badgeText }}>
                              <p className="font-semibold">Fallback analysis used</p>
                              <p className="mt-1">
                                We could not generate the full AI summary, so this page is using a safer template-based summary from your saved answers, confidence, and cluster labels.
                              </p>
                            </div>
                          )}
                          {summaryBySessionId[session.sessionId].analysis_status === 'partial' && (
                            <div className="mb-4 rounded-xl border p-3 text-sm" style={{ ...toneStyle('blue'), color: palette.blue.badgeText }}>
                              <p className="font-semibold">Some analysis is not available yet</p>
                              <p className="mt-1">
                                Your answers and revisions are shown, but cluster feedback may be missing because the teacher has not generated analysis for this session yet.
                              </p>
                            </div>
                          )}
                          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: palette.purple.badgeText }}>Your summary</p>
                          <h4 className="mt-2 text-xl font-semibold text-foreground">
                            {summaryBySessionId[session.sessionId].headline}
                          </h4>
                          <p className="mt-2 text-sm leading-6 text-foreground/70">
                            {summaryBySessionId[session.sessionId].overall_summary}
                          </p>
                          <div className="mt-4 grid gap-3 lg:grid-cols-3">
                            <div className="rounded-xl border p-3" style={toneStyle('blue')}>
                              <p className="text-xs font-medium uppercase tracking-wide text-foreground/45">Strengths</p>
                              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-foreground/70">
                                {summaryBySessionId[session.sessionId].strengths.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                            <div className="rounded-xl border p-3" style={toneStyle('yellow')}>
                              <p className="text-xs font-medium uppercase tracking-wide text-foreground/45">Needs practice</p>
                              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-foreground/70">
                                {summaryBySessionId[session.sessionId].needs_practice.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                            <div className="rounded-xl border p-3" style={toneStyle('purple')}>
                              <p className="text-xs font-medium uppercase tracking-wide text-foreground/45">Confidence</p>
                              <p className="mt-2 text-sm leading-6 text-foreground/70">
                                {summaryBySessionId[session.sessionId].confidence_insight}
                              </p>
                            </div>
                          </div>
                          {summaryBySessionId[session.sessionId].warnings.length > 0 && (
                            <details className="mt-4 rounded-xl border p-3 text-sm" style={{ ...toneStyle('yellow'), color: palette.yellow.badgeText }}>
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
                        <div className="rounded-xl border p-3 text-sm" style={{ ...toneStyle('yellow'), color: palette.yellow.badgeText }}>
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

                      <div>
                        <h4 className="text-lg font-semibold text-foreground">
                          Questions and your answers
                        </h4>
                        <p className="mt-1 text-sm text-foreground/55">
                          {session.questionCount} question{session.questionCount === 1 ? '' : 's'} in this session.
                        </p>
                      </div>
                      {session.questions.length === 0 ? (
                        <p className="text-sm text-foreground/55">No question details are available for this session.</p>
                      ) : session.responseCount + session.revisionResponseCount === 0 ? (
                        <p className="rounded-xl border border-dashed p-4 text-sm text-foreground/55" style={{ borderColor: 'rgba(148, 163, 184, 0.35)' }}>
                          No responses recorded for this session yet.
                        </p>
                      ) : (
                        <div className="space-y-4">
                          {session.questions.map((question) => {
                            const summaryCard = summaryBySessionId[session.sessionId]?.question_cards.find(
                              (card) => card.question_id === question.questionId
                            )
                            return (
                              <div key={question.questionId} className="student-summary-question rounded-2xl border bg-white p-4 print:border-gray-200" style={{ borderColor: 'rgba(148, 163, 184, 0.2)' }}>
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-semibold text-foreground">Question {question.position}</p>
                                    <p className="mt-1 text-sm leading-6 text-foreground/70">{question.prompt}</p>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <ResponseBadge tone="blue">{session.condition === 'baseline' ? 'Response' : 'Initial'}</ResponseBadge>
                                    {session.condition === 'treatment' && <ResponseBadge tone="purple">Revision</ResponseBadge>}
                                  </div>
                                </div>
                                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                                  <AnswerPreview
                                    label={session.condition === 'baseline' ? 'Your response' : 'Initial'}
                                    answer={question.initialAnswer}
                                    tone="blue"
                                  />
                                  {session.condition === 'treatment' && (
                                    <AnswerPreview
                                      label="Revision"
                                      answer={question.revisionAnswer}
                                      emptyText="No revision submitted."
                                      tone="purple"
                                    />
                                  )}
                                </div>
                                {summaryCard?.cluster_feedback ? (
                                  <div className="mt-3 rounded-xl border p-3">
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
                                      <p className="rounded-lg border p-2 text-sm text-foreground/65" style={toneStyle('yellow')}>
                                        <span className="font-medium text-foreground">Try:</span>{' '}
                                        {summaryCard.cluster_feedback.try_again_prompt || summaryCard.cluster_feedback.micro_hint}
                                      </p>
                                      {session.condition === 'treatment' && (
                                        <p className="rounded-lg border p-2 text-sm text-foreground/65" style={toneStyle('blue')}>
                                          <span className="font-medium text-foreground">Movement:</span>{' '}
                                          {movementDisplayLabel(summaryCard.improvement.movement_label)}. {summaryCard.improvement.short_interpretation}
                                        </p>
                                      )}
                                    </div>
                                    {summaryCard.cluster_feedback.confidence_check && (
                                      <p className="mt-2 rounded-lg border p-2 text-sm text-foreground/65" style={toneStyle('blue')}>
                                        <span className="font-medium text-foreground">Confidence check:</span>{' '}
                                        {summaryCard.cluster_feedback.confidence_check}
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  <p className="mt-3 rounded-xl border border-dashed p-3 text-sm text-foreground/50" style={{ borderColor: 'rgba(148, 163, 184, 0.35)' }}>
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
