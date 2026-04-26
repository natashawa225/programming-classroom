'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  getSession,
  getSessionParticipants,
  getSessionQuestions,
  getSessionResponses,
  getLatestCompletedAnalysisRun,
  getLatestInProgressAnalysisRun,
  updateSessionStatus,
} from '@/lib/supabase/queries'
import type { Response, Session, SessionParticipant, SessionQuestion } from '@/lib/types/database'
import type { SessionRoundAnalysis } from '@/lib/ai/experiment-analysis'
import { summarizeSessionRoundMetrics } from '@/lib/session-metrics'
import { teacherLogout } from '@/app/teacher/auth-actions'
import { usePostgresChanges } from '@/hooks/use-postgres-changes'
import { AnalysisDashboard } from '@/components/analysis-dashboard'

type MisconceptionComparison = NonNullable<SessionRoundAnalysis['misconception_comparison']>[number]
type MisconceptionDelta = NonNullable<MisconceptionComparison['deltas']>[number]
type MisconceptionGroupKey = 'resolved' | 'reduced' | 'persistent' | 'emerging'
type TreatmentPhase =
  | 'collecting_round1'
  | 'round1_analysis_ready'
  | 'revision_open'
  | 'revision_closed'
  | 'round2_analysis_ready'

const MISCONCEPTION_GROUP_META: Record<
  MisconceptionGroupKey,
  {
    label: string
    badgeClassName: string
    borderClassName: string
    hint: string
  }
> = {
  resolved: {
    label: 'Resolved',
    badgeClassName: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    borderClassName: 'border-emerald-500/15',
    hint: 'No longer showing up in round 2.',
  },
  reduced: {
    label: 'Reduced',
    badgeClassName: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/20',
    borderClassName: 'border-sky-500/15',
    hint: 'Still present, but less common.',
  },
  persistent: {
    label: 'Persistent',
    badgeClassName: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/20',
    borderClassName: 'border-amber-500/15',
    hint: 'Still common after the revision.',
  },
  emerging: {
    label: 'New / Emerging',
    badgeClassName: 'bg-violet-500/15 text-violet-800 dark:text-violet-300 border-violet-500/20',
    borderClassName: 'border-violet-500/15',
    hint: 'Appears for the first time in round 2.',
  },
}

function getDeltaClassification(delta: Pick<MisconceptionDelta, 'round1' | 'round2' | 'classification'>) {
  if (delta.classification) return delta.classification
  if (delta.round1 > 0 && delta.round2 === 0) return 'resolved'
  if (delta.round1 === 0 && delta.round2 > 0) return 'emerging'
  if (delta.round1 > 0 && delta.round2 > 0 && delta.round2 < delta.round1) return 'reduced'
  return 'persistent'
}

function getComparisonGroups(mc: MisconceptionComparison) {
  const raw = Array.isArray(mc.grouped_deltas)
    ? mc.grouped_deltas
    : null

  const fallback = Array.isArray(mc.deltas) ? mc.deltas : []
  const source = raw
    ? {
        resolved: Array.isArray(raw.resolved) ? raw.resolved : [],
        reduced: Array.isArray(raw.reduced) ? raw.reduced : [],
        persistent: Array.isArray(raw.persistent) ? raw.persistent : [],
        emerging: Array.isArray(raw.emerging) ? raw.emerging : [],
      }
    : {
        resolved: fallback.filter((d) => getDeltaClassification(d) === 'resolved'),
        reduced: fallback.filter((d) => getDeltaClassification(d) === 'reduced'),
        persistent: fallback.filter((d) => getDeltaClassification(d) === 'persistent'),
        emerging: fallback.filter((d) => getDeltaClassification(d) === 'emerging'),
      }

  const groupEntries = (Object.keys(MISCONCEPTION_GROUP_META) as MisconceptionGroupKey[]).map((key) => {
    const items = [...source[key]].sort((a, b) => {
      const aPriority = typeof a.priority === 'number' ? a.priority : 0
      const bPriority = typeof b.priority === 'number' ? b.priority : 0
      return bPriority - aPriority
    })

    return {
      key,
      meta: MISCONCEPTION_GROUP_META[key],
      items,
    }
  })

  const hasAny = groupEntries.some((group) => group.items.length > 0)
  return { groupEntries, hasAny }
}

function formatQuestionActionLine(mc: MisconceptionComparison) {
  if (mc.suggested_action) return mc.suggested_action
  if (mc.summary_line) return mc.summary_line
  return 'No major misconception changes detected.'
}

function formatPercentValue(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A'
  return `${Math.round(value)}%`
}

function deriveTreatmentPhase(options: {
  status: Session['status']
  round2ResponseCount: number
  hasRound2CompletedAnalysis: boolean
  hasRound2InProgressAnalysis: boolean
}) : TreatmentPhase {
  if (options.status === 'revision') return 'revision_open'
  if (options.status === 'live' || options.status === 'draft') return 'collecting_round1'
  if (options.hasRound2CompletedAnalysis) return 'round2_analysis_ready'
  if (options.hasRound2InProgressAnalysis) return 'revision_closed'
  if (options.round2ResponseCount > 0) return 'revision_closed'
  return 'round1_analysis_ready'
}

