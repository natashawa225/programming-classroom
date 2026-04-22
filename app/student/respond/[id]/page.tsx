'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  getRevisionPrefillResponse,
  getSession,
  getSessionParticipantForStudent,
  getSessionQuestions,
  getStudentResponse,
  submitStudentResponse,
} from '@/lib/supabase/queries'
import type { AttemptType, Session, SessionQuestion } from '@/lib/types/database'
import { usePostgresChanges } from '@/hooks/use-postgres-changes'

function getAttemptType(session: Session): AttemptType | null {
  if (session.live_phase === 'question_initial_open' || session.live_phase === 'question_initial_closed') {
    return 'initial'
  }
  if (session.live_phase === 'question_revision_open' || session.live_phase === 'question_revision_closed') {
    return 'revision'
  }
  return null
}

function getStateCopy(session: Session | null, attemptType: AttemptType | null, submitted: boolean) {
  if (!session) return { title: 'Loading...', body: '' }
  if (session.live_phase === 'session_completed' || session.status === 'closed') {
    return { title: 'Session ended', body: 'Your class session has ended.' }
  }
  if (session.live_phase === 'not_started') {
    return { title: 'Waiting for question', body: 'Your teacher has not opened the first question yet.' }
  }
  if (submitted) {
    return { title: 'Answer submitted', body: attemptType === 'revision' ? 'Your revision has been saved.' : 'Your answer has been saved.' }
  }
  if (session.live_phase === 'question_initial_closed') {
    return { title: 'Waiting for next step', body: 'The question is closed. Wait for your teacher to open the next step.' }
  }
  if (session.live_phase === 'question_revision_closed') {
    return { title: 'Waiting for next question', body: 'Revision is closed. Wait for your teacher to move on.' }
  }
  if (session.live_phase === 'question_revision_open') {
    return { title: 'Revision open', body: 'You may revise your answer for this question now.' }
  }
  return { title: 'Question open', body: 'Enter your answer and choose your confidence.' }
}

