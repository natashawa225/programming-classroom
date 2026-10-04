import type { AttemptType } from '@/lib/types/database'
import type { UnionFindQuestionContext } from '@/lib/ai/union-find-question-config'

export type AgentName =
  | 'translation'
  | 'cluster_generation'
  | 'cluster_summary'
  | 'session_summary'

export type ReviewTicketType =
  | 'WRONG_GROUP'
  | 'POSSIBLE_SPLIT'
  | 'POSSIBLE_MERGE'
  | 'REFERENCE_ALIGNMENT'
  | 'UNSUPPORTED_SUMMARY'
  | 'OUTLIER'

export type ReviewTicketStatus = 'open' | 'accepted' | 'rejected' | 'resolved'

export interface ReviewTicket {
  id: string
  sourceAgent: AgentName
  targetAgent: AgentName
  type: ReviewTicketType
  clusterIds?: string[]
  responseIds?: string[]
  reason: string
  evidence: {
    responseIds?: string[]
    excerpts?: string[]
  }
  round: number
  status: ReviewTicketStatus
}

export interface AgentExecutionLog {
  agent: AgentName
  model: string
  inputTokens?: number
  outputTokens?: number
  durationMs?: number
  success: boolean
}

export interface QuestionContext {
  questionId: string
  questionPosition: number
  questionPrompt: string
  correctAnswer?: string | null
  referenceAnswers?: Array<{ reference_id: string; answer_text: string }> | null
  lessonContext?: UnionFindQuestionContext | null
  attemptType: AttemptType
}

export interface ResponseRecord {
  responseId: string
  answer: string
  confidence: number
  bare?: boolean
  bareAnswerKind?: 'affirm' | 'reject' | 'uncertain' | null
}

export interface TranslatedResponse {
  responseId: string
  originalText: string
  translatedText: string
  translationStatus: 'not_needed' | 'translated' | 'failed'
  translationConfidence?: 'high' | 'medium' | 'low'
  detectedLanguage?: string
}

export interface ClusterArtifact {
  clusterId: string
  responseIds: string[]
  reasoningPattern: string
  representativeResponseIds: string[]
}

export interface ClusterSummary {
  clusterId: string
  label: string
  summary: string
  explanation: string
}

export interface ResponseAlignment {
  responseId: string
  alignment: 'strong' | 'partial' | 'limited' | 'unclear'
  evidence: string
  alignedReferenceIds?: string[]
}
