import type {
  AgentExecutionLog,
  ClusterArtifact,
  ClusterSummary,
  QuestionContext,
  ResponseAlignment,
  ResponseRecord,
  ReviewTicket,
  TranslatedResponse,
} from '@/lib/agents/orchestration/types'

export interface PipelineState {
  question: QuestionContext
  responses: ResponseRecord[]
  translations: Map<string, TranslatedResponse>
  clusters: Map<string, ClusterArtifact>
  summaries: Map<string, ClusterSummary>
  alignments: Map<string, ResponseAlignment>
  reviewTickets: ReviewTicket[]
  executionLogs: AgentExecutionLog[]
  metadata: {
    reviewRounds: number
    llmCalls: number
    startedAt: string
  }
}

export function createInitialPipelineState(
  question: QuestionContext,
  responses: ResponseRecord[]
): PipelineState {
  return {
    question,
    responses,
    translations: new Map(),
    clusters: new Map(),
    summaries: new Map(),
    alignments: new Map(),
    reviewTickets: [],
    executionLogs: [],
    metadata: {
      reviewRounds: 0,
      llmCalls: 0,
      startedAt: new Date().toISOString(),
    },
  }
}

export function serializePipelineState(state: PipelineState): Record<string, unknown> {
  return {
    questionId: state.question.questionId,
    attemptType: state.question.attemptType,
    responseCount: state.responses.length,
    translations: Array.from(state.translations.entries()).map(([id, t]) => ({
      responseId: id,
      translationStatus: t.translationStatus,
      detectedLanguage: t.detectedLanguage,
      originalText: t.originalText,
      translatedText: t.translatedText,
    })),
    clusters: Array.from(state.clusters.values()),
    summaries: Array.from(state.summaries.values()),
    alignments: Array.from(state.alignments.entries()).map(([id, a]) => ({
      responseId: id,
      alignment: a.alignment,
      evidence: a.evidence,
      alignedReferenceIds: a.alignedReferenceIds,
    })),
    reviewTickets: state.reviewTickets,
    executionLogs: state.executionLogs,
    metadata: state.metadata,
  }
}
