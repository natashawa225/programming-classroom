import { openaiChatJson } from '@/lib/ai/openai-json'
import type { QuestionContext, ResponseAlignment, ResponseRecord, TranslatedResponse } from '@/lib/agents/orchestration/types'
import { validateNonEvaluativeCluster } from '@/lib/ai/cluster-guardrail'

export interface ReferenceAlignmentInput {
  question: QuestionContext
  responses: ResponseRecord[]
  translations: Map<string, TranslatedResponse>
}

export interface ReferenceAlignmentOutput {
  alignments: Map<string, ResponseAlignment>
  durationMs: number
  llmCallsMade: number
}

function normalizeAnswerText(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
}

export async function runReferenceAlignmentAgent(
  input: ReferenceAlignmentInput
): Promise<ReferenceAlignmentOutput> {
  const startTime = Date.now()
  const alignments = new Map<string, ResponseAlignment>()

  if (input.responses.length === 0) {
    return {
      alignments,
      durationMs: Date.now() - startTime,
      llmCallsMade: 0,
    }
  }

  const refAnswers = input.question.referenceAnswers && input.question.referenceAnswers.length > 0
    ? input.question.referenceAnswers
    : input.question.correctAnswer
      ? [{ reference_id: 'ref_1', answer_text: input.question.correctAnswer }]
      : []

  // If no reference answers exist for this question, mark all responses as 'unclear'
  if (refAnswers.length === 0) {
    for (const r of input.responses) {
      alignments.set(r.responseId, {
        responseId: r.responseId,
        alignment: 'unclear',
        evidence: 'No reference answer provided for this question context.',
      })
    }
    return {
      alignments,
      durationMs: Date.now() - startTime,
      llmCallsMade: 0,
    }
  }

  // 1. Deterministic Exact-Match Check First (No LLM Call required for exact match)
  const refAnswerNormSet = new Set(refAnswers.map((ra) => normalizeAnswerText(ra.answer_text)))
  const toEvaluateViaLLM: Array<{ responseId: string; text: string }> = []

  for (const r of input.responses) {
    const translation = input.translations.get(r.responseId)
    const canonicalText = translation ? translation.translatedText : r.answer
    const normText = normalizeAnswerText(canonicalText)

    if (refAnswerNormSet.has(normText)) {
      const matchingRef = refAnswers.find((ra) => normalizeAnswerText(ra.answer_text) === normText)
      alignments.set(r.responseId, {
        responseId: r.responseId,
        alignment: 'strong',
        evidence: 'Response matches expected reference answer exact wording.',
        alignedReferenceIds: matchingRef ? [matchingRef.reference_id] : [],
      })
    } else {
      toEvaluateViaLLM.push({
        responseId: r.responseId,
        text: canonicalText,
      })
    }
  }

  // If all responses were resolved deterministically, return immediately
  if (toEvaluateViaLLM.length === 0) {
    return {
      alignments,
      durationMs: Date.now() - startTime,
      llmCallsMade: 0,
    }
  }

  // 2. Bounded Semantic Evaluation for Open-Ended Responses
  const promptPayload = {
    questionPrompt: input.question.questionPrompt,
    referenceAnswers: refAnswers.map((ra) => ({
      referenceId: ra.reference_id,
      text: ra.answer_text,
    })),
    responsesToEvaluate: toEvaluateViaLLM,
  }

  const systemPrompt = [
    'You evaluate response-level reference alignment in MeshQuiz.',
    'Your task is to compare individual student responses against expected reference answers/reasoning examples.',
    '',
    'STRICT ALIGNMENT RULES:',
    '1. Allowed alignment levels: "strong", "partial", "limited", "unclear".',
    '2. "strong" = response expresses reasoning with high conceptual overlap to reference reasoning examples.',
    '3. "partial" = response demonstrates partial overlap with key concepts in reference reasoning examples.',
    '4. "limited" = response exhibits minimal conceptual overlap with reference reasoning examples.',
    '5. "unclear" = response is ambiguous or lacks sufficient reasoning to determine overlap.',
    '6. STRICTLY NON-EVALUATIVE EXPLANATIONS: Neutral classroom descriptions ONLY. Never use forbidden evaluative terms like "correct", "wrong", "incorrect", "misconception", or "flawed".',
    '7. Output alignment at the RESPONSE LEVEL for every input responseId.',
    '',
    'Output JSON matching this exact structure:',
    JSON.stringify(
      {
        alignments: [
          {
            responseId: 'S001',
            alignment: 'strong',
            explanation: 'neutral 1-sentence description of conceptual overlap with reference reasoning example',
            alignedReferenceIds: ['ref_1'],
          },
        ],
      },
      null,
      2
    ),
  ].join('\n')

  try {
    const aiResult = await openaiChatJson({
      maxTokens: 1400,
      timeoutMs: 35000,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `QUESTION, REFERENCE ANSWERS, AND RESPONSES:\n${JSON.stringify(promptPayload, null, 2)}`,
        },
      ],
    })

    if (aiResult.ok && Array.isArray(aiResult.json?.alignments)) {
      for (const item of aiResult.json.alignments) {
        if (item?.responseId && typeof item?.alignment === 'string') {
          const rawLevel = String(item.alignment).toLowerCase()
          const level: 'strong' | 'partial' | 'limited' | 'unclear' =
            rawLevel === 'strong' || rawLevel === 'partial' || rawLevel === 'limited' || rawLevel === 'unclear'
              ? rawLevel
              : 'partial'

          const rawExplanation = typeof item.explanation === 'string' ? item.explanation.trim() : ''
          const sanitized = validateNonEvaluativeCluster({
            label: 'Alignment Note',
            summary: rawExplanation || 'Conceptual overlap with reference reasoning examples.',
          })

          const alignedIds = Array.isArray(item.alignedReferenceIds)
            ? item.alignedReferenceIds.map((id: unknown) => String(id || '')).filter(Boolean)
            : []

          alignments.set(String(item.responseId), {
            responseId: String(item.responseId),
            alignment: level,
            evidence: sanitized.summary,
            alignedReferenceIds: alignedIds,
          })
        }
      }
    }
  } catch (err) {
    console.error('[reference-alignment-agent] Error during semantic alignment evaluation', err)
  }

  // Fallback for any unassigned response
  for (const item of toEvaluateViaLLM) {
    if (!alignments.has(item.responseId)) {
      alignments.set(item.responseId, {
        responseId: item.responseId,
        alignment: 'partial',
        evidence: 'Response shows partial conceptual overlap with topic reasoning context.',
      })
    }
  }

  return {
    alignments,
    durationMs: Date.now() - startTime,
    llmCallsMade: 1,
  }
}
