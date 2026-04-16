'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Legend,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { QuestionAnalysis, SessionRoundAnalysis } from '@/lib/ai/experiment-analysis'

export type AnalysisDashboardAnalysis = SessionRoundAnalysis & {
  [key: string]: unknown
}

type Severity = 'high' | 'medium' | 'default'

type ChartPalette = {
  primary: string
  destructive: string
  destructiveSoft: string
  accent: string
  border: string
  muted: string
  background: string
  selection: string
}

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
  q1Accuracy: number | null
  q23Accuracy: number | null
}

// Flip this to false to force the hardcoded fallback palette while debugging theme/color resolution.
const USE_THEME_CHART_COLORS = true

const FALLBACK_CHART_PALETTE: ChartPalette = {
  primary: 'hsl(221 83% 53%)',
  destructive: 'hsl(0 84% 60%)',
  destructiveSoft: 'hsl(0 84% 60% / 0.7)',
  accent: 'hsl(262 83% 58%)',
  border: 'hsl(215 20% 80%)',
  muted: 'hsl(215 20% 65%)',
  background: 'hsl(0 0% 100%)',
  selection: 'hsl(45 93% 47%)',
}

export interface AnalysisDashboardProps {
  analysis: AnalysisDashboardAnalysis | null
}

type Size = { width: number; height: number }

function toNumber(value: unknown, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A'
  return `${Math.round(value)}%`
}

function resolveCssColorVariable(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!raw) return fallback
  if (/^(hsl|hsla|rgb|rgba|#)/i.test(raw)) return raw
  return `hsl(${raw})`
}

function resolveChartPalette(): ChartPalette {
  if (!USE_THEME_CHART_COLORS) return FALLBACK_CHART_PALETTE

  return {
    primary: resolveCssColorVariable('--primary', FALLBACK_CHART_PALETTE.primary),
    destructive: resolveCssColorVariable('--destructive', FALLBACK_CHART_PALETTE.destructive),
    destructiveSoft: resolveCssColorVariable('--destructive', FALLBACK_CHART_PALETTE.destructiveSoft),
    accent: resolveCssColorVariable('--accent', FALLBACK_CHART_PALETTE.accent),
    border: resolveCssColorVariable('--border', FALLBACK_CHART_PALETTE.border),
    muted: resolveCssColorVariable('--muted-foreground', FALLBACK_CHART_PALETTE.muted),
    background: resolveCssColorVariable('--background', FALLBACK_CHART_PALETTE.background),
    selection: FALLBACK_CHART_PALETTE.selection,
  }
}

function useElementSize<T extends HTMLElement>(fallbackHeight: number) {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: fallbackHeight })

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const update = () => {
      const nextWidth = Math.floor(element.getBoundingClientRect().width)
      setSize({
        width: nextWidth,
        height: fallbackHeight,
      })
    }

    update()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }

    const observer = new ResizeObserver(() => update())
    observer.observe(element)
    return () => observer.disconnect()
  }, [fallbackHeight])

  return [ref, size] as const
}

function getQuestionLabel(position: number) {
  return `Q${position}`
}

function getCorrectCount(question: QuestionAnalysis) {
  const correctNode = question.graph?.nodes?.find(node => node.kind === 'correct')
  if (correctNode) return Math.max(0, toNumber(correctNode.count))

  const submissionCount = Math.max(0, toNumber(question.submission_count))
  const percentCorrect = question.percent_correct
  if (percentCorrect === null || percentCorrect === undefined) return 0
  return Math.max(0, Math.round(submissionCount * (Number(percentCorrect) / 100)))
}

function getSeverity(label: string, prompt?: string): Severity {
  const text = `${label} ${prompt || ''}`.toLowerCase()

  if (
    (
      /\bstack\b/.test(text) && /\bfifo\b/.test(text)
    ) ||
    (
      /\bqueue\b/.test(text) && /\blifo\b/.test(text)
    ) ||
    /opposite|reversal|reversed|backwards|confused with/.test(text)
  ) {
    return 'high'
  }

  if (
    /partial|partly|incomplete|almost|mostly|somewhat|unclear|mixed up|close but|missing|not fully|half right/.test(text)
  ) {
    return 'medium'
  }

  return 'default'
}

