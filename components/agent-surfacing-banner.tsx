'use client'

import { AgentSurfacingAssistant } from '@/components/agent-surfacing-assistant'
import type { BoundedAgentObservation } from '@/lib/services/bounded-agency-service'

type Props = {
  observations: BoundedAgentObservation[]
  onInspectCluster: (clusterId: string) => void
}

export function AgentSurfacingBanner(props: Props) {
  return <AgentSurfacingAssistant {...props} />
}

export { AgentSurfacingAssistant }
