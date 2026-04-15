'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getSession, submitResponse } from '@/lib/supabase/queries'
import type { Session } from '@/lib/types/database'

export default function StudentRespond() {
  const params = useParams()
  const router = useRouter()
  const sessionId = params.id as string

  const [session, setSession] = useState<Session | null>(null)
  const [sessionParticipantId, setSessionParticipantId] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [confidence, setConfidence] = useState(3)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    const loadSession = async () => {
      try {
        const spId = sessionStorage.getItem('sessionParticipantId')
        if (!spId) {
          router.push('/student/join')
          return
        }

        setSessionParticipantId(spId)
        const sessionData = await getSession(sessionId)
        setSession(sessionData)
      } catch (err) {
        console.error('Error loading session:', err)
        setError('Failed to load session')
      } finally {
        setLoading(false)
      }
    }

    loadSession()
  }, [sessionId, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sessionParticipantId || !session) return

    try {
      setSubmitting(true)
      setError(null)

      // Submit response
      const response = await submitResponse(
        sessionId,
        sessionParticipantId,
        answer,
        confidence
      )

      setSubmitted(true)

      // For baseline condition, show AI feedback immediately
      if (session.condition === 'baseline') {
        // In a real implementation, this would call the AI API
        // For now, show a placeholder
        setFeedback('Your response has been submitted. Your instructor will provide feedback shortly.')
      } else {
        // For treatment condition, show confidence matrix
        setFeedback('Thank you for your response. You can now see how your answer compares to others in the class.')
      }
    } catch (err) {
      console.error('Error submitting response:', err)
      setError('Failed to submit response. Please try again.')
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
          <h1 className="text-2xl font-bold text-foreground">{session.session_code}</h1>
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

        {!submitted ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Question */}
            <Card className="p-8">
              <h2 className="text-2xl font-bold text-foreground mb-6">Question</h2>
              <div className="text-lg text-foreground leading-relaxed">
                {session.question}
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
              disabled={submitting || !answer.trim()}
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

            {/* Feedback for Baseline */}
            {session.condition === 'baseline' && feedback && (
              <Card className="p-8">
                <h3 className="text-xl font-semibold text-foreground mb-4">Your Feedback</h3>
                <p className="text-foreground/70 leading-relaxed">{feedback}</p>
              </Card>
            )}

            {/* Confidence Matrix for Treatment */}
            {session.condition === 'treatment' && (
              <Card className="p-8">
                <h3 className="text-xl font-semibold text-foreground mb-4">Class Response Overview</h3>
                <p className="text-foreground/70 mb-6">
                  Your response has been recorded. Below you can see how your confidence level compares to the class average.
                </p>
                    <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-secondary/30">
                    <p className="text-sm text-foreground/60 mb-2">Your Confidence</p>
                    <p className="text-3xl font-bold text-accent">{confidence}/5</p>
                  </div>
                  <div className="p-4 rounded-lg bg-primary/10">
                    <p className="text-sm text-foreground/60 mb-2">Class Average</p>
                    <p className="text-3xl font-bold text-primary">--</p>
                  </div>
                </div>
              </Card>
            )}

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
