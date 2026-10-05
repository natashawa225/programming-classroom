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
    'Your goal is to organize student responses into 1 to 5 groups based strictly on shared UNDERLYING REASONING PROCESS, bug diagnosis, or proposed fix strategy.',
    '',
    'STRICT MANDATORY CLUSTERING RULES:',
    '1. A CLUSTER REPRESENTS A SHARED REASONING APPROACH, BUG DIAGNOSIS, FIX STRATEGY, OR MENTAL MODEL.',
    '2. SEPARATE DISTINCT DIAGNOSES AND FIX STRATEGIES:',
    '   - Responses identifying different error types (e.g., "off-by-one bug" vs "compile error" vs "infinite loop") MUST be placed in separate clusters.',
    '   - Responses proposing different fix strategies for a bug (e.g., "change condition to i < n" vs "initialize counter i = 1") MUST be placed in separate clusters.',
    '3. DO NOT MERGE DIFFERENT REASONING PROCESSES OR FIXES JUST BECAUSE THEY MENTION THE SAME QUESTION OR TOPIC.',
    '   Example:',
    '   - Strategy A (change condition): "change i<=n to i<n" / "while(i<n)"',
    '   - Strategy B (change initialization): "start i from 1" / "i=1"',
    '   - Strategy C (alternative error diagnosis): "compile error" / "infinite loop"',
    '   - Strategy D (unelaborated bug label): "off-by-one bug"',
    '   These MUST be separate clusters so the lecturer can see how many students chose each approach.',
    '4. CONFIDENCE HANDLING: Confidence values MUST NOT be included or influence cluster membership.',
    '5. DO NOT EVALUATE CORRECTNESS OR ALIGNMENT: Do NOT classify responses as correct, incorrect, right, wrong, or misconception in your cluster labels.',
    '6. MERGE/SPLIT DECISION TEST: For every proposed merge, ask: "If shown to a lecturer, would placing these together hide a meaningful difference in how students answered or fixed the problem?" If YES, separate them.',
    '7. EXACT RESPONSE ID COVERAGE: Every input responseId MUST be assigned to exactly one cluster.',
    '8. BARE ANSWERS & SHORT RESPONSES: Group short/bare responses by their specific stated answer or fix (e.g. group all "i=1" together, group all "compile error" together). Do not lump all bare answers into a single mixed cluster if they state different answers.',
    '9. EVIDENCE GROUNDING: Every reasoning pattern description must be supported by actual student responses.',
    '10. TARGET CLUSTER DISTRIBUTION: Aim for 2 to 5 distinct, meaningful clusters whenever students provide different diagnoses or fixes. Do NOT collapse all responses into a single cluster if observable differences exist in their answers.',
    '',
    'Output JSON matching this exact structure ONLY:',
    JSON.stringify(
      {
        clusters: [
          {
            clusterId: 'C1',
            responseIds: ['S001', 'S007'],
            reasoningPattern: 'neutral 1-sentence description of the expressed reasoning pattern, bug diagnosis, or fix strategy',
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
      maxTokens: 3500,
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
