import type { LiveQuestionClusterAnalysis } from '@/lib/ai/live-question-clustering'
import type { QuestionContext, ResponseRecord, ResponseAlignment } from '@/lib/agents/orchestration/types'
import { createInitialPipelineState, serializePipelineState, type PipelineState } from '@/lib/agents/orchestration/state'
import { ENABLE_MULTI_AGENT_PIPELINE, PIPELINE_BUDGETS } from '@/lib/agents/orchestration/feature-flags'
import { filterValidTicketsForRound } from '@/lib/agents/orchestration/review-router'

export type LegacyClusteringFn = (input: {
  questionId: string
  questionPosition: number
  questionPrompt: string
  correctAnswer?: string | null
  referenceAnswers?: Array<{ reference_id: string; answer_text: string }> | null
  lessonContext?: any
  attemptType: any
  responses: Array<{ response_id: string; answer: string; confidence: number }>
}) => Promise<LiveQuestionClusterAnalysis>

export class BoundedClusteringOrchestrator {
  private legacyFallbackFn?: LegacyClusteringFn

  constructor(options?: { legacyFallbackFn?: LegacyClusteringFn }) {
    this.legacyFallbackFn = options?.legacyFallbackFn
  }

  public async run(input: {
    question: QuestionContext
    responses: ResponseRecord[]
  }): Promise<LiveQuestionClusterAnalysis> {
    const state = createInitialPipelineState(input.question, input.responses)

    // Feature Flag Guard: If Multi-Agent Pipeline is false (Phase 1), use adapter fallback
    if (!ENABLE_MULTI_AGENT_PIPELINE) {
      if (this.legacyFallbackFn) {
        return this.legacyFallbackFn({
          questionId: input.question.questionId,
          questionPosition: input.question.questionPosition,
          questionPrompt: input.question.questionPrompt,
          correctAnswer: input.question.correctAnswer,
          referenceAnswers: input.question.referenceAnswers,
          lessonContext: input.question.lessonContext,
          attemptType: input.question.attemptType,
          responses: input.responses.map((r) => ({
            response_id: r.responseId,
            answer: r.answer,
            confidence: r.confidence,
          })),
        })
      }
      throw new Error('Multi-Agent Pipeline disabled and no legacy fallback provided.')
    }

    // PHASE 2+: Bounded Multi-Agent Pipeline Execution Skeleton
    await this.stepTranslation(state)
    await this.stepClusterGeneration(state)
    await this.stepReferenceAlignment(state)

    let reviewRound = 1
    while (reviewRound <= PIPELINE_BUDGETS.maxClusterReviewRounds) {
      state.metadata.reviewRounds = reviewRound
      await this.stepClusterSummaryAndReview(state, reviewRound)

      const openTickets = filterValidTicketsForRound(state.reviewTickets, reviewRound)
      if (openTickets.length === 0) {
        break
      }

      await this.resolveReviewTickets(state, openTickets, reviewRound)
      reviewRound += 1
    }

    return this.synthesizeFinalOutput(state)
  }

  private async stepTranslation(state: PipelineState): Promise<void> {
    const { runTranslationAgent } = await import('@/lib/agents/orchestration/translation-agent')
    const result = await runTranslationAgent({
      responses: state.responses,
      existingTranslations: state.translations,
    })

    state.translations = result.translations
    state.metadata.llmCalls += result.llmCallsMade
    state.executionLogs.push({
      agent: 'translation',
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      durationMs: result.durationMs,
      success: true,
    })
  }

  private async stepClusterGeneration(state: PipelineState): Promise<void> {
    const { runClusterGenerationAgent } = await import('@/lib/agents/orchestration/cluster-generation-agent')
    const result = await runClusterGenerationAgent({
      question: state.question,
      responses: state.responses,
      translations: state.translations,
    })

    state.clusters.clear()
    for (const cluster of result.clusters) {
      state.clusters.set(cluster.clusterId, cluster)
    }

    state.metadata.llmCalls += result.llmCallsMade
    state.executionLogs.push({
      agent: 'cluster_generation',
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      durationMs: result.durationMs,
      success: true,
    })
  }

  private async stepReferenceAlignment(state: PipelineState): Promise<void> {
    const { runReferenceAlignmentAgent } = await import('@/lib/agents/orchestration/reference-alignment-agent')
    const result = await runReferenceAlignmentAgent({
      question: state.question,
      responses: state.responses,
      translations: state.translations,
    })

    state.alignments = result.alignments
    state.metadata.llmCalls += result.llmCallsMade
    state.executionLogs.push({
      agent: 'cluster_summary',
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      durationMs: result.durationMs,
      success: true,
    })
  }

