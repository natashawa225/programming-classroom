'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  CheckCircle2,
  ClipboardList,
  Download,
  Info,
  Lightbulb,
  RefreshCcw,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  LayoutDashboard,
  ArrowLeft,
  Play
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { ResponsePattern, SessionQuestionSummary, SessionSummaryPayload } from '@/lib/session-summary'
import { getClusterPatternColor } from '@/lib/live-cluster-rendering'
import { CONFIDENCE_BINS } from '@/lib/confidence'

/**
 * Thin, muted custom scrollbar for internally-scrolling containers (question
 * list, evidence drawers) — keeps overflow contained without the browser's
 * default chunky scrollbar breaking the card's visual boundary.
 */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300'

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

function formatStudentCount(count: number) {
  return `${count} ${count === 1 ? 'student' : 'students'}`
}

function truncatePrompt(prompt: string, maxLength = 120) {
  const trimmed = prompt.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`
}

function buildPatternCard(pattern: string, index: number) {
  const trimmed = pattern.trim()
  const match = trimmed.match(/^(.+?)\s+(appeared|showed|persisted|surfaced)\b/i)

  if (match) {
    return {
      title: match[1].trim(),
      detail: trimmed,
      eyebrow: `Trend ${index + 1}`,
    }
  }

  const [firstSentence, ...rest] = trimmed.split('. ')
  return {
    title: firstSentence.trim() || `Trend ${index + 1}`,
    detail: rest.length > 0 ? rest.join('. ').trim() : 'This pattern came up repeatedly across student responses.',
    eyebrow: `Trend ${index + 1}`,
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
    <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm transition-all hover:border-slate-200">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        <div className="rounded-lg bg-slate-50 p-1.5 text-slate-400">
          <Icon className="size-4" />
        </div>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
    </div>
  )
}

function OutcomeCard({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string
  value: string
  tone: 'emerald' | 'amber' | 'rose' | 'blue'
  icon: typeof TrendingUp
}) {
  const toneClasses = {
    emerald: 'border-emerald-100 bg-emerald-50/50 text-emerald-700 ring-emerald-600/10',
    amber: 'border-amber-100 bg-amber-50/50 text-amber-700 ring-amber-600/10',
    rose: 'border-rose-100 bg-rose-50/50 text-rose-700 ring-rose-600/10',
    blue: 'border-blue-100 bg-blue-50/50 text-blue-700 ring-blue-600/10',
  }

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
        </div>
        <div className={`rounded-xl border p-2.5 ${toneClasses[tone]}`}>
          <Icon className="size-5" />
        </div>
      </div>
    </article>
  )
}

function InsightRow({
  label,
  value,
  highlight = false
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${highlight ? 'border-indigo-100 bg-indigo-50/30' : 'border-slate-100 bg-slate-50/50'}`}>
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-800">{value}</p>
    </div>
  )
}

/**
 * Compact pill for a single stat (entries, confidence, change) — used in the
 * question detail pane instead of large boxed rows, so the header stays short
 * and the pattern grid below is what draws the eye.
 */
function StatChip({
  label,
  value,
  tone = 'slate',
}: {
  label: string
  value: string
  tone?: 'slate' | 'indigo' | 'emerald' | 'rose'
}) {
  const toneClasses = {
    slate: 'bg-slate-100 text-slate-600',
    indigo: 'bg-indigo-50 text-indigo-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    rose: 'bg-rose-50 text-rose-700',
  }

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${toneClasses[tone]}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  )
}

function getQuestionConfidenceDelta(question: SessionQuestionSummary) {
  if (!question.revision || question.initial.averageConfidence === null || question.revision.averageConfidence === null) {
    return null
  }
  return question.revision.averageConfidence - question.initial.averageConfidence
}

function FallbackNotice() {
  return (
    <p className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
      Analysis generated using fallback grouping.
    </p>
  )
}

