'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  getLiveQuestionAnalyses,
  getSession,
  getSessionParticipants,
  getSessionResponses,
} from '@/lib/supabase/queries'
import { teacherLogout } from '@/app/teacher/auth-actions'
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
import { usePostgresChanges } from '@/hooks/use-postgres-changes'
import { CONFIDENCE_BINS, getConfidenceLevel } from '@/lib/confidence'

type Props = {
  initialSession: Session
  initialQuestions: SessionQuestion[]
  initialParticipants: SessionParticipant[]
  initialResponses: Response[]
  initialLiveQuestionAnalyses: LiveQuestionAnalysis[]
}

type LiveAnalysisPayload = {
  version: 'live_question_clusters_v1'
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
  }>
}

type ConfidencePalette = {
  fill: string
  border: string
  dot: string
  badgeBg: string
  badgeText: string
}

type AnalysisStatus = 'idle' | 'loading' | 'success' | 'failed'
type BubblePlacement = {
  x: number
  y: number
  radius: number
}

type ClusterMapCategory = 'incorrect' | 'uncertain' | 'correct'

const CHART_VIEWBOX_WIDTH = 900
const CHART_VIEWBOX_HEIGHT = 560

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

function getConfidencePalette(score: number): ConfidencePalette {
  const intensity = Math.max(0.32, Math.min(0.9, 0.28 + ((score - 1) / 4) * 0.62))
  const level = getConfidenceLevel(score)

  if (level === 'high') {
    return {
      fill: `rgba(255, 228, 144, ${intensity})`,
      border: 'rgba(255, 199, 84, 0.88)',
      dot: '#F0B93B',
      badgeBg: 'rgba(255, 246, 220, 1)',
      badgeText: '#A97800',
    }
  }

  if (level === 'mid') {
    return {
      fill: `rgba(216, 232, 243, ${intensity})`,
      border: 'rgba(123, 175, 212, 0.92)',
      dot: '#7BAFD4',
      badgeBg: 'rgba(238, 244, 249, 1)',
      badgeText: '#4E7FA2',
    }
  }

  return {
    fill: `rgba(231, 223, 255, ${intensity})`,
    border: 'rgba(169, 119, 255, 0.82)',
    dot: '#A977FF',
    badgeBg: 'rgba(243, 236, 255, 1)',
    badgeText: '#8A57FF',
  }
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function getBubbleRadius(count: number, maxCount: number) {
  if (maxCount <= 1) return 78
  const normalized = Math.sqrt(count / maxCount)
  return clamp(54 + normalized * 70, 54, 124)
}

function getClusterMapCategory(label: string) {
  const normalized = label.trim().toLowerCase()

  if (
    normalized.startsWith('true:') ||
    normalized.includes('correct understanding') ||
    normalized.includes('correct answer') ||
    normalized.includes('correct reasoning')
  ) {
    return 'correct' as const
  }

  if (
    normalized.startsWith('false:') ||
    normalized.includes('misconception') ||
    normalized.includes('incorrect')
  ) {
    return 'incorrect' as const
  }

  if (
    normalized.includes('uncertain') ||
    normalized.includes('implementation-dependent') ||
    normalized.includes('depends') ||
    normalized.includes('mixed')
  ) {
    return 'uncertain' as const
  }

  return 'uncertain' as const
}

function getAxisLabel(category: ClusterMapCategory) {
  switch (category) {
    case 'incorrect':
      return 'Misconception'
    case 'correct':
      return 'Correct understanding'
    default:
      return 'Uncertain'
  }
}

function getClusterDisplayLabel(label: string) {
  return String(label || '').replace(/^(True|False|Uncertain):\s*/i, '').trim() || 'Response pattern'
}

function getClusterCategoryBadgeLabel(label: string) {
  const category = getClusterMapCategory(label)
  if (category === 'correct') return 'Target-answer cluster'
  if (category === 'incorrect') return 'Misconception cluster'
  return 'Needs interpretation'
}

function getClusterMapPlacements(
  clusters: LiveAnalysisPayload['clusters'],
  width: number,
  height: number
) {
  if (!clusters.length || width <= 0 || height <= 0) return new Map<string, BubblePlacement>()

  const sorted = clusters.slice().sort((a, b) => b.count - a.count)
  const maxCount = sorted.reduce((max, cluster) => Math.max(max, cluster.count), 0)
  const padding = 28
  const placements = new Map<string, BubblePlacement>()
  const anchorX: Record<ClusterMapCategory, number> = {
    incorrect: width * 0.24,
    uncertain: width * 0.5,
    correct: width * 0.76,
  }
  const laneOffsets = [0, -54, 54, -102, 102]
  const yOffsets = [0, -18, 18, -34, 34]
  const categoryCounts: Record<ClusterMapCategory, number> = {
    incorrect: 0,
    uncertain: 0,
    correct: 0,
  }

  sorted.forEach((cluster) => {
    const radius = getBubbleRadius(cluster.count, maxCount)
    const category = getClusterMapCategory(cluster.label)
    const laneIndex = categoryCounts[category]
    categoryCounts[category] += 1
    const normalizedConfidence = clamp((cluster.average_confidence - 1) / 4, 0, 1)
    const baseY = height - 74 - normalizedConfidence * (height - 148)
    const x = anchorX[category] + (laneOffsets[laneIndex] ?? 0)
    const y = baseY + (yOffsets[laneIndex] ?? 0)

    placements.set(cluster.cluster_id, {
      radius,
      x: clamp(x, padding + radius, width - padding - radius),
      y: clamp(y, padding + radius, height - padding - radius),
    })
  })

  return placements
}

function wrapBubbleLabel(label: string, maxCharactersPerLine: number, maxLines = 3) {
  const words = label.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxCharactersPerLine || current.length === 0) {
      current = candidate
      continue
    }

    lines.push(current)
    current = word

    if (lines.length === maxLines - 1) break
  }

  const remainingWords = words.slice(lines.join(' ').split(/\s+/).filter(Boolean).length)
  const remaining = [current, ...remainingWords].filter(Boolean).join(' ').trim()

  if (remaining) {
    lines.push(remaining)
  }

  return lines.slice(0, maxLines).map((line, index, array) => {
    if (index === array.length - 1 && line.length > maxCharactersPerLine) {
      return `${line.slice(0, maxCharactersPerLine - 1).trimEnd()}…`
    }
    return line
  })
}

