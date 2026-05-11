'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { QuestionAnalysis, SessionRoundAnalysis } from '@/lib/ai/experiment-analysis'

export type AnalysisDashboardAnalysis = SessionRoundAnalysis & {
  [key: string]: unknown
}

type Severity = 'high' | 'medium' | 'default'

type StackedQuestionDatum = {
  questionId: string
  position: number
  label: string
  prompt: string
  submissionCount: number
  correct: number
  incorrect: number
  percentCorrect: number | null
}

type BubbleDatum = {
  questionId: string
  questionPosition: number
  questionLabel: string
  prompt: string
  label: string
  count: number
  severity: Severity
}

type ConfidencePoint = {
  confidence: number
  overallAccuracy: number | null
}

// ─── palette ────────────────────────────────────────────────────────────────
// Read once synchronously so there's no flicker between SSR paint and effect.
// Falls back to the hardcoded values if window is unavailable (SSR).

const BASE_PALETTE = {
  correct:   '#639922',
  incorrect: '#E24B4A',
  bubble:    '#378ADD',
  confidenceLine: '#378ADD',
  refLine:   '#B4B2A9',
  grid:      '#E8E6DF',
  axis:      '#888780',
  selection: '#BA7517',
}

function resolvePalette() {
  if (typeof window === 'undefined') return BASE_PALETTE
  const style = getComputedStyle(document.documentElement)
  const get = (v: string) => {
    const raw = style.getPropertyValue(v).trim()
    if (!raw) return null
    return /^(hsl|rgb|#)/i.test(raw) ? raw : `hsl(${raw})`
  }
  return {
    ...BASE_PALETTE,
    correct:   get('--color-text-success')  ?? BASE_PALETTE.correct,
    incorrect: get('--destructive')          ?? BASE_PALETTE.incorrect,
    bubble:    get('--primary')              ?? BASE_PALETTE.bubble,
    confidenceLine: get('--primary')         ?? BASE_PALETTE.confidenceLine,
    grid:      get('--color-border-tertiary') ?? BASE_PALETTE.grid,
    axis:      get('--color-text-tertiary')  ?? BASE_PALETTE.axis,
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function toNumber(value: unknown, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A'
  return `${Math.round(value)}%`
}

function getQuestionLabel(position: number) {
  return `Q${position}`
}

function getCorrectCount(question: QuestionAnalysis) {
  const correctNode = question.graph?.nodes?.find(n => n.kind === 'correct')
  if (correctNode) return Math.max(0, toNumber(correctNode.count))
  const sub = Math.max(0, toNumber(question.submission_count))
  const pct = question.percent_correct
  if (pct === null || pct === undefined) return 0
  return Math.max(0, Math.round(sub * (Number(pct) / 100)))
}

function getSeverity(label: string, prompt?: string): Severity {
  const text = `${label} ${prompt ?? ''}`.toLowerCase()
  if (
    (/\bstack\b/.test(text) && /\bfifo\b/.test(text)) ||
    (/\bqueue\b/.test(text) && /\blifo\b/.test(text)) ||
    /opposite|reversal|reversed|backwards|confused with/.test(text)
  ) return 'high'
  if (/partial|incomplete|almost|mostly|unclear|mixed up|close but|missing|not fully/.test(text))
    return 'medium'
  return 'default'
}

// ─── data builders ────────────────────────────────────────────────────────────

function buildStackedBarData(analysis: AnalysisDashboardAnalysis | null): StackedQuestionDatum[] {
  return (analysis?.per_question ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(q => {
      const correct = getCorrectCount(q)
      const sub = Math.max(0, toNumber(q.submission_count))
      return {
        questionId: q.question_id,
        position: q.position,
        label: getQuestionLabel(q.position),
        prompt: q.prompt ?? `Question ${q.position}`,
        submissionCount: sub,
        correct,
        incorrect: Math.max(0, sub - correct),
        percentCorrect: q.percent_correct,
      }
    })
}

function buildBubbleData(analysis: AnalysisDashboardAnalysis | null): BubbleDatum[] {
  const points: BubbleDatum[] = []
  for (const q of analysis?.per_question ?? []) {
    for (const node of (q.graph?.nodes ?? []).filter(n => n.kind === 'cluster')) {
      points.push({
        questionId: q.question_id,
        questionPosition: q.position,
        questionLabel: getQuestionLabel(q.position),
        prompt: q.prompt ?? `Question ${q.position}`,
        label: node.label,
        count: Math.max(0, toNumber(node.count)),
        severity: getSeverity(node.label, q.prompt),
      })
    }
  }
  return points
}

function buildConfidenceData(analysis: AnalysisDashboardAnalysis | null): ConfidencePoint[] {
  const questions = analysis?.per_question ?? []

  return [1, 2, 3, 4, 5].map(confidence => {
    const key = String(confidence) as keyof QuestionAnalysis['confidence_breakdown']
    let correct = 0, total = 0
    for (const q of questions) {
      const b = q.confidence_breakdown?.[key]
      if (!b) continue
      correct += toNumber(b.correct)
      total += toNumber(b.total)
    }
    return { confidence, overallAccuracy: total > 0 ? (correct / total) * 100 : null }
  })
}

// ─── sub-components ───────────────────────────────────────────────────────────

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-secondary/20 p-3">
      <p className="text-sm text-foreground/55 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-sm text-foreground/50">{sub}</p>}
    </div>
  )
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-foreground/55">
      <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  )
}

function StackTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as StackedQuestionDatum
  return (
    <div className="rounded-lg border border-border/60 bg-background/95 p-2.5 text-sm shadow-sm backdrop-blur">
      <p className="font-medium text-foreground">{row.label} — {row.prompt}</p>
      <div className="mt-1.5 space-y-0.5 text-foreground/70">
        <p>Correct: {row.correct} · Incorrect: {row.incorrect}</p>
        <p>Accuracy: {formatPercent(row.percentCorrect)}</p>
      </div>
    </div>
  )
}

function BubbleTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as BubbleDatum
  const badgeVariant = row.severity === 'high' ? 'destructive' : row.severity === 'medium' ? 'secondary' : 'outline'
  return (
    <div className="max-w-[220px] rounded-lg border border-border/60 bg-background/95 p-2.5 text-sm shadow-sm backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-foreground">{row.questionLabel}</p>
        <Badge variant={badgeVariant} className="text-[10px] py-0">
          {row.severity === 'high' ? 'high' : row.severity === 'medium' ? 'medium' : 'standard'}
        </Badge>
      </div>
      <p className="mt-1 text-foreground/70 leading-snug">{row.label}</p>
      <p className="mt-1 text-foreground/50">{row.count} students</p>
    </div>
  )
}

function ConfidenceTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload as ConfidencePoint
  return (
    <div className="rounded-lg border border-border/60 bg-background/95 p-2.5 text-sm shadow-sm backdrop-blur">
      <p className="font-medium text-foreground">Confidence {row.confidence}</p>
      <p className="mt-1 text-foreground/70">
        Overall accuracy: {row.overallAccuracy === null ? 'N/A' : `${row.overallAccuracy.toFixed(0)}%`}
      </p>
    </div>
  )
}

function EmptySlate({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border/50 text-sm text-foreground/40">
      {label}
    </div>
  )
}

// ─── responsive width hook ───────────────────────────────────────────────────
// Uses a default width of 560 so the first paint isn't invisible.

function useWidth<T extends HTMLElement>(defaultWidth = 560) {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(defaultWidth)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.floor(el.getBoundingClientRect().width) || defaultWidth)
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [defaultWidth])

  return [ref, width] as const
}

// ─── main component ───────────────────────────────────────────────────────────

export interface AnalysisDashboardProps {
  analysis: AnalysisDashboardAnalysis | null
}

