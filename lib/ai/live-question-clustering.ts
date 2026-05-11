import type { AttemptType } from '@/lib/types/database'
import { openaiChatJson } from '@/lib/ai/openai-json'
import type { UnionFindQuestionContext } from '@/lib/ai/union-find-question-config'

export type UnderstandingBucket =
  | 'needs_attention'
  | 'mixed_reasoning'
  | 'strong_alignment'
  | 'unclear'

export type LiveCluster = {
  cluster_id: string
  label: string
  summary: string
  count: number
  average_confidence: number
  representative_answers: string[]
  response_ids: string[]
  conceptual_alignment?: number       // -1 (conflicting) → 0 (mixed) → 1 (aligned)
  understanding_bucket?: UnderstandingBucket
  teacher_note?: string | null
}

export type LiveQuestionClusterAnalysis = {
  version: 'live_question_clusters_v1' | 'live_question_clusters_v2'
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

// --- Backward-compat: map v1 True/False labels to alignment scores ---
export function inferAlignmentFromV1Label(label: string): number {
  const lower = label.toLowerCase()
  if (lower.startsWith('true')) return 0.7
  if (lower.startsWith('false')) return -0.7
  return 0.0
}

export function inferBucketFromAlignment(alignment: number): UnderstandingBucket {
  if (alignment >= 0.6) return 'strong_alignment'
  if (alignment >= 0.1) return 'mixed_reasoning'
  if (alignment <= -0.3) return 'needs_attention'
  return 'unclear'
}

function clampClusterCount(count: number) {
  if (count < 1) return 1
  if (count > 5) return 5
  return count
}

function clampAlignment(value: unknown): number {
  const n = Number(value)
  if (isNaN(n)) return 0
  return Math.max(-1, Math.min(1, n))
}

function safeUnderstandingBucket(value: unknown): UnderstandingBucket {
  const valid: UnderstandingBucket[] = [
    'needs_attention',
    'mixed_reasoning',
    'strong_alignment',
    'unclear',
  ]
  return valid.includes(value as UnderstandingBucket)
    ? (value as UnderstandingBucket)
    : 'unclear'
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
  index: number,
  v2Fields?: {
    conceptual_alignment?: number
    understanding_bucket?: UnderstandingBucket
    teacher_note?: string | null
  }
): LiveCluster {
  const averageConfidence =
    rows.length > 0
      ? Number((rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length).toFixed(2))
      : 0

  return {
    cluster_id: `cluster_${index + 1}`,
    label: safeLabel(label, index),
    summary: safeSummary(summary),
    count: rows.length,
    average_confidence: averageConfidence,
    representative_answers: rows.slice(0, 3).map((row) => row.answer),
    response_ids: rows.map((row) => row.response_id),
    ...(v2Fields ?? {}),
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

    const alignment = clampAlignment(cluster?.conceptual_alignment)

    sanitized.push(
      buildClusterFromResponses(cluster?.label, cluster?.summary, rows, index, {
        conceptual_alignment: alignment,
        understanding_bucket: cluster?.understanding_bucket
          ? safeUnderstandingBucket(cluster.understanding_bucket)
          : inferBucketFromAlignment(alignment),
        teacher_note: cluster?.teacher_note
          ? String(cluster.teacher_note).trim() || null
          : null,
      })
    )
  }

  const unassigned = responses.filter((response) => !assigned.has(response.response_id))
  if (unassigned.length > 0) {
    if (sanitized.length === 0) return []
    console.warn('[live-clustering] model omitted response_ids; merging unassigned responses into an existing cluster', {
      omitted_response_ids: unassigned.map((response) => response.response_id),
      omitted_count: unassigned.length,
      cluster_count_before_merge: sanitized.length,
    })
    const targetIndex = sanitized.reduce((bestIndex, cluster, index, array) => {
      return cluster.count < array[bestIndex].count ? index : bestIndex
    }, 0)
    const target = sanitized[targetIndex]
    const mergedRows = [...target.response_ids, ...unassigned.map((row) => row.response_id)]
      .map((id: string) => responseMap.get(id)!)
      .filter(Boolean)
    sanitized[targetIndex] = buildClusterFromResponses(
      target.label,
      target.summary,
      mergedRows,
      targetIndex,
      {
        conceptual_alignment: target.conceptual_alignment,
        understanding_bucket: target.understanding_bucket,
        teacher_note: target.teacher_note,
      }
    )
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

  const repeatedGroups = sortedGroups.filter((rows) => rows.length > 1)
  const singletonRows = sortedGroups.filter((rows) => rows.length === 1).flat()
  const fallbackGroups = [
    ...repeatedGroups,
    ...(singletonRows.length > 0 ? [singletonRows] : []),
  ]

  const targetClusterCount = responses.length === 1 ? 1 : clampClusterCount(fallbackGroups.length || 1)
  const limitedGroups =
    fallbackGroups.length <= targetClusterCount
      ? fallbackGroups
      : [
          ...fallbackGroups.slice(0, targetClusterCount - 1),
          fallbackGroups.slice(targetClusterCount - 1).flat(),
        ]

  const clusters = limitedGroups.map((rows, index) => {
    const isMergedOverflowGroup = fallbackGroups.length > targetClusterCount && index === limitedGroups.length - 1
    const isSingletonFallbackGroup = rows.length > 1 && rows.every((row) => {
      return grouped.get(normalizeAnswer(row.answer) || row.response_id)?.length === 1
    })
    const label = isMergedOverflowGroup
      ? 'Mixed response patterns'
      : isSingletonFallbackGroup
        ? 'Unclustered singleton responses'
      : `Similar response pattern ${index + 1}`
    const summary = isMergedOverflowGroup
      ? 'Students gave varied answers that could not be separated further without AI clustering.'
      : isSingletonFallbackGroup
        ? 'AI clustering was unavailable, so singleton wording variants are grouped together rather than split into artificial clusters.'
      : summarizeAnswerStem(rows[0]?.answer || '')
    return buildClusterFromResponses(label, summary, rows, index, {
      conceptual_alignment: 0,
      understanding_bucket: 'unclear',
      teacher_note: null,
    })
  })

  return {
    version: 'live_question_clusters_v2',
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
  questionId: string
  questionPosition: number
  questionPrompt: string
  correctAnswer?: string | null
  lessonContext?: UnionFindQuestionContext | null
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
    maxTokens: 1600,
    timeoutMs: 100000,
    messages: [
      {
        role: 'system',
        content: [
          'You cluster short student answers for one open-ended classroom question into 1 to 5 reasoning-pattern groups.',
          '',
          'Your main job is grouping, not grading.',
          'Cluster responses by the underlying idea or reasoning pattern students are using.',
          '',
          'Important: this question has a single teacher-provided reference answer, but the question is open-ended and may have multiple valid correct answers.',
          'Students typed free text. Do not treat the reference answer as the only acceptable answer.',
          'Different valid answers that reflect sound reasoning should be merged into the same cluster or treated as equally aligned, not split apart or penalised.',
          '',
          'Prefer fewer, broader clusters. False splits are worse than broad clusters for this live teacher dashboard.',
          'When unsure whether two responses are meaningfully different, merge them.',
          '',
          'Do not split by language, wording, confidence, answer length, writing quality, or minor detail differences.',
          'Do not create separate clusters just because one answer is more detailed or polished than another.',
          '',
          'Only separate responses when they show a meaningfully different concept, misconception, or lack of interpretable reasoning.',
          'A difference is meaningful only if it would change what the teacher should address next.',
          '',
          'After assigning response_ids to clusters, write a short neutral label and one-sentence summary for each cluster.',
          'Then optionally add teacher_note only if there is a useful misconception, ambiguity, or teaching point to notice.',
          '',
          'Return concise JSON only. Use classroom-safe language.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `Question id: ${input.questionId}`,
          `Question position: ${input.questionPosition}`,
          `Question prompt:\n${input.questionPrompt}`,
          `Reference answer (one valid example only — not the only correct answer): \n${input.correctAnswer || ''}`,
          `Lesson concept:\n${input.lessonContext?.lesson_concept || ''}`,
          `Target misconception:\n${input.lessonContext?.target_misconception || ''}`,
          `Strong answer criteria:\n${JSON.stringify(input.lessonContext?.strong_answer_criteria ?? [])}`,
          `Known misconception variants:\n${JSON.stringify(input.lessonContext?.misconception_variants ?? [])}`,
          `Attempt type: ${input.attemptType}`,
          'Student responses:',
          numberedResponses,
          'Return JSON with this shape:',
          JSON.stringify({
            clusters: [
              {
                cluster_id: 'cluster_1',
                label: 'neutral reasoning label',
                summary: 'one-sentence neutral description of the shared reasoning pattern',
                conceptual_alignment: 0.35,
                understanding_bucket: 'mixed_reasoning',
                teacher_note: 'optional — omit or null unless genuinely useful',
                response_ids: ['...'],
              },
            ],
          }, null, 2),
          'Rules:',
          '- Every response_id must appear in exactly one cluster.',
          '- Use 1 to 5 clusters. Use 1 cluster when responses are conceptually homogeneous.',
          '- If there are fewer than 4 responses, use 1–2 clusters unless there is a clearly different misconception.',
          '- Prefer fewer broader clusters. Merge when in doubt.',
          '- Separate clusters only when the difference would change what the teacher addresses next.',
          '- Always merge responses that express the same underlying concept in different words or languages.',
          '- Treat equivalent phrasings as one cluster: e.g. "postorder", "after all neighbors processed", "after descendants", "after recursive calls finish", "reverse topological order" all express the same DFS-finish-time idea.',
          '- Do not split by: language, wording, answer length, confidence, or writing quality.',
          '- Confidence is context for the teacher summary only. Do not use confidence as a reason to create separate clusters.',
          '- label = short name of the reasoning pattern (neutral, no True/False/Correct/Incorrect prefix).',
          '- summary = what students in the cluster are generally thinking (one sentence, neutral).',
          '- teacher_note must be actionable and specific. Do not write generic notes such as "review this concept" or "clarify the topic".',
          '- teacher_note should be null when there is no specific misconception, ambiguity, or teaching move worth surfacing.',
          '- conceptual_alignment is a float from -1.0 to 1.0:',
          '  - 1.0 = clearly aligned with the target concept',
          '  - 0.5–0.8 = mostly aligned but missing nuance',
          '  - 0.0–0.4 = partial, vague, or unsupported',
          '  - below 0.0 = appears to reflect a misconception or conflicts with the target concept',
          '- understanding_bucket must be exactly one of: needs_attention, mixed_reasoning, strong_alignment, unclear.',
          '- Use strong_alignment only when the shared reasoning clearly matches the target concept and is specific enough to interpret.',
          '- Use mixed_reasoning for partial, conditional, or incomplete reasoning.',
          '- Use needs_attention for clear misconceptions.',
          '- Use unclear only when responses are too vague to interpret.',
          '- Treat the reference answer as guidance, not an absolute answer key.',
          '- Do not penalize a response only because it differs from the reference answer; evaluate the reasoning.',
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
    version: 'live_question_clusters_v2',
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