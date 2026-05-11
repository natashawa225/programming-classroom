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

type BareAnswerKind = 'affirm' | 'reject' | 'uncertain'
type ReferenceDirection = 'affirm' | 'reject' | null
type ProcessedInputResponse = InputResponse & {
  bare: boolean
  bare_answer_kind: BareAnswerKind | null
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

function normalizeBareText(answer: string) {
  return String(answer || '')
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[。！？!?.,，、；;:：]+$/g, '')
    .replace(/\s+/g, ' ')
}

function classifyBareAnswer(answer: string): Pick<ProcessedInputResponse, 'bare' | 'bare_answer_kind'> {
  const normalized = normalizeBareText(answer)
  if (!normalized) return { bare: false, bare_answer_kind: null }

  const compact = normalized.replace(/\s+/g, '')
  const affirm = new Set([
    'yes',
    'y',
    'true',
    'correct',
    'right',
    'yeah',
    'yep',
    '是',
    '对',
    '正确',
    '對',
    '正確',
  ])
  const reject = new Set([
    'no',
    'n',
    'false',
    'incorrect',
    'wrong',
    '不是',
    '不对',
    '不對',
    '错误',
    '錯誤',
    '否',
  ])
  const uncertain = new Set([
    'idk',
    "i don't know",
    'i dont know',
    'i do not know',
    'dont know',
    "don't know",
    'not sure',
    'unsure',
    '不知道',
    '不确定',
    '不確定',
  ])

  if (affirm.has(normalized) || affirm.has(compact)) return { bare: true, bare_answer_kind: 'affirm' }
  if (reject.has(normalized) || reject.has(compact)) return { bare: true, bare_answer_kind: 'reject' }
  if (uncertain.has(normalized) || uncertain.has(compact)) return { bare: true, bare_answer_kind: 'uncertain' }

  return { bare: false, bare_answer_kind: null }
}

