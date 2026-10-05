'use client'

import { useEffect, useState } from 'react'
import { Download, Users, Lightbulb, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { StudentSessionSummaryPayload } from '@/lib/student-session-summary'

function formatConfidence(value: number | null) {
  return value === null ? '—' : `${value.toFixed(1)}/5`
}

function formatGeneratedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatAttemptLabel(value: 'Revision summary' | 'Initial response summary' | null) {
  return value || 'No class summary'
}

function formatSingleAttemptLabel(value: 'Revision summary' | 'Initial response summary' | null) {
  if (!value) return 'No class summary'
  return 'Response summary'
}

function formatSessionTypeLabel(_condition: 'baseline' | 'treatment') {
  return 'Session'
}

function SummaryRow({
  label,
  value,
}: {
  label: string
  value: string | null
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-muted/40 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {/* whitespace-pre-wrap and font-mono ensures code answers stay properly formatted */}
      <p className="mt-3 whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground">
        {value || '—'}
      </p>
    </div>
  )
}

export function StudentSessionSummary({ sessionId }: { sessionId: string }) {
  const [summary, setSummary] = useState<StudentSessionSummaryPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch('/api/student-session-summary', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sessionId }),
        })

        const payload = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to load the session summary.')
        }

        if (!cancelled) {
          setSummary(payload as StudentSessionSummaryPayload)
        }
      } catch (loadError) {
        console.error(loadError)
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load the session summary.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [sessionId])

  if (loading) {
    return (
      <Card className="mt-6 flex min-h-[200px] items-center justify-center p-6">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Sparkles className="size-5 animate-pulse" />
          <p className="text-sm font-medium">Preparing your class reasoning summary...</p>
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="mt-6 p-6 border-destructive/20 bg-destructive/5">
        <p className="text-sm font-medium text-destructive">{error}</p>
      </Card>
    )
  }

  if (!summary) return null

  const isSingleAttemptSession = summary.condition === 'baseline'

  return (
    <section className="student-summary-print-root mt-6 space-y-8">
      {/* Session Overview Card */}
      <Card className="overflow-hidden border-border/60 print:shadow-none">
        <div className="border-b border-border/50 bg-secondary/20 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">Class Learning Review</p>
              </div>
              <h3 className="mt-2 text-3xl font-bold tracking-tight text-foreground">
                Session {summary.sessionCode}
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                This summary reveals the common reasoning patterns across the entire class. It helps you understand different problem-solving approaches and is not an individual grade.
              </p>
            </div>
            
            <div className="flex flex-wrap items-center gap-3 student-summary-print-hide">
              <Button variant="outline" type="button" onClick={() => window.print()} className="rounded-full shadow-xs">
                <Download className="mr-2 size-4" />
                Export PDF
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px bg-border/40 sm:grid-cols-2">
          <div className="bg-card p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Questions</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {summary.questionsAnswered}<span className="text-muted-foreground text-lg">/{summary.totalQuestions}</span>
            </p>
          </div>
          <div className="bg-card p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Avg Confidence</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatConfidence(summary.averageConfidence)}</p>
          </div>
        </div>
      </Card>

      {/* Questions & Clusters */}
      <div className="space-y-8">
        {summary.questions.map((question) => (
          <Card key={question.questionId} className="student-summary-question overflow-hidden border-border/60 shadow-xs print:shadow-none">
            {/* 1. Question Header & Formatted CS Problem Statement */}
            <div className="border-b border-border/50 bg-secondary/20 p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Badge variant="outline" className="border-border bg-card font-semibold text-foreground">
                  Question {question.position}
                </Badge>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                    Confidence: {formatConfidence(isSingleAttemptSession ? question.confidence.initial : question.confidence.revised ?? question.confidence.initial)}
                  </div>
                </div>
              </div>
              
              {/* Formatted Question Prompt: Preserves CS Code Formatting, Indentation, and Paragraph Spacing */}
              <div className="rounded-xl border border-border/60 bg-card p-5 shadow-2xs space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Problem Statement</p>
                <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground break-words font-medium">
                  {question.prompt}
                </div>
              </div>
            </div>

            <div className="p-6 space-y-8">
              {/* 2. Personal Evidence: Your Response (Slightly Highlighted Surface) */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">✓</div>
                  <h4 className="text-sm font-bold text-foreground">Your Response</h4>
                </div>

                {isSingleAttemptSession ? (
                  <div className="rounded-lg bg-card border border-primary/15 p-4 shadow-2xs">
                    <p className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground font-medium">
                      {question.yourAnswer || 'No answer recorded.'}
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg bg-card border border-primary/15 p-4 shadow-2xs space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">First Attempt</p>
                      <p className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground font-medium">
                        {question.yourFirstAnswer || 'No response'}
                      </p>
                    </div>
                    <div className="rounded-lg bg-card border border-primary/15 p-4 shadow-2xs space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revised Attempt</p>
                      <p className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground font-medium">
                        {question.yourRevisedAnswer || 'No revision'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Class Reasoning Patterns Section */}
              <div className="space-y-4 pt-2 border-t border-border/50">
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-foreground/80" />
                    <h4 className="text-base font-bold text-foreground">Class Reasoning Patterns</h4>
                  </div>
                  <p className="rounded-xl bg-secondary/20 p-4 text-xs leading-relaxed text-muted-foreground border border-border/40">
                    These groups show different ways students approached this question. They are generated from similar reasoning patterns across the class. They are not grades or rankings.
                  </p>
                </div>

                {question.usesFallbackGrouping && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                    AI grouping was unavailable, so this summary uses a basic grouping of similar responses.
                  </div>
                )}

                {/* The Clusters */}
                {question.clusters.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/60 p-6 text-center">
                    <p className="text-sm font-medium text-muted-foreground">No class reasoning summary was generated for this question.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {question.clusters.map((cluster) => (
                      <div key={cluster.clusterId} className="rounded-xl border border-border/60 bg-card p-5 shadow-2xs space-y-3.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <h5 className="text-sm font-bold text-foreground">
                              {cluster.label}
                            </h5>
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <Badge variant="secondary" className="font-normal text-xs">{cluster.count} {cluster.count === 1 ? 'response' : 'responses'}</Badge>
                              <Badge variant="outline" className="font-normal text-xs">Avg confidence: {formatConfidence(cluster.averageConfidence)}</Badge>
                            </div>
                          </div>
                        </div>

                        <p className="text-sm leading-relaxed text-foreground/80">
                          {cluster.summary}
                        </p>

                        {cluster.learningNote && (
                          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4 space-y-1">
                            <p className="text-xs font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-200">Learning Note</p>
                            <p className="text-sm leading-relaxed text-amber-950 dark:text-amber-100">
                              {cluster.learningNote}
                            </p>
                          </div>
                        )}

                        {cluster.representativeAnswers.length > 0 && (
                          <details className="group rounded-lg bg-secondary/20 border border-border/40 p-3.5">
                            <summary className="cursor-pointer text-xs font-semibold text-muted-foreground group-open:mb-2 flex items-center justify-between">
                              <span>Example responses from this group</span>
                              <span className="text-[10px] text-muted-foreground/70 font-normal">click to expand</span>
                            </summary>
                            <div className="mt-2 space-y-2">
                              {cluster.representativeAnswers.map((answer, index) => (
                                <p key={`${cluster.clusterId}-${index}`} className="rounded-md bg-card border border-border/40 px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap">
                                  {answer}
                                </p>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}