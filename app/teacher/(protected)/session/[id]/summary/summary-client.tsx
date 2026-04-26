'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  CheckCircle2,
  ClipboardList,
  Download,
  Lightbulb,
  RefreshCcw,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { SessionQuestionSummary, SessionSummaryPayload } from '@/lib/session-summary'

function formatConfidence(value: number | null) {
  return value === null ? '—' : `${value.toFixed(1)}/5`
}

function formatPercent(value: number | null) {
  return value === null ? '—' : `${value.toFixed(0)}%`
}

function formatDelta(value: number | null) {
  if (value === null) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`
}

function truncatePrompt(prompt: string) {
  const trimmed = prompt.trim()
  if (trimmed.length <= 140) return trimmed
  return `${trimmed.slice(0, 137).trimEnd()}...`
}

function buildPatternCard(pattern: string, index: number) {
  const trimmed = pattern.trim()
  const match = trimmed.match(/^(.+?)\s+(appeared|showed|persisted|surfaced)\b/i)

  if (match) {
    return {
      title: match[1].trim(),
      detail: trimmed,
      eyebrow: `Pattern ${index + 1}`,
    }
  }

  const [firstSentence, ...rest] = trimmed.split('. ')
  return {
    title: firstSentence.trim() || `Pattern ${index + 1}`,
    detail: rest.length > 0 ? rest.join('. ').trim() : 'This pattern came up repeatedly across student responses.',
    eyebrow: `Pattern ${index + 1}`,
  }
}

function MetricTile({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: typeof Target
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        <Icon className="size-4 text-slate-400" />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
    </div>
  )
}

function OutcomeCard({
  label,
  value,
  tone,
  icon: Icon,
  detail,
}: {
  label: string
  value: string
  tone: 'emerald' | 'amber' | 'rose' | 'blue'
  icon: typeof TrendingUp
  detail: string
}) {
  const toneClasses = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
    blue: 'border-sky-200 bg-sky-50 text-sky-700',
  }

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-600">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
        </div>
        <div className={`rounded-full border px-3 py-3 ${toneClasses[tone]}`}>
          <Icon className="size-5" />
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">{detail}</p>
    </article>
  )
}

function InsightRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  )
}

function getQuestionConfidenceDelta(question: SessionQuestionSummary) {
  if (!question.revision || question.initial.averageConfidence === null || question.revision.averageConfidence === null) {
    return null
  }

  return question.revision.averageConfidence - question.initial.averageConfidence
}

export default function SummaryClient({
  sessionId,
  sessionCondition,
  initialSummary,
}: {
  sessionId: string
  sessionCondition: 'baseline' | 'treatment'
  initialSummary: SessionSummaryPayload
}) {
  const [summary, setSummary] = useState(initialSummary)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isBaseline = sessionCondition === 'baseline'
  const patternCards = useMemo(
    () => summary.recurringPatterns.map((pattern, index) => buildPatternCard(pattern, index)),
    [summary.recurringPatterns]
  )
  const mainMisconceptionCount = useMemo(() => {
    return summary.questionSummaries.filter((question) => Boolean(question.initial.topIncorrectClusterLabel)).length
  }, [summary.questionSummaries])

  const heroSubtitle = isBaseline
    ? 'Review how students understood the lesson on their first pass, with class-wide misconception patterns highlighted for follow-up teaching.'
    : 'Review how student thinking shifted between initial and revision responses, including confidence movement and misconception recovery.'

  const handleRegenerate = async () => {
    try {
      setIsRegenerating(true)
      setError(null)
      setStatusMessage(null)

      const response = await fetch('/api/session-summary?force=true', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
        }),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to regenerate summary.')
      }

      setSummary(payload as SessionSummaryPayload)
      setStatusMessage('Summary updated')
    } catch (regenError) {
      console.error(regenError)
      setError(regenError instanceof Error ? regenError.message : 'Failed to regenerate summary.')
    } finally {
      setIsRegenerating(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-6 text-slate-900 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
              <ClipboardList className="size-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Classroom Response System</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 shadow-none">
                  Teacher session summary
                </Badge>
                <Badge className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-none">
                  {isBaseline ? 'Baseline' : 'Treatment'}
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-start gap-3 lg:items-end">
            <div className="flex flex-wrap gap-3">
              <Button type="button" onClick={handleRegenerate} disabled={isRegenerating} className="rounded-full px-5">
                {isRegenerating ? (
                  <>
                    <Spinner className="size-4" />
                    Regenerating...
                  </>
                ) : (
                  <>
                    <RefreshCcw className="size-4" />
                    Regenerate summary
                  </>
                )}
              </Button>
              <Link href={`/teacher/session/${sessionId}`}>
                <Button variant="outline" className="rounded-full border-slate-200 px-5">
                  Back to session
                </Button>
              </Link>
            </div>
            {statusMessage ? <p className="text-sm text-slate-500">{statusMessage}</p> : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between min-w-0">
          <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">

                <Badge className={`rounded-full border px-3 py-1 text-sm font-medium shadow-none ${summary.source === 'openai' ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                  {summary.source === 'openai' ? 'AI summary' : 'Fallback summary'}
                </Badge>
              </div>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight text-slate-900">End-of-session teaching summary</h1>
              <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600">{heroSubtitle}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:w-[420px]">
              <MetricTile label="Questions" value={String(summary.metrics.totalQuestions)} icon={ClipboardList} />
              <MetricTile label="Participants" value={String(summary.metrics.totalParticipants)} icon={Target} />
              <MetricTile label="Responses" value={String(summary.metrics.totalResponses)} icon={CheckCircle2} />
              <MetricTile label="Avg confidence" value={formatConfidence(summary.metrics.averageConfidence)} icon={TrendingUp} />
            </div>
          </div>
        </section>

        {isBaseline ? (
          <section className="grid gap-4 md:grid-cols-3">
            <OutcomeCard
              label="Initial responses"
              value={String(summary.metrics.initialResponses)}
              tone="blue"
              icon={ClipboardList}
              detail="Baseline sessions focus on first-pass student thinking without a revision round."
            />
            <OutcomeCard
              label="Average confidence"
              value={formatConfidence(summary.metrics.initialAverageConfidence)}
              tone="blue"
              icon={TrendingUp}
              detail="This reflects how confident students felt while answering the initial questions."
            />
            <OutcomeCard
              label="Misconception clusters"
              value={String(mainMisconceptionCount)}
              tone="amber"
              icon={Target}
              detail="Baseline session: revision metrics are not available, so focus is on initial misconception patterns."
            />
          </section>
        ) : (
          <section className="grid gap-4 md:grid-cols-3">
            <OutcomeCard
              label="Improved"
              value={formatPercent(summary.metrics.improvedPercentage)}
              tone="emerald"
              icon={TrendingUp}
              detail="Questions where revision performance improved relative to the initial misconception/correctness balance."
            />
            <OutcomeCard
              label="Stayed similar"
              value={formatPercent(summary.metrics.stayedPercentage)}
              tone="amber"
              icon={Target}
              detail="Questions where revision responses stayed close to the initial class pattern."
            />
            <OutcomeCard
              label="Regressed"
              value={formatPercent(summary.metrics.regressedPercentage)}
              tone="rose"
              icon={TrendingDown}
              detail="Questions where revision responses showed more misconception pressure than the initial round."
            />
          </section>
        )}

        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="space-y-6">
            {!isBaseline ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-slate-500">Revision comparison</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Initial vs revision checks</h2>
                  </div>
                  <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <TrendingUp className="size-5" />
                  </div>
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <MetricTile label="Initial responses" value={String(summary.metrics.initialResponses)} icon={ClipboardList} />
                  <MetricTile label="Revision responses" value={String(summary.metrics.revisionResponses)} icon={CheckCircle2} />
                  <MetricTile label="Confidence change" value={formatDelta(summary.metrics.avgConfidenceChange)} icon={TrendingUp} />
                  <MetricTile label="Revision participation" value={formatPercent(summary.metrics.revisionParticipationRate)} icon={Target} />
                </div>
              </section>
            ) : null}

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-500">Per-question summary</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Question-level patterns</h2>
                </div>
                <div className="flex size-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                  <ClipboardList className="size-5" />
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {summary.questionSummaries.map((question) => {
                  const confidenceDelta = getQuestionConfidenceDelta(question)

                  return (
                    <article key={question.questionId} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <Badge className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-none">
                          Q{question.position}
                        </Badge>
                        {!isBaseline && question.misconceptionShift ? (
                          <Badge className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 shadow-none">
                            Shift: {question.misconceptionShift}
                          </Badge>
                        ) : null}
                      </div>

                      <h3 className="mt-4 text-lg font-semibold tracking-tight text-slate-900">{truncatePrompt(question.prompt)}</h3>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <InsightRow label="Responses" value={String(question.initial.responseCount)} />
                        <InsightRow label="Avg confidence" value={formatConfidence(question.initial.averageConfidence)} />
                        <InsightRow label="Top correct cluster" value={question.initial.topCorrectClusterLabel || 'None detected'} />
                        <InsightRow label="Top misconception" value={question.initial.topIncorrectClusterLabel || 'None detected'} />
                      </div>

                      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                        <p className="text-sm font-medium text-amber-800">Misconception summary</p>
                        <p className="mt-2 text-sm leading-7 text-amber-900/80">
                          {question.initial.topIncorrectClusterSummary || 'No misconception summary was generated for this question.'}
                        </p>
                      </div>

                      {!isBaseline && question.revision ? (
                        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <InsightRow label="Revision responses" value={String(question.revision.responseCount)} />
                            <InsightRow label="Revision confidence" value={formatConfidence(question.revision.averageConfidence)} />
                            <InsightRow label="Confidence change" value={formatDelta(confidenceDelta)} />
                            <InsightRow label="Revision misconception" value={question.revision.topIncorrectClusterLabel || 'None detected'} />
                          </div>
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </section>
          </section>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-500">Recurring patterns</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Class-wide misconception themes</h2>
                </div>
                <div className="flex size-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                  <Target className="size-5" />
                </div>
              </div>

              <div className="mt-5 space-y-4">
                {patternCards.map((pattern) => (
                  <article key={`${pattern.eyebrow}-${pattern.title}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <p className="text-sm font-medium text-slate-500">{pattern.eyebrow}</p>
                    <h3 className="mt-2 text-lg font-semibold text-slate-900">{pattern.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-slate-600">{pattern.detail}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-sky-200 bg-sky-50 p-6 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-white text-sky-700 shadow-sm">
                  <Sparkles className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-sky-700">Session takeaway</p>
                  <p className="mt-3 text-base leading-8 text-sky-950/85">{summary.sessionTakeaway}</p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                  <Lightbulb className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">Next teaching recommendation</p>
                  <p className="mt-3 text-base leading-8 text-slate-700">{summary.nextTeachingRecommendation}</p>
                  {summary.source === 'fallback' ? (
                    <p className="mt-3 text-sm text-slate-500">AI summary unavailable — showing fallback guidance.</p>
                  ) : null}
                </div>
              </div>
            </section>
          </aside>
        </section>

        <footer className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900">Next step</p>
            <p className="mt-1 text-sm text-slate-600">Export the report, return to the live session, or start planning the next class run.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href={`/teacher/session/${sessionId}/export`}>
              <Button variant="outline" className="rounded-full border-slate-200 px-5">
                <Download className="size-4" />
                Export report
              </Button>
            </Link>
            <Link href="/teacher/create-session">
              <Button variant="outline" className="rounded-full border-slate-200 px-5">
                Start new session
              </Button>
            </Link>
            <Link href="/teacher/dashboard">
              <Button variant="outline" className="rounded-full border-slate-200 px-5">
                Back to dashboard
              </Button>
            </Link>
          </div>
        </footer>
      </div>
    </main>
  )
}
