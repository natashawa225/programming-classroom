'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type {
  AttemptType,
  LiveQuestionAnalysis,
  Response,
  Session,
  SessionParticipant,
  SessionQuestion,
} from '@/lib/types/database'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { usePostgresChanges } from '@/hooks/use-postgres-changes'
import { TeacherLogoutButton } from '@/components/teacher-logout-button'
import {
  clamp,
  getClusterBucketX,
  getClusterPatternColor,
  resolveRenderedCluster,
  resolveRenderedClusters,
  type UnderstandingBucket,
} from '@/lib/live-cluster-rendering'
import { ClusterEvidenceDrawer } from '@/components/cluster-evidence-drawer'
import { AgentSurfacingBanner } from '@/components/agent-surfacing-banner'
import type { BoundedAgentObservation } from '@/lib/services/bounded-agency-service'
import {
  LayoutDashboard,
  Loader2,
  RefreshCw,
} from 'lucide-react'

type Props = {
  initialSession: Session
  initialQuestions: SessionQuestion[]
  initialParticipants: SessionParticipant[]
  initialResponses: Response[]
  initialLiveQuestionAnalyses: LiveQuestionAnalysis[]
  initialAssignedParticipantCount: number
  initialJoinedParticipantCount: number
  initialCurrentQuestionRespondentCount: number
}

type LiveAnalysisPayload = {
  version: 'live_question_clusters_v1' | 'live_question_clusters_v2'
  question_prompt: string
  attempt_type: AttemptType
  total_responses: number
  cluster_count: number
  source: 'openai' | 'fallback'
  fallback_reason?: string | null
  fallback_debug?: {
    error?: string | null
    raw_excerpt?: string | null
  } | null
  clusters: Array<{
    cluster_id: string
    label: string
    summary: string
    count: number
    average_confidence: number
    representative_answers: string[]
    response_ids: string[]
    evidence_spans?: Array<{ response_id: string; exact_quote: string }>
    reference_alignment?: {
      alignment_level?: string
      explanation?: string
      aligned_reference_ids?: string[]
    }
    conceptual_alignment?: number
    understanding_bucket?: UnderstandingBucket
  }>
  translations?: Record<
    string,
    {
      translationStatus: 'translated' | 'untranslated_english'
      originalText: string
      translatedText: string
      detectedLanguage: string
      confidence: number
    }
  >
}

type AnalysisStatus = 'idle' | 'loading' | 'success' | 'failed'
type BubblePlacement = {
  x: number
  y: number
  radius: number
}

const CHART_VIEWBOX_WIDTH = 1200
const CHART_VIEWBOX_HEIGHT = 620
const CHART_AXIS_LEFT = 84
const CHART_AXIS_RIGHT = 1120
const CHART_AXIS_BOTTOM = 544
const CHART_LANE_TOP = 44
const CHART_LANE_HEIGHT = 500
const CHART_LANE_GAP = 28
const CHART_LANE_WIDTH = 344

function mergeByKey<T>(items: T[], item: T, keyOf: (value: T) => string) {
  const key = keyOf(item)
  const index = items.findIndex((row) => keyOf(row) === key)
  if (index === -1) return [...items, item]
  const next = items.slice()
  next[index] = item
  return next
}

function parseAnalysis(value: LiveQuestionAnalysis | null | undefined): LiveAnalysisPayload | null {
  const raw = value?.analysis_json
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).clusters)) return null
  return raw as unknown as LiveAnalysisPayload
}

function getPhaseLabel(session: Session) {
  switch (session.live_phase) {
    case 'not_started':
      return 'Not started'
    case 'question_initial_open':
      return 'Collecting initial answers'
    case 'question_initial_closed':
      return 'Initial clustering ready'
    case 'question_revision_open':
      return 'Collecting revisions'
    case 'question_revision_closed':
      return 'Revision clustering ready'
    case 'session_completed':
      return 'Session completed'
    default:
      return session.live_phase
  }
}

function getCurrentAttemptType(session: Session): AttemptType {
  return session.live_phase === 'question_revision_open' || session.live_phase === 'question_revision_closed'
    ? 'revision'
    : 'initial'
}

function getResponseAttemptType(response: Response): AttemptType {
  if (response.attempt_type === 'revision' || response.round_number === 2 || response.question_type === 'revision') {
    return 'revision'
  }
  return 'initial'
}

function isQuestionOpen(session: Session) {
  return session.live_phase === 'question_initial_open' || session.live_phase === 'question_revision_open'
}

function getClassSnapshot(analysis: LiveAnalysisPayload | null, currentResponses: Response[]) {
  const sourceCount = analysis?.total_responses ?? currentResponses.length
  const avgConfidence =
    sourceCount > 0
      ? (analysis
          ? analysis.clusters.reduce((sum, cluster) => sum + cluster.average_confidence * cluster.count, 0) / sourceCount
          : currentResponses.reduce((sum, response) => sum + response.confidence, 0) / sourceCount)
      : 0

  return {
    totalResponses: sourceCount,
    averageConfidence: sourceCount > 0 ? avgConfidence : 0,
    clusterCount: analysis?.cluster_count ?? 0,
  }
}

function formatResponsesLabel(count: number) {
  return `${count} ${count === 1 ? 'response' : 'responses'}`
}

function getBubbleRadius(count: number, maxCount: number) {
  if (maxCount <= 1) return 86
  const normalized = Math.sqrt(count / maxCount)
  return clamp(60 + normalized * 72, 60, 132)
}

/**
 * The vertical axis (confidence) and bubble size (response count) are always
 * purely descriptive — neither ever encodes correctness.
 *
 * The horizontal axis is conditional:
 * - `neutralHorizontalOrder: true` — clusters are just spread left-to-right by
 *   size (largest = Pattern 1), no meaning beyond "a different pattern than
 *   its neighbor." This is the treatment condition's initial round, where we
 *   deliberately avoid biasing early discussion with a correctness framing.
 * - `neutralHorizontalOrder: false` — horizontal position reflects each
 *   cluster's resolved understanding bucket (needs_attention/mixed_reasoning/
 *   strong_alignment/unclear) via getClusterBucketX. This applies to baseline
 *   sessions and the revision round of treatment sessions, where seeing a
 *   correctness-oriented spread is the point. Clusters without real alignment
 *   data from the clustering pipeline resolve to the 'unclear' center rather
 *   than being placed on a side without evidence.
 */
function getClusterMapPlacements(
  clusters: LiveAnalysisPayload['clusters'],
  width: number,
  height: number,
  options?: { neutralHorizontalOrder?: boolean }
) {
  if (!clusters.length || width <= 0 || height <= 0) return new Map<string, BubblePlacement>()

  const neutralHorizontalOrder = options?.neutralHorizontalOrder ?? true
  const sorted = clusters.slice().sort((a, b) => b.count - a.count)
  const maxCount = sorted.reduce((max, cluster) => Math.max(max, cluster.count), 0)
  const padding = 36

  const nodes = sorted.map((cluster, index) => {
    const radius = getBubbleRadius(cluster.count, maxCount)
    const normalizedConfidence = clamp((cluster.average_confidence - 1) / 4, 0, 1)
    const baseY = CHART_AXIS_BOTTOM - normalizedConfidence * (CHART_AXIS_BOTTOM - 92)

    let x: number
    if (neutralHorizontalOrder) {
      const slotWidth = (CHART_AXIS_RIGHT - CHART_AXIS_LEFT) / (sorted.length + 1)
      x = CHART_AXIS_LEFT + slotWidth * (index + 1)
    } else {
      x = CHART_AXIS_LEFT + getClusterBucketX(cluster) * (CHART_AXIS_RIGHT - CHART_AXIS_LEFT)
    }
    const y = baseY

    return {
      cluster_id: cluster.cluster_id,
      radius,
      x: clamp(x, padding + radius, width - padding - radius),
      y: clamp(y, padding + radius, height - padding - radius),
    }
  })

  // Deterministic minimum-separation constraint / collision resolution
  const iterations = 100
  const gap = 16
  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i]
        const b = nodes[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let dist = Math.sqrt(dx * dx + dy * dy)
        const minDist = a.radius + b.radius + gap

        if (dist < minDist) {
          if (dist < 1e-4) {
            const angle = (i * 1.5 + j * 0.7) % (Math.PI * 2)
            dx = Math.cos(angle)
            dy = Math.sin(angle)
            dist = 1
          }
          const overlap = minDist - dist
          let nx = dx / dist
          let ny = dy / dist

          if (Math.abs(ny) < 0.2) {
            ny = i % 2 === 0 ? 0.4 : -0.4
            const len = Math.sqrt(nx * nx + ny * ny)
            nx /= len
            ny /= len
          }

          const moveX = nx * (overlap / 2)
          const moveY = ny * (overlap / 2)

          a.x -= moveX
          a.y -= moveY
          b.x += moveX
          b.y += moveY
        }
      }
    }
    for (const node of nodes) {
      node.x = clamp(node.x, padding + node.radius, width - padding - node.radius)
      node.y = clamp(node.y, padding + node.radius, height - padding - node.radius)
    }
  }

  const placements = new Map<string, BubblePlacement>()
  for (const node of nodes) {
    placements.set(node.cluster_id, {
      radius: node.radius,
      x: node.x,
      y: node.y,
    })
  }

  return placements
}

