import { openaiChatJson } from '@/lib/ai/openai-json'
import type { ClusterArtifact, QuestionContext, ResponseRecord, TranslatedResponse } from '@/lib/agents/orchestration/types'

export interface ClusterGenerationInput {
  question: QuestionContext
  responses: ResponseRecord[]
  translations: Map<string, TranslatedResponse>
}

export interface ClusterGenerationOutput {
  clusters: ClusterArtifact[]
  durationMs: number
  llmCallsMade: number
}

function buildCanonicalInputPayload(
  responses: ResponseRecord[],
  translations: Map<string, TranslatedResponse>
): Array<{ responseId: string; text: string }> {
  return responses.map((r) => {
    const translation = translations.get(r.responseId)
    const canonicalText = translation ? translation.translatedText : r.answer
    return {
      responseId: r.responseId,
      text: canonicalText,
    }
  })
}

export function validateClusterEvidence(
  clusters: ClusterArtifact[],
  inputResponses: Array<{ responseId: string; text: string }>
): { valid: boolean; issues: string[]; repairedClusters: ClusterArtifact[] } {
  const issues: string[] = []
  const responseMap = new Map(inputResponses.map((r) => [r.responseId, r]))
  const assignedSet = new Set<string>()
  const duplicateIds = new Set<string>()

  const repairedClusters: ClusterArtifact[] = []

  for (const c of clusters) {
    const validIds: string[] = []
    for (const id of c.responseIds) {
      if (!responseMap.has(id)) {
        issues.push(`Unknown response ID "${id}" in cluster ${c.clusterId}`)
        continue
      }
      if (assignedSet.has(id)) {
        duplicateIds.add(id)
        issues.push(`Duplicate response ID "${id}" in cluster ${c.clusterId}`)
        continue
      }
      assignedSet.add(id)
      validIds.push(id)
    }

    if (validIds.length > 0) {
      repairedClusters.push({
        ...c,
        responseIds: validIds,
        representativeResponseIds: validIds.slice(0, 3),
      })
    }
  }

  // Missing coverage check
  const missingIds = inputResponses.filter((r) => !assignedSet.has(r.responseId)).map((r) => r.responseId)
  if (missingIds.length > 0) {
    issues.push(`Missing ${missingIds.length} response IDs from cluster assignment.`)
    if (repairedClusters.length < 5) {
      repairedClusters.push({
        clusterId: `C${repairedClusters.length + 1}`,
        responseIds: missingIds,
        reasoningPattern: 'Other observed student reasoning patterns.',
        representativeResponseIds: missingIds.slice(0, 3),
      })
    } else if (repairedClusters.length > 0) {
      const smallest = repairedClusters.reduce(
        (prev, curr) => (curr.responseIds.length < prev.responseIds.length ? curr : prev),
        repairedClusters[0]
      )
      smallest.responseIds.push(...missingIds)
    }
  }

  // Artificial fragmentation check
  if (inputResponses.length >= 10 && repairedClusters.length >= 5) {
    const singletons = repairedClusters.filter((c) => c.responseIds.length === 1)
    if (singletons.length >= 3) {
      issues.push(`High artificial fragmentation detected (${singletons.length} singleton clusters).`)
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    repairedClusters,
  }
}

export async function runClusterGenerationAgent(
  input: ClusterGenerationInput
): Promise<ClusterGenerationOutput> {
  const startTime = Date.now()
  const canonicalResponses = buildCanonicalInputPayload(input.responses, input.translations)

  if (canonicalResponses.length === 0) {
    return {
      clusters: [],
      durationMs: Date.now() - startTime,
      llmCallsMade: 0,
    }
  }

  // Mandatory Runtime Guard: Reject any forbidden metadata in input payload
  const FORBIDDEN_KEYS = ['confidence', 'reference_answer', 'correctness', 'alignment', 'misconception']
  for (const item of canonicalResponses) {
    for (const key of Object.keys(item)) {
      if (FORBIDDEN_KEYS.includes(key.toLowerCase())) {
        throw new Error(`ClusterGenerationAgent received forbidden metadata: ${key}`)
      }
    }
  }

  const promptPayload = {
    question: input.question.questionPrompt,
    responses: canonicalResponses,
  }

  const systemPrompt = [
    'You are the Cluster Generation Agent in MeshQuiz.',
    'Your goal is to organize student responses into 1 to 5 groups based strictly on shared UNDERLYING REASONING PROCESS: the mechanism, assumptions, rules, causal explanation, or mental model students use to arrive at their response.',
    '',
    'STRICT MANDATORY CLUSTERING RULES:',
    '1. A CLUSTER REPRESENTS A SHARED REASONING APPROACH, STRATEGY, MENTAL MODEL, OR EXPLANATION STRUCTURE.',
    '2. DO NOT CLUSTER SOLELY BECAUSE:',
    '   - students have the same final answer',
    '   - students use the same keyword',
    '   - students mention the same concept',
    '3. DO NOT MERGE DIFFERENT REASONING PROCESSES JUST BECAUSE THEY REACH THE SAME CONCLUSION:',
    '   Example:',
    '   - Response 1: "The loop runs 10 times because i starts at 10 and stops before 20."',
    '   - Response 2: "The loop runs 10 times because the condition executes while i is greater than 0."',
    '   Although both conclude "10 times", their reasoning mechanism differs.',
    '   Correct Grouping:',
    '   Group A (boundary evaluation reasoning): Response 1',
    '   Group B (reverse iteration/decrement reasoning): Response 2',
    '',
    '   NEGATIVE EXAMPLE (INVALID CLUSTERING - DO NOT DO):',
    '   Cluster: "Students who answered 10 times" (INVALID: clustered solely by same final answer).',
    '   CORRECT CLUSTERING:',
    '   Cluster 1: "Students who reason through loop boundaries"',
    '   Cluster 2: "Students who reason through repeated decrement operations"',
    '4. CONFIDENCE HANDLING: Confidence values MUST NOT be included or influence cluster membership.',
    '5. DO NOT EVALUATE CORRECTNESS OR ALIGNMENT: Do NOT classify responses as correct, incorrect, right, wrong, or misconception.',
    '6. MERGE/SPLIT DECISION TEST: For every proposed merge, ask: "If shown to a lecturer, would placing these together hide a meaningful difference in how students reasoned?" If YES, separate; if NO, keep together.',
    '7. EXACT RESPONSE ID COVERAGE: Every input responseId MUST be assigned to exactly one cluster.',
    '8. BARE ANSWERS (NO REASONING): Responses without reasoning should be grouped together only when they provide insufficient evidence of reasoning. Do not split bare answers by inferred correctness.',
    '9. EVIDENCE GROUNDING: Every reasoning pattern description must be supported by actual student responses. Do not infer hidden reasoning that students did not express. If a response lacks explanation, describe only the observable response pattern.',
    '10. AMBIGUITY HANDLING: When responses are ambiguous, prefer keeping them together unless there is observable evidence of a different reasoning process. Do not create artificial clusters based on minor wording differences.',

    '',
    'Output JSON matching this exact structure ONLY:',
    JSON.stringify(
      {
        clusters: [
          {
            clusterId: 'C1',
            responseIds: ['S001', 'S007'],
            reasoningPattern: 'neutral 1-sentence description of the expressed reasoning pattern or approach',
            representativeEvidence: ['exact response quote 1', 'exact response quote 2'],
          },
        ],
      },
      null,
      2
    ),
  ].join('\n')

  try {
    const aiResult = await openaiChatJson({
      maxTokens: 1600,
      timeoutMs: 45000,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `QUESTION AND CANONICAL RESPONSES:\n${JSON.stringify(promptPayload, null, 2)}`,
        },
      ],
    })

    if (aiResult.ok && Array.isArray(aiResult.json?.clusters) && aiResult.json.clusters.length > 0) {
      const responseMap = new Map(canonicalResponses.map((r) => [r.responseId, r]))
      const assigned = new Set<string>()
      const clusters: ClusterArtifact[] = []

      for (const [index, rawCluster] of aiResult.json.clusters.entries()) {
        const rawIds = Array.isArray(rawCluster.responseIds)
          ? rawCluster.responseIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
          : []

        const validIds: string[] = []
        for (const id of rawIds) {
          if (responseMap.has(id) && !assigned.has(id)) {
            validIds.push(id)
            assigned.add(id)
          }
        }

        if (validIds.length === 0) continue

        const repQuotes = Array.isArray(rawCluster.representativeEvidence)
          ? rawCluster.representativeEvidence.map((q: unknown) => String(q || '').trim()).filter(Boolean)
          : validIds.slice(0, 3).map((id) => responseMap.get(id)?.text || '')

        clusters.push({
          clusterId: typeof rawCluster.clusterId === 'string' && rawCluster.clusterId.trim()
            ? rawCluster.clusterId.trim()
            : `C${index + 1}`,
          responseIds: validIds,
          reasoningPattern: typeof rawCluster.reasoningPattern === 'string' && rawCluster.reasoningPattern.trim()
            ? rawCluster.reasoningPattern.trim()
            : 'Students expressed a similar line of reasoning.',
          representativeResponseIds: validIds.slice(0, 3),
        })
      }

      // Coverage repair: assign omitted responses
      const unassigned = canonicalResponses.filter((r) => !assigned.has(r.responseId))
      if (unassigned.length > 0) {
        if (clusters.length < 5) {
          clusters.push({
            clusterId: `C${clusters.length + 1}`,
            responseIds: unassigned.map((r) => r.responseId),
            reasoningPattern: 'Other observed reasoning responses.',
            representativeResponseIds: unassigned.slice(0, 3).map((r) => r.responseId),
          })
        } else {
          // Add to smallest cluster
          const smallest = clusters.reduce((prev, curr) => (curr.responseIds.length < prev.responseIds.length ? curr : prev), clusters[0])
          smallest.responseIds.push(...unassigned.map((r) => r.responseId))
        }
      }

      const validation = validateClusterEvidence(clusters, canonicalResponses)
      if (!validation.valid) {
        console.warn('[cluster-generation-agent] Evidence validation repaired cluster set:', validation.issues)
      }

      return {
        clusters: validation.repairedClusters,
        durationMs: Date.now() - startTime,
        llmCallsMade: 1,
      }
    }
  } catch (err) {
    console.error('[cluster-generation-agent] Error during cluster generation', err)
  }

  // Fallback if LLM failed
  const fallbackCluster: ClusterArtifact = {
    clusterId: 'C1',
    responseIds: canonicalResponses.map((r) => r.responseId),
    reasoningPattern: 'Students expressed reasoning regarding the question prompt.',
    representativeResponseIds: canonicalResponses.slice(0, 3).map((r) => r.responseId),
  }

  return {
    clusters: [fallbackCluster],
    durationMs: Date.now() - startTime,
    llmCallsMade: 1,
  }
}