function firstNonEmpty(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function getMisconceptionDescription(item: any) {
  return firstNonEmpty(item?.description, item?.interpretation)
}

function getMisconceptionWhy(item: any) {
  return firstNonEmpty(item?.why_students_think_this, item?.interpretation)
}

function getMisconceptionAction(item: any, question: any) {
  return firstNonEmpty(item?.teacher_move, item?.hint, question?.suggested_teacher_action)
}

function getMisconceptionReasoningSummary(item: any, question: any) {
  const labels = Array.isArray(question?.response_labels) ? question.response_labels : []
  const target = String(item?.label || '').trim().toLowerCase()
  if (!target) return ''
  const match = labels.find((label: any) => {
    return (
      String(label?.misconception_label || '').trim().toLowerCase() === target &&
      typeof label?.reasoning_summary === 'string' &&
      label.reasoning_summary.trim()
    )
  })
  return typeof match?.reasoning_summary === 'string' ? match.reasoning_summary.trim() : ''
}

function MisconceptionCard({
  item,
  question,
  condition,
}: {
  item: any
  question: any
  condition: 'baseline' | 'treatment'
}) {
  const description = getMisconceptionDescription(item)
  const why = getMisconceptionWhy(item)
  const action = getMisconceptionAction(item, question)
  const reasoningSummary = getMisconceptionReasoningSummary(item, question)
  const representativeAnswers = Array.isArray(item?.representative_answers)
    ? item.representative_answers.filter((value: unknown) => typeof value === 'string' && value.trim()).slice(0, 1)
    : []
  const isTreatment = condition === 'treatment'

  return (
    <div
      className={
        isTreatment
          ? 'rounded-xl border border-primary/20 bg-primary/5 p-4'
          : 'rounded-xl border border-border/60 bg-secondary/15 p-4'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground leading-snug">{item?.label || 'Misconception'}</p>
        </div>
        <Badge variant="outline" className="shrink-0 text-sm font-medium">
          {item?.count ?? 0}
        </Badge>
      </div>

      {description && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground/55">What is happening</p>
          <p className="mt-1 text-sm leading-6 text-foreground/85">{description}</p>
        </div>
      )}

      {why && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground/55">Why students may think this</p>
          <p className="mt-1 text-sm leading-6 text-foreground/75">{why}</p>
        </div>
      )}

      {action && (
        <div className="mt-3 rounded-lg border border-border/40 bg-background/70 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground/55">
            {isTreatment ? 'Suggested teacher move' : 'Suggested teacher action'}
          </p>
          <p className="mt-1 text-sm leading-6 text-foreground/90">{action}</p>
        </div>
      )}

      {(reasoningSummary || representativeAnswers.length > 0) && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-primary">Show response signal</summary>
          <div className="mt-2 space-y-2">
            {reasoningSummary && (
              <div className="rounded-lg bg-background/60 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground/55">Model reasoning summary</p>
                <p className="mt-1 text-sm leading-6 text-foreground/80">{reasoningSummary}</p>
              </div>
            )}
            {representativeAnswers.map((answer: string, index: number) => (
              <div key={`${item?.label}-${index}`} className="rounded-lg bg-background/60 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground/55">Representative answer</p>
                <p className="mt-1 text-sm leading-6 text-foreground/80">{answer}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function isDetailedTransitionMetrics(value: any) {
  return Boolean(value && typeof value.total_pairs === 'number' && value.incorrect_to_correct && typeof value.incorrect_to_correct === 'object')
}

function getTransitionSummary(analysis: any, totalRound2Responses: number) {
  const transitions = analysis?.transitions
  const transitionMetrics = analysis?.transition_metrics
  const detailed = transitionMetrics || (isDetailedTransitionMetrics(transitions) ? transitions : null)
  const simple = !detailed && transitions && typeof transitions.incorrect_to_correct === 'number' ? transitions : null
  if (!detailed && !simple) return null

  const improved = detailed
    ? detailed.incorrect_to_correct?.count ?? 0
    : simple?.incorrect_to_correct ?? 0
  const regressed = detailed
    ? detailed.correct_to_incorrect?.count ?? 0
    : simple?.correct_to_incorrect ?? 0
  const noChange = detailed
    ? (detailed.stayed_correct?.count ?? 0) + (detailed.stayed_incorrect?.count ?? 0)
    : simple?.no_change ?? 0
  if ((detailed && (detailed.total_pairs ?? 0) === 0) || (!detailed && improved + regressed + noChange === 0)) return null
  const denominator = totalRound2Responses > 0 ? totalRound2Responses : analysis?.totals?.total_submissions ?? 0

  return {
    improved: {
      count: improved,
      percent: denominator > 0 ? (improved / denominator) * 100 : null,
    },
    regressed: {
      count: regressed,
      percent: denominator > 0 ? (regressed / denominator) * 100 : null,
    },
    noChange: {
      count: noChange,
      percent: denominator > 0 ? (noChange / denominator) * 100 : null,
    },
    totalPairs: detailed?.total_pairs ?? improved + regressed + noChange,
  }
}

function buildTreatmentRound1Priorities(perQuestion: any[]) {
  const aggregated = new Map<
    string,
    {
      label: string
      count: number
      description?: string
      why_students_think_this?: string
      teacher_move?: string
      hint?: string
      sourceQuestion?: any
    }
  >()

  for (const question of Array.isArray(perQuestion) ? perQuestion : []) {
    for (const item of Array.isArray(question?.top_misconceptions) ? question.top_misconceptions : []) {
      const rawLabel = typeof item?.label === 'string' ? item.label.trim() : ''
      if (!rawLabel) continue
      const key = rawLabel.toLowerCase()
      const existing = aggregated.get(key)
      if (existing) {
        existing.count += typeof item?.count === 'number' ? item.count : 0
        existing.description ||= typeof item?.description === 'string' ? item.description : undefined
        existing.why_students_think_this ||= typeof item?.why_students_think_this === 'string' ? item.why_students_think_this : undefined
        existing.teacher_move ||= typeof item?.teacher_move === 'string' ? item.teacher_move : undefined
        existing.hint ||= typeof item?.hint === 'string' ? item.hint : undefined
        existing.sourceQuestion ||= question
        continue
      }
      aggregated.set(key, {
        label: rawLabel,
        count: typeof item?.count === 'number' ? item.count : 0,
        description: typeof item?.description === 'string' ? item.description : undefined,
        why_students_think_this: typeof item?.why_students_think_this === 'string' ? item.why_students_think_this : undefined,
        teacher_move: typeof item?.teacher_move === 'string' ? item.teacher_move : undefined,
        hint: typeof item?.hint === 'string' ? item.hint : undefined,
        sourceQuestion: question,
      })
    }
  }

  return Array.from(aggregated.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.label.localeCompare(b.label)
    })
    .slice(0, 2)
}

export default function SessionAnalysis() {
  const params = useParams()
  const sessionId = params.id as string

  const [session, setSession] = useState<Session | null>(null)
  const [analysis, setAnalysis] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [loadingStoredAnalysis, setLoadingStoredAnalysis] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<SessionParticipant[]>([])
  const [questions, setQuestions] = useState<SessionQuestion[]>([])
  const [responses, setResponses] = useState<Response[]>([])
  const [roundNumber, setRoundNumber] = useState<1 | 2>(1)
  const [analysisStatus, setAnalysisStatus] = useState<'none' | 'in_progress' | 'completed'>('none')
  const [analysisRunMeta, setAnalysisRunMeta] = useState<{ analysisRunId: string; status: string; createdAt: string } | null>(null)
  const [analysisAvailability, setAnalysisAvailability] = useState({
    round1Completed: false,
    round2Completed: false,
    round1InProgress: false,
    round2InProgress: false,
  })
  const responseRealtimeTables = useMemo(
    () => [
      { table: 'responses', event: 'INSERT' as const, filter: `session_id=eq.${sessionId}` },
      { table: 'responses', event: 'UPDATE' as const, filter: `session_id=eq.${sessionId}` },
    ],
    [sessionId]
  )
  const participantRealtimeTables = useMemo(
    () => [{ table: 'session_participants', event: '*' as const, filter: `session_id=eq.${sessionId}` }],
    [sessionId]
  )
  const analysisRealtimeTables = useMemo(
    () => [{ table: 'analysis_runs', event: '*' as const, filter: `session_id=eq.${sessionId}` }],
    [sessionId]
  )

  const metrics = useMemo(
    () =>
      summarizeSessionRoundMetrics({
        session,
        participants,
        responses,
        roundNumber,
        questionCount: questions.length || analysis?.per_question?.length || 1,
      }),
    [analysis?.per_question?.length, participants, questions.length, responses, roundNumber, session]
  )

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        const [sessionData, participantsData, questionsData, responsesData] = await Promise.all([
          getSession(sessionId),
          getSessionParticipants(sessionId),
          getSessionQuestions(sessionId),
          getSessionResponses(sessionId),
        ])
        setSession(sessionData)
        setParticipants(participantsData || [])
        setQuestions(questionsData || [])
        setResponses(responsesData || [])
        setRoundNumber(1)
      } catch (err) {
        console.error('Error loading session:', err)
        setError('Failed to load session data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [sessionId])

  const loadStoredAnalysis = async (rn: 1 | 2, options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) {
        setLoadingStoredAnalysis(true)
      }
      setError(null)
      const [completed, inProgress, completedRound1, completedRound2, inProgressRound1, inProgressRound2] = await Promise.all([
        getLatestCompletedAnalysisRun(sessionId, rn),
        getLatestInProgressAnalysisRun(sessionId, rn),
        getLatestCompletedAnalysisRun(sessionId, 1),
        getLatestCompletedAnalysisRun(sessionId, 2),
        getLatestInProgressAnalysisRun(sessionId, 1),
        getLatestInProgressAnalysisRun(sessionId, 2),
      ])
      setAnalysisAvailability({
        round1Completed: Boolean(completedRound1?.summary_json),
        round2Completed: Boolean(completedRound2?.summary_json),
        round1InProgress: Boolean(inProgressRound1),
        round2InProgress: Boolean(inProgressRound2),
      })

      if (completed?.summary_json) {
        setAnalysis(completed.summary_json)
        setAnalysisStatus('completed')
        setAnalysisRunMeta({
          analysisRunId: completed.analysis_run_id,
          status: completed.status,
          createdAt: completed.created_at,
        })
        return
      }

      if (inProgress) {
        setAnalysis(null)
        setAnalysisStatus('in_progress')
        setAnalysisRunMeta({
          analysisRunId: inProgress.analysis_run_id,
          status: inProgress.status,
          createdAt: inProgress.created_at,
        })
        return
      }

      setAnalysis(null)
      setAnalysisStatus('none')
      setAnalysisRunMeta(null)
    } catch (err) {
      console.error('Error loading stored analysis:', err)
      // Don't hard-fail the whole page; keep "Generate" available.
      setAnalysis(null)
      setAnalysisStatus('none')
      setAnalysisRunMeta(null)
    } finally {
      if (!options?.silent) {
        setLoadingStoredAnalysis(false)
      }
    }
  }

  useEffect(() => {
    const refreshCount = async () => {
      try {
        const [participantsData, responsesData] = await Promise.all([
          getSessionParticipants(sessionId),
          getSessionResponses(sessionId),
        ])
        setParticipants(participantsData || [])
        setResponses(responsesData || [])
      } catch {}
    }
    void refreshCount()
  }, [sessionId, roundNumber])

  useEffect(() => {
    if (!session) return
    setAnalysis(null)
    setAnalysisStatus('none')
    setAnalysisRunMeta(null)
    void loadStoredAnalysis(roundNumber)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, session?.id, roundNumber])

  usePostgresChanges({
    tables: responseRealtimeTables,
    onChange: async () => {
      try {
        const responsesData = await getSessionResponses(sessionId)
        setResponses(responsesData || [])
      } catch (err) {
        console.error('Error refreshing response count:', err)
      }
    },
    pollMs: 10000,
    debugLabel: `teacher-analysis-${sessionId}-r${roundNumber}`,
  })

  usePostgresChanges({
    tables: participantRealtimeTables,
    onChange: async () => {
      try {
        const participantsData = await getSessionParticipants(sessionId)
        setParticipants(participantsData || [])
      } catch (err) {
        console.error('Error refreshing participant count:', err)
      }
    },
    pollMs: 10000,
    debugLabel: `teacher-analysis-participants-${sessionId}`,
  })

  usePostgresChanges({
    tables: analysisRealtimeTables,
    onChange: async () => {
      await loadStoredAnalysis(roundNumber, { silent: true })
    },
    pollMs: 10000,
    debugLabel: `teacher-analysis-run-${sessionId}-r${roundNumber}`,
  })

  const round1Responses = useMemo(
    () => responses.filter((response) => (response.round_number ?? 1) === 1),
    [responses]
  )
  const round2Responses = useMemo(
    () => responses.filter((response) => (response.round_number ?? 1) === 2),
    [responses]
  )

  const treatmentPhase: TreatmentPhase | null = useMemo(() => {
    if (!session || session.condition !== 'treatment') return null
    return deriveTreatmentPhase({
      status: session.status,
      round2ResponseCount: round2Responses.length,
      hasRound2CompletedAnalysis: analysisAvailability.round2Completed,
      hasRound2InProgressAnalysis: analysisAvailability.round2InProgress,
    })
  }, [analysisAvailability.round2Completed, analysisAvailability.round2InProgress, round2Responses.length, session])

  const canSelectRound2 =
    session?.condition === 'treatment' &&
    (treatmentPhase === 'round2_analysis_ready' || analysisAvailability.round2InProgress || (roundNumber === 2 && analysisStatus === 'in_progress'))

  useEffect(() => {
    if (session?.condition !== 'treatment') return
    if (roundNumber === 2 && !canSelectRound2) {
      setRoundNumber(1)
    }
  }, [canSelectRound2, roundNumber, session?.condition])

  const handleAnalyze = async (opts?: { forceRegenerate?: boolean; targetRound?: 1 | 2 }) => {
    try {
      setAnalyzing(true)
      setError(null)
      const requestedRound = opts?.targetRound ?? roundNumber
      if (session?.condition === 'treatment') {
        if (requestedRound === 2 && treatmentPhase !== 'revision_closed' && treatmentPhase !== 'round2_analysis_ready') {
          throw new Error('Final analysis is only available after revision has been completed.')
        }
        if (requestedRound === 1 && treatmentPhase === 'collecting_round1') {
          throw new Error('Round 1 analysis is only available after round 1 has been closed.')
        }
      }

      const response = await fetch('/teacher/api/analyze-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          roundNumber: requestedRound,
          forceRegenerate: Boolean(opts?.forceRegenerate),
        }),
      })

      if (!response.ok) {
        let message = 'Analysis failed'
        try {
          const body = await response.json()
          if (typeof body?.error === 'string') message = body.error
        } catch {}
        throw new Error(message)
      }

      if (response.status === 202) {
        const body = await response.json().catch(() => null)
        setAnalysis(null)
        setAnalysisStatus('in_progress')
        setRoundNumber(requestedRound)
        if (body?.analysis_run_id) {
          setAnalysisRunMeta({
            analysisRunId: String(body.analysis_run_id),
            status: String(body.status || 'running'),
            createdAt: String(body.created_at || ''),
          })
        }
        return
      }

      const data = await response.json()
      setRoundNumber(requestedRound)
      setAnalysis(data)
      setAnalysisStatus('completed')
    } catch (err) {
      console.error('Error analyzing session:', err)
      setError(err instanceof Error ? err.message : 'Failed to analyze responses')
    } finally {
      setAnalyzing(false)
    }
  }

  const transitionSummary = getTransitionSummary(analysis, metrics.totalSubmissions)
  const detailedTransitionMetricsRaw =
    analysis?.transition_metrics || (isDetailedTransitionMetrics(analysis?.transitions) ? analysis.transitions : null)
  const detailedTransitionMetrics =
    detailedTransitionMetricsRaw && (detailedTransitionMetricsRaw.total_pairs ?? 0) > 0
      ? detailedTransitionMetricsRaw
      : null
  const isTreatmentRound1View = session?.condition === 'treatment' && roundNumber === 1
  const isTreatmentFinalView = session?.condition === 'treatment' && roundNumber === 2 && canSelectRound2
  const canOpenRevision =
    session?.condition === 'treatment' &&
    session?.live_phase !== 'session_completed' &&
    session?.status !== 'closed' &&
    isTreatmentRound1View &&
    analysisStatus === 'completed' &&
    treatmentPhase === 'round1_analysis_ready' &&
    !analysisAvailability.round2Completed
  const canCloseRevision =
    session?.condition === 'treatment' &&
    session?.live_phase !== 'session_completed' &&
    session?.status !== 'closed' &&
    isTreatmentRound1View &&
    treatmentPhase === 'revision_open'
  const canGenerateTreatmentRound2 =
    session?.condition === 'treatment' &&
    isTreatmentRound1View &&
    treatmentPhase === 'revision_closed' &&
    round2Responses.length > 0 &&
    !analysisAvailability.round2Completed &&
    !analysisAvailability.round2InProgress
  const canRegenerateTreatmentRound1 =
    session?.condition === 'treatment' &&
    isTreatmentRound1View &&
    analysisStatus === 'completed'
  const isRevisionOpen = session?.condition === 'treatment' && treatmentPhase === 'revision_open'
  const isRevisionCompleted =
    session?.condition === 'treatment' &&
    isTreatmentRound1View &&
    (treatmentPhase === 'round2_analysis_ready' || analysisAvailability.round2Completed)
  const isRound2AnalysisInProgress =
    session?.condition === 'treatment' &&
    isTreatmentRound1View &&
    analysisAvailability.round2InProgress

  const treatmentRound1Priorities = useMemo(() => {
    if (!isTreatmentRound1View || !analysis?.per_question) return []
    return buildTreatmentRound1Priorities(analysis.per_question)
  }, [analysis?.per_question, isTreatmentRound1View])

  const treatmentRound1Summary = useMemo(() => {
    if (!isTreatmentRound1View || !analysis) return ''
    return firstNonEmpty(
      analysis?.teaching_summary?.overall_summary,
      analysis?.summary_text,
      ...((analysis?.per_question || []).map((q: any) => q?.teacher_interpretation))
    )
  }, [analysis, isTreatmentRound1View])

  const handleOpenRevision = async () => {
    if (!session || session.condition !== 'treatment') return
    const previousSession = session
    try {
      setActionLoading(true)
      setError(null)
      setSession({ ...session, status: 'revision' })
      const updated = await updateSessionStatus(sessionId, 'revision')
      setSession(updated)
    } catch (err) {
      console.error('Error opening revision:', err)
      setSession(previousSession)
      setError(err instanceof Error ? err.message : 'Failed to open revision')
    } finally {
      setActionLoading(false)
    }
  }

  const handleCloseRevision = async () => {
    if (!session || session.condition !== 'treatment') return
    const previousSession = session
    try {
      setActionLoading(true)
      setError(null)
      setSession({ ...session, status: 'analysis_ready' })
      const updated = await updateSessionStatus(sessionId, 'analysis_ready')
      setSession(updated)
    } catch (err) {
      console.error('Error closing revision:', err)
      setSession(previousSession)
      setError(err instanceof Error ? err.message : 'Failed to close revision')
    } finally {
      setActionLoading(false)
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
              <p className="text-sm text-foreground/60 mb-1">Status</p>
              <p className="text-lg font-semibold text-primary capitalize">{session.status}</p>
            </div>
            <div>
              <p className="text-sm text-foreground/60 mb-1">Viewing Round</p>
              <p className="text-lg font-semibold text-foreground">Round {roundNumber}</p>
            </div>
          </div>
        </Card>

        <Card className="p-6 mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-4">Participation Metrics</h2>
          <div className={`grid gap-4 ${metrics.questionCount > 1 ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
            <div className="p-4 rounded-lg bg-secondary/30">
              <p className="text-sm text-foreground/60 mb-1">Students Joined</p>
              <p className="text-2xl font-bold text-foreground">{metrics.studentsJoined}</p>
            </div>
            <div className="p-4 rounded-lg bg-secondary/30">
              <p className="text-sm text-foreground/60 mb-1">Students Responded</p>
              <p className="text-2xl font-bold text-foreground">{metrics.studentsResponded}</p>
            </div>
            <div className="p-4 rounded-lg bg-secondary/30">
              <p className="text-sm text-foreground/60 mb-1">Participation Rate</p>
              <p className="text-2xl font-bold text-foreground">
                {metrics.participationRate === null ? 'N/A' : `${Math.round(metrics.participationRate)}%`}
              </p>
            </div>
            <div className="p-4 rounded-lg bg-secondary/30">
              <p className="text-sm text-foreground/60 mb-1">Total Submissions</p>
              <p className="text-2xl font-bold text-foreground">{metrics.totalSubmissions}</p>
            </div>
            {metrics.questionCount > 1 && (
              <div className="p-4 rounded-lg bg-secondary/30">
                <p className="text-sm text-foreground/60 mb-1">Completion Rate</p>
                <p className="text-2xl font-bold text-foreground">
                  {metrics.completionRate === null ? 'N/A' : `${Math.round(metrics.completionRate)}%`}
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Analysis Section */}
        {loadingStoredAnalysis ? (
          <Card className="p-8 text-center">
            <h2 className="text-2xl font-bold text-foreground mb-3">Loading analysis…</h2>
            <p className="text-foreground/70 max-w-md mx-auto">
              Fetching the saved round {roundNumber} analysis so the page shows the correct treatment state.
            </p>
          </Card>
        ) : analysisStatus === 'in_progress' ? (
          <Card className="p-8 text-center">
            <h2 className="text-2xl font-bold text-foreground mb-3">Analysis in progress…</h2>
            <p className="text-foreground/70 mb-6 max-w-md mx-auto">
              This can take a little while. The page will update automatically when it finishes.
            </p>
            {analysisRunMeta && (
              <p className="text-sm text-foreground/60">
                Run {analysisRunMeta.analysisRunId} • {analysisRunMeta.status}
              </p>
            )}
          </Card>
        ) : !analysis ? (
          <Card className="p-8 text-center">
            <h2 className="text-2xl font-bold text-foreground mb-4">
              {session.condition === 'treatment' && treatmentPhase === 'revision_open'
                ? 'Revision In Progress'
                : session.condition === 'treatment' && treatmentPhase === 'revision_closed'
                  ? 'Ready for Final Analysis'
                  : 'Ready for Analysis'}
            </h2>
            <p className="text-foreground/70 mb-6 max-w-md mx-auto">
              {session.condition === 'baseline'
                ? 'Generate round 1 analysis (baseline ends after round 1).'
                : treatmentPhase === 'collecting_round1'
                  ? 'Round 1 is still collecting responses. Close round 1 before generating treatment analysis.'
                  : treatmentPhase === 'round1_analysis_ready'
                    ? 'Generate the round 1 treatment analysis, then open revision.'
                    : treatmentPhase === 'revision_open'
                      ? 'Students are revising now. Final analysis will be available after revision is closed.'
                      : treatmentPhase === 'revision_closed'
                        ? 'Revision is closed. Generate the final treatment analysis for round 2.'
                        : 'Round 2 final analysis is available.'}
            </p>

            {metrics.totalSubmissions > 0 && session.condition === 'baseline' && (
              <Button onClick={() => handleAnalyze({ targetRound: 1 })} disabled={analyzing} size="lg">
                {analyzing ? 'Analyzing...' : 'Generate Analysis'}
              </Button>
            )}

            {session.condition === 'treatment' && treatmentPhase === 'round1_analysis_ready' && round1Responses.length > 0 && (
              <Button onClick={() => handleAnalyze({ targetRound: 1 })} disabled={analyzing} size="lg">
                {analyzing ? 'Analyzing...' : 'Generate Round 1 Analysis'}
              </Button>
            )}

            {session.condition === 'treatment' && treatmentPhase === 'revision_closed' && round2Responses.length > 0 && (
              <Button onClick={() => handleAnalyze({ targetRound: 2 })} disabled={analyzing} size="lg">
                {analyzing ? 'Analyzing...' : 'Generate Final Analysis'}
              </Button>
            )}

            {metrics.totalSubmissions === 0 && (
              <p className="text-foreground/60">No responses to analyze yet</p>
            )}
          </Card>
        ) : (
          <div className="space-y-6">
            {session.condition === 'treatment' && canSelectRound2 && (
              <Card className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm text-foreground/70">Viewing round:</p>
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      variant={roundNumber === 1 ? 'default' : 'outline'}
                      onClick={() => setRoundNumber(1)}
                      size="sm"
                    >
                      Round 1
                    </Button>
                    <Button
                      type="button"
                      variant={roundNumber === 2 ? 'default' : 'outline'}
                      onClick={() => setRoundNumber(2)}
                      size="sm"
                    >
                      Round 2 (Final)
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {isTreatmentRound1View && (
              <div className="space-y-6">
                <Card className="p-6 border-primary/20 bg-primary/5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h3 className="text-xl font-semibold text-foreground mb-2">Round 1 Treatment Analysis</h3>
                      <p className="text-sm text-foreground/70">
                        Use this repair-oriented snapshot to address the top misconceptions before opening revision.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 md:items-end">
                      <div className="flex flex-wrap gap-2 md:justify-end">
                        {canRegenerateTreatmentRound1 && (
                          <Button
                            variant="outline"
                            onClick={() => handleAnalyze({ forceRegenerate: true, targetRound: 1 })}
                            disabled={analyzing || actionLoading}
                          >
                            {analyzing ? 'Regenerating...' : 'Regenerate Analysis'}
                          </Button>
                        )}
                        {canOpenRevision && (
                          <Button onClick={handleOpenRevision} disabled={actionLoading || analyzing}>
                            {actionLoading ? 'Opening Revision...' : 'Open Revision'}
                          </Button>
                        )}
                        {canCloseRevision && (
                          <Button variant="outline" onClick={handleCloseRevision} disabled={actionLoading || analyzing}>
                            {actionLoading ? 'Closing Revision...' : 'End Revision'}
                          </Button>
                        )}
                        {canGenerateTreatmentRound2 && (
                          <Button onClick={() => handleAnalyze({ targetRound: 2 })} disabled={analyzing || actionLoading}>
                            {analyzing ? 'Generating Round 2...' : 'Generate Final Analysis'}
                          </Button>
                        )}
                      </div>
                      {isRevisionOpen && (
                        <div className="flex flex-col gap-1 md:items-end">
                          <Badge variant="secondary" className="text-sm">
                            Revision is now open for students
                          </Badge>
                          <p className="text-sm text-foreground/70">Students can now revise their round 1 answers.</p>
                        </div>
                      )}
                      {canGenerateTreatmentRound2 && (
                        <div className="flex flex-col gap-1 md:items-end">
                          <Badge variant="outline" className="text-sm">
                            Revision ended
                          </Badge>
                          <p className="text-sm text-foreground/70">Students have completed revision. Generate the final round 2 analysis.</p>
                        </div>
                      )}
                      {isRound2AnalysisInProgress && (
                        <div className="flex flex-col gap-1 md:items-end">
                          <Badge variant="secondary" className="text-sm">
                            Round 2 analysis in progress
                          </Badge>
                          <p className="text-sm text-foreground/70">The final treatment analysis is running now.</p>
                        </div>
                      )}
                      {isRevisionCompleted && (
                        <div className="flex flex-col gap-1 md:items-end">
                          <Badge variant="outline" className="text-sm">
                            Revision already completed
                          </Badge>
                          <p className="text-sm text-foreground/70">Round 2 responses have been collected for this treatment session.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>

                <Card className="p-6">
                  <h3 className="text-lg font-semibold text-foreground mb-4">Round 1 Snapshot</h3>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-lg bg-secondary/25 p-4">
                      <p className="text-sm text-foreground/60 mb-1">Total submissions</p>
                      <p className="text-3xl font-bold text-foreground">{analysis.totals?.total_submissions ?? 0}</p>
                    </div>
                    <div className="rounded-lg bg-secondary/25 p-4">
                      <p className="text-sm text-foreground/60 mb-1">% correct</p>
                      <p className="text-3xl font-bold text-foreground">
                        {(analysis.totals?.percent_fully_correct ?? analysis.totals?.percent_correct) === null ||
                        (analysis.totals?.percent_fully_correct ?? analysis.totals?.percent_correct) === undefined
                          ? 'N/A'
                          : `${analysis.totals?.percent_fully_correct ?? analysis.totals.percent_correct}%`}
                      </p>
                    </div>
                    <div className="rounded-lg bg-secondary/25 p-4">
                      <p className="text-sm text-foreground/60 mb-1">Avg confidence</p>
                      <p className="text-3xl font-bold text-foreground">
                        {analysis.totals?.avg_confidence === null || analysis.totals?.avg_confidence === undefined
                          ? 'N/A'
                          : Number(analysis.totals.avg_confidence).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </Card>

                <Card className="p-6">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">Repair Priorities</h3>
                      <p className="text-sm text-foreground/70">Focus the brief teacher explanation on the top two class-wide misconceptions.</p>
                    </div>
                    <Badge variant="secondary" className="text-sm">Top 2</Badge>
                  </div>
                  {treatmentRound1Priorities.length > 0 ? (
                    <div className="grid gap-3">
                      {treatmentRound1Priorities.map((item) => {
                        const action = firstNonEmpty(item.teacher_move, item.hint, item.sourceQuestion?.suggested_teacher_action)
                        return (
                          <div key={item.label} className="rounded-xl border border-primary/15 bg-primary/5 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-base font-semibold text-foreground leading-snug">{item.label}</p>
                              </div>
                              <Badge variant="outline" className="shrink-0 text-sm font-medium">
                                {item.count}
                              </Badge>
                            </div>
                            {action && (
                              <div className="mt-3 rounded-lg border border-border/40 bg-background/70 p-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-foreground/55">Repair hint</p>
                                <p className="mt-1 text-sm leading-6 text-foreground/90">{action}</p>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-foreground/60">No major misconceptions were detected in the current round-1 analysis.</p>
                  )}
                </Card>

                <Card className="p-6">
                  <h3 className="text-lg font-semibold text-foreground mb-3">Teacher Note</h3>
                  <p className="text-base leading-7 text-foreground/85">
                    {treatmentRound1Summary || 'Address the main misconceptions briefly, then open revision for students to improve their answers.'}
                  </p>
                </Card>
              </div>
            )}

            {isTreatmentFinalView && (
              <Card className="p-6">
                <h3 className="text-lg font-semibold text-foreground mb-2">Final Treatment Summary</h3>
                <p className="text-sm text-foreground/60 mb-4">
                  Round 1 to round 2 movement for the current treatment group, based on matched backend comparisons.
                </p>
                {transitionSummary ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4">
                        <p className="text-sm text-emerald-700 dark:text-emerald-300 mb-1">Incorrect → Correct (Improved)</p>
                        <p className="text-2xl font-bold text-foreground">{transitionSummary.improved.count}</p>
                        <p className="text-sm text-foreground/60 mt-1">{formatPercentValue(transitionSummary.improved.percent)} of round 2 responses</p>
                      </div>
                      <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-4">
                        <p className="text-sm text-rose-700 dark:text-rose-300 mb-1">Correct → Incorrect (Regressed)</p>
                        <p className="text-2xl font-bold text-foreground">{transitionSummary.regressed.count}</p>
                        <p className="text-sm text-foreground/60 mt-1">{formatPercentValue(transitionSummary.regressed.percent)} of round 2 responses</p>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-secondary/25 p-4">
                        <p className="text-sm text-foreground/70 mb-1">No Change</p>
                        <p className="text-2xl font-bold text-foreground">{transitionSummary.noChange.count}</p>
                        <p className="text-sm text-foreground/60 mt-1">{formatPercentValue(transitionSummary.noChange.percent)} of round 2 responses</p>
                      </div>
                    </div>
                    <p className="text-sm text-foreground/60 mt-3">Pairs analyzed: {transitionSummary.totalPairs}</p>
                    <details className="mt-4 rounded-lg border border-border/50 bg-background/70 p-4">
                      <summary className="cursor-pointer text-sm font-medium text-primary">Show transition details</summary>
                      <div className="mt-4 space-y-4">
                        {detailedTransitionMetrics ? (
                          <>
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="rounded-lg bg-secondary/25 p-3">
                                <p className="text-sm font-medium text-foreground">Total matched pairs</p>
                                <p className="mt-1 text-2xl font-bold text-foreground">{detailedTransitionMetrics.total_pairs ?? 0}</p>
                                <p className="text-sm text-foreground/60 mt-1">
                                  Students with a matched round 1 and round 2 response for the same question.
                                </p>
                              </div>
                              <div className="rounded-lg bg-secondary/25 p-3">
                                <p className="text-sm font-medium text-foreground">No change</p>
                                <p className="mt-1 text-2xl font-bold text-foreground">
                                  {(detailedTransitionMetrics.stayed_correct?.count ?? 0) + (detailedTransitionMetrics.stayed_incorrect?.count ?? 0)}
                                </p>
                                <p className="text-sm text-foreground/60 mt-1">
                                  {formatPercentValue(
                                    (detailedTransitionMetrics.total_pairs ?? 0) > 0
                                      ? (((detailedTransitionMetrics.stayed_correct?.count ?? 0) + (detailedTransitionMetrics.stayed_incorrect?.count ?? 0)) /
                                          (detailedTransitionMetrics.total_pairs ?? 1)) *
                                          100
                                      : null
                                  )}{' '}
                                  of matched pairs
                                </p>
                              </div>
                            </div>
                            <div className="grid gap-3 md:grid-cols-5">
                              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
                                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Incorrect → Correct</p>
                                <p className="mt-1 text-xl font-bold text-foreground">{detailedTransitionMetrics.incorrect_to_correct?.count ?? 0}</p>
                                <p className="text-sm text-foreground/60 mt-1">
                                  {formatPercentValue(detailedTransitionMetrics.incorrect_to_correct?.percent)} of matched pairs
                                </p>
                              </div>
                              <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3">
                                <p className="text-sm font-medium text-rose-700 dark:text-rose-300">Correct → Incorrect</p>
                                <p className="mt-1 text-xl font-bold text-foreground">{detailedTransitionMetrics.correct_to_incorrect?.count ?? 0}</p>
                                <p className="text-sm text-foreground/60 mt-1">
                                  {formatPercentValue(detailedTransitionMetrics.correct_to_incorrect?.percent)} of matched pairs
                                </p>
                              </div>
                              <div className="rounded-lg border border-sky-500/20 bg-sky-500/10 p-3">
                                <p className="text-sm font-medium text-sky-700 dark:text-sky-300">Stayed Correct</p>
                                <p className="mt-1 text-xl font-bold text-foreground">{detailedTransitionMetrics.stayed_correct?.count ?? 0}</p>
                                <p className="text-sm text-foreground/60 mt-1">
                                  {formatPercentValue(detailedTransitionMetrics.stayed_correct?.percent)} of matched pairs
                                </p>
                              </div>
                              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Stayed Incorrect</p>
                                <p className="mt-1 text-xl font-bold text-foreground">{detailedTransitionMetrics.stayed_incorrect?.count ?? 0}</p>
                                <p className="text-sm text-foreground/60 mt-1">
                                  {formatPercentValue(detailedTransitionMetrics.stayed_incorrect?.percent)} of matched pairs
                                </p>
                              </div>
                              <div className="rounded-lg border border-border/50 bg-secondary/25 p-3">
                                <p className="text-sm font-medium text-foreground">No Change</p>
                                <p className="mt-1 text-xl font-bold text-foreground">
                                  {(detailedTransitionMetrics.stayed_correct?.count ?? 0) + (detailedTransitionMetrics.stayed_incorrect?.count ?? 0)}
                                </p>
                                <p className="text-sm text-foreground/60 mt-1">
                                  {formatPercentValue(
                                    (detailedTransitionMetrics.total_pairs ?? 0) > 0
                                      ? (((detailedTransitionMetrics.stayed_correct?.count ?? 0) + (detailedTransitionMetrics.stayed_incorrect?.count ?? 0)) /
                                          (detailedTransitionMetrics.total_pairs ?? 1)) *
                                          100
                                      : null
                                  )}{' '}
                                  of matched pairs
                                </p>
                              </div>
                            </div>
                            {analysis?.quality_transitions ? (
                              <div className="rounded-lg border border-border/40 bg-secondary/20 p-3">
                                <p className="text-sm font-medium text-foreground">Quality transition snapshot</p>
                                <p className="text-sm text-foreground/70 mt-1">
                                  Improved: {analysis.quality_transitions.improved ?? 0}, worsened: {analysis.quality_transitions.worsened ?? 0}, unchanged: {analysis.quality_transitions.unchanged ?? 0}, moved to fully correct: {analysis.quality_transitions.moved_to_fully_correct ?? 0}.
                                </p>
                              </div>
                            ) : null}
                            <div className="rounded-lg border border-dashed border-border/60 bg-background/50 p-3">
                              <p className="text-sm font-medium text-foreground">Not currently stored</p>
                              <p className="text-sm text-foreground/70 mt-1">
                                Transition-specific misconception clusters are not currently stored as separate dedicated fields; use the misconception comparison section below for that view.
                              </p>
                            </div>
                            {Array.isArray(analysis?.per_question_transition_breakdown) && analysis.per_question_transition_breakdown.length > 0 ? (
                              <div className="space-y-3">
                                <p className="text-sm font-medium text-foreground">Per-question transition breakdown</p>
                                {analysis.per_question_transition_breakdown.map((item: any) => (
                                  <div key={item.question_id} className="rounded-lg border border-border/40 bg-background/60 p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                      <p className="text-sm font-semibold text-foreground">Q{item.position}</p>
                                      <Badge variant="outline" className="text-sm">
                                        {item.total_pairs ?? 0} matched pair{(item.total_pairs ?? 0) === 1 ? '' : 's'}
                                      </Badge>
                                    </div>
                                    <div className="mt-3 grid gap-3 md:grid-cols-5">
                                      <div className="rounded-md bg-secondary/20 p-3">
                                        <p className="text-xs uppercase tracking-wide text-foreground/55">Incorrect → Correct</p>
                                        <p className="mt-1 text-lg font-bold text-foreground">{item.incorrect_to_correct?.count ?? 0}</p>
                                        <p className="text-sm text-foreground/60">{formatPercentValue(item.incorrect_to_correct?.percent)}</p>
                                      </div>
                                      <div className="rounded-md bg-secondary/20 p-3">
                                        <p className="text-xs uppercase tracking-wide text-foreground/55">Correct → Incorrect</p>
                                        <p className="mt-1 text-lg font-bold text-foreground">{item.correct_to_incorrect?.count ?? 0}</p>
                                        <p className="text-sm text-foreground/60">{formatPercentValue(item.correct_to_incorrect?.percent)}</p>
                                      </div>
                                      <div className="rounded-md bg-secondary/20 p-3">
                                        <p className="text-xs uppercase tracking-wide text-foreground/55">Stayed Correct</p>
                                        <p className="mt-1 text-lg font-bold text-foreground">{item.stayed_correct?.count ?? 0}</p>
                                        <p className="text-sm text-foreground/60">{formatPercentValue(item.stayed_correct?.percent)}</p>
                                      </div>
                                      <div className="rounded-md bg-secondary/20 p-3">
                                        <p className="text-xs uppercase tracking-wide text-foreground/55">Stayed Incorrect</p>
                                        <p className="mt-1 text-lg font-bold text-foreground">{item.stayed_incorrect?.count ?? 0}</p>
                                        <p className="text-sm text-foreground/60">{formatPercentValue(item.stayed_incorrect?.percent)}</p>
                                      </div>
                                      <div className="rounded-md bg-secondary/20 p-3">
                                        <p className="text-xs uppercase tracking-wide text-foreground/55">No Change</p>
                                        <p className="mt-1 text-lg font-bold text-foreground">{item.no_change?.count ?? 0}</p>
                                        <p className="text-sm text-foreground/60">{formatPercentValue(item.no_change?.percent)}</p>
                                      </div>
                                    </div>
                                    {item.examples ? (
                                      <details className="mt-3">
                                        <summary className="cursor-pointer text-sm text-primary">Show representative examples</summary>
                                        <div className="mt-3 space-y-3">
                                          {(['incorrect_to_correct', 'correct_to_incorrect', 'stayed_correct', 'stayed_incorrect'] as const).map((bucket) => {
                                            const examples = Array.isArray(item.examples?.[bucket]) ? item.examples[bucket] : []
                                            if (examples.length === 0) return null
                                            return (
                                              <div key={bucket} className="rounded-md border border-border/40 bg-secondary/15 p-3">
                                                <p className="text-sm font-medium text-foreground">
                                                  {bucket === 'incorrect_to_correct'
                                                    ? 'Incorrect → Correct'
                                                    : bucket === 'correct_to_incorrect'
                                                      ? 'Correct → Incorrect'
                                                      : bucket === 'stayed_correct'
                                                        ? 'Stayed Correct'
                                                        : 'Stayed Incorrect'}
                                                </p>
                                                <div className="mt-2 space-y-2">
                                                  {examples.map((example: any, idx: number) => (
                                                    <div key={`${bucket}-${idx}`} className="rounded-md bg-background/70 p-3">
                                                      <p className="text-xs uppercase tracking-wide text-foreground/55">
                                                        Round 1 label: {example.round1_label || 'N/A'} • Round 2 label: {example.round2_label || 'N/A'}
                                                      </p>
                                                      <p className="mt-2 text-sm text-foreground/80">
                                                        <span className="font-medium text-foreground">Round 1:</span> {example.round1_answer}
                                                      </p>
                                                      <p className="mt-1 text-sm text-foreground/80">
                                                        <span className="font-medium text-foreground">Round 2:</span> {example.round2_answer}
                                                      </p>
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>
                                            )
                                          })}
                                        </div>
                                      </details>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <p className="text-sm text-foreground/70">
                            Detailed transition counts are not available in this saved analysis payload.
                          </p>
                        )}
                      </div>
                    </details>
                  </>
                ) : null}
              </Card>
            )}

            {isTreatmentRound1View ? (
              <details className="rounded-xl border border-border/60 bg-background">
                <summary className="cursor-pointer list-none p-6">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">View detailed per-question diagnostics</h3>
                      <p className="text-sm text-foreground/70">
                        Optional deeper review of question-level analysis before you open revision.
                      </p>
                    </div>
                    <Badge variant="outline" className="text-sm">Optional detail</Badge>
                  </div>
                </summary>
                <div className="px-6 pb-6">
                  <Card className="p-6">
                    <h3 className="text-lg font-semibold text-foreground mb-4">Per-Question Diagnostics (Round 1)</h3>
                    <p className="text-sm text-foreground/70 mb-4">
                      Detailed question-level analysis is available here if you want it, but the main treatment workflow should use the repair priorities above.
                    </p>
                    <div className="grid md:grid-cols-3 gap-4 mb-6">
                      <div className="p-4 rounded-lg bg-secondary/30">
                        <p className="text-sm text-foreground/60 mb-1">Total submissions</p>
                        <p className="text-2xl font-bold text-foreground">{analysis.totals?.total_submissions ?? 0}</p>
                      </div>
                      <div className="p-4 rounded-lg bg-secondary/30">
                        <p className="text-sm text-foreground/60 mb-1">% correct (labeled)</p>
                        <p className="text-2xl font-bold text-foreground">
                          {(analysis.totals?.percent_fully_correct ?? analysis.totals?.percent_correct) === null ||
                          (analysis.totals?.percent_fully_correct ?? analysis.totals?.percent_correct) === undefined
                            ? 'N/A'
                            : `${analysis.totals?.percent_fully_correct ?? analysis.totals.percent_correct}%`}
                        </p>
                      </div>
                      <div className="p-4 rounded-lg bg-secondary/30">
                        <p className="text-sm text-foreground/60 mb-1">Avg confidence</p>
                        <p className="text-2xl font-bold text-foreground">
                          {analysis.totals?.avg_confidence === null || analysis.totals?.avg_confidence === undefined
                            ? 'N/A'
                            : Number(analysis.totals.avg_confidence).toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-4">
                      {(analysis.per_question || []).map((q: any) => (
                        <Card key={q.question_id} className="p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-lg font-semibold text-foreground mb-1">Q{q.position}</p>
                              <p className="text-sm text-foreground/70">Responses: {q.submission_count ?? 0}</p>
                            </div>
                            <Badge variant="outline" className="text-sm">
                              {(q.percent_fully_correct ?? q.percent_correct) === null || (q.percent_fully_correct ?? q.percent_correct) === undefined
                                ? 'Accuracy N/A'
                                : `${q.percent_fully_correct ?? q.percent_correct}% fully correct`}
                            </Badge>
                          </div>
                          <p className="text-sm text-foreground/70">
                            Avg confidence: {q.avg_confidence === null || q.avg_confidence === undefined ? 'N/A' : Number(q.avg_confidence).toFixed(2)}
                          </p>
                          {q.teacher_interpretation && (
                            <div className="mt-4 rounded-lg border border-border/50 bg-background/70 p-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-foreground/55">Teacher interpretation</p>
                              <p className="mt-1 text-sm leading-6 text-foreground/85">{q.teacher_interpretation}</p>
                            </div>
                          )}
                          {q.suggested_teacher_action && (
                            <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-foreground/55">Recommended teacher move</p>
                              <p className="mt-1 text-sm leading-6 text-foreground/90">{q.suggested_teacher_action}</p>
                            </div>
                          )}
                          {q.top_misconceptions && q.top_misconceptions.length > 0 && (
                            <div className="mt-3">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <p className="text-base font-medium text-foreground">Instructional misconceptions to address</p>
                                <Badge variant="secondary" className="text-sm">Treatment support</Badge>
                              </div>
                              <div className="grid gap-3">
                                {q.top_misconceptions.map((w: any, idx: number) => (
                                  <MisconceptionCard
                                    key={`${q.question_id}-${idx}`}
                                    item={w}
                                    question={q}
                                    condition={session.condition}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                        </Card>
                      ))}
                    </div>
                  </Card>
                </div>
              </details>
            ) : (
            <Card className="p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">
                {isTreatmentRound1View ? 'Round 1 Repair Priorities' : `Per-Question Summary (Round ${analysis.round_number})`}
              </h3>
              <p className="text-sm text-foreground/70 mb-4">{analysis.summary_text}</p>
              <div className="grid md:grid-cols-3 gap-4 mb-6">
                <div className="p-4 rounded-lg bg-secondary/30">
                  <p className="text-sm text-foreground/60 mb-1">Total submissions</p>
                  <p className="text-2xl font-bold text-foreground">{analysis.totals?.total_submissions ?? 0}</p>
                </div>
                <div className="p-4 rounded-lg bg-secondary/30">
                  <p className="text-sm text-foreground/60 mb-1">% correct (labeled)</p>
                  <p className="text-2xl font-bold text-foreground">
                    {(analysis.totals?.percent_fully_correct ?? analysis.totals?.percent_correct) === null ||
                    (analysis.totals?.percent_fully_correct ?? analysis.totals?.percent_correct) === undefined
                      ? 'N/A'
                      : `${analysis.totals?.percent_fully_correct ?? analysis.totals.percent_correct}%`}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-secondary/30">
                  <p className="text-sm text-foreground/60 mb-1">Avg confidence</p>
                  <p className="text-2xl font-bold text-foreground">
                    {analysis.totals?.avg_confidence === null || analysis.totals?.avg_confidence === undefined
                      ? 'N/A'
                      : Number(analysis.totals.avg_confidence).toFixed(2)}
                  </p>
                </div>
              </div>
              <div className="grid gap-4">
                {(analysis.per_question || []).map((q: any) => (
                  <Card key={q.question_id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-semibold text-foreground mb-1">Q{q.position}</p>
                        <p className="text-sm text-foreground/70">Responses: {q.submission_count ?? 0}</p>
                      </div>
                      <Badge variant="outline" className="text-sm">
                        {(q.percent_fully_correct ?? q.percent_correct) === null || (q.percent_fully_correct ?? q.percent_correct) === undefined
                          ? 'Accuracy N/A'
                          : `${q.percent_fully_correct ?? q.percent_correct}% fully correct`}
                      </Badge>
                    </div>
                    {session.condition === 'baseline' && q.response_quality_breakdown ? (
                      <div className="mt-3 bg-secondary/20 p-3 rounded-lg">
                        <p className="text-sm font-medium text-foreground mb-2">Response Quality Breakdown</p>
                        <div className="grid sm:grid-cols-2 gap-2 text-sm text-foreground/80">
                          <div>Fully correct: {q.response_quality_breakdown.fully_correct}</div>
                          <div>Partially correct: {q.response_quality_breakdown.partially_correct}</div>
                          <div>Relevant but incomplete: {q.response_quality_breakdown.relevant_incomplete}</div>
                          <div>Misconception: {q.response_quality_breakdown.misconception}</div>
                          <div>Unclear / off-topic: {q.response_quality_breakdown.unclear}</div>
                        </div>
                        <p className="text-sm text-foreground/60 mt-2">
                          % fully correct: {(q.percent_fully_correct ?? q.percent_correct) === null || (q.percent_fully_correct ?? q.percent_correct) === undefined ? 'N/A' : `${q.percent_fully_correct ?? q.percent_correct}%`}
                        </p>
                      </div>
                    ) : !isTreatmentRound1View ? (
                      <p className="text-sm text-foreground/70">
                        % Fully correct: {(q.percent_fully_correct ?? q.percent_correct) === null || (q.percent_fully_correct ?? q.percent_correct) === undefined ? 'N/A' : `${q.percent_fully_correct ?? q.percent_correct}%`}
                      </p>
                    ) : null}
                    <p className="text-sm text-foreground/70">
                      Avg confidence: {q.avg_confidence === null || q.avg_confidence === undefined ? 'N/A' : Number(q.avg_confidence).toFixed(2)}
                    </p>
                    {q.evaluation_breakdown && !isTreatmentRound1View && (
                      <p className="text-sm text-foreground/60 mt-2">
                        Breakdown: C {q.evaluation_breakdown.correct}, MC {q.evaluation_breakdown.mostly_correct}, PC {q.evaluation_breakdown.partially_correct}, I {q.evaluation_breakdown.incorrect}, U {q.evaluation_breakdown.unclear}
                      </p>
                    )}
                    {q.teacher_interpretation && (
                      <div className="mt-4 rounded-lg border border-border/50 bg-background/70 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-foreground/55">Teacher interpretation</p>
                        <p className="mt-1 text-sm leading-6 text-foreground/85">{q.teacher_interpretation}</p>
                      </div>
                    )}
                    {q.suggested_teacher_action && (
                      <div
                        className={
                          session.condition === 'treatment'
                            ? 'mt-3 rounded-lg border border-primary/20 bg-primary/5 p-4'
                            : 'mt-3 rounded-lg border border-border/40 bg-background/60 p-4'
                        }
                      >
                        <p className="text-xs font-semibold uppercase tracking-wide text-foreground/55">
                          {session.condition === 'treatment' ? 'Recommended teacher move' : 'Suggested teacher action'}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-foreground/90">{q.suggested_teacher_action}</p>
                      </div>
                    )}
                    {session.condition === 'baseline' && q.representative_examples && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm text-primary">Show representative examples</summary>
                        <pre className="mt-2 text-sm whitespace-pre-wrap bg-secondary/30 p-3 rounded-lg">
                          {JSON.stringify(q.representative_examples, null, 2)}
                        </pre>
                      </details>
                    )}
                    {q.top_misconceptions && q.top_misconceptions.length > 0 && (
                      <div className="mt-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-base font-medium text-foreground">
                            {session.condition === 'treatment' ? 'Instructional misconceptions to address' : 'Top misconceptions'}
                          </p>
                          {session.condition === 'treatment' && (
                            <Badge variant="secondary" className="text-sm">Treatment support</Badge>
                          )}
                        </div>
                        <div className="grid gap-3">
                          {q.top_misconceptions.map((w: any, idx: number) => (
                            <MisconceptionCard
                              key={`${q.question_id}-${idx}`}
                              item={w}
                              question={q}
                              condition={session.condition}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </Card>
            )}

            {isTreatmentFinalView && analysis.misconception_comparison && analysis.misconception_comparison.length > 0 && (
              <Card className="p-6">
                <h3 className="text-lg font-semibold text-foreground mb-4">Misconception Changes (Round 1 vs Round 2)</h3>
                <p className="text-sm text-foreground/60 mb-4">
                  Each question is grouped into teacher-facing categories so you can see what was resolved, what declined, and what still needs attention.
                </p>
                <div className="space-y-4">
                  {analysis.misconception_comparison.map((mc: any) => {
                    const { groupEntries, hasAny } = getComparisonGroups(mc)
                    const summaryLine = mc.summary_line || 'No major misconception changes detected.'
                    const actionLine = formatQuestionActionLine(mc)
                    const computedCounts: Record<MisconceptionGroupKey, number> = {
                      resolved: groupEntries.find((g) => g.key === 'resolved')?.items.length || 0,
                      reduced: groupEntries.find((g) => g.key === 'reduced')?.items.length || 0,
                      persistent: groupEntries.find((g) => g.key === 'persistent')?.items.length || 0,
                      emerging: groupEntries.find((g) => g.key === 'emerging')?.items.length || 0,
                    }
                    const rawCounts = mc.counts as Partial<Record<MisconceptionGroupKey, unknown>> | undefined
                    const counts: Record<MisconceptionGroupKey, number> = rawCounts
                      ? {
                          resolved: typeof rawCounts.resolved === 'number' ? rawCounts.resolved : computedCounts.resolved,
                          reduced: typeof rawCounts.reduced === 'number' ? rawCounts.reduced : computedCounts.reduced,
                          persistent: typeof rawCounts.persistent === 'number' ? rawCounts.persistent : computedCounts.persistent,
                          emerging: typeof rawCounts.emerging === 'number' ? rawCounts.emerging : computedCounts.emerging,
                        }
                      : computedCounts

                    return (
                      <div key={mc.question_id} className="rounded-xl border border-border/60 bg-secondary/20 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground">Q{mc.position}</p>
                            <p className="text-sm text-foreground/70 mt-1">{summaryLine}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(counts).map(([key, value]) =>
                              value > 0 ? (
                                <Badge
                                  key={key}
                                  variant="outline"
                                  className={MISCONCEPTION_GROUP_META[key as MisconceptionGroupKey].badgeClassName}
                                >
                                  {MISCONCEPTION_GROUP_META[key as MisconceptionGroupKey].label}: {value}
                                </Badge>
                              ) : null
                            )}
                          </div>
                        </div>

                        <div className="mt-4 rounded-lg border border-border/40 bg-background/70 p-3">
                          <p className="text-sm font-semibold uppercase tracking-wide text-foreground/55">Suggested action</p>
                          <p className="text-sm text-foreground/80 mt-1">{actionLine}</p>
                        </div>

                        {!hasAny ? (
                          <p className="text-sm text-foreground/60 mt-4">No major misconception changes detected.</p>
                        ) : (
                          <div className="mt-4 space-y-3">
                            {groupEntries.map((group) =>
                              group.items.length > 0 ? (
                                <section key={group.key} className={`rounded-lg border ${group.meta.borderClassName} bg-background/60 p-3`}>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline" className={group.meta.badgeClassName}>
                                      {group.meta.label}
                                    </Badge>
                                    <span className="text-sm text-foreground/60">{group.meta.hint}</span>
                                    <span className="ml-auto text-sm text-foreground/50">{group.items.length} item(s)</span>
                                  </div>

                                  <div className="mt-3 space-y-2">
                                    {group.items.map((d: MisconceptionDelta, idx: number) => {
                                      const delta = typeof d.delta === 'number' ? d.delta : d.round2 - d.round1
                                      const deltaLabel = delta > 0 ? `+${delta}` : `${delta}`
                                      const direction =
                                        group.key === 'resolved'
                                          ? 'Resolved'
                                          : group.key === 'reduced'
                                            ? 'Reduced'
                                            : group.key === 'persistent'
                                              ? 'Persistent'
                                              : 'New'

                                      return (
                                        <div key={`${d.label}-${idx}`} className="rounded-md border border-border/40 bg-secondary/20 px-3 py-2">
                                          <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                              <p className="text-sm font-medium text-foreground break-words">{d.label}</p>
                                              <p className="text-sm text-foreground/60 mt-1">
                                                Round 1 {d.round1} → Round 2 {d.round2}
                                              </p>
                                            </div>
                                            <div className="flex shrink-0 flex-col items-end gap-1">
                                              <Badge
                                                variant={group.key === 'persistent' ? 'destructive' : group.key === 'emerging' ? 'secondary' : 'outline'}
                                                className="text-[11px]"
                                              >
                                                {direction}
                                              </Badge>
                                              <span className="text-sm font-medium text-foreground/70 tabular-nums">{deltaLabel}</span>
                                            </div>
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </section>
                              ) : null
                            )}
                          </div>
                        )}

                        <details className="mt-4">
                          <summary className="cursor-pointer text-sm text-primary">Show raw deltas</summary>
                          <pre className="mt-2 text-sm whitespace-pre-wrap bg-secondary/30 p-3 rounded-lg">
                            {JSON.stringify(
                              {
                                question_id: mc.question_id,
                                position: mc.position,
                                summary_line: mc.summary_line,
                                suggested_action: mc.suggested_action,
                                counts: mc.counts,
                                grouped_deltas: mc.grouped_deltas,
                                deltas: mc.deltas,
                              },
                              null,
                              2
                            )}
                          </pre>
                        </details>
                      </div>
                    )
                  })}
                </div>
              </Card>
            )}

            {analysis.compare_to_round_1 && (
              <Card className="p-6">
                <h3 className="text-lg font-semibold text-foreground mb-4">Round 1 Snapshot (for export)</h3>
                <p className="text-sm text-foreground/70">
                  Included under `compare_to_round_1` so you can later plot misconception graphs and compare patterns.
                </p>
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-primary">Show raw JSON</summary>
                  <pre className="mt-3 text-sm whitespace-pre-wrap bg-secondary/30 p-3 rounded-lg">{JSON.stringify(analysis.compare_to_round_1, null, 2)}</pre>
                </details>
              </Card>
            )}

            <div className="flex gap-4">
              <Link href={`/teacher/session/${sessionId}/export`} className="flex-1">
                <Button variant="outline" className="w-full">Export Data</Button>
              </Link>
              <Button onClick={() => handleAnalyze({ forceRegenerate: true })} disabled={analyzing} className="flex-1">
                {analyzing ? 'Analyzing...' : 'Regenerate Analysis'}
              </Button>
            </div>

            <AnalysisDashboard analysis={analysis} />
          </div>
        )}
      </div>
    </main>
  )
}
