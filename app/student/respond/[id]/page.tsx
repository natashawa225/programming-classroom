'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getSession, getSessionParticipantForStudent, getSessionQuestions, getStudentResponse, submitStudentResponse } from '@/lib/supabase/queries'
import type { Session, SessionQuestion } from '@/lib/types/database'
import { usePostgresChanges } from '@/hooks/use-postgres-changes'

export default function StudentRespond() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const sessionId = params.id as string

  const [session, setSession] = useState<Session | null>(null)
  const [anonymizedLabel, setAnonymizedLabel] = useState<string | null>(null)
  const [questions, setQuestions] = useState<SessionQuestion[]>([])
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [confidence, setConfidence] = useState(3)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submittedServer, setSubmittedServer] = useState(false)
  const localSubmittedKeysRef = useRef<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [startTimeMs, setStartTimeMs] = useState<number>(() => Date.now())
  const [nowMs, setNowMs] = useState<number>(() => Date.now())

  useEffect(() => {
    const loadSession = async () => {
      try {
        const [sessionData, participation, sessionQuestions] = await Promise.all([
          getSession(sessionId),
          getSessionParticipantForStudent(sessionId),
          getSessionQuestions(sessionId),
        ])
        setSession(sessionData)
        setQuestions(sessionQuestions || [])
        if (!participation) {
          router.push('/student/join')
          return
        }
        setAnonymizedLabel(participation.anonymized_label)
      } catch (err) {
        console.error('Error loading session:', err)
        setError('Failed to load session')
      } finally {
        setLoading(false)
      }
    }

    loadSession()
  }, [sessionId, router])

  // Keep URL query param (?q=1..N) and internal index in sync.
  useEffect(() => {
    if (!questions || questions.length === 0) return
    const q = searchParams.get('q')
    const parsed = q ? Number(q) : NaN
    if (!Number.isFinite(parsed) || parsed < 1) return
    const idx = Math.max(0, Math.min(questions.length - 1, Math.floor(parsed) - 1))
    setCurrentQuestionIndex(idx)
  }, [searchParams, questions])

  const roundNumber = session?.status === 'revision' ? 2 : 1
  const canEdit =
    session?.status === 'live' ||
    session?.status === 'revision'

  const currentQuestion = questions[currentQuestionIndex] || null
  const submissionKey = currentQuestion ? `${currentQuestion.question_id}:${roundNumber}` : ''
  const hasSubmittedLocal = submissionKey ? localSubmittedKeysRef.current.has(submissionKey) : false
  const submitted = hasSubmittedLocal || submittedServer
  const timerSeconds = currentQuestion?.timer_seconds ?? null
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startTimeMs) / 1000))
  const remainingSeconds = timerSeconds ? Math.max(0, timerSeconds - elapsedSeconds) : null
  const timerExpired = timerSeconds ? remainingSeconds === 0 : false

  useEffect(() => {
    if (!timerSeconds || submitted || !canEdit) return
    const t = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [timerSeconds, submitted, canEdit, currentQuestion?.question_id])

  // Load existing response state for the current question/round.
  useEffect(() => {
    let cancelled = false
    const loadExisting = async () => {
      if (!session || !currentQuestion) return

      setError(null)
      setFeedback(null)
      setSubmitting(false)
      if (submissionKey && !localSubmittedKeysRef.current.has(submissionKey)) {
        setSubmittedServer(false)
      }

      // Reset timer for this question view.
      setStartTimeMs(Date.now())
      setNowMs(Date.now())

      try {
        // If we already submitted locally for this question/round, keep UI locked even if server
        // reads are momentarily stale (prevents flicker after submit).
        if (submissionKey && localSubmittedKeysRef.current.has(submissionKey)) {
          setSubmittedServer(true)
          setFeedback('Submitted. Editing is locked for this question in this round.')
          return
        }

        const existing = await getStudentResponse(sessionId, {
          questionId: currentQuestion.question_id,
          roundNumber,
        })

        if (cancelled) return

        if (existing) {
          setSubmittedServer(true)
          setAnswer(existing.answer)
          setConfidence(existing.confidence)
          setFeedback('Submitted. Editing is locked for this question in this round.')
          return
        }

        setSubmittedServer(false)

        // In revision, preload round 1 answer if present.
        if (roundNumber === 2) {
          const original = await getStudentResponse(sessionId, {
            questionId: currentQuestion.question_id,
            roundNumber: 1,
          })
          if (original) {
            setAnswer(original.answer)
            setConfidence(original.confidence)
          } else {
            setAnswer('')
            setConfidence(3)
          }
        } else {
          setAnswer('')
          setConfidence(3)
        }
      } catch (err) {
        console.error('Error loading existing response:', err)
        setError('Failed to load your response state')
      }
    }

    void loadExisting()
    return () => {
      cancelled = true
    }
  }, [sessionId, session?.id, currentQuestion?.question_id, roundNumber, submissionKey])

  const realtimeTables = useMemo(
    () => [{ table: 'sessions', event: 'UPDATE' as const, filter: `id=eq.${sessionId}` }],
    [sessionId]
  )

  usePostgresChanges({
    tables: realtimeTables,
    onChange: async () => {
      try {
        const updated = await getSession(sessionId)
        setSession(updated)
      } catch (err) {
        console.error('Error refreshing session status:', err)
      }
    },
    pollMs: 8000,
    debugLabel: `student-session-${sessionId}`,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session || !currentQuestion) return
    if (submitted) return

    try {
      setSubmitting(true)
      setError(null)

      const timeTakenSeconds = Math.max(0, Math.floor((Date.now() - startTimeMs) / 1000))

      await submitStudentResponse(sessionId, {
        questionId: currentQuestion.question_id,
        answerText: answer,
        confidence,
        roundNumber,
        questionType: roundNumber === 2 ? 'revision' : 'main',
        timeTakenSeconds,
      })

      if (submissionKey) {
        localSubmittedKeysRef.current.add(submissionKey)
      }
      setSubmittedServer(true)

      setFeedback('Submitted. Editing is locked for this question in this round.')
    } catch (err) {
      console.error('Error submitting response:', err)
      setError(err instanceof Error ? err.message : 'Failed to submit response. Please try again.')
    } finally {
      setSubmitting(false)
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Card className="p-6 text-center">
            <p className="text-destructive mb-4">Session not found</p>
            <Link href="/student/sessions">
              <Button variant="outline">Back to Sessions</Button>
            </Link>
          </Card>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{session.session_code}</h1>
            <p className="text-sm text-foreground/60 mt-1">
              Status: <span className="capitalize">{session.status}</span>
              {anonymizedLabel ? ` • You are: ${anonymizedLabel}` : ''}
            </p>
            {remainingSeconds !== null && (
              <p className="text-sm text-foreground/60 mt-1">
                Time remaining: {remainingSeconds}s
              </p>
            )}
          </div>
          <Link href="/student/sessions">
            <Button variant="outline">Back</Button>
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {error && (
          <Card className="mb-6 p-4 border-destructive/30 bg-destructive/5">
            <p className="text-destructive text-sm">{error}</p>
          </Card>
        )}

        {(!canEdit || session.status === 'analysis_ready' || timerExpired) && (
          <Card className="mb-6 p-4 border-border/40 bg-secondary/20">
            <p className="text-sm text-foreground/70">
              {session.status === 'draft'
                ? 'Waiting for your instructor to start the session.'
                : session.status === 'analysis_ready'
                  ? 'Round 1 is closed while your instructor reviews and generates analysis.'
                  : session.status === 'revision'
                    ? 'Revision is open.'
                    : timerExpired
                      ? 'Time is up for this question.'
                      : 'This session is closed.'}
            </p>
          </Card>
        )}

        {!currentQuestion ? (
          <Card className="p-8 text-center">
            <p className="text-foreground/70">No questions found for this session.</p>
          </Card>
        ) : !submitted ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Question */}
            <Card className="p-8">
              <h2 className="text-2xl font-bold text-foreground mb-6">
                Question {currentQuestion.position} of {questions.length} {roundNumber === 2 ? '(Revision)' : ''}
              </h2>
              <div className="text-lg text-foreground leading-relaxed">
                {currentQuestion.prompt}
              </div>
            </Card>

            {/* Answer Input */}
            <Card className="p-8">
              <label htmlFor="answer" className="block text-lg font-semibold text-foreground mb-4">
                Your Answer
              </label>
              <textarea
                id="answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type your answer here..."
                rows={6}
                className="w-full px-4 py-3 rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={submitting}
                required
              />
            </Card>

            {/* Confidence Slider */}
            <Card className="p-8">
              <label htmlFor="confidence" className="block text-lg font-semibold text-foreground mb-6">
                How confident are you in your answer?
              </label>
              <div className="space-y-4">
                <input
                  id="confidence"
                  type="range"
                  min="1"
                  max="5"
                  value={confidence}
                  onChange={(e) => setConfidence(Number(e.target.value))}
                  className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer"
                  disabled={submitting}
                />
                <div className="flex justify-between items-center">
                  <span className="text-sm text-foreground/60">Not confident</span>
                  <span className="text-2xl font-bold text-accent">{confidence}/5</span>
                  <span className="text-sm text-foreground/60">Very confident</span>
                </div>
              </div>
            </Card>

            {/* Submit Button */}
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={submitting || !answer.trim() || !canEdit || timerExpired}
            >
              {submitting ? 'Submitting...' : 'Submit Answer'}
            </Button>
          </form>
        ) : (
          <div className="space-y-6">
            {/* Success Message */}
            <Card className="p-8 bg-primary/5 border-primary/30">
              <div className="text-center">
                <div className="text-5xl mb-4">✓</div>
                <h2 className="text-2xl font-bold text-foreground mb-3">Answer Submitted</h2>
                <p className="text-lg text-foreground/70 mb-6">
                  Thank you for your response. Your instructor will review your answer.
                </p>
              </div>
            </Card>

            {feedback && (
              <Card className="p-6">
                <p className="text-foreground/70">{feedback}</p>
              </Card>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  const prev = Math.max(0, currentQuestionIndex - 1)
                  router.push(`/student/respond/${sessionId}?q=${prev + 1}`)
                }}
                disabled={currentQuestionIndex === 0}
              >
                Previous
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  const next = Math.min(questions.length - 1, currentQuestionIndex + 1)
                  router.push(`/student/respond/${sessionId}?q=${next + 1}`)
                }}
                disabled={currentQuestionIndex >= questions.length - 1}
              >
                Next
              </Button>
            </div>

            {/* Navigation */}
            <Link href="/student/sessions" className="block">
              <Button variant="outline" className="w-full">
                Back to Sessions
              </Button>
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}
