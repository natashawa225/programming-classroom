'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Bell, Eye, X, Sparkles, RefreshCw } from 'lucide-react'
import type { BoundedAgentObservation } from '@/lib/services/bounded-agency-service'

type Props = {
  observations: BoundedAgentObservation[]
  onInspectCluster: (clusterId: string) => void
}

export function AgentSurfacingBanner({ observations, onInspectCluster }: Props) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  const visibleObservations = observations.filter((obs) => !dismissedIds.has(obs.observationId))

  if (visibleObservations.length === 0) return null

  const handleDismiss = (id: string) => {
    setDismissedIds((prev) => new Set([...prev, id]))
  }

  return (
    <div className="space-y-2 my-4">
      {visibleObservations.map((obs) => (
        <div
          key={obs.observationId}
          className="flex items-start justify-between p-4 rounded-xl border border-primary/20 bg-primary/5 shadow-sm text-foreground animate-in fade-in duration-300"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
              {obs.type === 'recurring_pattern' ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] uppercase tracking-wider font-semibold">
                  AI Autonomous Observation
                </Badge>
                <span className="text-xs text-muted-foreground">{obs.title}</span>
              </div>
              <p className="text-sm font-medium mt-1 text-foreground leading-snug">{obs.description}</p>
              <p className="text-xs text-muted-foreground mt-1">
                The AI identified this pattern automatically. Click below to inspect student evidence and record your decision.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-4 shrink-0">
            <Button
              size="sm"
              variant="default"
              onClick={() => onInspectCluster(obs.clusterId)}
              className="text-xs"
            >
              <Eye className="h-3.5 w-3.5 mr-1" /> Inspect Evidence
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => handleDismiss(obs.observationId)}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