function getSeverityTone(severity: Severity, palette: ChartPalette = FALLBACK_CHART_PALETTE) {
  switch (severity) {
    case 'high':
      return {
        badge: 'destructive' as const,
        ring: 'ring-2 ring-destructive/50',
        stroke: palette.destructive,
      }
    case 'medium':
      return {
        badge: 'secondary' as const,
        ring: 'ring-2 ring-amber-500/50',
        stroke: 'hsl(38 92% 50%)',
      }
    default:
      return {
        badge: 'outline' as const,
        ring: 'ring-1 ring-border/60',
        stroke: palette.border,
      }
  }
}

function buildStackedBarData(analysis: AnalysisDashboardAnalysis | null): StackedQuestionDatum[] {
  const questions = analysis?.per_question || []
  return [...questions]
    .sort((a, b) => a.position - b.position)
    .map((question) => {
      const correct = getCorrectCount(question)
      const submissionCount = Math.max(0, toNumber(question.submission_count))
      const incorrect = Math.max(0, submissionCount - correct)

      return {
        questionId: question.question_id,
        position: question.position,
        label: getQuestionLabel(question.position),
        prompt: question.prompt || `Question ${question.position}`,
        submissionCount,
        correct,
        incorrect,
        percentCorrect: question.percent_correct,
      }
    })
}

function buildBubbleData(analysis: AnalysisDashboardAnalysis | null): BubbleDatum[] {
  const questions = analysis?.per_question || []
  const points: BubbleDatum[] = []

  for (const question of questions) {
    const clusterNodes = (question.graph?.nodes || []).filter(node => node.kind === 'cluster')
    clusterNodes.forEach((node) => {
      points.push({
        questionId: question.question_id,
        questionPosition: question.position,
        questionLabel: getQuestionLabel(question.position),
        prompt: question.prompt || `Question ${question.position}`,
        label: node.label,
        count: Math.max(0, toNumber(node.count)),
        severity: getSeverity(node.label, question.prompt),
      })
    })
  }

  return points
}

function buildConfidenceData(analysis: AnalysisDashboardAnalysis | null): ConfidencePoint[] {
  const questions = analysis?.per_question || []
  const q1 = questions.find(q => q.position === 1)
  const q23 = questions.filter(q => q.position === 2 || q.position === 3)

  return [1, 2, 3, 4, 5].map((confidence) => {
    const confidenceKey = String(confidence) as keyof QuestionAnalysis['confidence_breakdown']
    const q1Bucket = q1?.confidence_breakdown?.[confidenceKey]
    const q1Accuracy = q1Bucket && q1Bucket.total > 0
      ? (toNumber(q1Bucket.correct) / q1Bucket.total) * 100
      : null

    let q23Correct = 0
    let q23Total = 0
    q23.forEach((question) => {
      const bucket = question.confidence_breakdown?.[confidenceKey]
      if (!bucket) return
      q23Correct += toNumber(bucket.correct)
      q23Total += toNumber(bucket.total)
    })

    return {
      confidence,
      q1Accuracy,
      q23Accuracy: q23Total > 0 ? (q23Correct / q23Total) * 100 : null,
    }
  })
}

function MetricCard({
  label,
  value,
  sublabel,
}: {
  label: string
  value: string
  sublabel?: string
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/20 p-4">
      <p className="text-xs uppercase tracking-wide text-foreground/60">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      {sublabel && <p className="mt-1 text-xs text-foreground/60">{sublabel}</p>}
    </div>
  )
}

function StackTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null
  const row = payload[0]?.payload as StackedQuestionDatum | undefined
  if (!row) return null

  return (
    <div className="rounded-xl border border-border/60 bg-background/95 p-3 shadow-lg backdrop-blur">
      <p className="text-sm font-semibold text-foreground">{row.label}</p>
      <p className="mt-1 text-xs text-foreground/60">{row.prompt}</p>
      <div className="mt-3 space-y-1 text-xs">
        <p className="text-foreground/80">Correct: {row.correct}</p>
        <p className="text-foreground/80">Incorrect: {row.incorrect}</p>
        <p className="text-foreground/80">Total: {row.submissionCount}</p>
        <p className="text-foreground/80">Accuracy: {formatPercent(row.percentCorrect)}</p>
      </div>
    </div>
  )
}

function BubbleTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null
  const row = payload[0]?.payload as BubbleDatum | undefined
  if (!row) return null

  const tone = getSeverityTone(row.severity)

  return (
    <div className="max-w-xs rounded-xl border border-border/60 bg-background/95 p-3 shadow-lg backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{row.questionLabel}</p>
          <p className="mt-1 text-xs text-foreground/60">{row.prompt}</p>
        </div>
        <Badge variant={tone.badge} className="shrink-0">
          {row.severity === 'high' ? 'High severity' : row.severity === 'medium' ? 'Medium severity' : 'Standard'}
        </Badge>
      </div>
      <div className={cn('mt-3 rounded-lg border border-border/50 px-3 py-2', tone.ring)}>
        <p className="text-sm font-medium text-foreground">{row.label}</p>
        <p className="mt-1 text-xs text-foreground/60">Students in cluster: {row.count}</p>
      </div>
    </div>
  )
}

function ConfidenceTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null
  const row = payload[0]?.payload as ConfidencePoint | undefined
  if (!row) return null

  return (
    <div className="rounded-xl border border-border/60 bg-background/95 p-3 shadow-lg backdrop-blur">
      <p className="text-sm font-semibold text-foreground">Confidence {row.confidence}</p>
      <div className="mt-3 space-y-1 text-xs">
        <p className="text-foreground/80">Q1 accuracy: {row.q1Accuracy === null ? 'N/A' : `${row.q1Accuracy.toFixed(1)}%`}</p>
        <p className="text-foreground/80">Q2 + Q3 accuracy: {row.q23Accuracy === null ? 'N/A' : `${row.q23Accuracy.toFixed(1)}%`}</p>
      </div>
    </div>
  )
}

function resolveBubbleRadius(count: number) {
  return Math.max(7, Math.min(26, 6 + count * 1.8))
}

function BubbleShape({
  cx,
  cy,
  payload,
  selectedKey,
  palette,
  onSelect,
}: {
  cx?: number
  cy?: number
  payload?: BubbleDatum
  selectedKey?: string | null
  palette: ChartPalette
  onSelect: (row: BubbleDatum) => void
}) {
  if (cx === undefined || cy === undefined || !payload) return null
  const tone = getSeverityTone(payload.severity, palette)
  const key = `${payload.questionId}:${payload.label}`
  const isSelected = selectedKey === key
  const radius = resolveBubbleRadius(payload.count)
  return (
    <circle
      cx={cx}
      cy={cy}
      r={isSelected ? radius + 3 : radius}
      fill={palette.primary}
      fillOpacity={payload.severity === 'high' ? 0.82 : payload.severity === 'medium' ? 0.62 : 0.46}
      stroke={isSelected ? palette.selection : tone.stroke}
      strokeWidth={isSelected ? 3 : payload.severity === 'high' ? 3 : payload.severity === 'medium' ? 2 : 1.5}
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect(payload)}
      onMouseDown={(event) => event.stopPropagation()}
    />
  )
}

