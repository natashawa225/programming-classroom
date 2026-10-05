import { openaiChatJson } from '@/lib/ai/openai-json'
import type { ReviewTicket } from '@/lib/agents/orchestration/types'

export interface TargetedTicketResolutionInput {
  ticket: ReviewTicket
  affectedResponses: Array<{ id: string; text: string }>
  clusterSummary?: string
  questionPrompt: string
}

export interface TargetedTicketResolutionOutput {
  action: 'SPLIT' | 'MERGE' | 'KEEP'
  reason: string
  newClusterReasoningPattern?: string
  durationMs: number
  llmCallsMade: number
}

export async function runTargetedTicketResolutionAgent(
  input: TargetedTicketResolutionInput
): Promise<TargetedTicketResolutionOutput> {
  const startTime = Date.now()

  if (input.affectedResponses.length === 0) {
    return {
      action: 'KEEP',
      reason: 'No affected responses provided for ticket resolution.',
      durationMs: Date.now() - startTime,
      llmCallsMade: 0,
    }
  }

  const promptPayload = {
    ticket_type: input.ticket.type,
    flag_reason: input.ticket.reason,
    question_prompt: input.questionPrompt,
    cluster_summary: input.clusterSummary || 'Cluster of student responses',
    responses: input.affectedResponses,
  }

  const systemPrompt = [
    'You are the Targeted Ticket Resolution Agent in MeshQuiz.',
    'Your goal is to resolve a specific review ticket flagging potential reasoning inconsistencies among a minimal subset of student responses.',
    '',
    'RULES:',
    '1. Do NOT evaluate correctness or reference alignment.',
    '2. Focus ONLY on whether the flagged student responses express a materially different underlying reasoning mechanism from the main cluster.',
    '3. If the responses express a distinct reasoning approach from the cluster summary, select action "SPLIT".',
    '4. If the responses use the same underlying reasoning mechanism, select action "KEEP".',
    '5. If merging two clusters with identical reasoning mechanisms, select action "MERGE".',
    '',
    'Output JSON matching this exact structure ONLY:',
    JSON.stringify(
      {
        action: 'SPLIT',
        reason: 'Students in flagged set reason using explicit decrement bounds while main cluster uses upper limit heuristics.',
        newClusterReasoningPattern: 'Students who reason through explicit decrement operation bounds.',
      },
      null,
      2
    ),
  ].join('\n')

  try {
    const aiResult = await openaiChatJson({
      maxTokens: 2000,
      timeoutMs: 35000,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `TICKET AND FLAGGED RESPONSES:\n${JSON.stringify(promptPayload, null, 2)}`,
        },
      ],
    })

    if (aiResult.ok && aiResult.json?.action) {
      const rawAction = String(aiResult.json.action).toUpperCase()
      const action: 'SPLIT' | 'MERGE' | 'KEEP' =
        rawAction === 'SPLIT' || rawAction === 'MERGE' ? rawAction : 'KEEP'

      return {
        action,
        reason: typeof aiResult.json.reason === 'string' ? aiResult.json.reason.trim() : input.ticket.reason,
        newClusterReasoningPattern:
          typeof aiResult.json.newClusterReasoningPattern === 'string'
            ? aiResult.json.newClusterReasoningPattern.trim()
            : undefined,
        durationMs: Date.now() - startTime,
        llmCallsMade: 1,
      }
    }
  } catch (err) {
    console.error('[ticket-resolution-agent] Error during targeted ticket resolution', err)
  }

  return {
    action: 'KEEP',
    reason: 'LLM resolution unavailable; keeping existing cluster state.',
    durationMs: Date.now() - startTime,
    llmCallsMade: 1,
  }
}