/**
 * Compact color-chip legend for what a pattern's bubble/accent color means —
 * standard UI badge row instead of a paragraph. Ranges come straight from
 * lib/confidence.ts (the same source getClusterPatternColor uses), so this
 * can never drift out of sync with the actual color logic. Deliberately
 * avoids implying color = correctness.
 */
function ConfidenceLegend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        <Info className="size-3.5" />
        Confidence
      </span>
      {CONFIDENCE_BINS.map((bin) => (
        <span key={bin.level} className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: getClusterPatternColor(bin.min).dot }}
          />
          <span className="font-medium text-slate-700">{bin.label}</span>
          <span className="text-slate-400">{bin.min.toFixed(1)}–{bin.max.toFixed(1)}</span>
        </span>
      ))}
      <span className="text-slate-400">· reflects confidence, not correctness</span>
    </div>
  )
}

/**
 * One neutral response pattern rendered as a grid card with a collapsible
 * evidence drawer — summary metrics (count/share/confidence) stay visible up
 * front, every response in the pattern only appears once expanded (scrollable,
 * never truncated). Ranked by prevalence only — the rank number is a size
 * fact, never a correctness grade. The left accent + dot reflect the
 * pattern's own mean student confidence (low/middle/high), reusing the same
 * non-evaluative palette as the live cluster view; it carries no
 * correct/incorrect meaning. `spanFull` lets the grid give a lone trailing
 * card (odd pattern count) the full row instead of leaving an empty cell
 * beside it.
 */