export function AnalysisDashboard({ analysis }: AnalysisDashboardProps) {
  // Resolve palette synchronously to avoid a flicker on first paint.
  const palette = useMemo(() => resolvePalette(), [])

  const stackedData    = useMemo(() => buildStackedBarData(analysis), [analysis])
  const bubbleData     = useMemo(() => buildBubbleData(analysis), [analysis])
  const confidenceData = useMemo(() => buildConfidenceData(analysis), [analysis])

  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)
  const [selectedBubbleKey,  setSelectedBubbleKey]  = useState<string | null>(null)
  const [selectedConfidence, setSelectedConfidence] = useState<number | null>(null)

  const [stackRef,      stackWidth]      = useWidth<HTMLDivElement>()
  const [bubbleRef,     bubbleWidth]     = useWidth<HTMLDivElement>()
  const [confidenceRef, confidenceWidth] = useWidth<HTMLDivElement>()

  // Default selections
  useEffect(() => {
    if (!selectedQuestionId && stackedData[0]) setSelectedQuestionId(stackedData[0].questionId)
  }, [stackedData])

  useEffect(() => {
    const first = bubbleData[0]
    if (!selectedBubbleKey && first) setSelectedBubbleKey(`${first.questionId}:${first.label}`)
  }, [bubbleData])

  useEffect(() => {
    if (selectedConfidence === null) {
      const first = confidenceData.find(p => p.overallAccuracy !== null)
      if (first) setSelectedConfidence(first.confidence)
    }
  }, [confidenceData])

  const totals = analysis?.totals
  const selectedQuestion = useMemo(
    () => stackedData.find(r => r.questionId === selectedQuestionId) ?? null,
    [stackedData, selectedQuestionId],
  )
  const selectedBubble = useMemo(
    () => bubbleData.find(r => `${r.questionId}:${r.label}` === selectedBubbleKey) ?? null,
    [bubbleData, selectedBubbleKey],
  )
  const selectedPoint = useMemo(
    () => confidenceData.find(p => p.confidence === selectedConfidence) ?? null,
    [confidenceData, selectedConfidence],
  )

  const CHART_H = 220

  return (
    <Card className="p-5 space-y-5">
      {/* ── metrics row ── */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard
          label="Submissions"
          value={String(totals?.total_submissions ?? 0)}
          sub="across all questions"
        />
        <MetricCard
          label="Overall correct"
          value={formatPercent(totals?.percent_correct)}
          sub="labeled accuracy"
        />
        <MetricCard
          label="Avg confidence"
          value={totals?.avg_confidence != null ? Number(totals.avg_confidence).toFixed(1) : 'N/A'}
          sub="scale 1–5"
        />
      </div>

      {/* ── top row: stacked bar + bubble ── */}
      <div className="grid gap-4 md:grid-cols-2">

        {/* Correct vs incorrect */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Correct vs incorrect</p>
            <div className="flex gap-3">
              <Swatch color={palette.correct}   label="Correct" />
              <Swatch color={palette.incorrect} label="Incorrect" />
            </div>
          </div>
          <div ref={stackRef} style={{ height: CHART_H }}>
            {stackedData.length > 0 ? (
              <BarChart
                width={stackWidth}
                height={CHART_H}
                data={stackedData}
                margin={{ top: 4, right: 4, left: -16, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={palette.grid} vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: palette.axis }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: palette.axis }} allowDecimals={false} />
                <Tooltip content={<StackTooltip />} cursor={{ fill: 'transparent' }} />
                <Bar dataKey="correct" stackId="q" radius={[4, 4, 0, 0]} isAnimationActive={false}
                  onClick={({ payload }: any) => setSelectedQuestionId(payload?.questionId ?? null)}>
                  {stackedData.map(r => (
                    <Cell
                      key={r.questionId}
                      fill={palette.correct}
                      fillOpacity={r.questionId === selectedQuestionId ? 1 : 0.65}
                      style={{ cursor: 'pointer' }}
                    />
                  ))}
                </Bar>
                <Bar dataKey="incorrect" stackId="q" radius={[4, 4, 0, 0]} isAnimationActive={false}
                  onClick={({ payload }: any) => setSelectedQuestionId(payload?.questionId ?? null)}>
                  {stackedData.map(r => (
                    <Cell
                      key={r.questionId}
                      fill={palette.incorrect}
                      fillOpacity={r.questionId === selectedQuestionId ? 0.85 : 0.55}
                      style={{ cursor: 'pointer' }}
                    />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <EmptySlate label="No question data" />
            )}
          </div>
          {/* detail strip */}
          {selectedQuestion && (
            <div className="rounded-md border border-border/50 bg-secondary/10 px-3 py-2 text-sm">
              <span className="font-medium text-foreground">{selectedQuestion.label}</span>
              <span className="mx-1.5 text-foreground/30">·</span>
              <span className="text-foreground/70">{selectedQuestion.prompt}</span>
              <div className="mt-1 flex gap-4 text-foreground/55">
                <span>Correct: <strong className="text-foreground">{selectedQuestion.correct}</strong></span>
                <span>Incorrect: <strong className="text-foreground">{selectedQuestion.incorrect}</strong></span>
                <span>Accuracy: <strong className="text-foreground">{formatPercent(selectedQuestion.percentCorrect)}</strong></span>
              </div>
            </div>
          )}
        </div>

        {/* Misconception bubbles */}
        <div className="space-y-2">
        
          <div className="space-y-2">
            <p className="text-sm font-medium">Top misconceptions</p>
            {analysis?.per_question?.map(q => (
              <div key={q.question_id} className="rounded-lg border border-border/60 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">Q{q.position}</p>
                  <Badge variant="outline" className="text-xs">
                    {q.top_misconceptions?.length ?? 0} item(s)
                  </Badge>
                </div>
                <div className="mt-2 space-y-2">
                  {q.top_misconceptions?.map((m: any, i: number) => (
                    <div key={i} className="rounded-md bg-secondary/15 p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-foreground leading-snug">{m.label}</p>
                        <span className="text-sm text-foreground/55">({m.count})</span>
                      </div>
                      {(m.description || m.interpretation) && (
                        <p className="mt-1 text-sm leading-snug text-foreground/70">
                          {m.description || m.interpretation}
                        </p>
                      )}
                      {(m.teacher_move || m.hint) && (
                        <p className="mt-1 text-sm leading-snug text-foreground/60">
                          {m.teacher_move || m.hint}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {selectedBubble && (
            <div className="rounded-md border border-border/50 bg-secondary/10 px-3 py-2 text-sm">
              <span className="font-medium text-foreground">{selectedBubble.questionLabel}</span>
              <span className="mx-1.5 text-foreground/30">·</span>
              <span className="text-foreground/70">{selectedBubble.label}</span>
              <div className="mt-1 flex gap-4 text-foreground/55">
                <span>Students: <strong className="text-foreground">{selectedBubble.count}</strong></span>
                <span>Severity: <strong className="text-foreground capitalize">{selectedBubble.severity}</strong></span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── confidence line ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">Confidence vs accuracy</p>
          <div className="flex gap-3">
            <Swatch color={palette.confidenceLine} label="All questions" />
          </div>
        </div>
        <div ref={confidenceRef} style={{ height: CHART_H }}>
          {confidenceData.some(p => p.overallAccuracy !== null) ? (
            <LineChart
              data={confidenceData}
              width={confidenceWidth}
              height={CHART_H}
              margin={{ top: 4, right: 4, left: -16, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={palette.grid} vertical={false} />
              <XAxis dataKey="confidence" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: palette.axis }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: palette.axis }}
                domain={[0, 100]} tickFormatter={v => `${v}%`} />
              <ReferenceLine y={50} stroke={palette.refLine} strokeDasharray="4 4" />
              <Tooltip content={<ConfidenceTooltip />} />
              <Line
                type="monotone" dataKey="overallAccuracy" name="All questions"
                stroke={palette.confidenceLine} strokeWidth={2.5} connectNulls
                dot={{ r: 4, fill: palette.confidenceLine, strokeWidth: 0 }}
                activeDot={{ r: 6, fill: palette.confidenceLine, stroke: 'var(--background)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          ) : (
            <EmptySlate label="No confidence data" />
          )}
        </div>
        {selectedPoint && (
          <div className="rounded-md border border-border/50 bg-secondary/10 px-3 py-2 text-sm">
            <span className="font-medium text-foreground">Confidence level {selectedPoint.confidence}</span>
            <div className="mt-1 flex gap-4 text-foreground/55">
              <span>All questions: <strong className="text-foreground">
                {selectedPoint.overallAccuracy === null ? 'N/A' : `${selectedPoint.overallAccuracy.toFixed(0)}%`}
              </strong></span>
            </div>
          </div>
        )}
      </div>

      {/* ── raw JSON ── */}
      <details className="rounded-lg border border-border/50 bg-secondary/10 p-3">
        <summary className="cursor-pointer text-sm font-medium text-foreground/60 hover:text-foreground">
          Show raw analysis JSON
        </summary>
        <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-secondary/20 p-3 text-[11px] text-foreground/70 whitespace-pre-wrap">
          {JSON.stringify(analysis, null, 2)}
        </pre>
      </details>
    </Card>
  )
}