  private async stepClusterSummaryAndReview(state: PipelineState, round: number): Promise<void> {
    const { runClusterSummaryReviewAgent } = await import('@/lib/agents/orchestration/cluster-summary-review-agent')
    const clustersArray = Array.from(state.clusters.values())

    const result = await runClusterSummaryReviewAgent({
      question: state.question,
      clusters: clustersArray,
      responses: state.responses,
      translations: state.translations,
      round,
    })

    state.summaries = result.summaries
    state.reviewTickets.push(...result.reviewTickets)

    // Detect conflicting reference alignments within the same cluster to generate REFERENCE_ALIGNMENT tickets
    const { createReviewTicket } = await import('@/lib/agents/orchestration/review-router')
    for (const cluster of state.clusters.values()) {
      const alignmentsInCluster = cluster.responseIds
        .map((id) => state.alignments.get(id)?.alignment)
        .filter(Boolean) as string[]

      const uniqueAlignments = new Set(alignmentsInCluster)
      const hasConflict =
        (uniqueAlignments.has('strong') && uniqueAlignments.has('limited')) ||
        (uniqueAlignments.has('strong') && uniqueAlignments.has('unclear'))

      if (hasConflict) {
        const conflictingIds = cluster.responseIds.filter((id) => {
          const a = state.alignments.get(id)?.alignment
          return a === 'limited' || a === 'unclear'
        })

        if (conflictingIds.length > 0) {
          const conflictTicket = createReviewTicket({
            sourceAgent: 'cluster_summary',
            targetAgent: 'cluster_generation',
            type: 'REFERENCE_ALIGNMENT',
            clusterIds: [cluster.clusterId],
            responseIds: conflictingIds,
            reason: `Cluster ${cluster.clusterId} contains responses with conflicting reference alignments (strong vs limited/unclear). Check if reasoning mechanisms differ.`,
            evidence: {
              responseIds: conflictingIds,
              excerpts: conflictingIds.map((id) => state.translations.get(id)?.translatedText || state.responses.find((r) => r.responseId === id)?.answer || ''),
            },
            round,
          })
          state.reviewTickets.push(conflictTicket)
        }
      }
    }

    state.metadata.llmCalls += result.llmCallsMade
    state.executionLogs.push({
      agent: 'cluster_summary',
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      durationMs: result.durationMs,
      success: true,
    })
  }

  private async resolveReviewTickets(
    state: PipelineState,
    openTickets: any[],
    round: number
  ): Promise<void> {
    const { resolveTicket } = await import('@/lib/agents/orchestration/review-router')
    const { runTargetedTicketResolutionAgent } = await import('@/lib/agents/orchestration/ticket-resolution-agent')

    for (const ticket of openTickets) {
      console.info(`[orchestrator] Processing Review Ticket [${ticket.id}] (${ticket.type}) for cluster(s) ${ticket.clusterIds?.join(', ')}`, {
        reason: ticket.reason,
        affectedResponses: ticket.responseIds,
        round,
      })

      const targetClusterId = ticket.clusterIds?.[0]
      const targetCluster = targetClusterId ? state.clusters.get(targetClusterId) : undefined
      const clusterSummary = targetClusterId ? state.summaries.get(targetClusterId)?.summary || targetCluster?.reasoningPattern : undefined

      const responseMap = new Map(state.responses.map((r) => [r.responseId, r]))
      const affectedIds: string[] = ticket.responseIds || (targetCluster ? targetCluster.responseIds : [])
      const affectedResponsesPayload = affectedIds
        .map((id) => {
          const trans = state.translations.get(id)
          const resp = responseMap.get(id)
          return {
            id,
            text: trans ? trans.translatedText : resp?.answer || '',
          }
        })
        .filter((r) => r.text)

      // Invoke Targeted Ticket Resolution Agent with minimal context payload
      const resolution = await runTargetedTicketResolutionAgent({
        ticket,
        affectedResponses: affectedResponsesPayload,
        clusterSummary,
        questionPrompt: state.question.questionPrompt,
      })

      state.metadata.llmCalls += resolution.llmCallsMade
      state.executionLogs.push({
        agent: 'cluster_summary',
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        durationMs: resolution.durationMs,
        success: true,
      })

      if (
        resolution.action === 'SPLIT' &&
        targetCluster &&
        affectedIds.length > 0 &&
        targetCluster.responseIds.length > affectedIds.length
      ) {
        const remainingIds = targetCluster.responseIds.filter((id) => !affectedIds.includes(id))
        targetCluster.responseIds = remainingIds
        targetCluster.representativeResponseIds = remainingIds.slice(0, 3)
        // Clear stale summary for target cluster so it falls back to updated reasoning pattern if not re-reviewed
        state.summaries.delete(targetCluster.clusterId)

        const newClusterId = `C${state.clusters.size + 1}`
        state.clusters.set(newClusterId, {
          clusterId: newClusterId,
          responseIds: affectedIds,
          reasoningPattern: resolution.newClusterReasoningPattern || `Distinct reasoning pattern: ${ticket.reason}`,
          representativeResponseIds: affectedIds.slice(0, 3),
        })

        state.reviewTickets = state.reviewTickets.map((t) => (t.id === ticket.id ? resolveTicket(t, 'resolved') : t))
      } else if (resolution.action === 'MERGE' && ticket.clusterIds && ticket.clusterIds.length >= 2) {
        const primaryId = ticket.clusterIds[0]
        const secondaryId = ticket.clusterIds[1]
        const primary = state.clusters.get(primaryId)
        const secondary = state.clusters.get(secondaryId)

        if (primary && secondary) {
          primary.responseIds = Array.from(new Set([...primary.responseIds, ...secondary.responseIds]))
          primary.representativeResponseIds = primary.responseIds.slice(0, 3)
          state.clusters.delete(secondaryId)
          state.reviewTickets = state.reviewTickets.map((t) => (t.id === ticket.id ? resolveTicket(t, 'resolved') : t))
        } else {
          state.reviewTickets = state.reviewTickets.map((t) => (t.id === ticket.id ? resolveTicket(t, 'rejected') : t))
        }
      } else {
        // Action is KEEP or rejected/unresolved
        state.reviewTickets = state.reviewTickets.map((t) => (t.id === ticket.id ? resolveTicket(t, 'resolved') : t))
      }
    }
  }

