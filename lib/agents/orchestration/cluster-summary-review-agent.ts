import { openaiChatJson } from '@/lib/ai/openai-json'
import type {
  ClusterArtifact,
  ClusterSummary,
  QuestionContext,
  ResponseRecord,
  ReviewTicket,
  ReviewTicketType,
  TranslatedResponse,
} from '@/lib/agents/orchestration/types'
import { createReviewTicket } from '@/lib/agents/orchestration/review-router'
import { validateNonEvaluativeCluster } from '@/lib/ai/cluster-guardrail'

export interface ClusterSummaryReviewInput {
  question: QuestionContext
  clusters: ClusterArtifact[]
  responses: ResponseRecord[]
  translations: Map<string, TranslatedResponse>
  round: number
}

export interface ClusterSummaryReviewOutput {
  summaries: Map<string, ClusterSummary>
  reviewTickets: ReviewTicket[]
  durationMs: number
  llmCallsMade: number
}

export async function runClusterSummaryReviewAgent(
  input: ClusterSummaryReviewInput
): Promise<ClusterSummaryReviewOutput> {
  const startTime = Date.now()
  const summaries = new Map<string, ClusterSummary>()
  const reviewTickets: ReviewTicket[] = []

  if (input.clusters.length === 0) {
    return {
      summaries,
      reviewTickets: [],
      durationMs: Date.now() - startTime,
      llmCallsMade: 0,
    }
  }

  const responseMap = new Map(input.responses.map((r) => [r.responseId, r]))

  const clusterPayload = input.clusters.map((c) => {
    const clusterResponses = c.responseIds.map((id) => {
      const r = responseMap.get(id)
      const translation = input.translations.get(id)
      return {
        responseId: id,
        text: translation ? translation.translatedText : r?.answer || '',
      }
    })

    return {
      clusterId: c.clusterId,
      reasoningPattern: c.reasoningPattern,
      responses: clusterResponses,
    }
  })

  const systemPrompt = [
    'You are the Cluster Summary & Review Agent in MeshQuiz.',
    'Your task is twofold:',
    '1. Generate concise, neutral, evidence-grounded classroom summaries for each reasoning cluster.',
    '2. Inspect cluster consistency and issue typed Review Tickets if reasoning inconsistencies are detected.',
    '',
    'STRICT SUMMARY RULES:',
    '- Describe WHAT students stated or did using purely neutral, descriptive classroom language.',
    '- STRICTLY FORBIDDEN WORDS: "correct", "correctly", "incorrect", "incorrectly", "wrong", "right", "misconception", "error", "flawed", "accurate", "inaccurate".',
    '- Never judge correctness, diagnose misunderstandings, or claim learning deficits.',
    '- REFERENCE ANSWER CONFIDENTIALITY: Do NOT quote, reveal, or state reference answer text, expected correct answer statements, or correctness comparisons in cluster summaries. Summaries must describe student reasoning patterns only.',
    '',
    'STRICT REVIEW TICKET RULES:',
    '- You do NOT directly move students or modify clusters.',
    '- If a student response in a cluster uses a materially different reasoning mechanism from other members, issue a Review Ticket.',
    '- Allowed issue types: "POSSIBLE_SPLIT", "POSSIBLE_MERGE", "WRONG_GROUP", "UNSUPPORTED_SUMMARY", "OUTLIER".',
    '- If all clusters are coherent, return an empty "reviewTickets" array.',
    '',
    'Output JSON matching this exact structure:',
    JSON.stringify(
      {
        summaries: [
          {
            clusterId: 'C1',
            label: 'short neutral pattern label without evaluative words',
            summary: 'one neutral sentence describing what students in this cluster expressed',
            explanation: 'neutral evidence-grounded explanation of the shared reasoning model',
          },
        ],
        reviewTickets: [
          {
            type: 'POSSIBLE_SPLIT',
            clusterId: 'C3',
            responseIds: ['S018'],
            reason: 'S018 focuses on initialization while other members focus on loop condition evaluation.',
          },
        ],
      },
      null,
      2
    ),
  ].join('\n')

  try {
    const aiResult = await openaiChatJson({
      maxTokens: 4000,
      timeoutMs: 45000,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `QUESTION AND CLUSTER EVIDENCE:\nQuestion: ${input.question.questionPrompt}\nClusters:\n${JSON.stringify(clusterPayload, null, 2)}`,
        },
      ],
    })

    if (aiResult.ok && aiResult.json) {
      // Process Summaries
      if (Array.isArray(aiResult.json.summaries)) {
        for (const s of aiResult.json.summaries) {
          if (s?.clusterId && typeof s?.summary === 'string') {
            const rawLabel = typeof s.label === 'string' && s.label.trim() ? s.label.trim() : 'Reasoning pattern'
            const rawSummary = s.summary.trim()
            const sanitized = validateNonEvaluativeCluster({
              label: rawLabel,
              summary: rawSummary,
            })

            summaries.set(String(s.clusterId), {
              clusterId: String(s.clusterId),
              label: sanitized.label,
              summary: sanitized.summary,
              explanation: typeof s.explanation === 'string' ? s.explanation.trim() : sanitized.summary,
            })
          }
        }
      }

      // Process Review Tickets
      if (Array.isArray(aiResult.json.reviewTickets)) {
        for (const t of aiResult.json.reviewTickets) {
          const type = String(t?.type || '').toUpperCase() as ReviewTicketType
          const validTypes: ReviewTicketType[] = [
            'POSSIBLE_SPLIT',
            'POSSIBLE_MERGE',
            'WRONG_GROUP',
            'REFERENCE_ALIGNMENT',
            'UNSUPPORTED_SUMMARY',
            'OUTLIER',
          ]

          if (validTypes.includes(type) && t?.reason) {
            const clusterId = typeof t.clusterId === 'string' ? t.clusterId.trim() : undefined
            const respIds = Array.isArray(t.responseIds)
              ? t.responseIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
              : undefined

            const ticket = createReviewTicket({
              sourceAgent: 'cluster_summary',
              targetAgent: 'cluster_generation',
              type,
              clusterIds: clusterId ? [clusterId] : undefined,
              responseIds: respIds,
              reason: String(t.reason).trim(),
              evidence: {
                responseIds: respIds,
                excerpts: respIds?.map((id: string) => input.translations.get(id)?.translatedText || responseMap.get(id)?.answer || '').filter(Boolean),
              },
              round: input.round,
            })

            reviewTickets.push(ticket)
          }
        }
      }
    }
  } catch (err) {
    console.error('[cluster-summary-review-agent] Error during summary & review execution', err)
  }

  // Ensure every input cluster gets a summary fallback if omitted
  for (const c of input.clusters) {
    if (!summaries.has(c.clusterId)) {
      summaries.set(c.clusterId, {
        clusterId: c.clusterId,
        label: `Reasoning pattern ${c.clusterId}`,
        summary: c.reasoningPattern || 'Students expressed a similar line of reasoning.',
        explanation: 'Students in this cluster used a similar approach to reason about the question.',
      })
    }
  }

  return {
    summaries,
    reviewTickets,
    durationMs: Date.now() - startTime,
    llmCallsMade: 1,
  }
}