export default function StudentRespondPage() {
  const params = useParams()
  const router = useRouter()
  const sessionId = params.id as string

  const [session, setSession] = useState<Session | null>(null)
  const [questions, setQuestions] = useState<SessionQuestion[]>([])
  const [anonymizedLabel, setAnonymizedLabel] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [confidence, setConfidence] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [startTimeMs, setStartTimeMs] = useState<number>(Date.now())
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)

  const currentQuestion = useMemo(() => {
    if (!session) return null
    return questions.find((question) => question.position === session.current_question_position) || questions[0] || null
  }, [questions, session])

  const attemptType = session ? getAttemptType(session) : null
  const canEdit =
    session?.live_phase === 'question_initial_open' || session?.live_phase === 'question_revision_open'
  const realtimeTables = useMemo(
    () => [{ table: 'sessions', event: 'UPDATE' as const, filter: `id=eq.${sessionId}` }],
    [sessionId]
  )

  useEffect(() => {
    const load = async () => {
      try {
        const [sessionData, participation, sessionQuestions] = await Promise.all([
          getSession(sessionId),
          getSessionParticipantForStudent(sessionId),
          getSessionQuestions(sessionId),
        ])

        if (!participation) {
          router.replace('/student/join')
          return
        }

        setSession(sessionData)
        setQuestions(sessionQuestions || [])
        setAnonymizedLabel(participation.anonymized_label)
      } catch (err) {
        console.error(err)
        setError('Failed to load this session.')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [router, sessionId])

  usePostgresChanges({
    tables: realtimeTables,
    onChange: async () => {
      try {
        const updated = await getSession(sessionId)
        setSession(updated)
      } catch (err) {
        console.error(err)
      }
    },
    pollMs: 2000,
    debugLabel: `student-live-${sessionId}`,
  })

  useEffect(() => {
    let cancelled = false

    const loadCurrentState = async () => {
      if (!session || !currentQuestion) return

      setError(null)
      setNote(null)
      setSubmitted(false)
      setStartTimeMs(Date.now())

      const currentAttemptType = getAttemptType(session)
      if (!currentAttemptType) {
        setAnswer('')
        setConfidence(null)
        return
      }

      try {
        if (currentAttemptType === 'revision') {
          const prefill = await getRevisionPrefillResponse(sessionId, { questionId: currentQuestion.question_id })
          if (cancelled) return

          if (prefill.round2Response) {
            setAnswer(prefill.round2Response.answer)
            setConfidence(prefill.round2Response.confidence)
            setSubmitted(true)
            setNote('Answer submitted')
            return
          }

          if (prefill.round1Response) {
            setAnswer(prefill.round1Response.answer)
            setConfidence(prefill.round1Response.confidence)
            setNote('Your original answer has been loaded for revision.')
            return
          }

          setAnswer('')
          setConfidence(null)
          setNote('No earlier answer was found, so you can answer from scratch.')
          return
        }

        const existing = await getStudentResponse(sessionId, {
          questionId: currentQuestion.question_id,
          attemptType: currentAttemptType,
        })

        if (cancelled) return

        if (existing) {
          setAnswer(existing.answer)
          setConfidence(existing.confidence)
          setSubmitted(true)
          setNote('Answer submitted')
          return
        }

        setAnswer('')
        setConfidence(null)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError('Failed to load your saved answer.')
      }
    }

    void loadCurrentState()
    return () => {
      cancelled = true
    }
  }, [currentQuestion?.question_id, session, sessionId])

  useEffect(() => {
    if (!session?.timer_started_at || !session.current_timer_seconds || !canEdit || submitted) {
      setRemainingSeconds(null)
      return
    }

    const tick = () => {
      const elapsed = Math.floor((Date.now() - new Date(session.timer_started_at as string).getTime()) / 1000)
      setRemainingSeconds(Math.max(0, session.current_timer_seconds! - elapsed))
    }

    tick()
    const interval = window.setInterval(tick, 1000)
    return () => window.clearInterval(interval)
  }, [canEdit, session?.current_timer_seconds, session?.timer_started_at, submitted])

  const stateCopy = getStateCopy(session, attemptType, submitted)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!session || !currentQuestion || !attemptType || submitted || !canEdit) return

    if (!answer.trim()) {
      setError('Please enter an answer before submitting.')
      return
    }
    if (confidence === null) {
      setError('Please choose a confidence score before submitting.')
      return
    }

    try {
      setSubmitting(true)
      setError(null)

      await submitStudentResponse(sessionId, {
        questionId: currentQuestion.question_id,
        answerText: answer,
        confidence,
        timeTakenSeconds: Math.max(0, Math.floor((Date.now() - startTimeMs) / 1000)),
      })

      setSubmitted(true)
      setNote('Answer submitted')
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Failed to submit your answer.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-foreground/60">Loading session...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-8 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Student View</h1>
            <p className="mt-1 text-sm text-foreground/60">Session {session?.session_code}</p>
          </div>
          {anonymizedLabel && <Badge variant="outline">{anonymizedLabel}</Badge>}
        </div>

        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-foreground/55">
                {currentQuestion ? `Question ${currentQuestion.position} of ${questions.length}` : 'Session status'}
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-foreground">{stateCopy.title}</h2>
              <p className="mt-2 text-sm text-foreground/65">{stateCopy.body}</p>
            </div>
            {remainingSeconds !== null && (
              <div className="rounded-lg bg-secondary/25 px-4 py-3 text-center">
                <p className="text-xs uppercase tracking-wide text-foreground/55">Timer</p>
                <p className="mt-1 text-2xl font-bold text-foreground">{remainingSeconds}s</p>
              </div>
            )}
          </div>

          {currentQuestion && (
            <div className="mt-6 rounded-xl bg-secondary/20 p-5">
              <p className="whitespace-pre-wrap text-lg leading-8 text-foreground">{currentQuestion.prompt}</p>
            </div>
          )}

          {note && (
            <div className="mt-4 rounded-lg border border-border/60 bg-secondary/15 px-4 py-3 text-sm text-foreground/75">
              {note}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {canEdit && currentQuestion && !submitted && (
            <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Your answer</label>
                <Textarea
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  rows={7}
                  placeholder="Type your answer here"
                />
              </div>

              <div>
                <p className="mb-3 text-sm font-medium text-foreground">Confidence</p>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setConfidence(value)}
                      className={`rounded-lg border px-3 py-3 text-sm font-medium transition ${
                        confidence === value
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-foreground'
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-foreground/55">Choose one score from 1 to 5. No default is selected.</p>
              </div>

              <Button type="submit" disabled={submitting}>
                {submitting ? 'Submitting...' : attemptType === 'revision' ? 'Submit Revision' : 'Submit Answer'}
              </Button>
            </form>
          )}

          {!canEdit && session?.live_phase !== 'session_completed' && (
            <div className="mt-6 text-sm text-foreground/60">
              Keep this page open. It will update when your teacher opens the next step.
            </div>
          )}
        </Card>

        <div className="mt-6 text-center">
          <Link href="/student/join" className="text-sm text-foreground/60 transition hover:text-foreground">
            Back to join page
          </Link>
        </div>
      </div>
    </main>
  )
}
