import type { ReviewTicket, ReviewTicketType, AgentName, ReviewTicketStatus } from '@/lib/agents/orchestration/types'
import { PIPELINE_BUDGETS } from '@/lib/agents/orchestration/feature-flags'

export interface CreateReviewTicketOptions {
  sourceAgent: AgentName
  targetAgent: AgentName
  type: ReviewTicketType
  clusterIds?: string[]
  responseIds?: string[]
  reason: string
  evidence?: {
    responseIds?: string[]
    excerpts?: string[]
  }
  round: number
}

export function createReviewTicket(options: CreateReviewTicketOptions): ReviewTicket {
  const ticketId = `ticket_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  return {
    id: ticketId,
    sourceAgent: options.sourceAgent,
    targetAgent: options.targetAgent,
    type: options.type,
    clusterIds: options.clusterIds,
    responseIds: options.responseIds,
    reason: options.reason,
    evidence: options.evidence || {},
    round: options.round,
    status: 'open',
  }
}

export function filterValidTicketsForRound(
  tickets: ReviewTicket[],
  currentRound: number
): ReviewTicket[] {
  if (currentRound > PIPELINE_BUDGETS.maxClusterReviewRounds) {
    console.warn(`[review-router] Max review rounds (${PIPELINE_BUDGETS.maxClusterReviewRounds}) reached. Suppressing new tickets.`)
    return []
  }

  const openTickets = tickets.filter((t) => t.status === 'open' && t.round === currentRound)
  if (openTickets.length > PIPELINE_BUDGETS.maxReviewTicketsPerRound) {
    console.warn(
      `[review-router] Ticket count (${openTickets.length}) exceeds per-round limit (${PIPELINE_BUDGETS.maxReviewTicketsPerRound}). Truncating to top budget limit.`
    )
    return openTickets.slice(0, PIPELINE_BUDGETS.maxReviewTicketsPerRound)
  }

  return openTickets
}

export function resolveTicket(ticket: ReviewTicket, newStatus: Exclude<ReviewTicketStatus, 'open'>): ReviewTicket {
  return {
    ...ticket,
    status: newStatus,
  }
}