  private synthesizeFinalOutput(state: PipelineState): LiveQuestionClusterAnalysis {
    const responseMap = new Map(state.responses.map((r) => [r.responseId, r]))
    const clusters: Array<any> = []

    for (const [index, artifact] of Array.from(state.clusters.values()).entries()) {
      const clusterResponses = artifact.responseIds.map((id) => responseMap.get(id)).filter(Boolean) as ResponseRecord[]
      const avgConf = clusterResponses.length > 0
        ? Number((clusterResponses.reduce((sum, r) => sum + r.confidence, 0) / clusterResponses.length).toFixed(2))
        : 0

      const summaryObj = state.summaries.get(artifact.clusterId)
      const label = summaryObj?.label || artifact.reasoningPattern || `Cluster ${index + 1}`
      const summaryText = summaryObj?.summary || artifact.reasoningPattern || 'Students in this cluster expressed a similar line of reasoning.'

      const repAnswers = artifact.responseIds.slice(0, 3).map((id) => {
        const trans = state.translations.get(id)
        return trans ? trans.translatedText : responseMap.get(id)?.answer || ''
      }).filter(Boolean)

      const evidenceSpans = artifact.responseIds.slice(0, 3).map((id) => {
        const trans = state.translations.get(id)
        return {
          response_id: id,
          exact_quote: (trans ? trans.translatedText : responseMap.get(id)?.answer || '').slice(0, 150),
        }
      })

      const clusterAlignments = artifact.responseIds.map((id) => state.alignments.get(id)).filter(Boolean) as ResponseAlignment[]
      const levelCounts: Record<string, number> = {}
      const alignedRefIds = new Set<string>()

      for (const ca of clusterAlignments) {
        levelCounts[ca.alignment] = (levelCounts[ca.alignment] || 0) + 1
        if (ca.alignedReferenceIds) {
          ca.alignedReferenceIds.forEach((refId: string) => alignedRefIds.add(refId))
        }
      }

      let dominantLevel: 'strong' | 'partial' | 'limited' | 'unclear' = 'partial'
      let maxCount = -1
      for (const [lvl, count] of Object.entries(levelCounts)) {
        if (count > maxCount) {
          maxCount = count
          dominantLevel = lvl as any
        }
      }

      const clusterRefAlignment = clusterAlignments.length > 0
        ? {
            alignment_level: dominantLevel,
            explanation: clusterAlignments[0]?.evidence || 'Conceptual overlap with reference reasoning examples.',
            aligned_reference_ids: Array.from(alignedRefIds),
          }
        : undefined

      clusters.push({
        cluster_id: artifact.clusterId,
        label,
        summary: summaryText,
        count: artifact.responseIds.length,
        average_confidence: avgConf,
        representative_answers: repAnswers,
        response_ids: artifact.responseIds,
        evidence_spans: evidenceSpans,
        reference_alignment: clusterRefAlignment,
      })
    }

    const serializedTranslations: Record<string, unknown> = {}
    for (const [id, t] of state.translations.entries()) {
      serializedTranslations[id] = {
        responseId: t.responseId,
        originalText: t.originalText,
        translatedText: t.translatedText,
        translationStatus: t.translationStatus,
        translationConfidence: t.translationConfidence,
        detectedLanguage: t.detectedLanguage,
      }
    }

    const serializedAlignments: Record<string, unknown> = {}
    for (const [id, a] of state.alignments.entries()) {
      serializedAlignments[id] = {
        responseId: a.responseId,
        alignment: a.alignment,
        evidence: a.evidence,
        alignedReferenceIds: a.alignedReferenceIds,
      }
    }

    return {
      version: 'live_question_clusters_v2',
      question_prompt: state.question.questionPrompt,
      attempt_type: state.question.attemptType,
      total_responses: state.responses.length,
      cluster_count: clusters.length,
      source: 'openai',
      clusters,
      ...({
        translations: serializedTranslations,
        response_alignments: serializedAlignments,
        review_tickets: state.reviewTickets,
        execution_logs: state.executionLogs,
      } as any),
    }
  }
}

export const boundedClusteringOrchestrator = new BoundedClusteringOrchestrator()