function formatParticipantDisplay(sp?: { anonymized_label?: string; student_name?: string | null } | null) {
  if (!sp) return 'Participant'
  const label = sp.anonymized_label || ''
  const name = sp.student_name ? sp.student_name.trim() : ''
  if (label && name) return `${label}  ${name}`
  return label || name || 'Participant'
}

function getRepresentativeAnswers(cluster: LiveAnalysisPayload['clusters'][number] | null) {
  return (cluster?.representative_answers ?? []).filter((answer) => answer.trim().length > 0).slice(0, 3)
}

function MiniStat({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="min-w-0 rounded-xl border border-[rgba(123,175,212,0.16)] bg-white/92 px-3 py-2 text-foreground shadow-sm">
      <p className="text-[11px] uppercase tracking-[0.18em] text-foreground/42">
        {label}
      </p>
      <div className="mt-1 text-lg font-semibold tracking-tight">
        {value}
      </div>
    </div>
  )
}

export default function SessionDetailClient({
  initialSession,
  initialQuestions,
  initialParticipants,
  initialResponses,
  initialLiveQuestionAnalyses,
  initialAssignedParticipantCount,
  initialJoinedParticipantCount,
  initialCurrentQuestionRespondentCount,
}: Props) {
  const router = useRouter()
  const sessionId = initialSession.id
  const initialViewedQuestion =
    initialQuestions.find((question) => question.position === initialSession.current_question_position) ||
    initialQuestions[0] ||
    null
  const [session, setSession] = useState(initialSession)
  const [participants, setParticipants] = useState(initialParticipants)
  const [responses, setResponses] = useState(initialResponses)
  const [liveQuestionAnalyses, setLiveQuestionAnalyses] = useState(initialLiveQuestionAnalyses)
  const [assignedParticipantCount, setAssignedParticipantCount] = useState(initialAssignedParticipantCount)
  const [joinedParticipantCount, setJoinedParticipantCount] = useState(initialJoinedParticipantCount)
  const [currentQuestionRespondentCount, setCurrentQuestionRespondentCount] = useState(initialCurrentQuestionRespondentCount)
  const [timerInput, setTimerInput] = useState('')
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null)
  const [viewedQuestionId, setViewedQuestionId] = useState<string | null>(initialViewedQuestion?.question_id ?? null)
  const [selectedInitialClusterId, setSelectedInitialClusterId] = useState<string | null>(null)
  const [selectedRevisionClusterId, setSelectedRevisionClusterId] = useState<string | null>(null)
  const [hoveredClusterId, setHoveredClusterId] = useState<string | null>(null)
  const [compareMode, setCompareMode] = useState<'initial' | 'revision'>('initial')
  const [showSelectedGroupResponses, setShowSelectedGroupResponses] = useState(false)
  const [showRawResponses, setShowRawResponses] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [analysisStatusByKey, setAnalysisStatusByKey] = useState<Record<string, AnalysisStatus>>({})
  const [inspectingClusterId, setInspectingClusterId] = useState<string | null>(null)
  const [boundedObservations, setBoundedObservations] = useState<BoundedAgentObservation[]>([])

  const questions = useMemo(() => initialQuestions.slice().sort((a, b) => a.position - b.position), [initialQuestions])
  const realtimeTables = useMemo(
    () => [
      { table: 'sessions', event: '*' as const, filter: `id=eq.${sessionId}` },
      { table: 'session_participants', event: '*' as const, filter: `session_id=eq.${sessionId}` },
      { table: 'responses', event: '*' as const, filter: `session_id=eq.${sessionId}` },
      { table: 'live_question_analyses', event: '*' as const, filter: `session_id=eq.${sessionId}` },
    ],
    [sessionId]
  )

  const currentQuestion =
    questions.find((question) => question.position === session.current_question_position) || questions[0] || null
  const previousCurrentQuestionIdRef = useRef<string | null>(currentQuestion?.question_id ?? null)
  const viewedQuestion = questions.find((question) => question.question_id === viewedQuestionId) || currentQuestion || null
  const isViewingCurrentQuestion = Boolean(
    currentQuestion &&
      viewedQuestion &&
      currentQuestion.question_id === viewedQuestion.question_id
  )
  const isLastQuestion = Boolean(currentQuestion && currentQuestion.position === questions.length)
  const attemptType = getCurrentAttemptType(session)


  const currentResponses = useMemo(() => {
    if (!currentQuestion) return []
    return responses
      .filter((response) => {
        return response.question_id === currentQuestion.question_id && getResponseAttemptType(response) === attemptType
      })
      .slice()
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
  }, [attemptType, currentQuestion, responses])

  const currentInitialAnalysis = useMemo(() => {
    if (!currentQuestion) return null
    return parseAnalysis(
      liveQuestionAnalyses.find((analysis) => {
        return analysis.question_id === currentQuestion.question_id && analysis.attempt_type === 'initial'
      }) || null
    )
  }, [currentQuestion, liveQuestionAnalyses])

  const currentRevisionAnalysis = useMemo(() => {
    if (!currentQuestion) return null
    return parseAnalysis(
      liveQuestionAnalyses.find((analysis) => {
        return analysis.question_id === currentQuestion.question_id && analysis.attempt_type === 'revision'
      }) || null
    )
  }, [currentQuestion, liveQuestionAnalyses])

  const viewedInitialAnalysis = useMemo(() => {
    if (!viewedQuestion) return null
    return parseAnalysis(
      liveQuestionAnalyses.find((analysis) => {
        return analysis.question_id === viewedQuestion.question_id && analysis.attempt_type === 'initial'
      }) || null
    )
  }, [liveQuestionAnalyses, viewedQuestion])

  const viewedRevisionAnalysis = useMemo(() => {
    if (!viewedQuestion) return null
    return parseAnalysis(
      liveQuestionAnalyses.find((analysis) => {
        return analysis.question_id === viewedQuestion.question_id && analysis.attempt_type === 'revision'
      }) || null
    )
  }, [liveQuestionAnalyses, viewedQuestion])

  const viewedRevisionResponseCount = useMemo(() => {
    if (!viewedQuestion) return 0
    return responses.filter((response) => {
      return response.question_id === viewedQuestion.question_id && getResponseAttemptType(response) === 'revision'
    }).length
  }, [responses, viewedQuestion])

  const canCompareRevision = Boolean(
    session.condition === 'treatment' &&
    (viewedRevisionAnalysis || (session.live_phase === 'session_completed' && viewedRevisionResponseCount > 0))
  )

  const viewedAttemptType: AttemptType =
    compareMode === 'revision' && canCompareRevision ? 'revision' : 'initial'
  const activeAnalysis = viewedAttemptType === 'revision' ? viewedRevisionAnalysis : viewedInitialAnalysis
  const currentAttemptAnalysis = attemptType === 'revision' ? currentRevisionAnalysis : currentInitialAnalysis
  const currentAnalysisKey = currentQuestion ? `${currentQuestion.question_id}:${attemptType}` : null
  const currentAnalysisStatus =
    (currentAnalysisKey ? analysisStatusByKey[currentAnalysisKey] : null) ||
    (currentAttemptAnalysis ? 'success' : 'idle')
  const viewedResponses = useMemo(() => {
    if (!viewedQuestion) return []
    return responses
      .filter((response) => {
        return response.question_id === viewedQuestion.question_id && getResponseAttemptType(response) === viewedAttemptType
      })
      .slice()
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
  }, [responses, viewedAttemptType, viewedQuestion])
  const viewedAnalysisStatus =
    (viewedQuestion ? analysisStatusByKey[`${viewedQuestion.question_id}:${viewedAttemptType}`] : null) ||
    (activeAnalysis ? 'success' : 'idle')
  const activeSelectedClusterId =
    compareMode === 'revision' && canCompareRevision ? selectedRevisionClusterId : selectedInitialClusterId
  const setActiveSelectedClusterId =
    compareMode === 'revision' && canCompareRevision ? setSelectedRevisionClusterId : setSelectedInitialClusterId
  const selectedCluster =
    activeAnalysis?.clusters.find((cluster) => cluster.cluster_id === activeSelectedClusterId) ||
    activeAnalysis?.clusters[0] ||
    null
  const selectedRenderedCluster =
    selectedCluster && activeAnalysis ? resolveRenderedCluster(selectedCluster, activeAnalysis.clusters) : null
  const classSnapshot = getClassSnapshot(activeAnalysis, viewedResponses)
  const selectedRepresentativeAnswers = getRepresentativeAnswers(selectedCluster)
  const selectedClusterResponses = useMemo(() => {
    if (!selectedCluster?.response_ids?.length) return []
    const selectedResponseIds = new Set(selectedCluster.response_ids)
    return viewedResponses.filter((response) => selectedResponseIds.has(response.response_id))
  }, [selectedCluster, viewedResponses])

  const isFetchingAgentObsRef = useRef(false)
  const isRefreshingLiveDataRef = useRef(false)

  const fetchAgentObservations = useCallback(
    async (targetQuestionId?: string | null) => {
      const qId = targetQuestionId || viewedQuestion?.question_id || currentQuestion?.question_id
      if (!sessionId || !qId || isFetchingAgentObsRef.current) return

      try {
        isFetchingAgentObsRef.current = true
        const response = await fetch('/api/teacher/agent-surfacing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ sessionId, questionId: qId }),
        })
        if (!response.ok) return
        const data = await response.json()
        const obsList = (data.observations || []) as BoundedAgentObservation[]
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.log(`[AgentSurfacing] fetched ${obsList.length} observations`)
        }
        setBoundedObservations(obsList)
      } catch (err) {
        console.error('[AgentSurfacing] error fetching observations', err)
      } finally {
        isFetchingAgentObsRef.current = false
      }
    },
    [sessionId, viewedQuestion?.question_id, currentQuestion?.question_id]
  )

  const refreshLiveData = useCallback(async () => {
    if (isRefreshingLiveDataRef.current) return
    try {
      isRefreshingLiveDataRef.current = true
      const response = await fetch('/api/teacher/session-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ sessionId }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to refresh live session data.')
      }

      setSession(payload?.session as Session)
      setAssignedParticipantCount(Number(payload?.assignedParticipantCount ?? 0))
      setJoinedParticipantCount(Number(payload?.joinedParticipantCount ?? 0))
      setCurrentQuestionRespondentCount(Number(payload?.currentQuestionRespondentCount ?? 0))
      setParticipants((payload?.participants || []) as SessionParticipant[])
      setResponses((payload?.responses || []) as Response[])
      setLiveQuestionAnalyses((payload?.liveQuestionAnalyses || []) as LiveQuestionAnalysis[])
      console.info(
        `[teacher-live] session_id=${sessionId} assigned=${Number(payload?.assignedParticipantCount ?? 0)} joined=${Number(payload?.joinedParticipantCount ?? 0)} current_question_id=${payload?.currentQuestionId || 'none'} responses=${Number(payload?.currentQuestionRespondentCount ?? 0)}`
      )
    } catch (err) {
      console.error('Error refreshing live session data:', err)
    } finally {
      isRefreshingLiveDataRef.current = false
    }
  }, [sessionId])

  useEffect(() => {
    setTimerInput(
      session.current_timer_seconds !== null && session.current_timer_seconds !== undefined
        ? String(session.current_timer_seconds)
        : currentQuestion?.timer_seconds
          ? String(currentQuestion.timer_seconds)
          : ''
    )
  }, [currentQuestion?.question_id, currentQuestion?.timer_seconds, session.current_timer_seconds])

  useEffect(() => {
    if (currentQuestion && !viewedQuestionId) {
      setViewedQuestionId(currentQuestion.question_id)
    }
  }, [currentQuestion, viewedQuestionId])

  useEffect(() => {
    const previousCurrentQuestionId = previousCurrentQuestionIdRef.current
    const nextCurrentQuestionId = currentQuestion?.question_id ?? null

    if (!nextCurrentQuestionId) return

    setViewedQuestionId((previousViewedQuestionId) => {
      if (!previousViewedQuestionId) return nextCurrentQuestionId
      if (!questions.some((question) => question.question_id === previousViewedQuestionId)) {
        return nextCurrentQuestionId
      }
      if (previousViewedQuestionId === previousCurrentQuestionId) {
        return nextCurrentQuestionId
      }
      return previousViewedQuestionId
    })

    previousCurrentQuestionIdRef.current = nextCurrentQuestionId
  }, [currentQuestion, questions])

  useEffect(() => {
    if (!isQuestionOpen(session) || !session.timer_started_at || !session.current_timer_seconds) {
      setSecondsRemaining(null)
      return
    }

    const tick = () => {
      const elapsed = Math.floor((Date.now() - new Date(session.timer_started_at as string).getTime()) / 1000)
      const remaining = Math.max(0, session.current_timer_seconds! - elapsed)
      setSecondsRemaining(remaining)
    }

    tick()
    const interval = window.setInterval(tick, 1000)
    return () => window.clearInterval(interval)
  }, [session.current_timer_seconds, session.timer_started_at, session.live_phase])

  useEffect(() => {
    void refreshLiveData()
  }, [refreshLiveData])

  useEffect(() => {
    void fetchAgentObservations()
  }, [fetchAgentObservations, liveQuestionAnalyses])

  useEffect(() => {
    if (!canCompareRevision && compareMode === 'revision') {
      setCompareMode('initial')
    }
  }, [canCompareRevision, compareMode])

  useEffect(() => {
    setShowSelectedGroupResponses(false)
  }, [activeSelectedClusterId, viewedAttemptType, viewedQuestion?.question_id])

  useEffect(() => {
    if (!currentAnalysisKey || !currentAttemptAnalysis) return
    setAnalysisStatusByKey((prev) => {
      if (prev[currentAnalysisKey] === 'success') return prev
      return {
        ...prev,
        [currentAnalysisKey]: 'success',
      }
    })
  }, [currentAttemptAnalysis, currentAnalysisKey])

  usePostgresChanges({
    tables: realtimeTables,
    onChange: refreshLiveData,
    pollMs: 3000,
    pollStrategy: 'always',
    debugLabel: `teacher-live-session-${sessionId}`,
  })

  const runAction = async (label: string, action: () => Promise<void>) => {
    try {
      setActionLoading(label)
      setError(null)
      await action()
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Action failed.')
    } finally {
      setActionLoading(null)
    }
  }

  const getTimerValue = () => {
    const trimmed = timerInput.trim()
    if (!trimmed) return null
    return Math.max(0, Math.floor(Number(trimmed) || 0))
  }

  const postLiveControl = async (
    action: 'start' | 'open_revision' | 'next_question' | 'complete_session' | 'close_question',
    timerSeconds?: number | null
  ) => {
    const response = await fetch('/api/live-session-control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        action,
        timerSeconds: timerSeconds ?? null,
      }),
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to update live session.')
    }

    if (payload?.session) {
      setSession(payload.session)
    }
  }

  const handleAnalyzeAndClose = async (nextAttemptType: AttemptType, options?: { forceRegenerate?: boolean }) => {
    const targetQuestion = viewedQuestion || currentQuestion
    const analysisKey = targetQuestion ? `${targetQuestion.question_id}:${nextAttemptType}` : null
    if (analysisKey) {
      setAnalysisStatusByKey((prev) => ({
        ...prev,
        [analysisKey]: 'loading',
      }))
    }

    const response = await fetch('/api/live-question-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        questionId: targetQuestion?.question_id,
        questionPosition: targetQuestion?.position,
        attemptType: nextAttemptType,
        forceRegenerate: Boolean(options?.forceRegenerate),
      }),
    })

    const payload = await response.json().catch(() => null)
    if (response.status === 202) {
      if (analysisKey) {
        setAnalysisStatusByKey((prev) => ({
          ...prev,
          [analysisKey]: 'loading',
        }))
      }
    }
    if (!response.ok) {
      if (analysisKey) {
        setAnalysisStatusByKey((prev) => ({
          ...prev,
          [analysisKey]: 'failed',
        }))
      }
      throw new Error(payload?.error || 'Failed to analyze this question.')
    }

    if (response.status === 202) {
      return
    }

    if (analysisKey) {
      setAnalysisStatusByKey((prev) => ({
        ...prev,
        [analysisKey]: 'success',
      }))
    }

    setSession((prev) => ({
      ...prev,
      live_phase: nextAttemptType === 'revision' ? 'question_revision_closed' : 'question_initial_closed',
      current_timer_seconds: null,
      timer_started_at: null,
    }))
    const savedOrEphemeralAnalysis = payload?.saved || (
      payload?.analysis && currentQuestion
        ? {
            live_question_analysis_id: `ephemeral-${currentQuestion.question_id}-${nextAttemptType}-${Date.now()}`,
            session_id: sessionId,
            question_id: currentQuestion.question_id,
            attempt_type: nextAttemptType,
            analysis_json: payload.analysis,
            generated_at: new Date().toISOString(),
          }
        : null
    )
    if (savedOrEphemeralAnalysis) {
      setLiveQuestionAnalyses((prev) =>
        mergeByKey(prev, savedOrEphemeralAnalysis, (row) => `${row.question_id}:${row.attempt_type}`)
      )
      void fetchAgentObservations(currentQuestion?.question_id)
    }
    if (payload?.persistenceWarning) {
      setError(payload.persistenceWarning)
    }
  }

  const handlePostSessionRerunClustering = async (question: SessionQuestion, targetAttemptType: AttemptType) => {
    const confirmed = window.confirm(
      'Re-run clustering for this question using the latest prompt? This will update the displayed cluster view, but previous analysis runs will remain saved.'
    )
    if (!confirmed) return

    const analysisKey = `${question.question_id}:${targetAttemptType}`
    setAnalysisStatusByKey((prev) => ({
      ...prev,
      [analysisKey]: 'loading',
    }))

    const response = await fetch('/api/live-question-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        questionId: question.question_id,
        attemptType: targetAttemptType,
        forceRegenerate: true,
      }),
    })

    const payload = await response.json().catch(() => null)
    if (response.status === 202) {
      return
    }
    if (!response.ok) {
      setAnalysisStatusByKey((prev) => ({
        ...prev,
        [analysisKey]: 'failed',
      }))
      throw new Error(payload?.error || 'Failed to re-run clustering for this question.')
    }

    const savedOrEphemeralAnalysis = payload?.saved || (
      payload?.analysis
        ? {
            live_question_analysis_id: `ephemeral-${question.question_id}-${targetAttemptType}-${Date.now()}`,
            session_id: sessionId,
            question_id: question.question_id,
            attempt_type: targetAttemptType,
            analysis_json: payload.analysis,
            generated_at: new Date().toISOString(),
          }
        : null
    )

    if (savedOrEphemeralAnalysis) {
      setLiveQuestionAnalyses((prev) =>
        mergeByKey(prev, savedOrEphemeralAnalysis, (row) => `${row.question_id}:${row.attempt_type}`)
      )
      void fetchAgentObservations(question.question_id)
    }

    setAnalysisStatusByKey((prev) => ({
      ...prev,
      [analysisKey]: 'success',
    }))

    if (payload?.persistenceWarning) {
      setError(payload.persistenceWarning)
    }
  }

  const handleCompleteSession = async () => {
    await postLiveControl('complete_session')

    void fetch('/api/session-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      keepalive: true,
    }).catch((summaryError) => {
      console.error('session summary prefetch failed', summaryError)
    })

    router.push(`/teacher/session/${sessionId}/summary`)
  }

  const visibleResponseCount = isViewingCurrentQuestion ? currentResponses.length : viewedResponses.length
  const responseCountLabel = isViewingCurrentQuestion
    ? attemptType === 'revision'
      ? 'Revision now'
      : 'Submitted now'
    : viewedAttemptType === 'revision'
      ? 'Revision shown'
      : 'Responses shown'
  const visibleClusters = activeAnalysis?.clusters ?? []
  const isRevisionActive = session.live_phase === 'question_revision_open'
  const useNeutralLayout = Boolean(
    (session.condition === 'treatment' && viewedAttemptType === 'initial') ||
    (viewedAttemptType === 'revision' && isRevisionActive)
  )
  const renderedVisibleClusters = useMemo(
    () => (activeAnalysis ? resolveRenderedClusters(visibleClusters) : []),
    [activeAnalysis, visibleClusters]
  )
  const bubblePlacements = useMemo(
    () =>
      activeAnalysis
        ? getClusterMapPlacements(visibleClusters, CHART_VIEWBOX_WIDTH, CHART_VIEWBOX_HEIGHT, {
            neutralHorizontalOrder: useNeutralLayout,
          })
        : new Map<string, BubblePlacement>(),
    [activeAnalysis, visibleClusters, useNeutralLayout]
  )
  const closedAttemptType =
    session.live_phase === 'question_revision_closed'
      ? 'revision'
      : session.live_phase === 'question_initial_closed'
        ? 'initial'
        : null
  const canRegenerateClosedAnalysis = Boolean(closedAttemptType && currentQuestion)
  const showFallbackWarning = viewedAnalysisStatus === 'success' && activeAnalysis?.source === 'fallback'
  const showV1CompatibilityWarning = viewedAnalysisStatus === 'success' && activeAnalysis?.version === 'live_question_clusters_v1'
  const isCurrentAnalysisRunning = isViewingCurrentQuestion && currentAnalysisStatus === 'loading'
  const isViewedAnalysisLoading = viewedAnalysisStatus === 'loading'
  const isViewedAnalysisFailed = viewedAnalysisStatus === 'failed'
  const hasVisibleAnalysis = visibleClusters.length > 0
  const canPostSessionRerunClustering = Boolean(
    session.live_phase === 'session_completed' &&
    viewedQuestion &&
    viewedResponses.length > 0 &&
    (viewedAttemptType === 'initial' || session.condition === 'treatment')
  )
  const postSessionRerunActionKey = viewedQuestion
    ? `rerun-clustering-${viewedQuestion.question_id}-${viewedAttemptType}`
    : 'rerun-clustering'
  const primaryAction = (() => {
    if (isCurrentAnalysisRunning || currentAnalysisStatus === 'loading') {
      return {
        key: 'analysis-loading',
        label: 'Generating analysis...',
        action: async () => {},
        disabled: true,
      }
    }

    if (session.live_phase === 'not_started') {
      return {
        key: 'start-question',
        label: 'Start accepting question',
        action: () => postLiveControl('start', getTimerValue()),
      }
    }

    if (session.live_phase === 'question_initial_open') {
      return {
        key: currentAnalysisStatus === 'failed' ? 'retry-initial-analysis' : 'end-initial',
        label: currentAnalysisStatus === 'failed' ? 'Retry analysis' : 'End question',
        action: () => handleAnalyzeAndClose('initial'),
      }
    }

    if (session.live_phase === 'question_revision_open') {
      return {
        key: currentAnalysisStatus === 'failed' ? 'retry-revision-analysis' : 'end-revision',
        label: currentAnalysisStatus === 'failed' ? 'Retry analysis' : 'End question',
        action: () => handleAnalyzeAndClose('revision'),
      }
    }

    if (session.live_phase === 'question_initial_closed' && session.condition === 'treatment') {
      return {
        key: 'open-revision',
        label: 'Open revision',
        action: () => postLiveControl('open_revision', getTimerValue()),
      }
    }

    if ((session.live_phase === 'question_initial_closed' || session.live_phase === 'question_revision_closed') && !isLastQuestion) {
      return {
        key: 'next-question',
        label: 'Next question',
        action: () => postLiveControl('next_question', getTimerValue()),
      }
    }

    if ((session.live_phase === 'question_initial_closed' || session.live_phase === 'question_revision_closed') && isLastQuestion) {
      return {
        key: 'complete-session',
        label: 'End session',
        action: handleCompleteSession,
      }
    }

    return null
  })()
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#edf4fa_0%,#f7fbff_100%)] text-foreground">
      <header className="border-b border-[rgba(123,175,212,0.18)] px-6 py-4 lg:px-8">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-[12px] uppercase tracking-[0.18em] text-foreground/45">Live classroom session</p>
              <div className="mt-2 flex items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">{session.session_code}</h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 lg:justify-end">
              <div className="flex items-center gap-3">
              <Link href="/teacher/dashboard">
                <Button variant="ghost" size="sm" className="gap-2 text-slate-600 hover:text-slate-900">
                  <LayoutDashboard className="size-4" />
                  Dashboard
                </Button>
              </Link>
              </div>
          </div>
          </div>
          <div className="overflow-x-auto">
            <div className="grid min-w-[720px] grid-cols-5 gap-3 sm:min-w-0 sm:grid-cols-2 lg:grid-cols-5">
              <MiniStat label="Phase" value={getPhaseLabel(session)} />
              <MiniStat label="Joined" value={String(joinedParticipantCount)} />
              <MiniStat
                label="Responses"
                value={String(isViewingCurrentQuestion ? currentQuestionRespondentCount : visibleResponseCount)}
              />
              <MiniStat label="Timer" value={secondsRemaining === null ? '—' : `${secondsRemaining}s`} />
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-6 py-6 lg:px-8">
        {error && (
          <div className="mb-5 rounded-3xl border border-destructive/25 bg-destructive/5 px-5 py-4 text-sm text-destructive">
            {error}
          </div>
        )}

        <AgentSurfacingBanner
          observations={boundedObservations}
          onInspectCluster={(clusterId) => setInspectingClusterId(clusterId)}
        />

        <section className="mb-4 rounded-3xl bg-white px-6 py-5 shadow-[0_12px_30px_rgba(28,26,36,0.05)]">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <p className="text-[12px] uppercase tracking-[0.18em] text-foreground/45">
                Question {viewedQuestion?.position || 1} of {questions.length}
              </p>
              <h2 className="mt-3 max-w-5xl text-[28px] font-semibold leading-[1.45] tracking-tight text-foreground">
                {viewedQuestion?.prompt || 'No question configured.'}
              </h2>
              <div className="mt-4 flex max-h-28 flex-wrap items-center gap-2 overflow-y-auto pr-1">
                {questions.map((question) => {
                  const isCurrent = currentQuestion?.question_id === question.question_id
                  const isViewed = viewedQuestion?.question_id === question.question_id
                  return (
                    <button
                      key={question.question_id}
                      type="button"
                      onClick={() => setViewedQuestionId(question.question_id)}
                      className={[
                        'rounded-full border px-3 py-1.5 text-sm font-medium transition',
                        isViewed
                          ? 'border-[rgba(33,29,42,0.22)] bg-primary text-primary-foreground'
                          : 'border-[rgba(123,175,212,0.22)] bg-white text-foreground/74 hover:bg-[rgba(248,251,255,0.9)]',
                      ].join(' ')}
                    >
                      Q{question.position}
                      {isCurrent ? ' • Live' : ''}
                    </button>
                  )
                })}
              </div>
              {/* {!isViewingCurrentQuestion && (
                <div className="mt-4">
                  <Badge className="rounded-full border border-[rgba(123,175,212,0.22)] bg-[rgba(238,244,249,0.88)] px-3 py-1 text-sm font-medium text-foreground shadow-none">
                    Viewing previous question
                  </Badge>
                </div>
              )} */}
            </div>

            <div className="flex w-full flex-col gap-3 xl:w-[320px] xl:items-stretch">
              <div className="mt-1 flex flex-col gap-3">
                {isViewingCurrentQuestion ? (
                  <>
                    <div>
                      <p className="text-[12px] uppercase tracking-[0.18em] text-foreground/45">Timer for next open state</p>
                      <div className="mt-3 flex items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          value={timerInput}
                          onChange={(event) => setTimerInput(event.target.value)}
                          placeholder="Optional"
                          className="rounded-xl border-[rgba(123,175,212,0.2)] bg-[rgba(238,244,249,0.85)]"
                        />
                        <span className="text-sm text-foreground/55">sec</span>
                      </div>
                    </div>

                    {primaryAction && (
                      <Button
                        className={
                          primaryAction.key === 'complete-session'
                            ? 'rounded-2xl border border-red-500 bg-transparent text-red-600 hover:bg-red-50 hover:text-red-700'
                            : 'rounded-2xl'
                        }
                        disabled={actionLoading !== null || isCurrentAnalysisRunning || Boolean(primaryAction.disabled)}
                        onClick={() => runAction(primaryAction.key, primaryAction.action)}
                      >
                        {actionLoading === primaryAction.key
                          ? primaryAction.key === 'next-question'
                            ? 'Opening next question...'
                            : primaryAction.key === 'complete-session'
                              ? 'Ending session...'
                              : primaryAction.key === 'start-question'
                                ? 'Starting...'
                                : primaryAction.key === 'open-revision'
                                  ? 'Opening revision...'
                                  : 'Generating analysis...'
                          : primaryAction.label}
                      </Button>
                    )}

                    {isViewingCurrentQuestion &&
                      (session.live_phase === 'question_initial_open' || session.live_phase === 'question_revision_open') &&
                      currentAnalysisStatus === 'failed' && (
                        <Button
                          variant="outline"
                          className="rounded-2xl border-destructive/30 text-destructive hover:bg-destructive/5"
                          disabled={actionLoading !== null || isCurrentAnalysisRunning}
                          onClick={() => runAction('skip-and-close', () => postLiveControl('close_question'))}
                        >
                          {actionLoading === 'skip-and-close' ? 'Closing question...' : 'Skip analysis & close question'}
                        </Button>
                      )}
                  </>
                ) : (
                  <div className="rounded-2xl border border-[rgba(123,175,212,0.18)] bg-[rgba(238,244,249,0.7)] px-4 py-3 text-sm text-foreground/70">
                    <p className="font-medium text-foreground">Viewing Question {viewedQuestion?.position || 1}</p>
                    <p className="text-xs text-foreground/50 mt-0.5">Switch back to Q{currentQuestion?.position || 1} for live session controls.</p>
                  </div>
                )}

                {Boolean(viewedQuestion && (activeAnalysis || viewedResponses.length > 0)) && (
                  <Button
                    variant="outline"
                    className="rounded-2xl border-[rgba(123,175,212,0.22)] bg-white w-full"
                    disabled={actionLoading !== null || isCurrentAnalysisRunning || isViewedAnalysisLoading}
                    onClick={() =>
                      runAction(`analyze-${viewedQuestion!.question_id}-${viewedAttemptType}`, () =>
                        handleAnalyzeAndClose(viewedAttemptType, { forceRegenerate: true })
                      )
                    }
                  >
                    {actionLoading === `analyze-${viewedQuestion!.question_id}-${viewedAttemptType}`
                      ? 'Regenerating analysis...'
                      : 'Regenerate analysis'}
                  </Button>
                )}

                {isViewingCurrentQuestion && currentAnalysisStatus === 'loading' && (
                  <p className="rounded-2xl border border-[rgba(123,175,212,0.18)] bg-[rgba(238,244,249,0.7)] px-4 py-3 text-sm text-foreground/70">
                    Generating analysis now. Please wait before moving to the next step.
                  </p>
                )}

                {isViewingCurrentQuestion && currentAnalysisStatus === 'failed' && (
                  <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    Analysis failed. Please try again.
                  </div>
                )}

                {showFallbackWarning && (
                  <p className="rounded-2xl border border-[rgba(227,176,62,0.22)] bg-[rgba(255,247,223,0.8)] px-4 py-3 text-sm text-[rgba(133,93,18,1)]">
                    AI clustering was unavailable, so fallback grouping was used.
                  </p>
                )}

                {session.live_phase === 'session_completed' && (
                  <div className="grid gap-3">
                    <Link href={`/teacher/session/${sessionId}/summary`}>
                      <Button className="w-full rounded-2xl">View session summary</Button>
                    </Link>
                    <Link href={`/teacher/session/${sessionId}/export`}>
                      <Button variant="outline" className="w-full rounded-2xl border-[rgba(123,175,212,0.22)] bg-white">
                        Export session data
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <div
          className="grid items-start gap-4"
          style={{ gridTemplateColumns: 'minmax(0, 3fr) clamp(320px, 28vw, 380px)' }}
        >
          <section className="min-w-0 space-y-5">
            <section className="rounded-2xl bg-white p-4 shadow-[0_10px_24px_rgba(28,26,36,0.045)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold tracking-tight text-foreground">Cluster Map</h2>
                  {activeAnalysis?.source === 'fallback' && (
                    <p className="mt-2 text-xs text-foreground/45">Fallback grouping used{activeAnalysis.fallback_reason ? ` (${activeAnalysis.fallback_reason})` : ''}.</p>
                  )}
                  {showV1CompatibilityWarning && (
                    <p className="mt-2 text-xs text-foreground/45">Older v1 analysis is being shown with compatibility placement and cleaned labels.</p>
                  )}
                  
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3">
                  {canPostSessionRerunClustering && viewedQuestion && (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full border-[rgba(123,175,212,0.22)] bg-white px-4"
                      disabled={actionLoading !== null || isViewedAnalysisLoading}
                      onClick={() =>
                        runAction(postSessionRerunActionKey, () =>
                          handlePostSessionRerunClustering(viewedQuestion, viewedAttemptType)
                        )
                      }
                    >
                      {actionLoading === postSessionRerunActionKey
                        ? (
                          <><Loader2 className="size-3.5 animate-spin" /> Re-running...</>
                        ) : (
                          <><RefreshCw className="size-3.5" /> Re-run clustering</>
                        )}
                    </Button>
                  )}
                  {canCompareRevision && (
                    <div className="grid w-[220px] grid-cols-2 rounded-full bg-[rgba(238,244,249,0.95)] p-1">
                      <button
                        type="button"
                        onClick={() => setCompareMode('initial')}
                        className={[
                          'h-9 rounded-full text-center text-sm font-medium transition-colors',
                          compareMode === 'initial'
                            ? 'bg-white text-foreground shadow-sm'
                            : 'text-foreground/58',
                        ].join(' ')}
                      >
                        Initial
                      </button>

                      <button
                        type="button"
                        onClick={() => setCompareMode('revision')}
                        className={[
                          'h-9 rounded-full text-center text-sm font-medium transition-colors',
                          compareMode === 'revision'
                            ? 'bg-white text-foreground shadow-sm'
                            : 'text-foreground/58',
                        ].join(' ')}
                      >
                        Revision
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <MiniStat label="Responses" value={String(classSnapshot.totalResponses)} />
                <MiniStat
                  label="Avg confidence"
                  value={classSnapshot.totalResponses > 0 ? `${classSnapshot.averageConfidence.toFixed(1)}/5` : '—'}
                />
                <MiniStat label="Groups" value={classSnapshot.clusterCount ? String(classSnapshot.clusterCount) : '—'} />
              </div>

              <div className="mt-4 rounded-2xl bg-[rgba(248,251,255,0.9)] p-2">
                <div className="relative min-h-[520px] w-full overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.96),rgba(242,248,252,0.92)_58%,rgba(234,243,250,0.82)_100%)] xl:min-h-[600px]">
                  {!hasVisibleAnalysis ? (
                    <div
                      className={[
                        'flex min-h-[520px] items-center justify-center rounded-2xl border px-6 py-8 text-center xl:min-h-[600px]',
                        isViewedAnalysisFailed
                          ? 'border-destructive/25 bg-destructive/5 text-destructive'
                          : 'border-[rgba(123,175,212,0.18)] bg-white/68 text-foreground',
                      ].join(' ')}
                    >
                      <div className="max-w-sm">
                        {isViewedAnalysisLoading && (
                          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-[rgba(123,175,212,0.28)] border-t-[rgba(123,175,212,0.95)]" />
                        )}
                        <p className="text-lg font-semibold tracking-tight">
                          {isViewedAnalysisLoading
                            ? 'Generating reasoning groups...'
                            : isViewedAnalysisFailed
                              ? 'Analysis could not be generated.'
                              : 'No analysis yet'}
                        </p>
                        <p
                          className={[
                            'mt-2 text-sm leading-6',
                            isViewedAnalysisFailed ? 'text-destructive/78' : 'text-foreground/58',
                          ].join(' ')}
                        >
                          {isViewedAnalysisLoading
                            ? 'This may take a few seconds.'
                            : isViewedAnalysisFailed
                              ? 'Please try again by clicking Retry analysis or Regenerate analysis.'
                              : isViewingCurrentQuestion
                                ? 'End the question to generate reasoning groups.'
                                : 'No analysis was generated for this question.'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <svg
                      viewBox={`0 0 ${CHART_VIEWBOX_WIDTH} ${CHART_VIEWBOX_HEIGHT}`}
                      className="h-[520px] w-full xl:h-[600px]"
                      role="img"
                      aria-label="Student reasoning map"
                    >
                      <defs>
                        <filter id="bubble-shadow" x="-20%" y="-20%" width="140%" height="140%">
                          <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="rgba(28,26,36,0.16)" />
                        </filter>
                      </defs>
                      {!useNeutralLayout && (
                        <>
                          <rect x="72" y={CHART_LANE_TOP} width={CHART_LANE_WIDTH} height={CHART_LANE_HEIGHT} rx="34" fill="rgba(255,240,236,0.62)" />
                          <rect x={72 + CHART_LANE_WIDTH + CHART_LANE_GAP} y={CHART_LANE_TOP} width={CHART_LANE_WIDTH} height={CHART_LANE_HEIGHT} rx="34" fill="rgba(242,246,252,0.78)" />
                          <rect x={72 + (CHART_LANE_WIDTH + CHART_LANE_GAP) * 2} y={CHART_LANE_TOP} width={CHART_LANE_WIDTH} height={CHART_LANE_HEIGHT} rx="34" fill="rgba(236,248,239,0.72)" />
                        </>
                      )}
                      <line x1={CHART_AXIS_LEFT} y1={CHART_AXIS_BOTTOM} x2={CHART_AXIS_RIGHT} y2={CHART_AXIS_BOTTOM} stroke="rgba(33,29,42,0.16)" strokeWidth="2" />
                      <line x1={CHART_AXIS_LEFT} y1={CHART_AXIS_BOTTOM - 6} x2={CHART_AXIS_LEFT} y2="92" stroke="rgba(33,29,42,0.16)" strokeWidth="2" />
                      {!useNeutralLayout && (
                        <line x1="600" y1="92" x2="600" y2={CHART_AXIS_BOTTOM + 4} stroke="rgba(33,29,42,0.12)" strokeDasharray="8 10" strokeWidth="2" />
                      )}
                      <line x1="128" y1="164" x2="1100" y2="164" stroke="rgba(33,29,42,0.08)" strokeDasharray="6 10" strokeWidth="2" />
                      <line x1="128" y1="304" x2="1100" y2="304" stroke="rgba(33,29,42,0.08)" strokeDasharray="6 10" strokeWidth="2" />
                      <line x1="128" y1="444" x2="1100" y2="444" stroke="rgba(33,29,42,0.08)" strokeDasharray="6 10" strokeWidth="2" />
                      <text x="48" y="70" fill="rgba(33,29,42,0.68)" style={{ fontSize: 15, fontWeight: 600 }}>
                        Confidence
                      </text>
                      <text x="52" y="120" fill="rgba(33,29,42,0.48)" style={{ fontSize: 13, fontWeight: 500 }}>
                        High
                      </text>
                      <text x="53" y="306" fill="rgba(33,29,42,0.48)" style={{ fontSize: 13, fontWeight: 500 }}>
                        Mid
                      </text>
                      <text x="56" y="518" fill="rgba(33,29,42,0.48)" style={{ fontSize: 13, fontWeight: 500 }}>
                        Low
                      </text>

                      {renderedVisibleClusters
                        .slice()
                        .sort((a, b) => {
                          const aSelected = a.cluster_id === selectedRenderedCluster?.cluster_id
                          const bSelected = b.cluster_id === selectedRenderedCluster?.cluster_id
                          if (aSelected === bSelected) return a.count - b.count
                          return aSelected ? 1 : -1
                        })
                        .map((cluster) => {
                          const placement = bubblePlacements.get(cluster.cluster_id)
                          const palette = getClusterPatternColor(cluster.average_confidence)
                          const selected = cluster.cluster_id === selectedRenderedCluster?.cluster_id
                          const hovered = cluster.cluster_id === hoveredClusterId
                          const radius = placement?.radius ?? 78
                          const compact = radius * 2 < 196
                          const tiny = radius * 2 < 150
                          const showSecondaryText = !tiny
                          const labelLineHeight = compact ? 13 : 15
                          const countLineHeight = tiny ? 16 : compact ? 18 : 20
                          const confidenceLineHeight = compact ? 12 : 14
                          const gapAfterLabel = showSecondaryText ? (compact ? 5 : 7) : 0
                          const gapAfterCount = showSecondaryText ? (compact ? 5 : 7) : 0
                          const labelBlockHeight = showSecondaryText ? labelLineHeight : 0
                          const totalTextHeight =
                            labelBlockHeight +
                            gapAfterLabel +
                            countLineHeight +
                            gapAfterCount +
                            (showSecondaryText ? confidenceLineHeight : 0)
                          const blockStartY = -totalTextHeight / 2
                          const countY = blockStartY + labelBlockHeight + gapAfterLabel + countLineHeight / 2
                          const confidenceY = countY + countLineHeight / 2 + gapAfterCount + confidenceLineHeight / 2
                          const percentageText =
                            cluster.percentage !== null ? ` (${cluster.percentage}%)` : ''
                          const titleText = `${cluster.patternLabel}: ${cluster.displayLabel} - ${formatResponsesLabel(cluster.count)}${percentageText} - avg confidence ${cluster.average_confidence.toFixed(1)}/5`

                          return (
                            <g
                              key={cluster.cluster_id}
                              role="button"
                              tabIndex={0}
                              aria-pressed={selected}
                              onClick={() => setActiveSelectedClusterId(cluster.cluster_id)}
                              onMouseEnter={() => setHoveredClusterId(cluster.cluster_id)}
                              onMouseLeave={() => setHoveredClusterId((current) => (current === cluster.cluster_id ? null : current))}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault()
                                  setActiveSelectedClusterId(cluster.cluster_id)
                                }
                              }}
                              className="cursor-pointer outline-none"
                              transform={`translate(${placement?.x ?? CHART_VIEWBOX_WIDTH / 2} ${placement?.y ?? CHART_VIEWBOX_HEIGHT / 2})`}
                            >
                              {selected && (
                                <circle
                                  r={radius + 10}
                                  fill="none"
                                  stroke={palette.border}
                                  strokeWidth={4}
                                  strokeOpacity={0.35}
                                />
                              )}
                              <circle
                                r={radius}
                                fill={palette.fill}
                                stroke={palette.border}
                                strokeWidth={selected ? 6 : hovered ? 4 : 3}
                                filter="url(#bubble-shadow)"
                              />
                              <text
                                x="0"
                                y={showSecondaryText ? -confidenceY / 2 - 6: 0}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fill="#211d2a"
                                style={{ fontSize: tiny ? 28 : compact ? 32 : 38, fontWeight: 700 }}
                                >
                                {tiny ? `${cluster.count}` : (cluster.count)}
                              </text>
                              {showSecondaryText && (
                                <text
                                  x="0"
                                  y={confidenceY / 2}
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                  fill="rgba(33,29,42,0.72)"
                                  style={{ fontSize: compact ? 25 : 27, fontWeight: 500 }}
                                  >
                                  cf. {cluster.average_confidence.toFixed(1)}
                                </text>
                              )}
                              <title>{titleText}</title>
                            </g>
                          )
                        })}
                    </svg>
                  )}
                </div>
              </div>
            </section>
          </section>

          <aside className="min-w-0 xl:sticky xl:top-24">
            <section className="rounded-2xl bg-white p-4 shadow-[0_10px_24px_rgba(28,26,36,0.045)]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] uppercase tracking-[0.18em] text-foreground/45">Selected Cluster</p>
                <Badge className="rounded-full border border-[rgba(123,175,212,0.22)] bg-white px-3 py-1 text-xs font-medium text-foreground/60 shadow-none">
                  {visibleClusters.length} {visibleClusters.length === 1 ? 'group' : 'groups'}
                </Badge>
              </div>

              <div className="mt-4">
                <div className="mb-2.5 flex items-center justify-between">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-foreground/42">
                    Clusters
                  </p>

                  <span className="text-[11px] tabular-nums text-foreground/40">
                    {visibleClusters.length}
                  </span>
                </div>

                {!hasVisibleAnalysis ? (
                  <div className="rounded-xl border border-dashed border-[rgba(123,175,212,0.22)] bg-[rgba(248,251,255,0.72)] px-3 py-4">
                    <p className="text-sm leading-5 text-foreground/58">
                      {isViewedAnalysisLoading
                        ? 'Reasoning groups are being generated.'
                        : isViewedAnalysisFailed
                          ? 'Reasoning groups could not be generated yet.'
                          : 'Reasoning groups will appear here after analysis.'}
                    </p>
                  </div>
                ) : (
                  <div className="grid max-h-[220px] grid-cols-2 gap-2 overflow-y-auto pr-1">
                    {renderedVisibleClusters.map((cluster, index) => {
                      const palette = getClusterPatternColor(cluster.average_confidence)
                      const hovered = cluster.cluster_id===selectedRenderedCluster?.cluster_id
                      const selected =
                        cluster.cluster_id === selectedRenderedCluster?.cluster_id

                      return (
                        <button
                          key={cluster.cluster_id}
                          type="button"
                          onClick={() => setActiveSelectedClusterId(cluster.cluster_id)}
                          onMouseEnter={() => setHoveredClusterId(cluster.cluster_id)}
                          onMouseLeave={() => setHoveredClusterId(null)}
                          className={[
                            'group relative min-w-0 rounded-xl border p-2.5 text-left transition-all',
                            selected
                              ? 'border-foreground/15 bg-[rgba(238,244,249,0.95)] shadow-sm'
                              : 'border-transparent bg-[rgba(248,251,255,0.72)] hover:border-[rgba(123,175,212,0.18)] hover:bg-white',
                          ].join(' ')}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                className="size-2.5 shrink-0 rounded-full ring-2 ring-white"
                                style={{ backgroundColor: palette.dot }}
                              />

                              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-foreground/40">
                                {cluster.patternLabel}
                              </span>
                            </div>

                            {selected && (
                              <span className="size-1.5 shrink-0 rounded-full bg-foreground/60" />
                            )}
                          </div>

                          <p className="mt-2 truncate text-sm font-medium text-foreground">
                            {cluster.displayLabel}
                          </p>

                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <span className="text-[11px] tabular-nums text-foreground/48">
                              {cluster.count} responses
                            </span>

                            <span className="text-[11px] font-semibold tabular-nums text-foreground/58">
                              {cluster.average_confidence.toFixed(1)}
                            </span>
                          </div>

                          <div className="mt-2 h-1 overflow-hidden rounded-full bg-foreground/[0.06]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(cluster.count / Math.max(...visibleClusters.map(c => c.count))) * 100}%`,
                                backgroundColor: palette.dot,
                              }}
                            />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {selectedRenderedCluster ? (
                <>
                  <div
                    className="mt-4 rounded-2xl border px-3 py-3"
                    style={{
                      backgroundColor: getClusterPatternColor(selectedRenderedCluster.average_confidence).fill,
                      borderColor: getClusterPatternColor(selectedRenderedCluster.average_confidence).border,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span
                          className="mt-1 h-3 w-3 shrink-0 rounded-full"
                          style={{
                            backgroundColor: getClusterPatternColor(selectedRenderedCluster.average_confidence).dot,
                          }}
                        />
                        <div className="min-w-0">
                          <p className="text-[11px] uppercase tracking-[0.1em] text-foreground/48">
                            {selectedRenderedCluster.patternLabel}
                          </p>
                          <h3 className="mt-0.5 text-xl font-semibold leading-tight text-foreground">
                            {selectedRenderedCluster.summary}
                          </h3>
                          <p className="mt-1 text-xs text-foreground/55">
                            {formatResponsesLabel(selectedRenderedCluster.count)}
                            {selectedRenderedCluster.percentage !== null
                              ? ` · ${selectedRenderedCluster.percentage}% of responses`
                              : ''}
                          </p>
                        </div>
                      </div>
                      <Badge
                        className="rounded-full border-0 px-3 py-1 text-sm font-semibold shadow-none"
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.78)',
                          color: 'rgba(33,29,42,0.62)',
                        }}
                      >
                        cf. {selectedRenderedCluster.average_confidence.toFixed(1)}/5
                      </Badge>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSelectedGroupResponses((value) => !value)}
                    className="mt-4 w-full rounded-xl bg-foreground px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-foreground/90"
                  >
                    {showSelectedGroupResponses ? 'Hide responses in this group' : 'Show responses in this group'}
                  </button>

                  {showSelectedGroupResponses && (
                    <div className="mt-3 max-h-[230px] space-y-2 overflow-y-auto pr-1">
                      {selectedClusterResponses.length > 0 ? (
                        selectedClusterResponses.map((response) => {
                          const transObj = (activeAnalysis?.translations as any)?.[response.response_id]
                          const isTranslated = transObj?.translationStatus === 'translated'
                          return (
                            <div key={response.response_id} className="rounded-xl border border-[rgba(123,175,212,0.22)] bg-[rgba(242,246,251,0.75)] p-4 shadow-2xs">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold text-foreground">
                                    {formatParticipantDisplay(response.session_participants)}
                                  </p>
                                  {isTranslated && (
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 font-normal bg-sky-100/80 text-sky-800 border-sky-200">
                                      Translated
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm font-medium text-foreground/60">{response.confidence}/5</p>
                              </div>
                              <p className="mt-2.5 text-base leading-7 text-foreground/90">
                                {isTranslated ? transObj.translatedText : response.answer}
                              </p>
                              {isTranslated && (
                                <Accordion type="single" collapsible className="mt-3 w-full">
                                  <AccordionItem value="original" className="border-none">
                                    <AccordionTrigger className="flex w-full items-center justify-between rounded-lg border border-[rgba(123,175,212,0.25)] bg-white/90 px-3 py-1.5 text-xs font-medium text-foreground/75 shadow-2xs transition hover:bg-white hover:text-foreground hover:no-underline">
                                      <span className="flex items-center gap-1.5">
                                        See original response
                                      </span>
                                    </AccordionTrigger>
                                    <AccordionContent className="mt-2 rounded-lg border border-[rgba(123,175,212,0.2)] bg-white p-3.5 text-sm leading-6 text-foreground/85 shadow-2xs">
                                      <p className="whitespace-pre-wrap leading-relaxed">{transObj.originalText || response.answer}</p>
                                    </AccordionContent>
                                  </AccordionItem>
                                </Accordion>
                              )}
                            </div>
                          )
                        })
                      ) : selectedRepresentativeAnswers.length > 0 ? (
                        selectedRepresentativeAnswers.map((answer, index) => (
                          <div key={`${selectedRenderedCluster.cluster_id}-expanded-${index}`} className="rounded-xl border border-[rgba(123,175,212,0.22)] bg-[rgba(242,246,251,0.75)] p-4 text-base leading-7 text-foreground/90 shadow-2xs">
                            {answer}
                          </div>
                        ))
                      ) : (
                        <p className="rounded-xl border border-[rgba(123,175,212,0.22)] bg-[rgba(242,246,251,0.75)] p-4 text-sm text-foreground/60 shadow-2xs">
                          No responses are available for this group yet.
                        </p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-4 rounded-xl border border-[rgba(123,175,212,0.18)] bg-[rgba(248,251,255,0.88)] px-3 py-3 text-sm leading-5 text-foreground/62">
                  <p className="font-medium text-foreground/72">
                    {isViewedAnalysisLoading
                      ? 'Generating reasoning groups...'
                      : isViewedAnalysisFailed
                        ? 'Analysis could not be generated.'
                        : 'Reasoning groups will appear here after analysis.'}
                  </p>
                  <p className="mt-1 text-foreground/55">
                    {isViewedAnalysisLoading
                      ? 'This may take a few seconds.'
                      : isViewedAnalysisFailed
                        ? 'Please try again by clicking Retry analysis or Regenerate analysis.'
                        : 'After groups are generated, select one to view its summary and example responses.'}
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowRawResponses((value) => !value)}
                className="mt-4 w-full rounded-xl border border-[rgba(123,175,212,0.22)] bg-white px-3 py-2.5 text-sm font-medium text-foreground/64 transition hover:bg-[rgba(248,251,255,0.9)]"
              >
                  {showRawResponses ? 'Hide all student responses' : 'View all student responses'}
              </button>
            </section>

            {showRawResponses && (
              <section className="mt-3 rounded-2xl bg-white p-4 shadow-[0_10px_24px_rgba(28,26,36,0.045)]">
                <p className="text-[11px] uppercase tracking-[0.16em] text-foreground/42">All Student Responses</p>
                <div className="mt-3 max-h-[280px] space-y-2 overflow-y-auto pr-1">
                  {viewedResponses.length === 0 ? (
                    <p className="text-sm text-foreground/55">No submissions yet for this question attempt.</p>
                  ) : (
                    viewedResponses.map((response) => {
                      const transObj = (activeAnalysis?.translations as any)?.[response.response_id]
                      const isTranslated = transObj?.translationStatus === 'translated'
                      return (
                        <div key={response.response_id} className="rounded-xl border border-[rgba(123,175,212,0.22)] bg-[rgba(242,246,251,0.75)] p-4 shadow-2xs">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-foreground">
                                {formatParticipantDisplay(response.session_participants)}
                              </p>
                              {isTranslated && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 font-normal bg-sky-100/80 text-sky-800 border-sky-200">
                                  Translated
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm font-medium text-foreground/60">{response.confidence}/5</p>
                          </div>
                          <p className="mt-2.5 text-base leading-7 text-foreground/90">
                            {isTranslated ? transObj.translatedText : response.answer}
                          </p>
                          {isTranslated && (
                            <Accordion type="single" collapsible className="mt-3 w-full">
                              <AccordionItem value="original" className="border-none">
                                <AccordionTrigger className="flex w-full items-center justify-between rounded-lg border border-[rgba(123,175,212,0.25)] bg-white/90 px-3 py-1.5 text-xs font-medium text-foreground/75 shadow-2xs transition hover:bg-white hover:text-foreground hover:no-underline">
                                  <span className="flex items-center gap-1.5">
                                    <span className="text-sm">🌐</span> Original response
                                  </span>
                                </AccordionTrigger>
                                <AccordionContent className="mt-2 rounded-lg border border-[rgba(123,175,212,0.2)] bg-white p-3.5 text-sm leading-6 text-foreground/85 shadow-2xs">
                                  <p className="whitespace-pre-wrap leading-relaxed">{transObj.originalText || response.answer}</p>
                                </AccordionContent>
                              </AccordionItem>
                            </Accordion>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </section>
            )}
          </aside>
        </div>

      </div>

      {inspectingClusterId && viewedQuestion && (
        <ClusterEvidenceDrawer
          isOpen={Boolean(inspectingClusterId)}
          onClose={() => setInspectingClusterId(null)}
          sessionId={sessionId}
          questionId={viewedQuestion.question_id}
          clusterId={inspectingClusterId}
          label={visibleClusters.find((c) => c.cluster_id === inspectingClusterId)?.label || 'Reasoning Pattern'}
          summary={visibleClusters.find((c) => c.cluster_id === inspectingClusterId)?.summary || null}
          count={visibleClusters.find((c) => c.cluster_id === inspectingClusterId)?.count || 0}
          averageConfidence={visibleClusters.find((c) => c.cluster_id === inspectingClusterId)?.average_confidence || null}
          representativeAnswers={visibleClusters.find((c) => c.cluster_id === inspectingClusterId)?.representative_answers || []}
          evidenceQuotes={visibleClusters.find((c) => c.cluster_id === inspectingClusterId)?.evidence_spans || []}
          responseIds={visibleClusters.find((c) => c.cluster_id === inspectingClusterId)?.response_ids || []}
          referenceAlignment={(visibleClusters.find((c) => c.cluster_id === inspectingClusterId) as any)?.reference_alignment}
          translations={
            (
              liveQuestionAnalyses.find(
                (a) => a.question_id === viewedQuestion.question_id && a.attempt_type === viewedAttemptType
              )?.analysis_json as any
            )?.translations
          }
        />
      )}
    </main>
  )
}
