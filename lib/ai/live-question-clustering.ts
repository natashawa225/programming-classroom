import type { AttemptType } from '@/lib/types/database'
import { openaiChatJson } from '@/lib/ai/openai-json'

export type LiveCluster = {
  cluster_id: string
  label: string
  summary: string
  count: number
  average_confidence: number
  representative_answers: string[]
  response_ids: string[]
}

export type LiveQuestionClusterAnalysis = {
  version: 'live_question_clusters_v1'
  question_prompt: string
  attempt_type: AttemptType
  total_responses: number
  cluster_count: number
  source: 'openai' | 'fallback'
  fallback_reason?: string | null
  fallback_debug?: {
    error?: string | null
    raw_excerpt?: string | null
  } | null
  clusters: LiveCluster[]
}

type InputResponse = {
  response_id: string
  answer: string
  confidence: number
}

function clampClusterCount(count: number) {
  if (count < 2) return 2
  if (count > 5) return 5
  return count
}

function safeLabel(text: string, index: number) {
  const trimmed = String(text || '').trim()
  return trimmed || `Cluster ${index + 1}`
}

function safeSummary(text: string) {
  const trimmed = String(text || '').trim()
  return trimmed || 'Students in this cluster use a similar line of reasoning.'
}

function normalizeAnswer(answer: string) {
  return String(answer || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
}

function summarizeAnswerStem(answer: string) {
  const normalized = normalizeAnswer(answer)
  if (!normalized) return 'Students expressed a similar idea with overlapping wording.'
  const words = normalized.split(' ').filter(Boolean).slice(0, 8)
  return words.length > 0
    ? `Students used similar wording around "${words.join(' ')}".`
    : 'Students expressed a similar idea with overlapping wording.'
}

function buildClusterFromResponses(
  label: string,
  summary: string,
  rows: InputResponse[],
  index: number
): LiveCluster {
  const averageConfidence =
    rows.length > 0 ? Number((rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length).toFixed(2)) : 0

  return {
    cluster_id: `cluster_${index + 1}`,
    label: safeLabel(label, index),
    summary: safeSummary(summary),
    count: rows.length,
    average_confidence: averageConfidence,
    representative_answers: rows.slice(0, 3).map((row) => row.answer),
    response_ids: rows.map((row) => row.response_id),
  }
}

export class LiveClusteringError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'LiveClusteringError'
    this.code = code
  }
}

function sanitizeModelClusters(
  rawClusters: any[],
  responses: InputResponse[]
): LiveCluster[] {
  const responseMap = new Map(responses.map((response) => [response.response_id, response]))
  const assigned = new Set<string>()
  const sanitized: LiveCluster[] = []

  for (const [index, cluster] of rawClusters.entries()) {
    const ids = Array.isArray(cluster?.response_ids)
      ? cluster.response_ids
          .map((value: unknown) => String(value || '').trim())
          .filter((value: string) => value && responseMap.has(value) && !assigned.has(value))
      : []

    if (ids.length === 0) continue

    ids.forEach((id: string) => assigned.add(id))
    const rows = ids.map((id: string) => responseMap.get(id)!).filter(Boolean)
    sanitized.push(
      buildClusterFromResponses(
        cluster?.label,
        cluster?.summary,
        rows,
        index
      )
    )
  }

  const unassigned = responses.filter((response) => !assigned.has(response.response_id))
  if (unassigned.length > 0) {
    if (sanitized.length === 0) return []
    const targetIndex = sanitized.reduce((bestIndex, cluster, index, array) => {
      return cluster.count < array[bestIndex].count ? index : bestIndex
    }, 0)
    const target = sanitized[targetIndex]
    const mergedRows = [...target.response_ids, ...unassigned.map((row) => row.response_id)]
      .map((id: string) => responseMap.get(id)!)
      .filter(Boolean)
    sanitized[targetIndex] = buildClusterFromResponses(target.label, target.summary, mergedRows, targetIndex)
  }

  return sanitized.slice(0, 5)
}

