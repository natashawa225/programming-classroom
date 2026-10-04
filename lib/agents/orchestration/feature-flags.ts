/**
 * Feature Flags for MeshQuiz Bounded Multi-Agent Pipeline
 */

export const ENABLE_REALTIME_MONITORING = false
export const ENABLE_MULTI_AGENT_PIPELINE = true

export const PIPELINE_BUDGETS = {
  maxClusterReviewRounds: 2,
  maxReviewTicketsPerRound: 5,
  maxSessionRegenerations: 1,
} as const
