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
  ChevronDown,
  ChevronUp,
  LayoutDashboard,
  ArrowLeft,
  Play
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
  if (trimmed.length <= 120) return trimmed
  return `${trimmed.slice(0, 117).trimEnd()}...`
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
  const [isGeneratingStudentSummaries, setIsGeneratingStudentSummaries] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [studentSummaryResult, setStudentSummaryResult] = useState<{
    analysis_status: 'ok' | 'partial' | 'fallback'
    warnings: string[]
    errors: string[]
    fallback_cards_created: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null)

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

  return (
    <main className="min-h-screen bg-slate-50/60 px-4 py-8 text-slate-900 md:px-8">
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
                  {isBaseline ? 'Baseline Pass' : 'With Revision Cycle'}
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
              {isRegenerating ? 'Updating Insights...' : 'Regenerate Overview'}
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
              Sync Student Analytics
            </Button>
          </div>
        </header>

        {/* HERO HERO SECTION & CORE METRICS */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-2">
                <Badge className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${summary.source === 'openai' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                  {summary.source === 'openai' ? 'AI-Engineered' : 'Fallback Mode'}
                </Badge>
              </div>
              <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl">
                End-of-Session Performance Summary
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

        {/* OUTCOME TILES */}
        {isBaseline ? (
          <section className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            <OutcomeCard
              label="Initial Submissions"
              value={String(summary.metrics.initialResponses)}
              tone="blue"
              icon={ClipboardList}
            />
            <OutcomeCard
              label="Starting Confidence"
              value={formatConfidence(summary.metrics.initialAverageConfidence)}
              tone="blue"
              icon={TrendingUp}
            />
            <OutcomeCard
              label="Primary Misconceptions"
              value={String(mainMisconceptionCount)}
              tone="amber"
              icon={Target}
            />
          </section>
        ) : (
          <section className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            <OutcomeCard
              label="Performance Improved"
              value={formatPercent(summary.metrics.improvedPercentage)}
              tone="emerald"
              icon={TrendingUp}
            />
            <OutcomeCard
              label="Consistent Response Rate"
              value={formatPercent(summary.metrics.stayedPercentage)}
              tone="amber"
              icon={Target}
            />
            <OutcomeCard
              label="Regressed Responses"
              value={formatPercent(summary.metrics.regressedPercentage)}
              tone="rose"
              icon={TrendingDown}
            />
          </section>
        )}

        {/* DETAILED SPLIT LAYOUT */}
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            
            {/* COMPARISON METRICS SECTION */}
            {!isBaseline && (
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Shift Analysis</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Tracking data movement from pass 1 to pass 2</p>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600">
                    <TrendingUp className="size-5" />
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <MetricTile label="First Round Entries" value={String(summary.metrics.initialResponses)} icon={ClipboardList} />
                  <MetricTile label="Revision Entries" value={String(summary.metrics.revisionResponses)} icon={CheckCircle2} />
                  <MetricTile label="Confidence Growth" value={formatDelta(summary.metrics.avgConfidenceChange)} icon={TrendingUp} />
                  <MetricTile label="Retention Rate" value={formatPercent(summary.metrics.revisionParticipationRate)} icon={Target} />
                </div>
              </section>
            )}

            {/* QUESTION BY QUESTION LIST */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Questions Breakdown</h3>                </div>
                <div className="rounded-xl bg-slate-100 p-2 text-slate-600">
                  <ClipboardList className="size-5" />
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {summary.questionSummaries.map((question) => {
                  const confidenceDelta = getQuestionConfidenceDelta(question)
                  const isExpanded = expandedQuestionId === question.questionId

                  return (
                    <article 
                      key={question.questionId} 
                      className={`rounded-xl border transition-all duration-150 ${isExpanded ? 'border-slate-300 bg-slate-50/30 ring-1 ring-slate-200' : 'border-slate-150 bg-white hover:border-slate-300'}`}
                    >
                      <div 
                        className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between cursor-pointer select-none"
                        onClick={() => setExpandedQuestionId(isExpanded ? null : question.questionId)}
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-700">
                            {question.position}
                          </span>
                          <div className="min-w-0">
                            <h4 className="text-sm font-semibold text-slate-900 leading-snug">
                              {truncatePrompt(question.prompt)}
                            </h4>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                              <span><strong className="text-slate-700 font-medium">{question.initial.responseCount}</strong> entries</span>
                              <span className="text-slate-300">•</span>
                              <span><strong className="text-slate-700 font-medium">{formatConfidence(question.initial.averageConfidence)}</strong> confidence</span>
                              
                            </div>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-3 lg:justify-end">
                          {!isBaseline && question.misconceptionShift && (
                            <Badge className="bg-purple-50 text-purple-700 border-purple-100 shadow-none text-xs font-medium">
                              {question.misconceptionShift}
                            </Badge>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="size-8 p-0 text-slate-400 hover:text-slate-600 rounded-lg"
                          >
                            {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                          </Button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-slate-200/60 p-4 space-y-4 bg-white/70 rounded-b-xl">
                          <div className="rounded-xl border border-slate-100 bg-slate-50/40 p-4">
                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Question</p>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{question.prompt}</p>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            <InsightRow label="Total Initial Submission" value={String(question.initial.responseCount)} />
                            <InsightRow label="Initial Confidence" value={formatConfidence(question.initial.averageConfidence)} />
                            <InsightRow label="Top Identified Alignment" value={question.initial.topCorrectClusterLabel || 'None detected'} highlight />
                            <InsightRow label="Identified Misconception" value={question.initial.topIncorrectClusterLabel || 'None detected'} />
                          </div>

                          {question.initial.topIncorrectClusterSummary && (
                            <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-4">
                              <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">Misconception Context</p>
                              <p className="mt-1.5 text-sm leading-relaxed text-amber-900/90">
                                {question.initial.topIncorrectClusterSummary}
                              </p>
                            </div>
                          )}

                          {!isBaseline && question.revision && (
                            <div className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-4 space-y-3">
                              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">Iteration Updates</p>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <InsightRow label="Revision Submissions" value={String(question.revision.responseCount)} />
                                <InsightRow label="Revision Confidence Level" value={formatConfidence(question.revision.averageConfidence)} />
                                <InsightRow label="Confidence Growth" value={formatDelta(confidenceDelta)} />
                                <InsightRow label="Identified Misconception (Round 2)" value={question.revision.topIncorrectClusterLabel || 'None detected'} />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>
          </div>

          {/* SIDEBAR COMPONENT COLUMNS */}
          <aside className="space-y-6">
            
            {/* RECURRING PATTERNS LIST */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Observed Trends</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Recurring profiles across entries</p>
                </div>
                <div className="rounded-xl bg-amber-50 p-2 text-amber-600">
                  <Target className="size-5" />
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

            {/* AI TAKEAWAY BANNER */}
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

            {/* NEXT STEPS SECTIONS */}
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
          </aside>
        </div>

      </div>
    </main>
  )
}