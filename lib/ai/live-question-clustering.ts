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
  // v2 fields
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
  if (count < 2) return 2
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
      ? 'Mixed response patterns'
      : `Similar response pattern ${index + 1}`
    const summary = isMixedGroup
      ? 'Students gave varied answers that could not be separated further without AI clustering.'
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
          'You cluster short student answers for one open-ended classroom question into 2 to 5 reasoning-pattern groups.',
          '',
          'Your goal is teacher sensemaking — help the teacher quickly see the spread of reasoning in the room.',
          '',
          'Important: the teacher/reference answer is contextual guidance, not necessarily the only valid answer. Some questions may have multiple defensible interpretations, especially when wording depends on assumptions such as worst-case vs amortized time, implementation details, or level of abstraction.',
          '',
          'Do NOT grade students. Do NOT label responses as simply correct or incorrect. Do NOT cluster only by the final Yes/No answer.',
          '',
          'Instead:',
          '- Identify the main reasoning pattern used in each cluster.',
          '- Preserve nuanced or conditionally valid reasoning.',
          '- Distinguish strong reasoning, partial reasoning, unsupported claims, and misconception-based reasoning.',
          '- Estimate how closely the reasoning aligns with the lesson goals, target concept, and known misconceptions.',
          '- If a response is defensible only under a particular interpretation, explain that in teacher_note.',
          '- If a response has the right final answer but weak reasoning, keep the alignment moderate rather than high.',
          '- If a response disagrees with the reference answer but gives a defensible interpretation, do not mark it as low alignment purely because of the disagreement.',
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
          `Reference answer:\n${input.correctAnswer || ''}`,
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
                label: 'neutral reasoning label (no True/False prefix)',
                summary: 'one-sentence neutral description of the shared reasoning pattern',
                conceptual_alignment: 0.35,
                understanding_bucket: 'mixed_reasoning',
                teacher_note: 'optional note for teacher — only if genuinely useful, else omit or null',
                response_ids: ['...'],
              },
            ],
          }, null, 2),
          'Rules:',
          '- Every response_id must appear in exactly one cluster.',
          '- Use 2 to 5 clusters unless there is only 1 response.',
          '- label = short name of the reasoning pattern.',
          '- summary = what students in the cluster are generally thinking.',
          '- teacher_note = what the teacher should notice, especially ambiguity, missing nuance, or conditional validity.',
          '- Labels must be neutral and descriptive — never start with "True:", "False:", "Yes:", "No:", "Correct:", or "Incorrect:".',
          '- Labels should describe the reasoning pattern, not the final verdict.',
          '- Cluster by reasoning pattern, not by final answer alone.',
          '- Split different lines of reasoning into separate clusters even when they reach the same final answer.',
          '- Different final answers may both be reasonable if they rely on different interpretations of the question.',
          '- Treat the reference answer as teacher guidance, not as an absolute answer key.',
          '- Do not penalize a response only because it differs from the reference answer; evaluate the reasoning quality and assumptions.',
          '- Explicitly preserve conditional reasoning such as "yes if amortized near-constant time is accepted" or "no if strict worst-case O(1) is required."',
          '- Separate misconception-based reasoning from defensible alternative interpretations.',
          '- Different final answers may be clustered together only when the underlying reasoning pattern or misconception is genuinely similar.',
          '- Do not combine dynamic/static graph confusion, root/order confusion, implementation-dependence, strict worst-case reasoning, amortized-time reasoning, and simple uncertainty into one broad cluster.',
          '- conceptual_alignment is a float from -1.0 to 1.0:',
          '  - 1.0 = strongly aligned reasoning under the lesson goals',
          '  - 0.5 to 0.8 = mostly aligned but missing nuance or conditions',
          '  - 0.0 to 0.4 = partial, vague, unsupported, or mixed reasoning',
          '  - below 0.0 = reasoning conflicts with the target concept or reflects a clear misconception',
          '- understanding_bucket must be exactly one of: needs_attention, mixed_reasoning, strong_alignment, unclear.',
          '- Use strong_alignment only when reasoning is both conceptually sound and sufficiently explained.',
          '- Use mixed_reasoning for partially correct, conditionally valid, or incomplete reasoning.',
          '- Use needs_attention for clear misconceptions or reasoning that would likely mislead future learning.',
          '- Use unclear for responses that are too vague to interpret.',
          '- teacher_note is optional, but include it when the reasoning is conditionally valid, the answer depends on interpretation, the final answer is right but the reasoning is weak, the response disagrees with the reference answer but is defensible, or the misconception is important for the teacher to address.',
          '- Summaries should neutrally describe the shared reasoning pattern and be concise.',
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
