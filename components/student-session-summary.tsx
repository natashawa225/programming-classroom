'use client'

import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
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

function formatPercent(value: number | null, count: number) {
  if (value === null) return `${count}`
  return `${count} (${value}%)`
}

function SummaryRow({
  label,
  value,
}: {
  label: string
  value: string | null
}) {
  return (
    <div className="rounded-xl bg-secondary/20 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">{label}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{value || '—'}</p>
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

        const response = await fetch('/student/api/student-session-summary', {
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
      <Card className="mt-6 p-6">
        <p className="text-sm text-foreground/60">Preparing your end-of-session summary...</p>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="mt-6 p-6">
        <p className="text-sm text-destructive">{error}</p>
      </Card>
    )
  }

  if (!summary) return null

  return (
    <section className="student-summary-print-root mt-6 space-y-6">
      <Card className="p-6 print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-foreground/55">End-of-session summary</p>
            <h3 className="mt-2 text-2xl font-semibold text-foreground">Your reflection for session {summary.sessionCode}</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/65">
              Review your answers, the classroom pattern, the reference answer, and one next-step suggestion for each question.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 student-summary-print-hide">
            <Button type="button" onClick={() => window.print()} className="rounded-full">
              <Download className="size-4" />
              Export PDF
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{summary.studentLabel}</Badge>
            <Badge variant="outline">{summary.condition === 'baseline' ? 'Baseline' : 'Treatment'}</Badge>
            <Badge variant="outline">{summary.source === 'mixed' ? 'AI explanation + local summary' : 'Local summary'}</Badge>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-xl bg-secondary/20 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Session code</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{summary.sessionCode}</p>
          </div>
          <div className="rounded-xl bg-secondary/20 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Generated</p>
            <p className="mt-2 text-base font-semibold text-foreground">{formatGeneratedAt(summary.generatedAt)}</p>
          </div>
          <div className="rounded-xl bg-secondary/20 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Questions answered</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">
              {summary.questionsAnswered}/{summary.totalQuestions}
            </p>
          </div>
          <div className="rounded-xl bg-secondary/20 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Average confidence</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">{formatConfidence(summary.averageConfidence)}</p>
          </div>
          <div className="rounded-xl bg-secondary/20 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Session type</p>
            <p className="mt-2 text-2xl font-semibold text-foreground">
              {summary.condition === 'baseline' ? 'One-round reflection' : 'Revision reflection'}
            </p>
          </div>
        </div>
      </Card>

      {summary.revisionStats && (
        <Card className="p-6 print:shadow-none">
          <p className="text-sm font-medium uppercase tracking-wide text-foreground/55">Revision pattern</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <SummaryRow
              label="Improved after revision"
              value={formatPercent(summary.revisionStats.improvedPercent, summary.revisionStats.improvedCount)}
            />
            <SummaryRow
              label="Incorrect to target reasoning"
              value={formatPercent(summary.revisionStats.incorrectToCorrectPercent, summary.revisionStats.incorrectToCorrectCount)}
            />
            <SummaryRow
              label="Target to needs review"
              value={formatPercent(summary.revisionStats.correctToIncorrectPercent, summary.revisionStats.correctToIncorrectCount)}
            />
            <SummaryRow
              label="Stayed on target"
              value={formatPercent(summary.revisionStats.stayedCorrectPercent, summary.revisionStats.stayedCorrectCount)}
            />
            <SummaryRow
              label="Stayed in review"
              value={formatPercent(summary.revisionStats.stayedIncorrectPercent, summary.revisionStats.stayedIncorrectCount)}
            />
          </div>
          <div className="mt-4 rounded-xl bg-secondary/20 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Revision suggestion</p>
            <p className="mt-2 text-sm leading-6 text-foreground">{summary.revisionStats.suggestion}</p>
          </div>
        </Card>
      )}

      <div className="space-y-4">
        {summary.questions.map((question) => (
          <Card key={question.questionId} className="student-summary-question p-6 print:shadow-none">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-foreground/55">Question {question.position}</p>
                <h4 className="mt-2 text-lg font-semibold text-foreground">{question.prompt}</h4>
              </div>
              <div className="rounded-full bg-secondary/25 px-3 py-1.5 text-xs font-medium text-foreground/70">
                Confidence {formatConfidence(question.confidence.revised ?? question.confidence.initial)}
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {summary.condition === 'baseline' ? (
                <SummaryRow label="Your answer" value={question.yourAnswer} />
              ) : (
                <>
                  <SummaryRow label="Your first answer" value={question.yourFirstAnswer} />
                  <SummaryRow label="Your revised answer" value={question.yourRevisedAnswer} />
                  <SummaryRow label="What changed" value={question.whatChanged} />
                </>
              )}
              <SummaryRow
                label={summary.condition === 'baseline' ? 'Classroom pattern' : 'Classroom pattern after revision'}
                value={question.classroomPatternAfterRevision || question.classroomPattern}
              />
              <SummaryRow label="Reference answer" value={question.referenceAnswer} />
              <SummaryRow label="Explanation" value={question.explanation} />
            </div>

            <div className="mt-4 rounded-xl border border-border/60 bg-background p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Suggestion</p>
              <p className="mt-2 text-sm leading-6 text-foreground">{question.suggestion}</p>
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}
