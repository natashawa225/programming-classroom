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

function fallbackClusterResponses(responses: InputResponse[]): LiveCluster[] {
  const groups = new Map<string, InputResponse[]>()

  for (const response of responses) {
    const key = normalizeAnswer(response.answer) || response.response_id
    const bucket = groups.get(key) || []
    bucket.push(response)
    groups.set(key, bucket)
  }

  const sortedGroups = [...groups.values()].sort((a, b) => b.length - a.length)
  const desired = Math.min(clampClusterCount(sortedGroups.length || 1), Math.max(1, responses.length))
  const selected = sortedGroups.slice(0, desired)
  const overflow = sortedGroups.slice(desired).flat()

  if (overflow.length > 0) {
    selected[selected.length - 1] = [...selected[selected.length - 1], ...overflow]
  }

  return selected.map((rows, index) => {
    const sample = rows[0]?.answer || ''
    const label = sample.split(/\s+/).slice(0, 5).join(' ') || `Cluster ${index + 1}`
    return buildClusterFromResponses(
      label,
      'Students in this cluster gave closely related responses.',
      rows,
      index
    )
  })
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
    if (sanitized.length === 0) {
      return fallbackClusterResponses(responses)
    }
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
    return {
      version: 'live_question_clusters_v1',
      question_prompt: input.questionPrompt,
      attempt_type: input.attemptType,
      total_responses: 0,
      cluster_count: 0,
      source: 'fallback',
      clusters: [],
    }
  }

  const numberedResponses = cleanedResponses
    .map((response, index) => {
      return `${index + 1}. response_id=${response.response_id}\nconfidence=${response.confidence}\nanswer=${response.answer}`
    })
    .join('\n\n')

  const result = await openaiChatJson({
    maxTokens: 1400,
    messages: [
      {
        role: 'system',
        content:
          'You cluster short student answers for one open-ended classroom question. Return concise JSON only. Keep 2 to 5 clusters. Use neutral language. Do not grade, do not label answers correct or incorrect, and do not mention misconceptions.',
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
          '- Labels should be short and descriptive.',
          '- Summaries should neutrally describe the shared idea.',
          '- Keep summaries concise and classroom-safe.',
        ].join('\n\n'),
      },
    ],
  })

  const fallback = fallbackClusterResponses(cleanedResponses)

  if (!result.ok) {
    return {
      version: 'live_question_clusters_v1',
      question_prompt: input.questionPrompt,
      attempt_type: input.attemptType,
      total_responses: cleanedResponses.length,
      cluster_count: fallback.length,
      source: 'fallback',
      clusters: fallback,
    }
  }

  const rawClusters = Array.isArray(result.json?.clusters) ? result.json.clusters : []
  const clusters = sanitizeModelClusters(rawClusters, cleanedResponses)
  const finalClusters = clusters.length > 0 ? clusters : fallback

  return {
    version: 'live_question_clusters_v1',
    question_prompt: input.questionPrompt,
    attempt_type: input.attemptType,
    total_responses: cleanedResponses.length,
    cluster_count: finalClusters.length,
    source: clusters.length > 0 ? 'openai' : 'fallback',
    clusters: finalClusters,
  }
}
