'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft,
  Check,
  Eye,
  MessageSquarePlus,
  Pin,
  Sparkles,
  Target,
  X,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  History,
  Info,
  Clock,
  CheckCircle2,
  Quote,
  ShieldCheck
} from 'lucide-react'
import type { BoundedAgentObservation } from '@/lib/services/bounded-agency-service'

type Props = {
  observations: BoundedAgentObservation[]
  onInspectCluster: (clusterId: string) => void
}

export function AgentSurfacingAssistant({ observations, onInspectCluster }: Props) {
  const [mounted, setMounted] = useState(false)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set())
  const [savedNotes, setSavedNotes] = useState<Record<string, string>>({})
  const [noteInput, setNoteInput] = useState<Record<string, string>>({})
  const [activeNoteEditId, setActiveNoteEditId] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedObservationId, setSelectedObservationId] = useState<string | null>(null)
  const [showRuleForObsId, setShowRuleForObsId] = useState<string | null>(null)
  const [persistenceFeedback, setPersistenceFeedback] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const visibleObservations = observations.filter((obs) => !dismissedIds.has(obs.observationId))

  const selectedObservation =
    visibleObservations.find((obs) => obs.observationId === selectedObservationId) ?? null

  useEffect(() => {
    if (selectedObservationId && !visibleObservations.some((obs) => obs.observationId === selectedObservationId)) {
      setSelectedObservationId(null)
    }
  }, [selectedObservationId, visibleObservations])

  if (!mounted || visibleObservations.length === 0) return null

  const handleOpen = () => {
    setIsExpanded(true)
    if (!selectedObservationId) {
      setSelectedObservationId(visibleObservations[0].observationId)
    }
  }

  const handleClose = () => {
    setIsExpanded(false)
    setSelectedObservationId(null)
    setActiveNoteEditId(null)
    setShowRuleForObsId(null)
  }

  const handleDismiss = (observationId: string) => {
    setDismissedIds((prev) => new Set([...prev, observationId]))
    if (selectedObservationId === observationId) {
      setSelectedObservationId(null)
      setActiveNoteEditId(null)
      setShowRuleForObsId(null)
    }
  }

  const showPersistenceNotification = (msg: string) => {
    setPersistenceFeedback(msg)
    setTimeout(() => setPersistenceFeedback(null), 4000)
  }

  const handleInspect = async (obs: BoundedAgentObservation) => {
    onInspectCluster(obs.clusterId)
    setPinnedIds((prev) => new Set([...prev, obs.observationId]))
    showPersistenceNotification('Observation inspected & marked reviewed')
    try {
      await fetch('/api/teacher/annotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: obs.sessionId,
          questionId: obs.questionId,
          clusterId: obs.clusterId,
          actionType: 'inspected',
          lecturerDecision: 'Inspected evidence for autonomous observation checkpoint',
        }),
      })
    } catch {
      // Background logging is non-blocking
    }
  }

  const handlePin = async (obs: BoundedAgentObservation) => {
    if (pinnedIds.has(obs.observationId)) return

    try {
      setIsSaving(true)
      const res = await fetch('/api/teacher/annotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: obs.sessionId,
          questionId: obs.questionId,
          clusterId: obs.clusterId,
          actionType: 'pinned',
          customLabel: obs.title,
          lecturerDecision: `${obs.prevalencePercentage}% prevalence observation pinned`,
        }),
      })

      if (res.ok) {
        setPinnedIds((prev) => new Set([...prev, obs.observationId]))
        showPersistenceNotification('Saved to session memory & added to lecturer monitoring context')
      }
    } catch (err) {
      console.error('[AgentSurfacingAssistant] error pinning observation', err)
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveNote = async (obs: BoundedAgentObservation) => {
    const noteText = (noteInput[obs.observationId] || '').trim()
    if (!noteText) return

    try {
      setIsSaving(true)
      const res = await fetch('/api/teacher/annotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: obs.sessionId,
          questionId: obs.questionId,
          clusterId: obs.clusterId,
          actionType: 'annotated',
          lecturerInterpretation: noteText,
          customLabel: obs.title,
          lecturerDecision: 'Teacher note added to AI observation',
        }),
      })

      if (res.ok) {
        setSavedNotes((prev) => ({ ...prev, [obs.observationId]: noteText }))
        setPinnedIds((prev) => new Set([...prev, obs.observationId]))
        setActiveNoteEditId(null)
        showPersistenceNotification('Saved to session memory for summary & longitudinal context')
      }
    } catch (err) {
      console.error('[AgentSurfacingAssistant] error saving note', err)
    } finally {
      setIsSaving(false)
    }
  }

  const getCheckpointStatus = (obs: BoundedAgentObservation) => {
    if (dismissedIds.has(obs.observationId)) return 'dismissed'
    if (pinnedIds.has(obs.observationId) || savedNotes[obs.observationId] || obs.humanCheckpointStatus === 'accepted') {
      return 'accepted'
    }
    return 'pending'
  }

  const renderCheckpointBadge = (obs: BoundedAgentObservation) => {
    const status = getCheckpointStatus(obs)
    if (status === 'accepted') {
      return (
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[10px] gap-1 font-semibold">
          <CheckCircle2 className="h-3 w-3" /> AI SURFACED → REVIEWED BY YOU
        </Badge>
      )
    }
    if (status === 'dismissed') {
      return (
        <Badge variant="outline" className="bg-muted text-muted-foreground text-[10px] gap-1 font-medium">
          Dismissed
        </Badge>
      )
    }
    return (
      <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 text-[10px] gap-1 font-semibold">
        <Clock className="h-3 w-3 animate-pulse" /> AI SURFACED → AWAITING YOUR REVIEW
      </Badge>
    )
  }

  const assistantSurface = (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>

          <div>
            <div className="text-sm font-semibold">AI Assistant</div>
            <div className="text-xs text-muted-foreground">
              {visibleObservations.length} observation
              {visibleObservations.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleClose}
          aria-label="Close assistant"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Persistence Feedback Alert */}
      {persistenceFeedback && (
        <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-4 py-2 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2 font-medium">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span>{persistenceFeedback}</span>
        </div>
      )}

      {/* Observation list */}
      {!selectedObservation ? (
        <div className="max-h-[540px] overflow-y-auto p-3">
          <div className="mb-3 px-1">
            <p className="text-sm font-medium">AI Observations</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Surfaced reasoning evidence for lecturer interpretation & review.
            </p>
          </div>

          <div className="space-y-2.5">
            {visibleObservations.map((obs) => (
              <button
                key={obs.observationId}
                type="button"
                onClick={() => setSelectedObservationId(obs.observationId)}
                className="
                  w-full rounded-xl border border-border
                  bg-background p-3.5 text-left
                  transition-colors
                  hover:bg-muted/50
                  focus-visible:outline-none
                  focus-visible:ring-2
                  focus-visible:ring-ring
                "
              >
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground leading-snug">
                        {obs.title}
                      </p>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>

                    {obs.triggerDetails?.goalTitle && (
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground/80">Monitored Dimension:</span> {obs.triggerDetails.goalTitle}
                      </p>
                    )}

                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {obs.description}
                    </p>

                    <div className="pt-2 flex items-center justify-between border-t border-border/30">
                      {renderCheckpointBadge(obs)}
                      <span className="text-[11px] text-foreground font-bold">
                        {obs.prevalencePercentage}% response share
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Observation detail view structured strictly around evidence chain */
        <div className="max-h-[540px] overflow-y-auto">
          {/* Header */}
          <div className="border-b border-border px-4 py-3 bg-muted/20">
            <button
              type="button"
              onClick={() => setSelectedObservationId(null)}
              className="mb-2.5 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              All observations
            </button>

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  AI Observation
                </div>
                <h3 className="text-base font-bold text-foreground leading-tight">
                  {selectedObservation.title}
                </h3>
                {selectedObservation.triggerDetails?.goalTitle && (
                  <div className="text-xs text-muted-foreground pt-0.5">
                    <span className="font-semibold text-foreground/80">Monitored Dimension: </span>
                    {selectedObservation.triggerDetails.goalTitle}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4 p-4">
            {/* 1. LECTURER CHECKPOINT STATUS HEADER */}
            <div className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-background">
              <span className="text-xs font-semibold text-muted-foreground">Lecturer Checkpoint:</span>
              {renderCheckpointBadge(selectedObservation)}
            </div>

            {/* 2. WHAT I NOTICED / REASONING EVIDENCE */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> What I Noticed (Reasoning Evidence)
                </h4>
                <Badge variant="secondary" className="text-[11px] font-bold">
                  {selectedObservation.prevalencePercentage}% of responses
                </Badge>
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground bg-muted/30 p-3 rounded-xl border border-border/60">
                {selectedObservation.description}
              </p>

              {/* Render supporting clusters if available */}
              {selectedObservation.supportingClusters && selectedObservation.supportingClusters.length > 0 && (
                <div className="space-y-2 pt-1">
                  <span className="text-[11px] font-semibold text-foreground block">
                    Supporting Reasoning Patterns ({selectedObservation.supportingClusters.length}):
                  </span>
                  {selectedObservation.supportingClusters.map((cluster) => (
                    <div key={cluster.clusterId} className="rounded-xl border border-border/80 bg-background p-3 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-foreground">{cluster.label}</span>
                        <Badge variant="outline" className="text-[10px] font-semibold">
                          {cluster.count} responses ({cluster.percentage}%)
                        </Badge>
                      </div>

                      {cluster.summary && (
                        <p className="text-[11px] text-muted-foreground">{cluster.summary}</p>
                      )}

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/30">
                        <span>Average Confidence:</span>
                        <span className="font-semibold text-foreground">{cluster.averageConfidence.toFixed(1)} / 5</span>
                      </div>

                      {cluster.evidenceQuotes && cluster.evidenceQuotes.length > 0 && (
                        <div className="pt-1 space-y-1">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase flex items-center gap-1">
                            <Quote className="h-3 w-3 text-primary" /> Representative Student Quote:
                          </span>
                          <p className="text-[11px] italic bg-muted/40 p-2 rounded-lg text-foreground/90 border border-border/40">
                            "{cluster.evidenceQuotes[0].exact_quote}"
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 3. WHY YOU'RE SEEING THIS (CAUSAL CHAIN) */}
            <div className="rounded-xl border border-border/80 bg-muted/30 p-3.5 space-y-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-primary" /> Why You're Seeing This
              </span>

              <div className="space-y-2 text-xs">
                {selectedObservation.triggerType === 'active_monitoring_goal_match' && (
                  <>
                    <div className="bg-background p-2.5 rounded-lg border border-border/60 space-y-1">
                      <span className="text-[11px] text-muted-foreground block">1. You asked MeshQuiz to monitor:</span>
                      <span className="font-bold text-foreground block">{selectedObservation.triggerDetails?.goalTitle || 'Active Monitoring Goal'}</span>
                    </div>

                    <div className="bg-background p-2.5 rounded-lg border border-border/60 space-y-1">
                      <span className="text-[11px] text-muted-foreground block">2. AI observed:</span>
                      <span className="font-bold text-foreground block">{selectedObservation.prevalencePercentage}% of responses matched this monitoring dimension</span>
                    </div>

                    <div className="bg-background p-2.5 rounded-lg border border-border/60 space-y-1">
                      <span className="text-[11px] text-muted-foreground block">3. Surfacing rule:</span>
                      <span className="font-medium text-foreground block">Surface when ≥ 30% of responses match</span>
                    </div>

                    <div className="bg-primary/10 p-2.5 rounded-lg border border-primary/20 text-primary font-bold text-xs">
                      Result: {selectedObservation.prevalencePercentage}% ≥ 30% → Observation surfaced for review
                    </div>
                  </>
                )}

                {(selectedObservation.triggerType === 'longitudinal_lecturer_focus_match' || selectedObservation.type === 'prior_discussion_focus') && (
                  <>
                    <div className="bg-background p-2.5 rounded-lg border border-border/60 space-y-1">
                      <span className="text-[11px] text-muted-foreground block">1. Longitudinal trigger:</span>
                      <span className="font-bold text-foreground block">Previous lecturer discussion focus reappeared</span>
                    </div>

                    <div className="bg-background p-2.5 rounded-lg border border-border/60 space-y-1">
                      <span className="text-[11px] text-muted-foreground block">2. Current vs Previous occurrence:</span>
                      <span className="font-bold text-foreground block">
                        Current: {selectedObservation.prevalencePercentage}% · Previous: {selectedObservation.longitudinalDetails?.priorPrevalence ?? '—'}%
                      </span>
                    </div>

                    <div className="bg-primary/10 p-2.5 rounded-lg border border-primary/20 text-primary font-bold text-xs">
                      Result: Reappeared from prior lecturer focus in Session {selectedObservation.longitudinalDetails?.priorSessionCode || '9U69QQ'}
                    </div>
                  </>
                )}

                {selectedObservation.triggerType === 'longitudinal_prevalence_shift' && (
                  <>
                    <div className="bg-background p-2.5 rounded-lg border border-border/60 space-y-1">
                      <span className="text-[11px] text-muted-foreground block">1. Longitudinal trigger:</span>
                      <span className="font-bold text-foreground block">Significant prevalence shift across sessions</span>
                    </div>

                    <div className="bg-primary/10 p-2.5 rounded-lg border border-primary/20 text-primary font-bold text-xs">
                      Result: Shift delta of {selectedObservation.longitudinalDetails?.prevalenceDelta && selectedObservation.longitudinalDetails.prevalenceDelta > 0 ? '+' : ''}{selectedObservation.longitudinalDetails?.prevalenceDelta ?? '—'} percentage points (≥15% threshold)
                    </div>
                  </>
                )}

                {selectedObservation.triggerType === 'stream_prevalence_threshold' && (
                  <>
                    <div className="bg-background p-2.5 rounded-lg border border-border/60 space-y-1">
                      <span className="text-[11px] text-muted-foreground block">1. Stream trigger:</span>
                      <span className="font-bold text-foreground block">Prominent reasoning pattern in current session</span>
                    </div>

                    <div className="bg-primary/10 p-2.5 rounded-lg border border-primary/20 text-primary font-bold text-xs">
                      Result: {selectedObservation.prevalencePercentage}% ≥ 30% threshold → Observation surfaced
                    </div>
                  </>
                )}
              </div>

              {/* 4. COLLAPSIBLE DECISION RULE DISCLOSURE */}
              <div className="pt-2 border-t border-border/40">
                <button
                  type="button"
                  onClick={() =>
                    setShowRuleForObsId(
                      showRuleForObsId === selectedObservation.observationId
                        ? null
                        : selectedObservation.observationId
                    )
                  }
                  className="flex items-center justify-between w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors py-1"
                >
                  <span className="font-semibold">View decision rule</span>
                  {showRuleForObsId === selectedObservation.observationId ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>

                {showRuleForObsId === selectedObservation.observationId && (
                  <div className="mt-2 rounded-lg bg-background p-3 border border-border/60 text-xs space-y-2 animate-in fade-in duration-150">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">Decision rule:</span>
                      <span className="font-mono text-primary font-semibold break-all">{selectedObservation.decisionRuleExecuted}</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">Condition:</span>
                      <span className="font-medium text-foreground">Prevalence ≥ configured monitoring threshold</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">Observed:</span>
                      <span className="font-bold text-foreground">{selectedObservation.prevalencePercentage}%</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">Threshold:</span>
                      <span className="font-medium text-foreground">30%</span>
                    </div>
                    <div className="flex justify-between text-[11px] pt-1 border-t border-border/30 text-emerald-600 font-bold">
                      <span>Result:</span>
                      <span>Condition satisfied</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 5. NEUTRAL RESPONSIBILITY CLARIFICATION NOTICE */}
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-blue-900 dark:text-blue-300 flex items-start gap-2.5">
              <ShieldCheck className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
              <p className="leading-relaxed text-[11px]">
                This observation is surfaced for lecturer interpretation. It does not determine whether the responses are correct or incorrect, and it does not determine what the lecturer should do next.
              </p>
            </div>

            {/* 6. LONGITUDINAL PROVENANCE (If applicable) */}
            {(selectedObservation.longitudinalDetails || selectedObservation.type === 'prior_discussion_focus' || selectedObservation.type === 'prevalence_shift') && (
              <div className="rounded-xl border border-border/80 bg-slate-50 dark:bg-slate-900/40 p-3.5 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-foreground flex items-center gap-1.5">
                    <History className="h-3.5 w-3.5 text-primary" /> Longitudinal Provenance
                  </span>
                  <Badge variant="outline" className="text-[10px] font-mono bg-background">
                    Session {selectedObservation.longitudinalDetails?.priorSessionCode || '9U69QQ'}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                  <div>
                    <span className="text-muted-foreground block">Observed Date:</span>
                    <span className="font-medium text-foreground">{selectedObservation.longitudinalDetails?.priorSessionDate || '2026-05-25'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Topic Domain:</span>
                    <span className="font-medium text-foreground">{selectedObservation.longitudinalDetails?.priorTopicDomain || 'Hash Tables'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Previous Prevalence:</span>
                    <span className="font-medium text-foreground">{selectedObservation.longitudinalDetails?.priorPrevalence ?? 19}%</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Current Prevalence:</span>
                    <span className="font-medium text-foreground">
                      {selectedObservation.prevalencePercentage}% ({selectedObservation.longitudinalDetails?.prevalenceDelta && selectedObservation.longitudinalDetails.prevalenceDelta > 0 ? '+' : ''}{selectedObservation.longitudinalDetails?.prevalenceDelta ?? 15}%)
                    </span>
                  </div>
                </div>

                {selectedObservation.longitudinalDetails?.priorLecturerAction && (
                  <div className="text-[11px] pt-2 border-t border-border/40 text-muted-foreground">
                    <span>Previous Lecturer Action: </span>
                    <span className="font-semibold text-foreground capitalize">
                      {selectedObservation.longitudinalDetails.priorLecturerAction.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* 7. LECTURER CHECKPOINT ACTIONS */}
            <div className="space-y-2 pt-1 border-t border-border/60">
              <span className="text-xs font-bold uppercase tracking-wider text-foreground block">
                Lecturer Action
              </span>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleInspect(selectedObservation)}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Inspect responses
                </Button>

                <Button
                  size="sm"
                  variant={
                    pinnedIds.has(selectedObservation.observationId)
                      ? 'secondary'
                      : 'outline'
                  }
                  disabled={
                    isSaving || pinnedIds.has(selectedObservation.observationId)
                  }
                  onClick={() => handlePin(selectedObservation)}
                >
                  {pinnedIds.has(selectedObservation.observationId) ? (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Pinned
                    </>
                  ) : (
                    <>
                      <Pin className="mr-2 h-4 w-4" />
                      Pin
                    </>
                  )}
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setActiveNoteEditId(
                      activeNoteEditId === selectedObservation.observationId
                        ? null
                        : selectedObservation.observationId
                    )
                  }
                >
                  <MessageSquarePlus className="mr-2 h-4 w-4" />
                  Add note
                </Button>
              </div>
            </div>

            {/* Teacher note editor */}
            {activeNoteEditId === selectedObservation.observationId && (
              <div className="space-y-2 pt-1">
                <label className="text-xs font-semibold text-foreground">
                  Teacher note (saves to session memory)
                </label>

                <textarea
                  value={
                    noteInput[selectedObservation.observationId] ||
                    savedNotes[selectedObservation.observationId] ||
                    ''
                  }
                  onChange={(e) =>
                    setNoteInput((prev) => ({
                      ...prev,
                      [selectedObservation.observationId]: e.target.value,
                    }))
                  }
                  placeholder="Add your interpretation, pedagogical context, or planned discussion points..."
                  rows={3}
                  className="
                    w-full resize-none rounded-xl border border-input
                    bg-background px-3 py-2 text-xs
                    outline-none
                    placeholder:text-muted-foreground
                    focus-visible:ring-2
                    focus-visible:ring-ring
                  "
                />

                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setActiveNoteEditId(null)}
                  >
                    Cancel
                  </Button>

                  <Button
                    size="sm"
                    disabled={
                      isSaving ||
                      !(noteInput[selectedObservation.observationId] || '').trim()
                    }
                    onClick={() => handleSaveNote(selectedObservation)}
                  >
                    Save note
                  </Button>
                </div>
              </div>
            )}

            {/* Existing saved note */}
            {savedNotes[selectedObservation.observationId] &&
              activeNoteEditId !== selectedObservation.observationId && (
                <div className="rounded-xl border border-border bg-muted/30 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquarePlus className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs font-semibold">
                        Teacher note
                      </span>
                    </div>
                    <Badge variant="outline" className="text-[9px] bg-background">
                      Saved to session memory
                    </Badge>
                  </div>

                  <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                    {savedNotes[selectedObservation.observationId]}
                  </p>
                </div>
              )}

            {/* Dismiss */}
            <div className="border-t border-border pt-3">
              <Button
                size="sm"
                variant="ghost"
                className="w-full text-muted-foreground hover:text-destructive text-xs"
                onClick={() =>
                  handleDismiss(selectedObservation.observationId)
                }
              >
                Dismiss observation
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  return createPortal(
    <>
      {/* Expanded panel */}
      {isExpanded && (
        <div
          className="
            fixed bottom-[84px] right-6 z-[9999]
            w-[440px] max-w-[calc(100vw-32px)]
            origin-bottom-right
            animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2
            duration-150
          "
        >
          {assistantSurface}
        </div>
      )}
  
      {/* Fixed bottom-right trigger */}
      <button
        type="button"
        onClick={isExpanded ? handleClose : handleOpen}
        className="
          fixed bottom-6 right-6 z-[10000]
          group flex h-12 w-12
          items-center justify-center
          rounded-full
          bg-black text-white
          shadow-lg
          transition-all duration-200
          hover:scale-105 hover:shadow-xl
          focus-visible:outline-none
          focus-visible:ring-2
          focus-visible:ring-ring
          focus-visible:ring-offset-2
        "
        aria-label={
          isExpanded
            ? 'Close assistant'
            : `Open assistant. ${visibleObservations.length} observations available.`
        }
      >
        {isExpanded ? (
          <X className="h-5 w-5" />
        ) : (
          <Target className="h-6 w-6 stroke-[2.2] transition-transform duration-200 group-hover:scale-110" />
        )}
  
        {!isExpanded && visibleObservations.length > 0 && (
          <span
            className="
              absolute -right-1 -top-1
              flex h-5 min-w-5
              items-center justify-center
              rounded-full
              border-2 border-background
              bg-white px-1
              text-[10px] font-bold
              leading-none text-black
              shadow-sm
            "
          >
            {visibleObservations.length}
          </span>
        )}
      </button>
    </>,
    document.body
  )
}