function getRepresentativeAnswers(cluster: LiveAnalysisPayload['clusters'][number] | null) {
  return (cluster?.representative_answers ?? []).filter((answer) => answer.trim().length > 0).slice(0, 3)
}

function MiniStat({
  label,
  value,
  emphasized = false,
}: {
  label: string
  value: string
  emphasized?: boolean
}) {
  return (
    <div className="min-w-[92px]">
      <p className="text-[11px] uppercase tracking-[0.18em] text-foreground/42">{label}</p>
      <div
        className={[
          'mt-2 inline-flex rounded-full px-4 py-3 text-base font-semibold',
          emphasized ? 'bg-primary text-primary-foreground shadow-[0_8px_20px_rgba(28,26,36,0.14)]' : 'text-foreground',
        ].join(' ')}
      >
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
  const [timerInput, setTimerInput] = useState('')
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null)
  const [viewedQuestionId, setViewedQuestionId] = useState<string | null>(initialViewedQuestion?.question_id ?? null)
  const [selectedInitialClusterId, setSelectedInitialClusterId] = useState<string | null>(null)
  const [selectedRevisionClusterId, setSelectedRevisionClusterId] = useState<string | null>(null)
  const [hoveredClusterId, setHoveredClusterId] = useState<string | null>(null)
  const [compareMode, setCompareMode] = useState<'initial' | 'revision'>('initial')
  const [showRawResponses, setShowRawResponses] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [analysisStatusByKey, setAnalysisStatusByKey] = useState<Record<string, AnalysisStatus>>({})

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

  const canCompareRevision = Boolean(
    session.condition === 'treatment' &&
    viewedRevisionAnalysis
  )

  const activeAnalysis = compareMode === 'revision' && canCompareRevision ? viewedRevisionAnalysis : viewedInitialAnalysis
  const currentAttemptAnalysis = attemptType === 'revision' ? currentRevisionAnalysis : currentInitialAnalysis
  const currentAnalysisKey = currentQuestion ? `${currentQuestion.question_id}:${attemptType}` : null
  const currentAnalysisStatus =
    (currentAnalysisKey ? analysisStatusByKey[currentAnalysisKey] : null) ||
    (currentAttemptAnalysis ? 'success' : 'idle')
  const viewedAttemptType: AttemptType =
    compareMode === 'revision' && canCompareRevision ? 'revision' : 'initial'
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
  const classSnapshot = getClassSnapshot(activeAnalysis, viewedResponses)
  const selectedRepresentativeAnswers = getRepresentativeAnswers(selectedCluster)

  const refreshLiveData = useCallback(async () => {
    try {
      const [sessionData, participantsData, responsesData, analysesData] = await Promise.all([
        getSession(sessionId),
        getSessionParticipants(sessionId),
        getSessionResponses(sessionId),
        getLiveQuestionAnalyses(sessionId),
      ])

      setSession(sessionData)
      setParticipants(participantsData || [])
      setResponses(responsesData || [])
      setLiveQuestionAnalyses(analysesData || [])
    } catch (err) {
      console.error('Error refreshing live session data:', err)
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
    if (!canCompareRevision && compareMode === 'revision') {
      setCompareMode('initial')
    }
  }, [canCompareRevision, compareMode])

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
    action: 'start' | 'open_revision' | 'next_question' | 'complete_session',
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

  const handleAnalyzeAndClose = async (nextAttemptType: AttemptType) => {
    const analysisKey = currentQuestion ? `${currentQuestion.question_id}:${nextAttemptType}` : null
    if (analysisKey) {
      setAnalysisStatusByKey((prev) => ({
        ...prev,
        [analysisKey]: 'loading',
      }))
    }

    const response = await fetch('/api/live-question-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, attemptType: nextAttemptType }),
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      if (analysisKey) {
        setAnalysisStatusByKey((prev) => ({
          ...prev,
          [analysisKey]: 'failed',
        }))
      }
      throw new Error(payload?.error || 'Failed to analyze this question.')
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
    }
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
  const bubblePlacements = useMemo(
    () => getClusterMapPlacements(visibleClusters, CHART_VIEWBOX_WIDTH, CHART_VIEWBOX_HEIGHT),
    [visibleClusters]
  )
  const closedAttemptType =
    session.live_phase === 'question_revision_closed'
      ? 'revision'
      : session.live_phase === 'question_initial_closed'
        ? 'initial'
        : null
  const canRegenerateClosedAnalysis = Boolean(closedAttemptType && currentQuestion)
  const showFallbackWarning = viewedAnalysisStatus === 'success' && activeAnalysis?.source === 'fallback'
  const primaryAction = (() => {
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
  const secondaryAction = (() => {
    if (session.live_phase === 'question_initial_closed' && session.condition === 'treatment') {
      if (isLastQuestion) {
        return {
          key: 'complete-session',
          label: 'End session',
          action: handleCompleteSession,
        }
      }

      return {
        key: 'next-question',
        label: 'Next question',
        action: () => postLiveControl('next_question', getTimerValue()),
      }
    }

    return null
  })()

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#edf4fa_0%,#f7fbff_100%)] text-foreground">
      <header className="border-b border-[rgba(123,175,212,0.18)] px-6 py-5 lg:px-8">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-start justify-between gap-6">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <p className="text-[12px] uppercase tracking-[0.18em] text-foreground/45">Live classroom session</p>
              <div className="mt-2 flex items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">{session.session_code}</h1>
                <Badge className="rounded-full border border-[rgba(123,175,212,0.28)] bg-white/80 px-3 py-1 text-sm font-medium text-foreground shadow-none hover:bg-white/80">
                  {session.condition}
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-6">
            <MiniStat label="Phase" value={getPhaseLabel(session)} />
            <MiniStat label="Joined" value={String(participants.length)} />
            <MiniStat label={responseCountLabel} value={String(visibleResponseCount)} emphasized />
            <MiniStat label="Timer" value={secondsRemaining === null ? '—' : `${secondsRemaining}s`} />
            <div className="flex items-center gap-3 pt-6">
              <Link href="/teacher/dashboard">
                <Button variant="outline" className="rounded-full border-[rgba(123,175,212,0.22)] bg-white/80 px-5">
                  Back
                </Button>
              </Link>
              <form action={teacherLogout}>
                <Button variant="outline" type="submit" className="rounded-full border-[rgba(123,175,212,0.22)] bg-white/80 px-5">
                  Log Out
                </Button>
              </form>
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

        <section className="mb-4 rounded-3xl bg-white px-6 py-5 shadow-[0_12px_30px_rgba(28,26,36,0.05)]">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <p className="text-[12px] uppercase tracking-[0.18em] text-foreground/45">
                Question {viewedQuestion?.position || 1} of {questions.length}
              </p>
              <h2 className="mt-3 max-w-5xl text-[28px] font-semibold leading-[1.45] tracking-tight text-foreground">
                {viewedQuestion?.prompt || 'No question configured.'}
              </h2>
              <div className="mt-4 flex flex-wrap items-center gap-2">
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
              {!isViewingCurrentQuestion && (
                <div className="mt-4">
                  <Badge className="rounded-full border border-[rgba(123,175,212,0.22)] bg-[rgba(238,244,249,0.88)] px-3 py-1 text-sm font-medium text-foreground shadow-none">
                    Viewing previous question
                  </Badge>
                </div>
              )}
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
                        className="rounded-2xl"
                        disabled={actionLoading !== null}
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

                    {secondaryAction && (
                      <Button
                        variant="outline"
                        className="rounded-2xl border-[rgba(123,175,212,0.22)] bg-white"
                        disabled={actionLoading !== null}
                        onClick={() => runAction(secondaryAction.key, secondaryAction.action)}
                      >
                        {actionLoading === secondaryAction.key
                          ? secondaryAction.key === 'complete-session'
                            ? 'Ending session...'
                            : 'Opening next question...'
                          : secondaryAction.label}
                      </Button>
                    )}

                    {canRegenerateClosedAnalysis && (
                      <Button
                        variant="outline"
                        className="rounded-2xl border-[rgba(123,175,212,0.22)] bg-white"
                        disabled={actionLoading !== null}
                        onClick={() => runAction(`analyze-${closedAttemptType}`, () => handleAnalyzeAndClose(closedAttemptType!))}
                      >
                        {actionLoading === `analyze-${closedAttemptType}` ? 'Regenerating analysis...' : 'Regenerate analysis'}
                      </Button>
                    )}
                  </>
                ) : (
                  <div className="rounded-2xl border border-[rgba(123,175,212,0.18)] bg-[rgba(238,244,249,0.7)] px-4 py-4 text-sm text-foreground/70">
                    Switch back to the live question to run analysis or advance the session.
                  </div>
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
                    <Link href={`/teacher/session/${sessionId}/analysis`}>
                      <Button variant="outline" className="w-full rounded-2xl border-[rgba(123,175,212,0.22)] bg-white">
                        Generate final analysis
                      </Button>
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

        <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)_320px] xl:grid-cols-[260px_minmax(0,2fr)_340px]">
          <aside className="order-2 space-y-4 lg:order-1">
            <section className="rounded-3xl bg-white p-5 shadow-[0_10px_28px_rgba(28,26,36,0.05)]">
              <p className="text-[12px] uppercase tracking-[0.18em] text-foreground/45">Class snapshot</p>
              <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-3xl font-semibold text-foreground">{classSnapshot.totalResponses}</p>
                  <p className="mt-2 text-sm text-foreground/55">Responses</p>
                </div>
                <div>
                  <p className="text-3xl font-semibold text-foreground">
                    {classSnapshot.totalResponses > 0 ? `${classSnapshot.averageConfidence.toFixed(1)}/5` : '—'}
                  </p>
                  <p className="mt-2 text-sm text-foreground/55">Avg confidence</p>
                </div>
                <div>
                  <p className="text-3xl font-semibold text-foreground">{classSnapshot.clusterCount || '—'}</p>
                  <p className="mt-2 text-sm text-foreground/55">Clusters</p>
                </div>
              </div>
            </section>

            <section className="rounded-3xl bg-white p-5 shadow-[0_10px_28px_rgba(28,26,36,0.05)]">
              <p className="text-[12px] uppercase tracking-[0.18em] text-foreground/45">Legend</p>
              <div className="mt-5 space-y-4 text-sm text-foreground/68">
                <p>Bubble size = number of students</p>
                <p>Bubble color = average confidence</p>
                <div className="grid grid-cols-3 gap-2 text-xs text-foreground/55">
                  {CONFIDENCE_BINS.map((bin) => {
                    const palette = getConfidencePalette(bin.min)
                    return (
                      <div
                        key={bin.level}
                        className="rounded-2xl px-3 py-3 text-center"
                        style={{ backgroundColor: palette.badgeBg }}
                      >
                        <div className="mx-auto h-3 w-3 rounded-full" style={{ backgroundColor: palette.dot }} />
                        <p className="mt-2 font-medium" style={{ color: palette.badgeText }}>
                          {bin.label}
                        </p>
                        <p>{bin.min.toFixed(1)}-{bin.max.toFixed(1)}</p>
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-start gap-3 rounded-2xl bg-[rgba(238,244,249,0.9)] px-3 py-3">
                  <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-[rgba(123,175,212,0.6)] text-[10px] text-foreground/60">
                    ↕
                  </span>
                  <p className="leading-6">Vertical position = average confidence
                  (bottom = lower confidence, top = higher confidence)</p>
                </div>
                <div className="flex items-start gap-3 rounded-2xl bg-[rgba(255,246,220,0.72)] px-3 py-3">
                  <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[rgba(255,199,84,0.55)] text-[10px] text-foreground/60">
                    ~
                  </span>
                  <p className="leading-6">Horizontal position = reasoning pattern
                  (left = common misconception, right = Correct understanding)</p>
                </div>
              </div>
            </section>
          </aside>

          <section className="order-1 space-y-5 lg:order-2">
            <section className="rounded-3xl bg-white p-6 shadow-[0_12px_30px_rgba(28,26,36,0.05)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-[34px] font-semibold tracking-tight text-foreground">Misconception map</h2>
                  <p className="mt-2 text-sm text-foreground/55">Bubbles are positioned by inferred correctness and average confidence.</p>
                  {activeAnalysis?.source === 'fallback' && (
                    <p className="mt-2 text-xs text-foreground/45">Fallback grouping used{activeAnalysis.fallback_reason ? ` (${activeAnalysis.fallback_reason})` : ''}.</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {canCompareRevision && (
                    <div className="flex rounded-full bg-[rgba(238,244,249,0.95)] p-1">
                      <button
                        type="button"
                        onClick={() => setCompareMode('initial')}
                        className={[
                          'rounded-full px-4 py-2 text-sm font-medium transition',
                          compareMode === 'initial' ? 'bg-white text-foreground shadow-sm' : 'text-foreground/58',
                        ].join(' ')}
                      >
                        Initial
                      </button>
                      <button
                        type="button"
                        onClick={() => setCompareMode('revision')}
                        className={[
                          'rounded-full px-4 py-2 text-sm font-medium transition',
                          compareMode === 'revision' ? 'bg-white text-foreground shadow-sm' : 'text-foreground/58',
                        ].join(' ')}
                      >
                        Revision
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 rounded-[30px] bg-[rgba(248,251,255,0.9)] p-4">
                <div className="relative h-[420px] w-full overflow-hidden rounded-[28px] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.96),rgba(242,248,252,0.92)_58%,rgba(234,243,250,0.82)_100%)] md:h-[480px] xl:h-[520px]">
                  {visibleClusters.length === 0 ? (
                    <div className="flex h-full items-center justify-center rounded-[28px] border border-dashed border-[rgba(123,175,212,0.24)] bg-white/65 text-sm text-foreground/55">
                      {viewedAnalysisStatus === 'failed'
                        ? 'Analysis failed for this question. Retry analysis to generate cluster visualization.'
                        : isViewingCurrentQuestion
                          ? 'No analysis generated yet.'
                          : 'No analysis generated yet for this question.'}
                    </div>
                  ) : (
                    <svg
                      viewBox={`0 0 ${CHART_VIEWBOX_WIDTH} ${CHART_VIEWBOX_HEIGHT}`}
                      className="h-full w-full"
                      role="img"
                      aria-label="Misconception map"
                    >
                      <defs>
                        <filter id="bubble-shadow" x="-20%" y="-20%" width="140%" height="140%">
                          <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="rgba(28,26,36,0.16)" />
                        </filter>
                      </defs>
                      <rect x="42" y="36" width="248" height="458" rx="30" fill="rgba(255,240,236,0.62)" />
                      <rect x="326" y="36" width="248" height="458" rx="30" fill="rgba(242,246,252,0.78)" />
                      <rect x="610" y="36" width="248" height="458" rx="30" fill="rgba(236,248,239,0.72)" />
                      <line x1="66" y1="490" x2="842" y2="490" stroke="rgba(33,29,42,0.16)" strokeWidth="2" />
                      <line x1="88" y1="486" x2="88" y2="72" stroke="rgba(33,29,42,0.16)" strokeWidth="2" />
                      <line x1="450" y1="72" x2="450" y2="494" stroke="rgba(33,29,42,0.12)" strokeDasharray="8 10" strokeWidth="2" />
                      <line x1="302" y1="156" x2="838" y2="156" stroke="rgba(33,29,42,0.08)" strokeDasharray="6 10" strokeWidth="2" />
                      <line x1="302" y1="284" x2="838" y2="284" stroke="rgba(33,29,42,0.08)" strokeDasharray="6 10" strokeWidth="2" />
                      <line x1="302" y1="412" x2="838" y2="412" stroke="rgba(33,29,42,0.08)" strokeDasharray="6 10" strokeWidth="2" />
                      <text x="48" y="62" fill="rgba(33,29,42,0.68)" style={{ fontSize: 14, fontWeight: 600 }}>
                        Confidence
                      </text>
                      <text x="54" y="110" fill="rgba(33,29,42,0.48)" style={{ fontSize: 12, fontWeight: 500 }}>
                        High
                      </text>
                      <text x="52" y="286" fill="rgba(33,29,42,0.48)" style={{ fontSize: 12, fontWeight: 500 }}>
                        Mid
                      </text>
                      <text x="56" y="468" fill="rgba(33,29,42,0.48)" style={{ fontSize: 12, fontWeight: 500 }}>
                        Low
                      </text>
                      <text x="152" y="530" textAnchor="middle" fill="rgba(33,29,42,0.68)" style={{ fontSize: 14, fontWeight: 600 }}>
                        {getAxisLabel('incorrect')}
                      </text>
                      <text x="450" y="530" textAnchor="middle" fill="rgba(33,29,42,0.68)" style={{ fontSize: 14, fontWeight: 600 }}>
                        {getAxisLabel('uncertain')}
                      </text>
                      <text x="748" y="530" textAnchor="middle" fill="rgba(33,29,42,0.68)" style={{ fontSize: 14, fontWeight: 600 }}>
                        {getAxisLabel('correct')}
                      </text>
                      <text x="450" y="552" textAnchor="middle" fill="rgba(33,29,42,0.48)" style={{ fontSize: 12, fontWeight: 500 }}>
                        Understanding / correctness
                      </text>
                      {visibleClusters
                        .slice()
                        .sort((a, b) => {
                          const aSelected = a.cluster_id === selectedCluster?.cluster_id
                          const bSelected = b.cluster_id === selectedCluster?.cluster_id
                          if (aSelected === bSelected) return a.count - b.count
                          return aSelected ? 1 : -1
                        })
                        .map((cluster) => {
                          const placement = bubblePlacements.get(cluster.cluster_id)
                          const palette = getConfidencePalette(cluster.average_confidence)
                          const selected = cluster.cluster_id === selectedCluster?.cluster_id
                          const hovered = cluster.cluster_id === hoveredClusterId
                          const radius = placement?.radius ?? 78
                          const compact = radius * 2 < 170
                          const tiny = radius * 2 < 128
                          const showSecondaryText = !tiny
                          const labelLines = showSecondaryText
                            ? wrapBubbleLabel(cluster.label, compact ? 14 : 18, compact ? 2 : 3)
                            : []
                          const labelLineHeight = compact ? 13 : 15
                          const countLineHeight = tiny ? 16 : compact ? 18 : 20
                          const confidenceLineHeight = compact ? 12 : 14
                          const gapAfterLabel = labelLines.length > 0 ? (compact ? 5 : 7) : 0
                          const gapAfterCount = showSecondaryText ? (compact ? 5 : 7) : 0
                          const labelBlockHeight = labelLines.length > 0 ? labelLineHeight * labelLines.length : 0
                          const totalTextHeight =
                            labelBlockHeight +
                            gapAfterLabel +
                            countLineHeight +
                            gapAfterCount +
                            (showSecondaryText ? confidenceLineHeight : 0)
                          const blockStartY = -totalTextHeight / 2
                          const labelCenterY = blockStartY + labelBlockHeight / 2
                          const countY = blockStartY + labelBlockHeight + gapAfterLabel + countLineHeight / 2
                          const confidenceY = countY + countLineHeight / 2 + gapAfterCount + confidenceLineHeight / 2

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
                                  r={radius + 8}
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
                                strokeWidth={selected ? 5 : 3}
                                filter="url(#bubble-shadow)"
                                opacity={hovered && !selected ? 0.96 : 1}
                              />
                             
                              <text
                                x="0"
                                y={showSecondaryText ? -confidenceY / 2 : 0}  // ← shift count UP by half the gap
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fill="#211d2a"
                                style={{ fontSize: tiny ? 14 : compact ? 15 : 17, fontWeight: 700 }}
                              >
                                {tiny ? `${cluster.count}` : formatResponsesLabel(cluster.count)}
                              </text>
                              {showSecondaryText && (
                                <text
                                  x="0"
                                  y={confidenceY / 2}   // ← shift confidence DOWN by same amount
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                  fill="rgba(33,29,42,0.72)"
                                  style={{ fontSize: compact ? 12 : 14, fontWeight: 500 }}
                                >
                                  Avg confidence {cluster.average_confidence.toFixed(1)}/5
                                </text>
                              )}
                              <title>
                                {getClusterDisplayLabel(cluster.label)} - {formatResponsesLabel(cluster.count)} - avg confidence{' '}
                                {cluster.average_confidence.toFixed(1)}/5
                              </title>
                            </g>
                          )
                        })}
                    </svg>
                  )}
                </div>
              </div>

              <div className="mt-5 grid gap-4 rounded-3xl border border-[rgba(123,175,212,0.14)] bg-white px-5 py-5 md:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-foreground/42">Most common understanding</p>
                  <p className="mt-3 text-xl font-semibold text-foreground">
                    {visibleClusters[0] ? getClusterDisplayLabel(visibleClusters[0].label) : '—'}
                  </p>
                  <p className="mt-2 text-lg text-foreground/76">
                    {visibleClusters[0] ? formatResponsesLabel(visibleClusters[0].count) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-foreground/42">Highest confidence</p>
                  <p className="mt-3 text-xl font-semibold text-foreground">
                    {visibleClusters.length > 0
                      ? getClusterDisplayLabel(visibleClusters.slice().sort((a, b) => b.average_confidence - a.average_confidence)[0].label)
                      : '—'}
                  </p>
                  <p className="mt-2 text-lg text-foreground/76">
                    {visibleClusters.length > 0
                      ? `${visibleClusters.slice().sort((a, b) => b.average_confidence - a.average_confidence)[0].average_confidence.toFixed(1)}/5`
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-foreground/42">Lowest confidence</p>
                  <p className="mt-3 text-xl font-semibold text-foreground">
                    {visibleClusters.length > 0
                      ? getClusterDisplayLabel(visibleClusters.slice().sort((a, b) => a.average_confidence - b.average_confidence)[0].label)
                      : '—'}
                  </p>
                  <p className="mt-2 text-lg text-foreground/76">
                    {visibleClusters.length > 0
                      ? `${visibleClusters.slice().sort((a, b) => a.average_confidence - b.average_confidence)[0].average_confidence.toFixed(1)}/5`
                      : '—'}
                  </p>
                </div>
              </div>
            </section>
          </section>

          <aside className="order-3 space-y-4 lg:sticky lg:top-24">
            <section className="rounded-3xl bg-white p-5 shadow-[0_10px_28px_rgba(28,26,36,0.05)]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] uppercase tracking-[0.18em] text-foreground/45">
                  Clusters ({visibleClusters.length})
                </p>
              </div>

              <div className="mt-4 space-y-2">
                {visibleClusters.length === 0 ? (
                  <p className="text-sm text-foreground/55">Clusters will appear here after analysis.</p>
                ) : (
                  visibleClusters.map((cluster, index) => {
                    const palette = getConfidencePalette(cluster.average_confidence)
                    const selected = cluster.cluster_id === selectedCluster?.cluster_id
                    return (
                      <button
                        key={cluster.cluster_id}
                        type="button"
                        onClick={() => setActiveSelectedClusterId(cluster.cluster_id)}
                        className={[
                          'flex w-full items-start justify-between gap-3 rounded-2xl px-3 py-3 text-left transition',
                          selected ? 'bg-[rgba(238,244,249,0.92)]' : 'hover:bg-[rgba(248,251,255,0.9)]',
                        ].join(' ')}
                      >
                        <div className="flex min-w-0 gap-3">
                          <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: palette.dot }} />
                          <div className="min-w-0">
                            <p className="truncate text-[17px] font-semibold text-foreground">
                              {getClusterDisplayLabel(cluster.label)}
                            </p>
                            <p className="mt-2 text-sm text-foreground/58">
                              {formatResponsesLabel(cluster.count)}
                            </p>
                          </div>
                        </div>
                        <span
                          className="rounded-xl px-3 py-2 text-sm font-semibold"
                          style={{ backgroundColor: palette.badgeBg, color: palette.badgeText }}
                        >
                          {cluster.average_confidence.toFixed(1)}/5
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </section>

            <section className="rounded-3xl bg-white p-5 shadow-[0_10px_28px_rgba(28,26,36,0.05)]">
              <p className="text-[12px] uppercase tracking-[0.18em] text-foreground/45">Selected cluster</p>
              {selectedCluster ? (
                <>
                  <div
                    className="mt-5 rounded-[28px] border px-4 py-4"
                    style={{
                      backgroundColor: getConfidencePalette(selectedCluster.average_confidence).badgeBg,
                      borderColor: getConfidencePalette(selectedCluster.average_confidence).border,
                    }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <span
                          className="mt-1 h-3.5 w-3.5 rounded-full"
                          style={{
                            backgroundColor: getConfidencePalette(selectedCluster.average_confidence).dot,
                          }}
                        />
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-[28px] font-semibold leading-tight text-foreground">
                              {getClusterDisplayLabel(selectedCluster.label)}
                            </h3>
                            <Badge className="rounded-full border border-[rgba(123,175,212,0.22)] bg-white/80 px-3 py-1 text-xs font-medium text-foreground shadow-none">
                              {getClusterCategoryBadgeLabel(selectedCluster.label)}
                            </Badge>
                          </div>
                          <p className="mt-2 text-sm text-foreground/62">{formatResponsesLabel(selectedCluster.count)}</p>
                        </div>
                      </div>
                      <Badge
                        className="rounded-full border-0 px-3 py-1 text-sm font-semibold shadow-none"
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.78)',
                          color: getConfidencePalette(selectedCluster.average_confidence).badgeText,
                        }}
                      >
                        {selectedCluster.average_confidence.toFixed(1)}/5
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-6">
                    <p className="text-[12px] uppercase tracking-[0.18em] text-foreground/45">Cluster summary</p>
                    <p className="mt-3 rounded-2xl bg-[rgba(248,251,255,0.92)] px-4 py-4 text-[16px] leading-8 text-foreground/74">
                      {selectedCluster.summary}
                    </p>
                  </div>

                  
                </>
              ) : (
                <p className="mt-4 text-sm text-foreground/58">Select a cluster to inspect the representative explanation and sample responses.</p>
              )}

              <button
                type="button"
                onClick={() => setShowRawResponses((value) => !value)}
                className="mt-6 w-full rounded-2xl border border-[rgba(123,175,212,0.22)] bg-white px-4 py-3 text-sm font-medium text-foreground/74"
              >
                  {showRawResponses ? 'Hide Example Responses' : 'View Example Responses'}
              </button>
            </section>

            {showRawResponses && (
              <section className="rounded-3xl bg-white p-5 shadow-[0_10px_28px_rgba(28,26,36,0.05)]">
                <p className="text-[12px] uppercase tracking-[0.18em] text-foreground/45">Student responses</p>
                <div className="mt-4 max-h-[360px] space-y-3 overflow-y-auto pr-1">
                  {viewedResponses.length === 0 ? (
                    <p className="text-sm text-foreground/55">No submissions yet for this question attempt.</p>
                  ) : (
                    viewedResponses.map((response) => (
                      <div key={response.response_id} className="rounded-2xl bg-[rgba(238,244,249,0.92)] px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-foreground">
                            {response.session_participants?.anonymized_label || 'Participant'}
                          </p>
                          <p className="text-sm text-foreground/55">{response.confidence}/5</p>
                        </div>
                        <p className="mt-2 text-sm leading-7 text-foreground/76">{response.answer}</p>
                      </div>
                    ))
                  )}
                </div>
              </section>
            )}
          </aside>
        </div>

      </div>
    </main>
  )
}
