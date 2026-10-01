'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { HistoricalEvidenceDrawer } from '@/components/historical-evidence-drawer'
import { TeacherLogoutButton } from '@/components/teacher-logout-button'
import {
  ShieldAlert,
  CheckCircle2,
  Eye,
  Plus,
  Play,
  Pause,
  ArrowLeft,
  Sparkles,
  BookOpen,
  HelpCircle,
  Database,
  Layers,
} from 'lucide-react'
import type { CandidateMonitoringGoal, MonitoringGoal } from '@/lib/services/monitoring-goals-service'

export default function MonitoringGoalsPage() {
  const [candidates, setCandidates] = useState<CandidateMonitoringGoal[]>([])
  const [activeGoals, setActiveGoals] = useState<MonitoringGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notification, setNotification] = useState<string | null>(null)

  // Inspection Drawer State
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateMonitoringGoal | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/teacher/monitoring-goals')
      const payload = await res.json()
      if (!res.ok || !payload.success) {
        throw new Error(payload?.error || 'Failed to load monitoring goals data')
      }
      setCandidates(payload.candidates || [])
      setActiveGoals(payload.activeGoals || [])
    } catch (err: any) {
      console.error('Error loading monitoring goals:', err)
      setError(err?.message || 'Failed to connect to monitoring goals service')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleCreateGoal = async (candidate: CandidateMonitoringGoal) => {
    try {
      const res = await fetch('/api/teacher/monitoring-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateKey: candidate.candidateKey,
          title: candidate.title,
          description: candidate.description,
          originSessionId: candidate.evidenceItems[0]?.sessionId || null,
          originQuestionId: candidate.evidenceItems[0]?.questionId || null,
          evidenceSummary: {
            supportingSessionsCount: candidate.evidenceItems.length,
            sessions: candidate.evidenceItems.map((e) => ({
              code: e.sessionCode,
              date: e.sessionDate,
              questionPos: e.questionPosition,
            })),
          },
        }),
      })

      const payload = await res.json()
      if (!res.ok || !payload.success) {
        throw new Error(payload?.error || 'Failed to create monitoring goal')
      }

      setNotification(payload.message || 'Monitoring goal created successfully.')
      setTimeout(() => setNotification(null), 6000)
      loadData()
    } catch (err: any) {
      console.error('Failed to create goal:', err)
      setError(err?.message || 'Failed to create goal')
    }
  }

  const handleToggleStatus = async (goalId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'active' ? 'paused' : 'active'
    try {
      const res = await fetch('/api/teacher/monitoring-goals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalId, status: nextStatus }),
      })
      const payload = await res.json()
      if (!res.ok || !payload.success) {
        throw new Error(payload?.error || 'Failed to update goal status')
      }
      loadData()
    } catch (err: any) {
      console.error('Failed to update goal status:', err)
    }
  }

  const isCandidateCreated = (key: string) => {
    return activeGoals.some((g) => g.candidateKey === key)
  }

  return (
    <main className="min-h-screen bg-background pb-16">
      {/* Header */}
      <header className="border-b border-border/40 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/teacher/dashboard">
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-foreground">Historical Evidence & Monitoring Goals</h1>
                <Badge variant="outline" className="text-xs bg-primary/5 text-primary border-primary/20">
                  Bounded Agency
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Seed teacher-authored persistent monitoring goals from the 7 historical May 2026 classroom sessions
              </p>
            </div>
          </div>
          <TeacherLogoutButton />
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
        {/* Notification Banner */}
        {notification && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-sm flex items-center gap-3 animate-in fade-in duration-300">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            <span className="font-medium">{notification}</span>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center justify-between">
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={() => setError(null)}>
              Dismiss
            </Button>
          </div>
        )}

        {/* SECTION 1: Active Teacher-Authored Monitoring Goals */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                Active Teacher-Authored Monitoring Goals ({activeGoals.length})
              </h2>
              <p className="text-xs text-muted-foreground">
                Goals created by the lecturer that MeshQuiz will check against future classroom evidence.
              </p>
            </div>
          </div>

          {loading ? (
            <Card className="p-8 text-center text-muted-foreground text-sm">Loading monitoring goals...</Card>
          ) : activeGoals.length === 0 ? (
            <Card className="p-8 text-center border-dashed space-y-3">
              <div className="text-3xl">🎯</div>
              <p className="text-sm font-medium text-foreground">No active monitoring goals created yet</p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Inspect the candidate goals below derived from historical classroom evidence and click "Create monitoring goal" to activate them.
              </p>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {activeGoals.map((goal) => (
                <Card key={goal.id} className="border-border/60 shadow-sm hover:border-primary/40 transition-all flex flex-col justify-between">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between mb-2">
                      <Badge
                        variant="outline"
                        className={
                          goal.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                            : 'bg-muted text-muted-foreground'
                        }
                      >
                        {goal.status === 'active' ? 'Active Monitoring' : 'Paused'}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {new Date(goal.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <CardTitle className="text-base font-bold leading-snug">{goal.title}</CardTitle>
                    <CardDescription className="text-xs text-muted-foreground line-clamp-2 mt-1">
                      {goal.description}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="py-2 text-xs space-y-2 border-t border-border/30 mt-auto">
                    <div className="flex items-center justify-between text-muted-foreground pt-2">
                      <span>Provenance:</span>
                      <Badge variant="secondary" className="text-[10px]">
                        Teacher-Authored ({goal.originType})
                      </Badge>
                    </div>
                    {goal.evidenceSummary?.supportingSessionsCount && (
                      <div className="flex items-center justify-between text-muted-foreground text-[11px]">
                        <span>Supported by:</span>
                        <span>{goal.evidenceSummary.supportingSessionsCount} Historical Sessions</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium pt-1 border-t border-border/30">
                      <span>Surfacing threshold:</span>
                      <span className="text-primary font-semibold">≥ 30% response prevalence</span>
                    </div>
                    <div className="bg-muted/40 p-2 rounded-md text-[11px] text-muted-foreground leading-relaxed">
                      💡 MeshQuiz continuously evaluates live student reasoning clusters against this goal and surfaces evidence to your floating assistant when threshold is met.
                    </div>
                  </CardContent>

                  <CardFooter className="pt-3 border-t border-border/30 flex items-center justify-between">
                    <Button
                      size="sm"
                      variant={goal.status === 'active' ? 'outline' : 'default'}
                      onClick={() => handleToggleStatus(goal.id, goal.status)}
                      className="text-xs gap-1.5 w-full"
                    >
                      {goal.status === 'active' ? (
                        <>
                          <Pause className="h-3.5 w-3.5" /> Pause Monitoring
                        </>
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5" /> Resume Monitoring
                        </>
                      )}
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* SECTION 2: Candidate Monitoring Goals Derived from Historical Evidence */}
        <section className="space-y-4 pt-4 border-t border-border/40">
          <div>
            <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              Candidate Monitoring Goals from Historical Evidence
            </h2>
            <p className="text-xs text-muted-foreground">
              Derived from clean analysis runs across the 7 completed May 2026 classroom sessions (647 student responses).
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-3">
            {candidates.map((candidate) => {
              const created = isCandidateCreated(candidate.candidateKey)

              return (
                <Card
                  key={candidate.candidateKey}
                  className="border-border/80 shadow-md flex flex-col justify-between transition-all hover:border-primary/50 bg-card"
                >
                  <CardHeader className="pb-4">
                    <div className="mb-3">
                      {created ? (
                        <Badge className="bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border-emerald-600/30 text-xs font-semibold">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Teacher-authored monitoring goal (Active)
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs bg-secondary text-secondary-foreground">
                          Candidate monitoring goal derived from historical evidence
                        </Badge>
                      )}
                    </div>

                    <CardTitle className="text-lg font-bold text-foreground leading-tight">
                      {candidate.title}
                    </CardTitle>
                    <CardDescription className="text-xs text-muted-foreground leading-relaxed mt-2">
                      {candidate.description}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-3 py-2 text-xs border-t border-border/40">
                    <div className="bg-muted/40 p-3 rounded-lg space-y-1.5">
                      <span className="font-semibold text-foreground text-[11px] block">
                        Supported by historical evidence from:
                      </span>
                      <ul className="space-y-1 text-muted-foreground text-[11px] list-disc list-inside">
                        {candidate.evidenceItems.map((e, idx) => (
                          <li key={idx}>
                            Session {e.sessionCode} ({e.sessionDate}) — {e.topicDomain} Q{e.questionPosition}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="text-[11px] text-muted-foreground italic leading-tight">
                      Rationale: {candidate.pedagogicalRationale}
                    </div>
                  </CardContent>

                  <CardFooter className="pt-4 border-t border-border/40 flex items-center justify-between gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedCandidate(candidate)
                        setIsDrawerOpen(true)
                      }}
                      className="text-xs flex-1 gap-1.5"
                    >
                      <Eye className="h-3.5 w-3.5" /> Inspect evidence
                    </Button>

                    {!created ? (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleCreateGoal(candidate)}
                        className="text-xs flex-1 gap-1.5"
                      >
                        <Plus className="h-3.5 w-3.5" /> Create goal
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" disabled className="text-xs flex-1 opacity-80">
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Goal Active
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              )
            })}
          </div>
        </section>
      </div>

      {/* Evidence Inspection Drawer Modal */}
      <HistoricalEvidenceDrawer
        candidate={selectedCandidate}
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false)
          setSelectedCandidate(null)
        }}
        isAlreadyCreated={selectedCandidate ? isCandidateCreated(selectedCandidate.candidateKey) : false}
        onCreateGoal={handleCreateGoal}
      />
    </main>
  )
}