function buildFallbackClusters(
  responses: InputResponse[],
  fallbackReason: string,
  rawExcerpt?: string | null
): LiveQuestionClusterAnalysis {
  const grouped = new Map<string, InputResponse[]>()

  for (const response of responses) {
    const key = normalizeAnswer(response.answer) || response.response_id
    const existing = grouped.get(key)
    if (existing) {
      existing.push(response)
    } else {
      grouped.set(key, [response])
    }
  }

  const sortedGroups = Array.from(grouped.values()).sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length
    return b.reduce((sum, row) => sum + row.confidence, 0) - a.reduce((sum, row) => sum + row.confidence, 0)
  })

  const targetClusterCount = responses.length === 1 ? 1 : clampClusterCount(sortedGroups.length || 1)
  const limitedGroups =
    sortedGroups.length <= targetClusterCount
      ? sortedGroups
      : [
          ...sortedGroups.slice(0, targetClusterCount - 1),
          sortedGroups.slice(targetClusterCount - 1).flat(),
        ]

  const clusters = limitedGroups.map((rows, index) => {
    const isMixedGroup = sortedGroups.length > targetClusterCount && index === limitedGroups.length - 1
    const label = isMixedGroup
      ? 'Uncertain: Mixed response patterns'
      : `Uncertain: Similar response pattern ${index + 1}`
    const summary = isMixedGroup
      ? 'Students gave varied answers that could not be separated further without AI clustering.'
      : summarizeAnswerStem(rows[0]?.answer || '')
    return buildClusterFromResponses(label, summary, rows, index)
  })

  return {
    version: 'live_question_clusters_v1',
    question_prompt: '',
    attempt_type: 'initial',
    total_responses: responses.length,
    cluster_count: clusters.length,
    source: 'fallback',
    fallback_reason: fallbackReason,
    fallback_debug: {
      error: fallbackReason,
      raw_excerpt: rawExcerpt ? rawExcerpt.slice(0, 280) : null,
    },
    clusters,
  }
}

export async function clusterLiveQuestionResponses(input: {
  questionPrompt: string
  attemptType: AttemptType
  responses: InputResponse[]
}): Promise<LiveQuestionClusterAnalysis> {
  const cleanedResponses = input.responses
    .map((response) => ({
      response_id: String(response.response_id),
      answer: String(response.answer || '').trim(),
      confidence: Math.max(1, Math.min(5, Math.round(Number(response.confidence) || 0))),
    }))
    .filter((response) => response.response_id && response.answer)

  if (cleanedResponses.length === 0) {
    throw new LiveClusteringError('no_responses', 'No responses are available for this question attempt.')
  }

  const numberedResponses = cleanedResponses
    .map((response, index) => {
      return `${index + 1}. response_id=${response.response_id}\nconfidence=${response.confidence}\nanswer=${response.answer}`
    })
    .join('\n\n')

  const result = await openaiChatJson({
    maxTokens: 1400,
    timeoutMs: 100000,
    messages: [
      {
        role: 'system',
        content:
          'You cluster short student answers for one open-ended classroom question. Return concise JSON only. Keep 2 to 5 clusters. Use classroom-safe language. Separate responses by distinct reasoning patterns, not just broad answer polarity. Avoid junk-drawer clusters that mix different misconceptions. Label each cluster with one of these prefixes: "True:", "False:", or "Uncertain:" so the visualization can place it on a correctness map.',
      },
      {
        role: 'user',
        content: [
          `Question prompt:\n${input.questionPrompt}`,
          `Attempt type: ${input.attemptType}`,
          'Student responses:',
          numberedResponses,
          'Return JSON with this shape:',
          '{"clusters":[{"cluster_id":"cluster_1","label":"short label","summary":"neutral one-sentence summary","response_ids":["..."]}]}',
          'Rules:',
          '- Every response_id must appear in exactly one cluster.',
          '- Use 2 to 5 clusters unless there is only 1 response.',
          '- Labels should be short and descriptive and must start with "True:", "False:", or "Uncertain:".',
          '- Split different lines of reasoning into separate clusters even when they reach the same final answer.',
          '- Do not combine directional-union confusion, root/order confusion, implementation-dependence, and simple uncertainty into one broad cluster.',
          '- Summaries should neutrally describe the shared reasoning pattern.',
          '- Keep summaries concise and classroom-safe.',
        ].join('\n\n'),
      },
    ],
  })

  if (!result.ok) {
    const fallbackReason =
      typeof result.error === 'string' && result.error.trim()
        ? result.error
        : 'OpenAI clustering request failed.'
    console.error('[live-clustering] openai failure:', fallbackReason)
    const fallback = buildFallbackClusters(cleanedResponses, fallbackReason, result.rawText || null)
    fallback.question_prompt = input.questionPrompt
    fallback.attempt_type = input.attemptType
    return fallback
  }

  const rawClusters = Array.isArray(result.json?.clusters) ? result.json.clusters : []
  const clusters = sanitizeModelClusters(rawClusters, cleanedResponses)
  if (clusters.length === 0) {
    const fallbackReason = 'OpenAI returned cluster JSON, but it could not be mapped to the submitted responses.'
    const fallback = buildFallbackClusters(cleanedResponses, fallbackReason, result.rawText || null)
    fallback.question_prompt = input.questionPrompt
    fallback.attempt_type = input.attemptType
    return fallback
  }

  return {
    version: 'live_question_clusters_v1',
    question_prompt: input.questionPrompt,
    attempt_type: input.attemptType,
    total_responses: cleanedResponses.length,
    cluster_count: clusters.length,
    source: 'openai',
    fallback_reason: null,
    fallback_debug: null,
    clusters,
  }
}
