'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getSession, getSessionResponses } from '@/lib/supabase/queries'
import type { Session } from '@/lib/types/database'
import { teacherLogout } from '@/app/teacher/auth-actions'
import { usePostgresChanges } from '@/hooks/use-postgres-changes'

export default function SessionAnalysis() {
  const params = useParams()
  const sessionId = params.id as string

  const [session, setSession] = useState<Session | null>(null)
  const [analysis, setAnalysis] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [responseCount, setResponseCount] = useState(0)

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        const sessionData = await getSession(sessionId)
        setSession(sessionData)

        const responsesData = await getSessionResponses(sessionId)
        setResponseCount(responsesData?.length || 0)
      } catch (err) {
        console.error('Error loading session:', err)
        setError('Failed to load session data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [sessionId])

  usePostgresChanges({
    tables: [{ table: 'responses', event: 'INSERT', filter: `session_id=eq.${sessionId}` }],
    onChange: async () => {
      try {
        const responsesData = await getSessionResponses(sessionId)
        setResponseCount(responsesData?.length || 0)
      } catch (err) {
        console.error('Error refreshing response count:', err)
      }
    },
    pollMs: 10000,
    debugLabel: `teacher-analysis-${sessionId}`,
  })

  const handleAnalyze = async () => {
    try {
      setAnalyzing(true)
      setError(null)

      const response = await fetch('/api/analyze-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          teacherId: 'demo-teacher-001',
        }),
      })

      if (!response.ok) {
        throw new Error('Analysis failed')
      }

      const data = await response.json()
      setAnalysis(data)
    } catch (err) {
      console.error('Error analyzing session:', err)
      setError('Failed to analyze responses')
    } finally {
      setAnalyzing(false)
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

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">AI Analysis</h1>
            <p className="text-sm text-foreground/60 mt-1">{session.session_code}</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/teacher/session/${sessionId}`}>
              <Button variant="outline">Back</Button>
            </Link>
            <form action={teacherLogout}>
              <Button variant="outline" type="submit">Log Out</Button>
            </form>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {error && (
          <Card className="mb-6 p-4 border-destructive/30 bg-destructive/5">
            <p className="text-destructive text-sm">{error}</p>
          </Card>
        )}

        {/* Session Info */}
        <Card className="p-6 mb-8">
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-foreground/60 mb-1">Condition</p>
              <p className="text-lg font-semibold text-foreground">
                {session.condition === 'baseline' ? 'Baseline' : 'Treatment'}
              </p>
            </div>
            <div>
              <p className="text-sm text-foreground/60 mb-1">Total Responses</p>
              <p className="text-lg font-semibold text-foreground">{responseCount}</p>
            </div>
            <div>
              <p className="text-sm text-foreground/60 mb-1">Status</p>
              <p className="text-lg font-semibold text-primary capitalize">{session.status}</p>
            </div>
          </div>
        </Card>

        {/* Analysis Section */}
        {!analysis ? (
          <Card className="p-8 text-center">
            <div className="text-5xl mb-4">🔍</div>
            <h2 className="text-2xl font-bold text-foreground mb-4">Ready for AI Analysis</h2>
            <p className="text-foreground/70 mb-8 max-w-md mx-auto">
              {session.condition === 'baseline'
                ? 'Review the personalized feedback that was generated for each student response.'
                : 'Generate AI-powered misconception cards and teaching suggestions based on student responses.'}
            </p>
            {responseCount > 0 && (
              <Button
                onClick={handleAnalyze}
                disabled={analyzing}
                size="lg"
              >
                {analyzing ? 'Analyzing...' : 'Generate Analysis'}
              </Button>
            )}
            {responseCount === 0 && (
              <p className="text-foreground/60">No responses to analyze yet</p>
            )}
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Baseline Analysis */}
            {analysis.type === 'baseline' && (
              <>
                <Card className="p-6 border-primary/20">
                  <div className="flex items-start gap-4">
                    <div className="text-3xl">✓</div>
                    <div>
                      <h2 className="text-xl font-semibold text-foreground mb-2">Feedback Generated</h2>
                      <p className="text-foreground/70">
                        Individual AI-generated feedback has been provided to each student. The feedback addresses
                        their specific answer, highlights strengths, identifies misconceptions, and provides guidance
                        for improvement.
                      </p>
                    </div>
                  </div>
                </Card>

                <Card className="p-6">
                  <h3 className="text-lg font-semibold text-foreground mb-4">Next Steps</h3>
                  <ul className="space-y-3">
                    <li className="flex items-start gap-3">
                      <span className="text-primary font-bold mt-1">1.</span>
                      <span className="text-foreground/70">Review individual student responses in the session detail</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-primary font-bold mt-1">2.</span>
                      <span className="text-foreground/70">Note which misconceptions appear most frequently</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="text-primary font-bold mt-1">3.</span>
                      <span className="text-foreground/70">Use this information to adjust your instruction</span>
                    </li>
                  </ul>
                </Card>
              </>
            )}

            {/* Treatment Analysis */}
            {analysis.type === 'treatment' && (
              <>
                {/* Common Misconceptions */}
                <Card className="p-6">
                  <h3 className="text-lg font-semibold text-foreground mb-4">Common Misconceptions</h3>
                  {analysis.misconceptions && analysis.misconceptions.length > 0 ? (
                    <ul className="space-y-3">
                      {analysis.misconceptions.map((misconception: string, idx: number) => (
                        <li key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-secondary/30">
                          <span className="text-accent font-bold mt-1">{idx + 1}.</span>
                          <span className="text-foreground">{misconception}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-foreground/70">No major misconceptions detected</p>
                  )}
                </Card>

                {/* Confidence Analysis */}
                <Card className="p-6">
                  <h3 className="text-lg font-semibold text-foreground mb-4">Confidence Analysis</h3>
                  <p className="text-foreground/70 mb-4">{analysis.confidenceAnalysis}</p>
                  <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                    <p className="text-sm text-foreground/70 whitespace-pre-wrap font-mono">
                      {analysis.confidenceMatrix}
                    </p>
                  </div>
                </Card>

                {/* Teaching Suggestions */}
                <Card className="p-6">
                  <h3 className="text-lg font-semibold text-foreground mb-4">Teaching Suggestions</h3>
                  {analysis.teachingSuggestions && analysis.teachingSuggestions.length > 0 ? (
                    <ul className="space-y-3">
                      {analysis.teachingSuggestions.map((suggestion: string, idx: number) => (
                        <li key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-accent/10">
                          <span className="text-accent font-bold">💡</span>
                          <span className="text-foreground">{suggestion}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-foreground/70">No specific suggestions available</p>
                  )}
                </Card>

                <Card className="p-6 bg-primary/5 border-primary/20">
                  <h3 className="text-lg font-semibold text-foreground mb-3">Key Insight</h3>
                  <p className="text-foreground/70">
                    Use the misconceptions and teaching suggestions above to design targeted instruction that addresses
                    your students&apos; specific learning needs. The confidence analysis shows which students may need
                    additional support.
                  </p>
                </Card>
              </>
            )}

            {/* Export Button */}
            <div className="flex gap-4">
              <Link href={`/teacher/session/${sessionId}/export`} className="flex-1">
                <Button variant="outline" className="w-full">
                  Export Data
                </Button>
              </Link>
              <Button onClick={handleAnalyze} disabled={analyzing} className="flex-1">
                Regenerate Analysis
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