function ConfidenceDot({
  cx,
  cy,
  payload,
  stroke,
  background,
  selectedConfidence,
  onSelect,
}: {
  cx?: number
  cy?: number
  payload?: ConfidencePoint
  stroke: string
  background: string
  selectedConfidence?: number | null
  onSelect: (confidence: number) => void
}) {
  if (cx === undefined || cy === undefined || !payload) return null
  const isSelected = selectedConfidence === payload.confidence
  return (
    <circle
      cx={cx}
      cy={cy}
      r={isSelected ? 7 : 4.5}
      fill={stroke}
      fillOpacity={isSelected ? 1 : 0.88}
      stroke={isSelected ? background : stroke}
      strokeWidth={isSelected ? 2 : 1}
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect(payload.confidence)}
      onMouseDown={(event) => event.stopPropagation()}
    />
  )
}

function renderConfidenceDot(
  dotProps: Record<string, unknown>,
  options: {
    stroke: string
    background: string
    selectedConfidence: number | null
    onSelect: (confidence: number) => void
  }
) {
  const { key: _key, index, ...rest } = dotProps as { key?: string; index?: number } & Record<string, unknown>
  const stableKey = typeof index === 'number' ? `confidence-dot-${index}` : `confidence-dot-${String(rest.cx ?? 'x')}-${String(rest.cy ?? 'y')}`
  return <ConfidenceDot key={stableKey} {...(rest as any)} {...options} />
}