function PatternGridCard({
  pattern,
  isExpanded,
  onToggle,
  spanFull = false,
}: {
  pattern: ResponsePattern
  isExpanded: boolean
  onToggle: () => void
  spanFull?: boolean
}) {
  const palette = getClusterPatternColor(pattern.averageConfidence)
  // Defensive: a stored summary_json blob is untyped at runtime, so a stale
  // cached row from before this field existed could still reach the client.
  const responses = pattern.responses ?? []
  const hasEvidence = responses.length > 0

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:shadow-md ${spanFull ? 'col-span-2' : ''}`}
      style={{ borderLeftWidth: 4, borderLeftColor: palette.border }}
    >
      <button
        type="button"
        onClick={hasEvidence ? onToggle : undefined}
        aria-expanded={hasEvidence ? isExpanded : undefined}
        className={`flex w-full items-start gap-2.5 p-3.5 text-left ${hasEvidence ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: palette.dot }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Pattern {pattern.rank}</span>
            {hasEvidence && (
              isExpanded ? <ChevronUp className="size-3.5 shrink-0 text-slate-400" /> : <ChevronDown className="size-3.5 shrink-0 text-slate-400" />
            )}
          </div>
          <p className="mt-0.5 text-sm font-semibold leading-snug text-slate-800">{pattern.label}</p>
          {pattern.summary && <p className="mt-1 text-xs leading-relaxed text-slate-500">{pattern.summary}</p>}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              {formatStudentCount(pattern.count)}
              {pattern.percentage !== null ? ` · ${pattern.percentage.toFixed(0)}%` : ''}
            </span>
            {pattern.averageConfidence !== null && (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-slate-700"
                style={{ backgroundColor: palette.fill }}
              >
                {pattern.averageConfidence.toFixed(1)}/5 confidence
              </span>
            )}
          </div>
        </div>
      </button>

      {hasEvidence && isExpanded && (
        <div className="border-t border-slate-100 bg-slate-50/70 px-3.5 py-3">
          <div className={`max-h-56 space-y-1.5 overflow-y-auto pr-1 ${THIN_SCROLLBAR}`}>
            {responses.map((response) => (
              <div
                key={response.responseId}
                className="rounded-lg border border-slate-100 bg-white px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-slate-500">
                    {response.participantLabel || 'Participant'}
                  </span>
                  <span className="text-[11px] text-slate-400">{response.confidence}/5</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{response.answer}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ResponsePatternGrid({ patterns }: { patterns: ResponsePattern[] }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggle = (clusterId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(clusterId)) next.delete(clusterId)
      else next.add(clusterId)
      return next
    })
  }

  if (patterns.length === 0) {
    return <p className="text-sm text-slate-400">No response patterns are available for this round.</p>
  }

  const isOddCount = patterns.length % 2 === 1

  return (
    <div className="grid grid-cols-2 items-start gap-3">
      {patterns.map((pattern, index) => (
        <PatternGridCard
          key={pattern.clusterId}
          pattern={pattern}
          isExpanded={expandedIds.has(pattern.clusterId)}
          onToggle={() => toggle(pattern.clusterId)}
          spanFull={isOddCount && index === patterns.length - 1}
        />
      ))}
    </div>
  )
}

/** Detail pane for the currently selected question in the master/detail Questions Breakdown. */
function QuestionDetailPane({
  question,
  isBaseline,
}: {
  question: SessionQuestionSummary
  isBaseline: boolean
}) {
  const confidenceDelta = getQuestionConfidenceDelta(question)

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Question {question.position}
        </p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
          {question.prompt}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <StatChip label="Entries" value={String(question.initial.responseCount)} />
        <StatChip label="Confidence" value={formatConfidence(question.initial.averageConfidence)} tone="indigo" />
        {!isBaseline && confidenceDelta !== null && (
          <StatChip
            label="Change"
            value={formatDelta(confidenceDelta)}
            tone={confidenceDelta > 0 ? 'emerald' : confidenceDelta < 0 ? 'rose' : 'slate'}
          />
        )}
      </div>

      {question.initial.source === 'fallback' && <FallbackNotice />}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Response Patterns{!isBaseline && question.revision ? ' (Initial)' : ''}
        </p>
        <ConfidenceLegend />
        <div className="mt-3">
          <ResponsePatternGrid patterns={question.initial.patterns} />
        </div>
      </div>

      {!isBaseline && question.revision && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Revision Round</p>
            <div className="flex flex-wrap gap-2">
              <StatChip label="Entries" value={String(question.revision.responseCount)} />
              <StatChip label="Confidence" value={formatConfidence(question.revision.averageConfidence)} tone="indigo" />
            </div>
          </div>

          {question.revision.source === 'fallback' && <FallbackNotice />}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Response Patterns (Revision)
            </p>
            <ResponsePatternGrid patterns={question.revision.patterns} />
          </div>
        </div>
      )}
    </div>
  )
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
  const [isGeneratingStudentSummaries, setIsGeneratingStudentSummaries] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [studentSummaryResult, setStudentSummaryResult] = useState<{
    analysis_status: 'ok' | 'partial' | 'fallback'
    warnings: string[]
    errors: string[]
    fallback_cards_created: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)

  const isBaseline = sessionCondition === 'baseline'
  const patternCards = useMemo(
    () => summary.recurringPatterns.map((pattern, index) => buildPatternCard(pattern, index)),
    [summary.recurringPatterns]
  )
  const totalPatternsIdentified = useMemo(() => {
    return summary.questionSummaries.reduce((sum, question) => sum + question.initial.patterns.length, 0)
  }, [summary.questionSummaries])

  const selectedQuestion =
    summary.questionSummaries.find((question) => question.questionId === selectedQuestionId) ??
    summary.questionSummaries[0] ??
    null

  const heroSubtitle = isBaseline
    ? 'Review the response patterns students gave on their first pass, grouped by what they said, with confidence shown as a separate descriptive statistic.'
    : 'Review how student responses were distributed across patterns in the initial and revision rounds, alongside confidence movement between rounds.'

  const handleRegenerate = async () => {
    try {
      setIsRegenerating(true)
      setError(null)
      setStatusMessage(null)
      setStudentSummaryResult(null)

      const response = await fetch('/api/session-summary?force=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to regenerate summary.')

      setSummary(payload as SessionSummaryPayload)
      setStatusMessage('Summary updated successfully.')
    } catch (regenError) {
      console.error(regenError)
      setError(regenError instanceof Error ? regenError.message : 'Failed to regenerate summary.')
    } finally {
      setIsRegenerating(false)
    }
  }

  const handleGenerateStudentSummaries = async () => {
    try {
      setIsGeneratingStudentSummaries(true)
      setError(null)
      setStatusMessage(null)
      setStudentSummaryResult(null)

      const response = await fetch(`/api/teacher/sessions/${sessionId}/generate-student-summaries`, {
        method: 'POST',
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to generate student summaries.')

      const warnings = Array.isArray(payload?.warnings) ? payload.warnings : []
      const errors = Array.isArray(payload?.errors) ? payload.errors : []
      setStudentSummaryResult({
        analysis_status: payload?.analysis_status || 'ok',
        warnings,
        errors,
        fallback_cards_created: Number(payload?.fallback_cards_created || 0),
      })
      setStatusMessage('Student summaries generated successfully.')
    } catch (summaryError) {
      console.error(summaryError)
      setError('Could not generate student summaries.')
    } finally {
      setIsGeneratingStudentSummaries(false)
    }
  }

  // Split into three standalone cards so treatment and baseline can each
  // arrange them differently without duplicating markup. Baseline keeps them
  // bundled as `sidebarCards` (same 3-across grid as before); treatment places
  // Observed Trends beside Shift Analysis and renders the other two full width
  // below, so the right-hand rail no longer ends up dramatically taller than
  // Shift Analysis.
  const observedTrendsCard = (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Observed Trends</h3>
          <p className="text-xs text-slate-400 mt-0.5">Recurring response patterns across the session</p>
        </div>
        <div className="rounded-xl bg-amber-50 p-2 text-amber-600">
          <Sparkles className="size-5" />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {patternCards.map((pattern) => (
          <article key={`${pattern.eyebrow}-${pattern.title}`} className="rounded-xl border border-slate-100 bg-slate-50/40 p-4 hover:border-slate-200 transition-colors">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{pattern.eyebrow}</span>
            <h4 className="mt-1 text-sm font-bold text-slate-900">{pattern.title}</h4>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{pattern.detail}</p>
          </article>
        ))}
      </div>
    </section>
  )

  const sessionTakeawayCard = (
    <section className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-sky-50/40 p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm border border-indigo-50">
          <Sparkles className="size-5" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-indigo-900">Session Summary Takeaway</h4>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{summary.sessionTakeaway}</p>
        </div>
      </div>
    </section>
  )

  const nextRecommendationCard = (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
          <Lightbulb className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-bold text-slate-900">Next Curated Recommendation</h4>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{summary.nextTeachingRecommendation}</p>
          {summary.source === 'fallback' && (
            <p className="mt-3 text-xs text-slate-400 italic border-t border-slate-50 pt-2">
              System running in fallback guidance profile.
            </p>
          )}
        </div>
      </div>
    </section>
  )

  // Baseline-only bundle — identical DOM/order to the previous single-array
  // sidebarCards, so the baseline branch below is visually/structurally unchanged.
  const sidebarCards = (
    <>
      {observedTrendsCard}
      {sessionTakeawayCard}
      {nextRecommendationCard}
    </>
  )

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">

        {/* TOP NAVIGATION BAR */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <Link href="/teacher/dashboard">
              <Button variant="ghost" size="sm" className="gap-2 text-slate-600 hover:text-slate-900">
                <LayoutDashboard className="size-4" />
                Dashboard
              </Button>
            </Link>
            <span className="text-slate-300">/</span>
            <Link href={`/teacher/session/${sessionId}`}>
              <Button variant="ghost" size="sm" className="gap-2 text-slate-600 hover:text-slate-900">
                <ArrowLeft className="size-4" />
                Active Session
              </Button>
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <Link href={`/teacher/session/${sessionId}/export`}>
              <Button variant="outline" size="sm" className="rounded-lg bg-white shadow-sm gap-2">
                <Download className="size-4 text-slate-500" />
                Export Report
              </Button>
            </Link>
            <Link href="/teacher/create-session">
              <Button variant="default" size="sm" className="rounded-lg bg-indigo-600 hover:bg-indigo-700 shadow-sm gap-2">
                <Play className="size-4" />
                Start New Session
              </Button>
            </Link>
          </div>
        </div>

        {/* STATUS BAR ALERTS */}
        {(statusMessage || error) && (
          <div className={`p-4 rounded-xl border text-sm ${error ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
            {error || statusMessage}
          </div>
        )}

        {/* CONTROLS HEADER */}
        <header className="flex flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <ClipboardList className="size-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Session Evaluation</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-100 font-medium">
                  Teacher Summary
                </Badge>
                <Badge className={`font-medium ${isBaseline ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200'} shadow-none`}>
                  {isBaseline ? 'Baseline Pass' : 'With Revision'}
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <Button
              variant="outline"
              onClick={handleRegenerate}
              disabled={isRegenerating || isGeneratingStudentSummaries}
              className="rounded-xl border-slate-200 bg-white shadow-sm gap-2"
            >
              <RefreshCcw className={`size-4 text-slate-500 ${isRegenerating ? 'animate-spin' : ''}`} />
              {isRegenerating ? 'Updating Insights...' : 'Regenerate Analysis'}
            </Button>

            <Button
              variant="outline"
              onClick={handleGenerateStudentSummaries}
              disabled={isRegenerating || isGeneratingStudentSummaries}
              className="rounded-xl border-indigo-200 bg-indigo-50/50 text-indigo-700 hover:bg-indigo-50 shadow-sm gap-2"
            >
              {isGeneratingStudentSummaries ? (
                <Spinner className="size-4" />
              ) : (
                <Sparkles className="size-4 text-indigo-600" />
              )}
              Generate Student Individual Summaries
            </Button>
          </div>
        </header>

        {/* HERO HERO SECTION & CORE METRICS */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-2">
                <Badge className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${summary.source === 'openai' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                  {summary.source === 'openai' ? 'AI-Analysis' : 'Fallback Mode'}
                </Badge>
              </div>
              <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl">
                End-of-Session Summary
              </h1>
              <p className="mt-4 text-base leading-relaxed text-slate-500 max-w-xl">
                {heroSubtitle}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 bg-slate-50/50 p-4 rounded-xl border border-slate-100">
              <MetricTile label="Total Questions" value={String(summary.metrics.totalQuestions)} icon={ClipboardList} />
              <MetricTile label="Active Cohort" value={String(summary.metrics.totalParticipants)} icon={Target} />
              <MetricTile label="Total Submissions" value={String(summary.metrics.totalResponses)} icon={CheckCircle2} />
              <MetricTile label="Avg Confidence" value={formatConfidence(summary.metrics.averageConfidence)} icon={TrendingUp} />
            </div>
          </div>
        </section>

        {/* OUTCOME TILES — descriptive counts only, no correctness judgment */}
        <section className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {/* <OutcomeCard
            label="Initial Submissions"
            value={String(summary.metrics.initialResponses)}
            tone="blue"
            icon={ClipboardList}
          /> */}
          {/* <OutcomeCard
            label="Starting Confidence"
            value={formatConfidence(summary.metrics.initialAverageConfidence)}
            tone="blue"
            icon={TrendingUp}
          /> */}
          {/* <OutcomeCard
            label="Response Patterns Identified"
            value={String(totalPatternsIdentified)}
            tone="blue"
            icon={Sparkles}
          /> */}
        </section>

        {/* CONFIDENCE SHIFT TILES — movement in self-reported confidence only, never a correctness claim */}
        {!isBaseline && (
          <section className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            <OutcomeCard
              label="Confidence Increased"
              value={formatPercent(summary.metrics.confidenceIncreasedPercentage)}
              tone="emerald"
              icon={TrendingUp}
            />
            <OutcomeCard
              label="Confidence Stayed the Same"
              value={formatPercent(summary.metrics.confidenceStayedPercentage)}
              tone="amber"
              icon={Target}
            />
            <OutcomeCard
              label="Confidence Decreased"
              value={formatPercent(summary.metrics.confidenceDecreasedPercentage)}
              tone="rose"
              icon={TrendingDown}
            />
          </section>
        )}

        {/* SHIFT ANALYSIS + OBSERVED TRENDS — treatment sessions pair these two
            side by side (both naturally similar heights) instead of stacking
            all three sidebar cards next to Shift Analysis, which is what left
            a huge empty gap under the shorter Shift Analysis card. Session
            Takeaway and Next Recommendation move to their own full-width
            cards below. Baseline (no Shift Analysis) is unchanged: sidebarCards
            still renders as a 3-across row. */}
        {!isBaseline ? (
          <>
            <div className="grid items-start gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Shift Analysis</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Tracking data movement from initial responses to revision</p>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600">
                    <TrendingUp className="size-5" />
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 items-start gap-3">
                  <MetricTile label="First Round Entries" value={String(summary.metrics.initialResponses)} icon={ClipboardList} />
                  <MetricTile label="Revision Entries" value={String(summary.metrics.revisionResponses)} icon={CheckCircle2} />
                  <MetricTile label="Confidence Growth" value={formatDelta(summary.metrics.avgConfidenceChange)} icon={TrendingUp} />
                  {/* <MetricTile label="Retention Rate" value={formatPercent(summary.metrics.revisionParticipationRate)} icon={Target} /> */}
                </div>
              </section>

              {observedTrendsCard}
            </div>

            {/* {sessionTakeawayCard}
            {nextRecommendationCard} */}
          </>
        ) : (
          <div className="grid gap-6 sm:grid-cols-3">{sidebarCards}</div>
        )}

        {/* QUESTIONS BREAKDOWN — full width so the pattern grid has real room to breathe */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-5 py-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Questions Breakdown</h3>
              <p className="text-xs text-slate-400 mt-0.5">Select a question to see its response patterns</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 shadow-sm">
              <ClipboardList className="size-5" />
            </div>
          </div>

          {summary.questionSummaries.length === 0 ? (
            <p className="p-6 text-sm text-slate-400">No questions in this session yet.</p>
          ) : (
            <div className="grid md:grid-cols-[240px_1fr]">
              {/* MASTER LIST */}
              <nav className={`border-b border-slate-100 bg-slate-50/50 p-2 md:max-h-[640px] md:overflow-y-auto md:border-b-0 md:border-r ${THIN_SCROLLBAR}`}>
                {summary.questionSummaries.map((question) => {
                  const selected = question.questionId === selectedQuestion?.questionId
                  return (
                    <button
                      key={question.questionId}
                      type="button"
                      onClick={() => setSelectedQuestionId(question.questionId)}
                      aria-pressed={selected}
                      className={`mb-1.5 w-full rounded-xl border px-3 py-2.5 text-left transition last:mb-0 ${
                        selected
                          ? 'border-indigo-200 bg-indigo-50/70 shadow-sm'
                          : 'border-transparent hover:border-slate-200 hover:bg-white hover:shadow-sm'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex size-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                            selected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {question.position}
                        </span>
                        <span className="min-w-0 truncate text-sm font-medium text-slate-800">
                          {truncatePrompt(question.prompt, 60)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-8 text-[11px] text-slate-400">
                        {/* <span>{question.initial.responseCount} entries</span>
                        <span>·</span>
                        <span>{formatConfidence(question.initial.averageConfidence)}</span> */}
                        {/* {question.initial.patterns.length > 0 && (
                          <span className="rounded-full bg-slate-200/70 px-1.5 py-0.5 font-medium text-slate-500">
                            {question.initial.patterns.length}p
                          </span>
                        )} */}
                      </div>
                    </button>
                  )
                })}
              </nav>

              {/* DETAIL PANE */}
              <div className={`min-w-0 p-5 md:max-h-[640px] md:overflow-y-auto md:p-6 ${THIN_SCROLLBAR}`}>
                {selectedQuestion && <QuestionDetailPane question={selectedQuestion} isBaseline={isBaseline} />}
              </div>
            </div>
            
          )}
          
        </section>
        {sessionTakeawayCard}
        {nextRecommendationCard}
      </div>
    </main>
  )
}