function inferReferenceDirection(correctAnswer?: string | null): ReferenceDirection {
  const normalized = normalizeBareText(correctAnswer || '')
  if (!normalized) return null

  const compact = normalized.replace(/\s+/g, '')
  const affirmStart = /^(yes|true|correct|right)\b/.test(normalized) || /^(是|对|正确|對|正確)/.test(compact)
  const rejectStart = /^(no|false|incorrect|wrong)\b/.test(normalized) || /^(不是|不对|不對|错误|錯誤|否)/.test(compact)
  if (affirmStart && !rejectStart) return 'affirm'
  if (rejectStart && !affirmStart) return 'reject'

  const affirmStatement = /\b(the answer is|answer is|it is|it's)\s+(yes|true|correct|right)\b/.test(normalized)
  const rejectStatement = /\b(the answer is|answer is|it is|it's)\s+(no|false|incorrect|wrong)\b/.test(normalized)
  if (affirmStatement && !rejectStatement) return 'affirm'
  if (rejectStatement && !affirmStatement) return 'reject'

  return null
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

function buildBareTeacherNote(rows: InputResponse[]) {
  const high = rows.filter((row) => row.confidence >= 4).length
  const medium = rows.filter((row) => row.confidence === 3).length
  const low = rows.filter((row) => row.confidence <= 2).length
  const studentLabel = rows.length === 1 ? 'student' : 'students'
  const responseLabel = rows.length === 1 ? 'response' : 'responses'
  return `${rows.length} ${studentLabel} gave answer-only ${responseLabel} with no reasoning. Confidence: ${high} high, ${medium} medium, ${low} low. Use this as a confidence/participation signal, not as evidence of reasoning.`
}

function getBareClusterDescriptor(
  rows: ProcessedInputResponse[],
  referenceDirection: ReferenceDirection
): { label: string; summary: string } {
  const hasUncertain = rows.some((row) => row.bare_answer_kind === 'uncertain')
  if (hasUncertain) {
    return {
      label: 'Uncertain answer only - no reasoning given',
      summary: 'Students gave answer-only uncertainty responses without explaining their thinking.',
    }
  }

  if (!referenceDirection) {
    return {
      label: 'Answer only - no reasoning given',
      summary: 'Students gave a bare final answer without explaining their reasoning.',
    }
  }

  const firstKind = rows[0]?.bare_answer_kind
  const isCorrectBare = firstKind === referenceDirection
  return isCorrectBare
    ? {
        label: 'Correct answer only - no reasoning given',
        summary: 'Students gave the expected final answer without explaining their reasoning.',
      }
    : {
        label: 'Wrong answer only - no reasoning given',
        summary: 'Students gave a final answer that conflicts with the reference direction without explaining their reasoning.',
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

  if (sanitized.length <= 5) return sanitized

  console.warn('[live-clustering] model returned more than 5 clusters; merging overflow clusters', {
    cluster_count_before_merge: sanitized.length,
    overflow_count: sanitized.length - 4,
  })
  const kept = sanitized.slice(0, 4)
  const overflowRows = sanitized
    .slice(4)
    .flatMap((cluster) => cluster.response_ids)
    .map((id: string) => responseMap.get(id)!)
    .filter(Boolean)
  kept.push(
    buildClusterFromResponses(
      'Additional response patterns',
      'The model returned more than five clusters, so smaller overflow groups were merged to preserve every response.',
      overflowRows,
      4,
      {
        conceptual_alignment: 0,
        understanding_bucket: 'mixed_reasoning',
        teacher_note: 'Overflow clusters were merged locally because the model returned more than five groups.',
      }
    )
  )
  return kept
}

function appendBareTeacherNote(existingNote: string | null | undefined, rows: InputResponse[]) {
  const note = buildBareTeacherNote(rows)
  const trimmed = String(existingNote || '').trim()
  return trimmed ? `${trimmed} ${note}` : note
}

function getBareClusterKey(response: ProcessedInputResponse, referenceDirection: ReferenceDirection) {
  if (response.bare_answer_kind === 'uncertain') return 'uncertain'
  if (!referenceDirection) return 'unknown'
  return response.bare_answer_kind === referenceDirection ? 'correct' : 'wrong'
}

function postProcessBareAnswerClusters(
  clusters: LiveCluster[],
  responses: ProcessedInputResponse[],
  referenceDirection: ReferenceDirection
) {
  const responseMap = new Map(responses.map((response) => [response.response_id, response]))
  const processed: LiveCluster[] = []

  for (const cluster of clusters) {
    const rows = cluster.response_ids
      .map((id) => responseMap.get(id))
      .filter(Boolean) as ProcessedInputResponse[]
    const bareRows = rows.filter((row) => row.bare)
    const explainedRows = rows.filter((row) => !row.bare)

    if (explainedRows.length > 0) {
      processed.push(
        buildClusterFromResponses(cluster.label, cluster.summary, explainedRows, processed.length, {
          conceptual_alignment: cluster.conceptual_alignment,
          understanding_bucket: cluster.understanding_bucket,
          teacher_note: cluster.teacher_note,
        })
      )
    }

    const groupedBareRows = new Map<string, ProcessedInputResponse[]>()
    for (const row of bareRows) {
      const key = getBareClusterKey(row, referenceDirection)
      groupedBareRows.set(key, [...(groupedBareRows.get(key) || []), row])
    }

    for (const key of ['correct', 'wrong', 'uncertain', 'unknown']) {
      const groupRows = groupedBareRows.get(key)
      if (!groupRows || groupRows.length === 0) continue
      const descriptor = getBareClusterDescriptor(groupRows, referenceDirection)
      processed.push(
        buildClusterFromResponses(descriptor.label, descriptor.summary, groupRows, processed.length, {
          conceptual_alignment: 0,
          understanding_bucket: 'unclear',
          teacher_note: appendBareTeacherNote(null, groupRows),
        })
      )
    }
  }

  return validateExactResponseCoverage(processed, responses)
}

function validateExactResponseCoverage(clusters: LiveCluster[], responses: ProcessedInputResponse[]) {
  const expectedIds = new Set(responses.map((response) => response.response_id))
  const seen = new Set<string>()
  const duplicateIds = new Set<string>()

  for (const cluster of clusters) {
    for (const id of cluster.response_ids) {
      if (seen.has(id)) duplicateIds.add(id)
      seen.add(id)
    }
  }

  const missingIds = [...expectedIds].filter((id) => !seen.has(id))
  const unknownIds = [...seen].filter((id) => !expectedIds.has(id))
  if (missingIds.length > 0 || duplicateIds.size > 0 || unknownIds.length > 0) {
    console.warn('[live-clustering] local cluster coverage repair needed', {
      missing_response_ids: missingIds,
      duplicate_response_ids: [...duplicateIds],
      unknown_response_ids: unknownIds,
    })

    const responseMap = new Map(responses.map((response) => [response.response_id, response]))
    const repaired: LiveCluster[] = []
    const assigned = new Set<string>()
    for (const cluster of clusters) {
      const rows = cluster.response_ids
        .filter((id) => expectedIds.has(id) && !assigned.has(id))
        .map((id) => responseMap.get(id)!)
        .filter(Boolean)
      if (rows.length === 0) continue
      rows.forEach((row) => assigned.add(row.response_id))
      repaired.push(
        buildClusterFromResponses(cluster.label, cluster.summary, rows, repaired.length, {
          conceptual_alignment: cluster.conceptual_alignment,
          understanding_bucket: cluster.understanding_bucket,
          teacher_note: cluster.teacher_note,
        })
      )
    }

    const repairedMissingRows = responses.filter((response) => !assigned.has(response.response_id))
    if (repairedMissingRows.length > 0) {
      repaired.push(
        buildClusterFromResponses(
          'Additional response patterns',
          'Responses that were omitted during local validation were merged into a final catch-all group.',
          repairedMissingRows,
          repaired.length,
          {
            conceptual_alignment: 0,
            understanding_bucket: 'unclear',
            teacher_note: 'These responses were added locally to preserve exact response coverage.',
          }
        )
      )
    }

    return repaired
  }

  return clusters.map((cluster, index) => ({
    ...cluster,
    cluster_id: `cluster_${index + 1}`,
    count: cluster.response_ids.length,
  }))
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
    .map((response): ProcessedInputResponse => {
      const answer = String(response.answer || '').trim()
      const bareClassification = classifyBareAnswer(answer)
      return {
        response_id: String(response.response_id),
        answer,
        confidence: Math.max(1, Math.min(5, Math.round(Number(response.confidence) || 0))),
        bare: bareClassification.bare,
        bare_answer_kind: bareClassification.bare_answer_kind,
      }
    })
    .filter((response) => response.response_id && response.answer)

  if (cleanedResponses.length === 0) {
    throw new LiveClusteringError('no_responses', 'No responses are available for this question attempt.')
  }

  const referenceDirection = inferReferenceDirection(input.correctAnswer)
  const numberedResponses = cleanedResponses
    .map((response, index) => {
      return `${index + 1}. response_id=${response.response_id}\nconfidence=${response.confidence}\nbare=${response.bare}\nanswer=${response.answer}`
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
          '- Responses marked bare=true contain no reasoning. Always place them in a separate cluster from explained responses. Set understanding_bucket to unclear. Do not split bare responses further by confidence.',
          '- Use unclear for bare responses and for explained responses that are too vague to interpret.',
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
    fallback.clusters = postProcessBareAnswerClusters(fallback.clusters, cleanedResponses, referenceDirection)
    fallback.cluster_count = fallback.clusters.length
    return fallback
  }

  const rawClusters = Array.isArray(result.json?.clusters) ? result.json.clusters : []
  const clusters = postProcessBareAnswerClusters(
    sanitizeModelClusters(rawClusters, cleanedResponses),
    cleanedResponses,
    referenceDirection
  )
  if (clusters.length === 0) {
    const fallbackReason = 'OpenAI returned cluster JSON, but it could not be mapped to the submitted responses.'
    const fallback = buildFallbackClusters(cleanedResponses, fallbackReason, result.rawText || null)
    fallback.question_prompt = input.questionPrompt
    fallback.attempt_type = input.attemptType
    fallback.clusters = postProcessBareAnswerClusters(fallback.clusters, cleanedResponses, referenceDirection)
    fallback.cluster_count = fallback.clusters.length
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