export function AnalysisDashboard({ analysis }: AnalysisDashboardProps) {
  const stackedData = useMemo(() => buildStackedBarData(analysis), [analysis])
  const bubbleData = useMemo(() => buildBubbleData(analysis), [analysis])
  const confidenceData = useMemo(() => buildConfidenceData(analysis), [analysis])
  const [chartPalette, setChartPalette] = useState<ChartPalette>(FALLBACK_CHART_PALETTE)
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)
  const [selectedBubbleKey, setSelectedBubbleKey] = useState<string | null>(null)
  const [selectedConfidence, setSelectedConfidence] = useState<number | null>(null)
  const [stackRef, stackSize] = useElementSize<HTMLDivElement>(320)
  const [bubbleRef, bubbleSize] = useElementSize<HTMLDivElement>(340)
  const [confidenceRef, confidenceSize] = useElementSize<HTMLDivElement>(320)

  useEffect(() => {
    const resolved = resolveChartPalette()
    setChartPalette(resolved)
    console.log('[AnalysisDashboard] chart colors resolved from', USE_THEME_CHART_COLORS ? 'theme CSS variables' : 'fallback palette', resolved)
  }, [])

  useEffect(() => {
    if (!selectedQuestionId && stackedData[0]) {
      setSelectedQuestionId(stackedData[0].questionId)
    } else if (selectedQuestionId && !stackedData.some(row => row.questionId === selectedQuestionId)) {
      setSelectedQuestionId(stackedData[0]?.questionId ?? null)
    }
  }, [stackedData, selectedQuestionId])

  useEffect(() => {
    if (!selectedBubbleKey && bubbleData[0]) {
      setSelectedBubbleKey(`${bubbleData[0].questionId}:${bubbleData[0].label}`)
    } else if (selectedBubbleKey && !bubbleData.some(row => `${row.questionId}:${row.label}` === selectedBubbleKey)) {
      setSelectedBubbleKey(bubbleData[0] ? `${bubbleData[0].questionId}:${bubbleData[0].label}` : null)
    }
  }, [bubbleData, selectedBubbleKey])

  useEffect(() => {
    if (selectedConfidence === null && confidenceData.some(point => point.q1Accuracy !== null || point.q23Accuracy !== null)) {
      setSelectedConfidence(confidenceData.find(point => point.q1Accuracy !== null || point.q23Accuracy !== null)?.confidence ?? null)
    } else if (selectedConfidence !== null && !confidenceData.some(point => point.confidence === selectedConfidence)) {
      setSelectedConfidence(confidenceData.find(point => point.q1Accuracy !== null || point.q23Accuracy !== null)?.confidence ?? null)
    }
  }, [confidenceData, selectedConfidence])

  const totals = analysis?.totals
  const totalSubmissions = totals?.total_submissions ?? 0
  const percentCorrect = formatPercent(totals?.percent_correct)
  const avgConfidence = totals?.avg_confidence === null || totals?.avg_confidence === undefined
    ? 'N/A'
    : Number(totals.avg_confidence).toFixed(2)
  const selectedQuestion = useMemo(
    () => stackedData.find(row => row.questionId === selectedQuestionId) ?? null,
    [stackedData, selectedQuestionId]
  )
  const selectedBubble = useMemo(
    () => bubbleData.find(row => `${row.questionId}:${row.label}` === selectedBubbleKey) ?? null,
    [bubbleData, selectedBubbleKey]
  )
  const selectedConfidencePoint = useMemo(
    () => confidenceData.find(point => point.confidence === selectedConfidence) ?? null,
    [confidenceData, selectedConfidence]
  )

  return (
    <Card className="p-6">
      <div className="mb-6 flex flex-col gap-2">
        <h3 className="text-lg font-semibold text-foreground">Graph-Ready Data</h3>
        <p className="text-sm text-foreground/70">
          Interactive analysis for correctness, misconception clusters, and confidence patterns.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Total submissions" value={String(totalSubmissions)} sublabel="Across all questions" />
        <MetricCard label="% correct" value={percentCorrect} sublabel="Overall labeled accuracy" />
        <MetricCard label="Avg confidence" value={avgConfidence} sublabel="Scale: 1 to 5" />
      </div>

      <div className="mt-6 space-y-6">
        <Card className="p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-foreground">Correct vs Incorrect by Question</h4>
              <p className="text-sm text-foreground/60">Stacked totals make drops to 0% immediately visible.</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-foreground/60">
              <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                Correct
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-destructive/80" />
                Incorrect
              </span>
            </div>
          </div>
          <div ref={stackRef} className="h-[320px] w-full">
            {stackedData.length > 0 && stackSize.width > 0 ? (
              <BarChart width={stackSize.width} height={stackSize.height} data={stackedData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartPalette.border} vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} stroke={chartPalette.muted} />
                <YAxis tickLine={false} axisLine={false} stroke={chartPalette.muted} allowDecimals={false} />
                <Tooltip content={<StackTooltip />} />
                <Legend />
                <Bar
                  dataKey="correct"
                  stackId="questions"
                  radius={[6, 6, 0, 0]}
                  style={{ cursor: 'pointer' }}
                  onClick={(entry: any) => {
                    const row = entry?.payload as StackedQuestionDatum | undefined
                    if (row?.questionId) setSelectedQuestionId(row.questionId)
                  }}
                >
                  {stackedData.map((row) => {
                    const isSelected = row.questionId === selectedQuestionId
                    return (
                      <Cell
                        key={`correct-${row.questionId}`}
                        fill={chartPalette.primary}
                        fillOpacity={isSelected ? 0.95 : 0.72}
                        stroke={isSelected ? chartPalette.selection : 'transparent'}
                        strokeWidth={isSelected ? 2 : 0}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedQuestionId(row.questionId)}
                      />
                    )
                  })}
                </Bar>
                <Bar
                  dataKey="incorrect"
                  stackId="questions"
                  radius={[6, 6, 0, 0]}
                  style={{ cursor: 'pointer' }}
                  onClick={(entry: any) => {
                    const row = entry?.payload as StackedQuestionDatum | undefined
                    if (row?.questionId) setSelectedQuestionId(row.questionId)
                  }}
                >
                  {stackedData.map((row) => {
                    const isSelected = row.questionId === selectedQuestionId
                    return (
                      <Cell
                        key={`incorrect-${row.questionId}`}
                        fill={chartPalette.destructiveSoft}
                        fillOpacity={isSelected ? 0.92 : 0.68}
                        stroke={isSelected ? chartPalette.selection : 'transparent'}
                        strokeWidth={isSelected ? 2 : 0}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedQuestionId(row.questionId)}
                      />
                    )
                  })}
                </Bar>
              </BarChart>
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border/60 text-sm text-foreground/60">
                No question data available yet.
              </div>
            )}
          </div>
          <div className="mt-4 rounded-lg border border-border/60 bg-background/60 p-3">
            {selectedQuestion ? (
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-foreground/55">Selected question</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{selectedQuestion.label}</p>
                  <p className="mt-1 text-sm text-foreground/70">{selectedQuestion.prompt}</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-foreground/55">Correct</p>
                    <p className="text-sm font-medium text-foreground">{selectedQuestion.correct}</p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground/55">Incorrect</p>
                    <p className="text-sm font-medium text-foreground">{selectedQuestion.incorrect}</p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground/55">Total</p>
                    <p className="text-sm font-medium text-foreground">{selectedQuestion.submissionCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground/55">Accuracy</p>
                    <p className="text-sm font-medium text-foreground">{formatPercent(selectedQuestion.percentCorrect)}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-foreground/60">Click a bar to inspect a question.</p>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h4 className="text-base font-semibold text-foreground">Misconception Clusters</h4>
              <p className="text-sm text-foreground/60">
                Bubble size reflects how many students share the misconception. Strong rings highlight likely fundamental misunderstandings.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="destructive">High severity</Badge>
              <Badge variant="secondary">Medium severity</Badge>
              <Badge variant="outline">Standard</Badge>
            </div>
          </div>
          <div ref={bubbleRef} className="h-[340px] w-full">
            {bubbleData.length > 0 && bubbleSize.width > 0 ? (
              <ScatterChart width={bubbleSize.width} height={bubbleSize.height} margin={{ top: 10, right: 18, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartPalette.border} />
                <XAxis
                  type="number"
                  dataKey="questionPosition"
                  name="Question"
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  stroke={chartPalette.muted}
                  domain={['dataMin - 0.2', 'dataMax + 0.2']}
                  tickFormatter={(value) => `Q${value}`}
                />
                <YAxis
                  type="number"
                  dataKey="count"
                  name="Students"
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  stroke={chartPalette.muted}
                />
                <ZAxis dataKey="count" range={[90, 700]} />
                <Tooltip content={<BubbleTooltip />} cursor={{ strokeDasharray: '3 3' }} />
                <Legend />
                <Scatter
                  name="Misconception cluster"
                  data={bubbleData}
                  fill={chartPalette.primary}
                  isAnimationActive
                  shape={(shapeProps: any) => (
                    <BubbleShape
                      {...shapeProps}
                      palette={chartPalette}
                      selectedKey={selectedBubbleKey}
                      onSelect={(row) => setSelectedBubbleKey(`${row.questionId}:${row.label}`)}
                    />
                  )}
                />
              </ScatterChart>
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border/60 text-sm text-foreground/60">
                No misconception clusters available yet.
              </div>
            )}
          </div>
          <div className="mt-4 rounded-lg border border-border/60 bg-background/60 p-3">
            {selectedBubble ? (
              <div className="grid gap-2 md:grid-cols-[1.4fr_1fr]">
                <div>
                  <p className="text-xs uppercase tracking-wide text-foreground/55">Selected misconception</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{selectedBubble.questionLabel}</p>
                  <p className="mt-1 text-sm text-foreground/70">{selectedBubble.prompt}</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-foreground/55">Label</p>
                    <p className="text-sm font-medium text-foreground">{selectedBubble.label}</p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground/55">Count</p>
                    <p className="text-sm font-medium text-foreground">{selectedBubble.count}</p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground/55">Severity</p>
                    <p className="text-sm font-medium text-foreground capitalize">{selectedBubble.severity}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-foreground/60">Click a bubble to inspect a misconception cluster.</p>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-foreground">Confidence vs Accuracy</h4>
              <p className="text-sm text-foreground/60">
                Confidence level on the x-axis, accuracy on the y-axis. This makes overconfidence easier to spot.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-foreground/60">
              <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                Q1
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-accent" />
                Q2 + Q3
              </span>
            </div>
          </div>
          <div ref={confidenceRef} className="h-[320px] w-full">
            {confidenceData.some(point => point.q1Accuracy !== null || point.q23Accuracy !== null) && confidenceSize.width > 0 ? (
              <LineChart data={confidenceData} width={confidenceSize.width} height={confidenceSize.height} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartPalette.border} vertical={false} />
                <XAxis
                  dataKey="confidence"
                  tickLine={false}
                  axisLine={false}
                  stroke={chartPalette.muted}
                  allowDecimals={false}
                  tickFormatter={(value) => String(value)}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  stroke={chartPalette.muted}
                  domain={[0, 100]}
                  tickFormatter={(value) => `${value}%`}
                />
                <ReferenceLine y={50} stroke={chartPalette.border} strokeDasharray="4 4" />
                <Tooltip content={<ConfidenceTooltip />} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="q1Accuracy"
                  name="Q1 accuracy"
                  stroke={chartPalette.primary}
                  strokeWidth={2.5}
                  dot={(dotProps: any) =>
                    renderConfidenceDot(dotProps, {
                      stroke: chartPalette.primary,
                      background: chartPalette.background,
                      selectedConfidence,
                      onSelect: setSelectedConfidence,
                    })
                  }
                  connectNulls
                  activeDot={(dotProps: any) =>
                    renderConfidenceDot(dotProps, {
                      stroke: chartPalette.primary,
                      background: chartPalette.background,
                      selectedConfidence,
                      onSelect: setSelectedConfidence,
                    })
                  }
                />
                <Line
                  type="monotone"
                  dataKey="q23Accuracy"
                  name="Q2 + Q3 accuracy"
                  stroke={chartPalette.accent}
                  strokeWidth={2.5}
                  dot={(dotProps: any) =>
                    renderConfidenceDot(dotProps, {
                      stroke: chartPalette.accent,
                      background: chartPalette.background,
                      selectedConfidence,
                      onSelect: setSelectedConfidence,
                    })
                  }
                  connectNulls
                  activeDot={(dotProps: any) =>
                    renderConfidenceDot(dotProps, {
                      stroke: chartPalette.accent,
                      background: chartPalette.background,
                      selectedConfidence,
                      onSelect: setSelectedConfidence,
                    })
                  }
                />
              </LineChart>
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border/60 text-sm text-foreground/60">
                No confidence breakdown data available yet.
              </div>
            )}
          </div>
          <div className="mt-4 rounded-lg border border-border/60 bg-background/60 p-3">
            {selectedConfidencePoint ? (
              <div className="grid gap-2 md:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-foreground/55">Selected confidence</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">Level {selectedConfidencePoint.confidence}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground/55">Q1 accuracy</p>
                  <p className="text-sm font-medium text-foreground">
                    {selectedConfidencePoint.q1Accuracy === null ? 'N/A' : `${selectedConfidencePoint.q1Accuracy.toFixed(1)}%`}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-foreground/55">Q2 + Q3 accuracy</p>
                  <p className="text-sm font-medium text-foreground">
                    {selectedConfidencePoint.q23Accuracy === null ? 'N/A' : `${selectedConfidencePoint.q23Accuracy.toFixed(1)}%`}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-foreground/60">Click a confidence point to inspect accuracy at that level.</p>
            )}
          </div>
        </Card>
      </div>

      <details className="mt-6 rounded-xl border border-border/60 bg-secondary/15 p-4">
        <summary className="cursor-pointer text-sm font-medium text-primary">Show raw analysis JSON</summary>
        <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/30 p-3 text-xs text-foreground/80">
          {JSON.stringify(analysis, null, 2)}
        </pre>
      </details>
    </Card>
  )
}
