'use client'

import { useEffect, useMemo, useState } from 'react'
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
  Play,
  Pin,
  Terminal,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type {
  ResponsePattern,
  SessionQuestionSummary,
  SessionSummaryPayload,
  SynthesizedAgentObservation,
  SynthesizedTeacherDecision,
} from '@/lib/session-summary'
import type { LecturerAnnotation } from '@/lib/types/database'
import { getClusterPatternColor } from '@/lib/live-cluster-rendering'
import { CONFIDENCE_BINS } from '@/lib/confidence'

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

function ReferenceAlignmentBadge({ alignment }: { alignment?: ResponsePattern['referenceAlignment'] }) {
  if (!alignment || !alignment.alignmentLevel) return null

  const level = alignment.alignmentLevel
  const config = {
    strong: { label: 'Strong Reference Alignment', tone: 'bg-sky-50 text-sky-700 border-sky-200' },
    partial: { label: 'Partial Reference Alignment', tone: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    unclear: { label: 'Unclear Alignment', tone: 'bg-slate-100 text-slate-700 border-slate-200' },
    limited: { label: 'Limited Reference Alignment', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  }[level] || { label: 'Reference Alignment', tone: 'bg-slate-100 text-slate-700 border-slate-200' }

  return (
    <div className="mt-2 flex flex-col gap-0.5">
      <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${config.tone}`}>
        <span>🎯 {config.label}</span>
      </span>
      {alignment.explanation && (
        <span className="text-[10px] text-slate-500 italic pl-1">
          {alignment.explanation} (Relative to reference answer; does not imply incorrectness)
        </span>
      )}
    </div>
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

          <ReferenceAlignmentBadge alignment={pattern.referenceAlignment} />

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

/**
 * Synthesized AI Observations Section ("What AI Brought to Your Attention")
 * Grouped, human-readable observations (NOT raw 49-event log dumps!)
 */
function SynthesizedObservationsSection({ observations }: { observations: SynthesizedAgentObservation[] }) {
  const [expandedQuoteId, setExpandedQuoteId] = useState<string | null>(null)

  if (!observations || observations.length === 0) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">What AI Brought to Your Attention</h3>
            <p className="text-xs text-slate-400 mt-0.5">Surfaced observations grounded in student reasoning evidence and active teacher monitoring goals</p>
          </div>
          <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600">
            <Sparkles className="size-5" />
          </div>
        </div>
        <p className="mt-4 text-xs text-slate-400 italic">No autonomous observations crossed teacher monitoring thresholds in this session.</p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/50 via-white to-sky-50/40 p-6 shadow-sm space-y-5">
      <div className="flex items-center justify-between border-b border-indigo-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-slate-900">What AI Brought to Your Attention</h3>
            <Badge className="bg-indigo-600 text-white font-medium">{observations.length} Synthesized Finding{observations.length === 1 ? '' : 's'}</Badge>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
          MeshQuiz noticed these patterns in student responses during the lesson.
          </p>
        </div>
        <div className="rounded-xl bg-indigo-100 p-2.5 text-indigo-700">
          <Sparkles className="size-5" />
        </div>
      </div>

      <div className="space-y-4">
        {observations.map((obs) => {
          const isQuotesExpanded = expandedQuoteId === obs.id
          return (
            <div key={obs.id} className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm space-y-4">
              {/* Finding Title & Status */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-700 block">AI Observation</span>
                  <h4 className="mt-1 text-base font-bold text-slate-900 leading-snug">{obs.title}</h4>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">{obs.findingDescription}</p>
                </div>
                <Badge
                  variant="outline"
                  className={`capitalize font-semibold text-xs px-2.5 py-1 ${
                    obs.humanCheckpointStatus === 'accepted' || obs.lecturerAction === 'pinned'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : obs.humanCheckpointStatus === 'dismissed'
                      ? 'bg-slate-100 text-slate-600 border-slate-200'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}
                >
                  {obs.lecturerAction ? `Lecturer: ${obs.lecturerAction}` : `Status: ${obs.humanCheckpointStatus}`}
                </Badge>
              </div>

              {/* Evidence & Why Surfaced Grid */}
              <div className="grid gap-3 sm:grid-cols-2 bg-slate-50/80 p-4 rounded-xl border border-slate-100">
                {/* Evidence Column */}
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Evidence</span>
                  <p className="text-sm font-bold text-slate-800">
                    {obs.prevalencePercentage}% of responses ({obs.responseCount} student{obs.responseCount === 1 ? '' : 's'})
                  </p>

                  {obs.sampleQuotes.length > 0 && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setExpandedQuoteId(isQuotesExpanded ? null : obs.id)}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                      >
                        {isQuotesExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                        {isQuotesExpanded ? 'Hide representative quotes' : `View ${obs.sampleQuotes.length} sample quotes`}
                      </button>

                      {isQuotesExpanded && (
                        <div className="mt-2 space-y-1.5 border-t border-slate-200/60 pt-2">
                          {obs.sampleQuotes.map((sq) => (
                            <blockquote key={sq.responseId} className="text-xs text-slate-700 italic bg-white p-2 rounded border border-slate-100 flex items-center justify-between gap-2">
                              <span>"{sq.quote}"</span>
                              {typeof sq.confidence === 'number' && (
                                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 not-italic">
                                  Conf: {sq.confidence}/5
                                </span>
                              )}
                            </blockquote>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Why Surfaced Column */}
                <div className="space-y-1 border-t sm:border-t-0 sm:border-l sm:pl-4 border-slate-200/60 pt-2 sm:pt-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Why MeshQuiz Surfaced This</span>
                  {obs.monitoringGoalTitle && (
                    <p className="text-xs font-semibold text-slate-800">
                      Monitored dimension: <span className="text-indigo-700 font-bold">{obs.monitoringGoalTitle}</span>
                    </p>
                  )}
                  <p className="text-xs text-slate-600 leading-relaxed">{obs.triggerReason}</p>
                  {/* <p className="text-[10px] text-slate-400 pt-1">
                    Evaluated {obs.evaluationCount} time{obs.evaluationCount === 1 ? '' : 's'} during live response stream updates
                  </p> */}
                </div>
              </div>

              {/* Lecturer Response & Notes if recorded */}
              {obs.lecturerInterpretation && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 flex items-start gap-2.5">
                  <Pin className="size-4 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block">Lecturer Note</span>
                    <p className="text-xs text-slate-800 font-medium whitespace-pre-wrap">{obs.lecturerInterpretation}</p>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function CarriesForwardSection({ items }: { items: SessionSummaryPayload['carriesForward'] }) {
  if (!items || items.length === 0) return null

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Carries Forward to Future Sessions</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Persistent memory, active monitoring goals, and lecturer-selected discussion topics carried forward
          </p>
        </div>
        <div className="rounded-xl bg-amber-50 p-2 text-amber-600">
          <Target className="size-5" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {item.type.replace(/_/g, ' ')}
              </span>
              <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                {item.status}
              </span>
            </div>
            <h4 className="text-sm font-bold text-slate-900">{item.title}</h4>
            <p className="text-xs text-slate-600 leading-relaxed">{item.description}</p>
            <div className="pt-2 border-t border-slate-200/60 text-[11px] text-indigo-700 font-medium flex items-center gap-1.5">
              <span>🔄</span>
              <span>{item.nextSessionRole}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function QualitativeRevisionSection({
  analysis,
  note,
}: {
  analysis?: SessionSummaryPayload['qualitativeRevisionAnalysis']
  note?: string | null
}) {
  const [showDetailedPatternList, setShowDetailedPatternList] = useState(false)

  if (!analysis && !note) return null

  return (
    <section className="rounded-2xl border border-emerald-100 bg-emerald-50/30 p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-emerald-200/60 pb-4">
        <div>
          <h3 className="text-lg font-bold text-emerald-950">What Changed After Revision</h3>
          <p className="text-xs text-emerald-700 mt-0.5">Qualitative synthesis of conceptual refinement, new reasoning directions, and persistent student interpretations.</p>
        </div>
        <div className="rounded-xl bg-emerald-100 p-2 text-emerald-700">
          <TrendingUp className="size-5" />
        </div>
      </div>

      <p className="text-xs font-medium text-emerald-900 leading-relaxed bg-white/80 p-4 rounded-xl border border-emerald-100 shadow-sm">
        {note || analysis?.summaryNote}
      </p>

      {analysis && (
        <div>
          <button
            type="button"
            onClick={() => setShowDetailedPatternList((prev) => !prev)}
            className="text-xs font-bold text-emerald-700 hover:text-emerald-900 flex items-center gap-1.5 py-1"
          >
            {showDetailedPatternList ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            {showDetailedPatternList ? 'Hide detailed pattern changes' : 'View detailed reasoning-pattern changes'}
          </button>

          {showDetailedPatternList && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 block">Persistent Interpretations</span>
                <ul className="mt-2 space-y-1 text-xs text-slate-700">
                  {analysis.persistedPatterns.length > 0 ? (
                    analysis.persistedPatterns.map((p, i) => <li key={i}>• {p}</li>)
                  ) : (
                    <li className="text-slate-400 italic">None</li>
                  )}
                </ul>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700 block">Refined Reasoning</span>
                <ul className="mt-2 space-y-1 text-xs text-slate-700">
                  {analysis.changedPatterns.length > 0 ? (
                    analysis.changedPatterns.map((p, i) => <li key={i}>• {p}</li>)
                  ) : (
                    <li className="text-slate-400 italic">None</li>
                  )}
                </ul>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-violet-700 block">New Conceptual Directions</span>
                <ul className="mt-2 space-y-1 text-xs text-slate-700">
                  {analysis.emergedPatterns.length > 0 ? (
                    analysis.emergedPatterns.map((p, i) => <li key={i}>• {p}</li>)
                  ) : (
                    <li className="text-slate-400 italic">None</li>
                  )}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function LongitudinalContextSection({ items }: { items: SessionSummaryPayload['longitudinalContext'] }) {
  if (!items || items.length === 0) return null

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Longitudinal Pattern Context</h3>
          <p className="text-xs text-slate-400 mt-0.5">Reasoning patterns matched against historical sessions</p>
        </div>
        <div className="rounded-xl bg-sky-50 p-2 text-sky-600">
          <RefreshCcw className="size-5" />
        </div>
      </div>

      <div className="space-y-3">
        {items.map((item, idx) => (
          <div key={idx} className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-slate-900">{item.patternLabel}</h4>
              <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[10px] font-semibold text-sky-800">
                Prior Prevalence: {item.priorPrevalence}% → Current: {item.currentPrevalence}%
              </span>
            </div>
            <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">{item.descriptiveNote}</p>
            {item.priorLecturerAction && (
              <p className="mt-2 text-[11px] text-indigo-700 font-medium">
                Prior Lecturer Action: <span className="capitalize">{item.priorLecturerAction.replace(/_/g, ' ')}</span>
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function QuestionDetailPane({
  question,
  isBaseline,
  synthesizedObs,
  annotations,
}: {
  question: SessionQuestionSummary
  isBaseline: boolean
  synthesizedObs?: SynthesizedAgentObservation[]
  annotations?: LecturerAnnotation[]
}) {
  const confidenceDelta = getQuestionConfidenceDelta(question)

  const questionObs = useMemo(() => {
    return (synthesizedObs || []).filter((a) => a.questionId === question.questionId)
  }, [synthesizedObs, question.questionId])

  const questionNotes = useMemo(() => {
    return (annotations || []).filter(
      (a) => a.question_id === question.questionId && a.lecturer_interpretation !== null
    )
  }, [annotations, question.questionId])

  return (
    <div className="space-y-5">
      {/* 1. QUESTION CONTEXT */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Question {question.position}
        </p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-800 font-medium">
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

      {/* 2. WHAT STUDENTS SAID (Initial Response Patterns) */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Response Patterns{!isBaseline && question.revision ? ' (Initial)' : ''}
        </p>
        <ConfidenceLegend />
        <div className="mt-3">
          <ResponsePatternGrid patterns={question.initial.patterns} />
        </div>
      </div>

      {/* 3. WHAT CHANGED AFTER REVISION */}
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

      {/* 4. WHAT AI BROUGHT TO ATTENTION */}
      {questionObs.length > 0 && (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-800">✦ AI Observation for Question {question.position}</p>
          {questionObs.map((obs) => (
            <div key={obs.id} className="text-xs text-slate-700 space-y-0.5">
              <p className="font-bold text-indigo-950">{obs.title}</p>
              <p className="text-xs text-slate-600 leading-relaxed">{obs.findingDescription}</p>
              {obs.monitoringGoalTitle && (
                <p className="text-[11px] text-indigo-700 font-medium">Monitored dimension: {obs.monitoringGoalTitle}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 5. WHAT YOU DECIDED (Teacher Notes for Question) */}
      {questionNotes.length > 0 && (
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 p-4 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">📝 What You Decided for Question {question.position}</p>
          {questionNotes.map((ann) => (
            <div key={ann.annotation_id} className="text-xs text-slate-700">
              {ann.lecturer_interpretation && (
                <p className="text-xs font-medium text-slate-800 leading-relaxed whitespace-pre-wrap">
                  "{ann.lecturer_interpretation}"
                </p>
              )}
            </div>
          ))}
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
  const [error, setError] = useState<string | null>(null)
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<LecturerAnnotation[]>([])

  useEffect(() => {
    async function fetchAnnotations() {
      try {
        const res = await fetch(`/api/teacher/annotation?sessionId=${sessionId}`)
        if (res.ok) {
          const data = await res.json()
          setAnnotations((data.annotations || []) as LecturerAnnotation[])
        }
      } catch (err) {
        console.error('Failed to fetch session annotations', err)
      }
    }
    void fetchAnnotations()
  }, [sessionId])

  const teacherDecisions = useMemo(() => {
    return summary.synthesizedTeacherDecisions ?? []
  }, [summary.synthesizedTeacherDecisions])

  const isBaseline = sessionCondition === 'baseline'
  const patternCards = useMemo(
    () => summary.recurringPatterns.map((pattern, index) => buildPatternCard(pattern, index)),
    [summary.recurringPatterns]
  )

  const selectedQuestion =
    summary.questionSummaries.find((question) => question.questionId === selectedQuestionId) ??
    summary.questionSummaries[0] ??
    null

  const heroSubtitle = isBaseline
    ? 'Review response patterns grounded in student submissions, reference answer alignment, and confidence distribution.'
    : 'Synthesized review of student reasoning distributions, revision movements, reference alignments, and autonomous agent findings.'

  const handleRegenerate = async () => {
    try {
      setIsRegenerating(true)
      setError(null)
      setStatusMessage(null)

      const response = await fetch('/api/session-summary?force=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to regenerate summary.')

      setSummary(payload as SessionSummaryPayload)
      setStatusMessage('Summary updated successfully using synthesized lesson review pipeline.')
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

      const response = await fetch(`/api/teacher/sessions/${sessionId}/generate-student-summaries`, {
        method: 'POST',
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to generate student summaries.')

      setStatusMessage('Student individual summaries generated successfully.')
    } catch (summaryError) {
      console.error(summaryError)
      setError('Could not generate student summaries.')
    } finally {
      setIsGeneratingStudentSummaries(false)
    }
  }

  const observedTrendsCard = (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900">What Students Expressed</h3>
          <p className="text-xs text-slate-400 mt-0.5">Synthesized response patterns grounded in student submissions</p>
        </div>
        <div className="rounded-xl bg-amber-50 p-2 text-amber-600">
          <Sparkles className="size-5" />
        </div>
      </div>

      <div className="space-y-3">
        {patternCards.map((pattern) => (
          <article key={`${pattern.eyebrow}-${pattern.title}`} className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 hover:border-slate-200 transition-colors">
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
          <h4 className="text-sm font-bold text-slate-900">Possible Next-Session Consideration</h4>
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
              <h2 className="text-lg font-bold text-slate-900">Session Evaluation & Lesson Review</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-100 font-medium">
                  Lesson Review
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
              {isRegenerating ? 'Updating Review...' : 'Regenerate Analysis'}
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

        {/* HERO SECTION & CORE METRICS */}
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

        {/* CONFIDENCE SHIFT TILES */}
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

        {/* SHIFT ANALYSIS + OBSERVED TRENDS */}
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
                </div>
              </section>

              {observedTrendsCard}
            </div>

            {sessionTakeawayCard}
            {nextRecommendationCard}
          </>
        ) : (
          <div className="grid gap-6 sm:grid-cols-3">{sidebarCards}</div>
        )}

        {/* SECTION 6: QUESTIONS BREAKDOWN */}
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
                          Question {question.position}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </nav>

              {/* DETAIL PANE */}
              <div className={`min-w-0 p-5 md:max-h-[640px] md:overflow-y-auto md:p-6 ${THIN_SCROLLBAR}`}>
                {selectedQuestion && (
                  <QuestionDetailPane
                    question={selectedQuestion}
                    isBaseline={isBaseline}
                    synthesizedObs={summary.synthesizedObservations}
                    annotations={annotations}
                  />
                )}
              </div>
            </div>
          )}
        </section>

        {/* SECTION 1: WHAT AI BROUGHT TO YOUR ATTENTION (Synthesized AI Findings) */}
        <SynthesizedObservationsSection observations={summary.synthesizedObservations} />

        {/* SECTION 2: WHAT CHANGED AFTER REVISION */}
        {!isBaseline && (
          <QualitativeRevisionSection
            analysis={summary.qualitativeRevisionAnalysis}
            note={summary.qualitativeRevisionNote}
          />
        )}

        {/* SECTION 3: CARRIES FORWARD (Persistent Memory) */}
        <CarriesForwardSection items={summary.carriesForward} />

        {/* SECTION 4: LONGITUDINAL PATTERN CONTEXT */}
        <LongitudinalContextSection items={summary.longitudinalContext} />

        {/* SECTION 5: WHAT YOU DECIDED (Lecturer Judgments & Notes) */}
        {teacherDecisions.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">What You Decided</h3>
                <p className="text-xs text-slate-400 mt-0.5">Patterns you chose to review, discuss, or carry forward.</p>
              </div>
              <div className="rounded-xl bg-blue-50 p-2 text-blue-600">
                <Pin className="size-5" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {teacherDecisions.map((dec) => (
                <div key={dec.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-bold text-slate-900">
                      {dec.patternLabel}
                    </h4>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {dec.actionTypes.includes('selected_for_discussion') && (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">
                          Discussion
                        </span>
                      )}
                      {dec.actionTypes.includes('pinned') && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                          Pinned
                        </span>
                      )}
                      {dec.actionTypes.includes('monitored') && (
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-800">
                          Monitored
                        </span>
                      )}
                      {dec.actionTypes.includes('inspected') && dec.actionTypes.length === 1 && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          Reviewed
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    {dec.synthesizedActionText}
                  </p>

                  {dec.lecturerInterpretation && (
                    <div className="rounded-lg border border-amber-200/80 bg-amber-50/70 p-2.5 mt-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block">
                        📝 Teacher Note
                      </span>
                      <p className="mt-1 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                        {dec.lecturerInterpretation}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* SECTION 7: TECHNICAL ACTIVITY LOG (Collapsed Audit Trail) */}
        <details className="rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm group">
          <summary className="cursor-pointer font-bold text-slate-700 flex items-center justify-between text-sm select-none">
            <span className="flex items-center gap-2">
              <Terminal className="size-4 text-slate-500" />
              Technical Activity Log ({summary.agentActivity.length} Event Log Records)
            </span>
            <span className="text-xs text-indigo-600 font-medium group-open:hidden">Expand Audit Trail</span>
            <span className="text-xs text-slate-400 font-medium hidden group-open:inline">Collapse Audit Trail</span>
          </summary>
          <p className="mt-2 text-xs text-slate-500 border-b border-slate-200 pb-3">
            Full raw database event log of agent evaluation triggers, streaming threshold decisions, and action records for research auditability and system debugging.
          </p>
          <div className="mt-4 space-y-2 max-h-96 overflow-y-auto pr-1 text-xs">
            {summary.agentActivity.length === 0 ? (
              <p className="text-slate-400 italic">No technical log records found.</p>
            ) : (
              summary.agentActivity.map((act) => (
                <div key={act.actionId} className="rounded-lg border border-slate-200 bg-white p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400 font-mono">
                    <span>ID: {act.actionId.slice(0, 8)}...</span>
                    <span>{new Date(act.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="font-mono text-slate-800 font-semibold">{act.decisionRuleExecuted}</p>
                  <p className="text-slate-600">{act.actionTaken}</p>
                  <div className="flex gap-2 text-[10px] text-slate-500 font-mono pt-1">
                    <span>Role: {act.agentRole}</span>
                    <span>·</span>
                    <span>Trigger: {act.triggerType}</span>
                    <span>·</span>
                    <span>Checkpoint: {act.humanCheckpointStatus}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </details>

      </div>
    </main>
  )
}
