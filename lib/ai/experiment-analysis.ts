import type { Response, Session, SessionQuestion } from '@/lib/types/database'
import { createHash } from 'crypto'
import { openaiChatJson } from '@/lib/ai/openai-json'
import { getUnionFindQuestionContext } from '@/lib/ai/union-find-question-config'

export const BASELINE_ANALYSIS_PROMPT_VERSION = 'baseline_v6_misconception_detector_compact'
export const TREATMENT_R1_ANALYSIS_PROMPT_VERSION = 'treatment_r1_v2_compact_repair'
export const TREATMENT_R2_ANALYSIS_PROMPT_VERSION = 'treatment_r2_v2_compact_revision'

export type UnderstandingLevel = 'correct' | 'mostly_correct' | 'partially_correct' | 'incorrect' | 'unclear'
export type EvaluationCategory =
  | 'fully_correct'
  | 'partially_correct'
  | 'relevant_incomplete'
  | 'misconception'
  | 'unclear'

export type ResponseLabel = {
  response_id: string
  understanding_level: UnderstandingLevel
  is_correct: boolean | null
  evaluation_category: EvaluationCategory
  misconception_label: string | null
  misconception_variant?: string | null
  cluster_id: string | null
  reasoning_summary: string | null
  missing_key_idea?: string | null
  key_concepts_detected?: string[]
  missing_key_concepts?: string[]
  explanation: string | null // legacy
}

export type MisconceptionCluster = {
  cluster_id: string
  label: string
  variant?: string | null
  description?: string | null
  interpretation?: string | null
  why_students_think_this?: string | null
  teacher_move?: string | null
  count: number
  hint?: string | null
  example_response_ids?: string[]
  representative_answers?: string[]
}

export type SessionAnalysisResponseLabel = {
  response_id: string
  question_id: string
  is_correct: boolean | null
  understanding_level: UnderstandingLevel
  evaluation_category: EvaluationCategory
  misconception_label: string | null
  misconception_variant?: string | null
  cluster_id: string | null
  reasoning_summary: string | null
  missing_key_idea?: string | null
  key_concepts_detected?: string[]
  missing_key_concepts?: string[]
  explanation: string | null
}

export type QuestionAnalysis = {
  question_id: string
  question_no?: number
  position: number
  prompt: string
  correct_answer: string | null
  submission_count: number
  response_count?: number
  avg_confidence: number | null
  average_confidence?: number | null
  percent_correct: number | null
  percent_fully_correct?: number | null
  evaluation_breakdown?: {
    correct: number
    mostly_correct: number
    partially_correct: number
    incorrect: number
    unclear: number
  }
  response_quality_breakdown?: {
    fully_correct: number
    partially_correct: number
    relevant_incomplete: number
    misconception: number
    unclear: number
  }
  representative_examples?: Partial<Record<EvaluationCategory, string>>
  teacher_interpretation?: string
  suggested_teacher_action?: string
  confidence_breakdown: Record<
    '1' | '2' | '3' | '4' | '5',
    { correct: number; incorrect: number; unknown: number; total: number }
  >
  clusters: MisconceptionCluster[]
  top_misconceptions: MisconceptionCluster[]
  response_labels: ResponseLabel[]
  graph: {
    nodes: Array<{ id: string; label: string; count: number; kind: 'cluster' | 'correct' | 'unknown' }>
    links: Array<{ source: string; target: string; count: number }>
  }
}

export type SessionRoundAnalysis = {
  version: 'analysis_v1'
  session_id: string
  session_code: string
  condition: Session['condition']
  round_number: 1 | 2
  created_at: string
  totals: {
    total_submissions: number
    average_confidence?: number | null
    avg_confidence: number | null
    percent_correct: number | null
    percent_fully_correct?: number | null
    evaluation_breakdown?: {
      correct: number
      mostly_correct: number
      partially_correct: number
      incorrect: number
      unclear: number
    }
    response_quality_breakdown?: {
      fully_correct: number
      partially_correct: number
      relevant_incomplete: number
      misconception: number
      unclear: number
    }
    confidence_breakdown: Record<
      '1' | '2' | '3' | '4' | '5',
      { correct: number; incorrect: number; unknown: number; total: number }
    >
  }
  per_question: QuestionAnalysis[]
  response_labels?: SessionAnalysisResponseLabel[]
  teaching_summary?: {
    overall_summary: string
    top_class_issues: string[]
    teaching_suggestions: string[]
  }
  summary_text: string
  transition_metrics?: {
    total_pairs: number
    incorrect_to_correct: { count: number; percent: number | null }
    correct_to_incorrect: { count: number; percent: number | null }
    stayed_correct: { count: number; percent: number | null }
    stayed_incorrect: { count: number; percent: number | null }
  }
  quality_transitions?: {
    total_pairs: number
    improved: number
    worsened: number
    unchanged: number
    moved_to_fully_correct: number
    avg_score_delta: number | null
  }
  transitions?: {
    incorrect_to_correct: number
    correct_to_incorrect: number
    no_change: number
  }
  per_question_transition_breakdown?: Array<{
    question_id: string
    position: number
    total_pairs: number
    incorrect_to_correct: { count: number; percent: number | null }
    correct_to_incorrect: { count: number; percent: number | null }
    stayed_correct: { count: number; percent: number | null }
    stayed_incorrect: { count: number; percent: number | null }
    no_change: { count: number; percent: number | null }
    examples?: {
      incorrect_to_correct: Array<{
        round1_response_id: string
        round2_response_id: string
        round1_answer: string
        round2_answer: string
        round1_label?: string | null
        round2_label?: string | null
      }>
      correct_to_incorrect: Array<{
        round1_response_id: string
        round2_response_id: string
        round1_answer: string
        round2_answer: string
        round1_label?: string | null
        round2_label?: string | null
      }>
      stayed_correct: Array<{
        round1_response_id: string
        round2_response_id: string
        round1_answer: string
        round2_answer: string
        round1_label?: string | null
        round2_label?: string | null
      }>
      stayed_incorrect: Array<{
        round1_response_id: string
        round2_response_id: string
        round1_answer: string
        round2_answer: string
        round1_label?: string | null
        round2_label?: string | null
      }>
    }
  }>
  misconception_comparison?: Array<{
    question_id: string
    position: number
    summary_line?: string
    suggested_action?: string
    counts?: {
      resolved: number
      reduced: number
      persistent: number
      emerging: number
    }
    grouped_deltas?: {
      resolved: Array<{
        label: string
        round1: number
        round2: number
        delta: number
        classification: 'resolved' | 'reduced' | 'persistent' | 'emerging'
        priority?: number
      }>
      reduced: Array<{
        label: string
        round1: number
        round2: number
        delta: number
        classification: 'resolved' | 'reduced' | 'persistent' | 'emerging'
        priority?: number
      }>
      persistent: Array<{
        label: string
        round1: number
        round2: number
        delta: number
        classification: 'resolved' | 'reduced' | 'persistent' | 'emerging'
        priority?: number
      }>
      emerging: Array<{
        label: string
        round1: number
        round2: number
        delta: number
        classification: 'resolved' | 'reduced' | 'persistent' | 'emerging'
        priority?: number
      }>
    }
    deltas: Array<{
      label: string
      round1: number
      round2: number
      delta: number
      classification: 'resolved' | 'reduced' | 'persistent' | 'emerging'
      priority?: number
    }>
  }>
}

function normalize(s: string) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function sha256(input: string) {
  return createHash('sha256').update(input).digest('hex')
}

function canonicalizeLabel(label: string) {
  const raw = String(label || '')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .toLowerCase()
  // Keep letters/numbers and spaces; drop most punctuation so O(1) and o(1) match.
  const stripped = raw.replace(/[^a-z0-9\s]+/g, ' ')
  return stripped.replace(/\s+/g, ' ').trim()
}

function parseUnderstandingLevel(input: unknown): UnderstandingLevel {
  const s = String(input || '').toLowerCase().replace(/[\s_-]+/g, '_').trim()
  if (s === 'correct') return 'correct'
  if (s === 'mostly_correct' || s === 'mostlycorrect') return 'mostly_correct'
  if (s === 'partially_correct' || s === 'partiallycorrect') return 'partially_correct'
  if (s === 'incorrect') return 'incorrect'
  return 'unclear'
}

function parseEvaluationCategory(input: unknown): EvaluationCategory {
  const s = String(input || '').toLowerCase().replace(/[\s_-]+/g, '_').trim()
  if (s === 'fully_correct' || s === 'fullycorrect') return 'fully_correct'
  if (s === 'partially_correct' || s === 'partial' || s === 'partiallycorrect') return 'partially_correct'
  if (s === 'relevant_incomplete' || s === 'incomplete' || s === 'relevantbutincomplete') return 'relevant_incomplete'
  if (s === 'misconception' || s === 'wrong' || s === 'incorrect') return 'misconception'
  return 'unclear'
}

function categoryToUnderstandingLevel(category: EvaluationCategory): UnderstandingLevel {
  if (category === 'fully_correct') return 'correct'
  if (category === 'partially_correct') return 'partially_correct'
  if (category === 'relevant_incomplete') return 'partially_correct'
  if (category === 'misconception') return 'incorrect'
  return 'unclear'
}

function levelToScore(level: UnderstandingLevel) {
  // Ordinal score for round-1 vs round-2 comparisons.
  if (level === 'correct') return 4
  if (level === 'mostly_correct') return 3
  if (level === 'partially_correct') return 2
  if (level === 'incorrect') return 1
  return 0
}

function isFullyCorrect(level: UnderstandingLevel) {
  return level === 'correct'
}

function mean(values: number[]) {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function getAnalysisPromptVersion(options: {
  condition: Session['condition']
  roundNumber: 1 | 2
}) {
  if (options.condition === 'baseline') return BASELINE_ANALYSIS_PROMPT_VERSION
  if (options.roundNumber === 2) return TREATMENT_R2_ANALYSIS_PROMPT_VERSION
  return TREATMENT_R1_ANALYSIS_PROMPT_VERSION
}

function isFixedAnswerQuestion(question: SessionQuestion) {
  const ca = String(question.correct_answer || '').trim()
  if (!ca) return false
  const len = ca.length
  const words = ca.split(/\s+/).filter(Boolean).length
  // Big-O and similar short forms are typically safe for exact matching.
  if (/^o\([^)]+\)$/i.test(ca)) return true
  // Very short canonical answers (e.g., "LIFO", "FIFO", "root", "true") are often fixed-answer style.
  if (len <= 24 && words <= 4) return true
  // Simple symbol-like answers (no spaces) are also likely fixed-answer.
  if (words === 1 && len <= 32) return true
  return false
}

function makeFallbackClusters(question: SessionQuestion, responses: Response[]) {
  const correctKey = question.correct_answer ? normalize(question.correct_answer) : ''
  let correctCount = 0
  const wrongCounts = new Map<string, number>()

  for (const r of responses) {
    const ans = normalize(r.answer)
    const isCorrect = correctKey ? ans === correctKey : false
    if (isCorrect) correctCount++
    else wrongCounts.set(ans, (wrongCounts.get(ans) || 0) + 1)
  }

  const wrongAnswerToClusterId = new Map<string, string>()
  const clusters: MisconceptionCluster[] = [...wrongCounts.entries()]
    .filter(([a]) => a)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([answer, count], idx) => ({
      cluster_id: (() => {
        const id = `C${idx + 1}`
        wrongAnswerToClusterId.set(answer, id)
        return id
      })(),
      label: answer.length > 80 ? `${answer.slice(0, 77)}...` : answer,
      variant: null,
      description: null,
      count,
      hint: question.correct_answer ? `Contrast with correct answer: ${question.correct_answer}` : null,
      example_response_ids: [],
    }))

  const labels: ResponseLabel[] = responses.map((r) => {
    const ans = normalize(r.answer)
    const isCorrect = correctKey ? ans === correctKey : null
    const cluster = isCorrect === false ? wrongAnswerToClusterId.get(ans) || null : null
    const understanding_level: UnderstandingLevel =
      isCorrect === true ? 'correct' : isCorrect === false ? 'incorrect' : 'unclear'
    const evaluation_category: EvaluationCategory =
      isCorrect === true ? 'fully_correct' : isCorrect === false ? 'misconception' : 'unclear'
    return {
      response_id: r.response_id,
      understanding_level,
      is_correct: isCorrect,
      evaluation_category,
      misconception_label: isCorrect === false ? (clusters.find(c => c.cluster_id === cluster)?.label || 'Incorrect') : null,
      misconception_variant: null,
      cluster_id: cluster,
      reasoning_summary: null,
      missing_key_idea: null,
      key_concepts_detected: [],
      missing_key_concepts: [],
      explanation: null,
    }
  })

  return { clusters, labels, correctCount }
}

export async function analyzeQuestionWithAI(options: {
  session: Session
  question: SessionQuestion
  responses: Array<Pick<Response, 'response_id' | 'answer' | 'confidence' | 'explanation'>>
}): Promise<
  | {
      ok: true
      analysis: { clusters: MisconceptionCluster[]; labels: ResponseLabel[]; summary: string }
      rawJson?: any
      rawText?: string
      promptMessages?: Array<{ role: 'system' | 'user'; content: string }>
    }
  | { ok: false; error: string; promptMessages?: Array<{ role: 'system' | 'user'; content: string }> }
> {
  const { question, responses } = options
  const reference = question.correct_answer
    ? `Intended correct answer (conceptual, not exact wording):\n${question.correct_answer}\n`
    : 'No intended answer provided.\n'

  const responseList = responses.map((r) => ({
    response_id: r.response_id,
    answer_text: r.answer,
    confidence: r.confidence,
    explanation: r.explanation || null,
  }))

  const system = `You are an educational measurement assistant helping a classroom teacher. Return ONLY valid JSON (no markdown). The JSON must follow this schema:
{
  "summary": string,
  "clusters": [{"cluster_id": "C1", "label": string, "description": string, "hint": string, "response_ids": [string]}],
  "response_labels": [{"response_id": string, "understanding_level": "correct"|"mostly_correct"|"partially_correct"|"incorrect"|"unclear", "cluster_id": string|null, "misconception_label": string|null, "explanation": string|null}]
}
Rules:
- "cluster_id" must be like C1, C2, ...
- Evaluate conceptual correctness relative to the intended answer. Do NOT rely on exact string matching.
- Use understanding_level:
  - correct: conceptually correct
  - mostly_correct: largely correct but missing a detail
  - partially_correct: has some correct idea but key gaps
  - incorrect: wrong or based on a misconception
  - unclear: too vague / off-topic / unreadable / language barrier
- If understanding_level is correct, set cluster_id=null and misconception_label=null.
- Clusters should group semantically similar misunderstandings from incorrect/partial answers.
- Keep labels short and teacher-friendly.
All output (summary, labels, hints, explanations) must be in English, regardless of input language.
`

  const user = `Question prompt:\n${question.prompt}\n\n${reference}\nStudent responses (JSON):\n${JSON.stringify(responseList)}`

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]

  const result = await openaiChatJson({ messages, maxTokens: 1100 })

  if (!result.ok) return { ok: false, error: result.error, promptMessages: messages }

  const json = result.json
  const clustersIn = Array.isArray(json?.clusters) ? json.clusters : []
  const labelsIn = Array.isArray(json?.response_labels) ? json.response_labels : []
  const clusters: MisconceptionCluster[] = clustersIn
    .filter((c: any) => c && typeof c.cluster_id === 'string' && typeof c.label === 'string')
    .map((c: any, idx: number) => ({
      cluster_id: String(c.cluster_id || `C${idx + 1}`),
      label: String(c.label || '').slice(0, 120),
      description: typeof c.description === 'string' ? c.description : null,
      hint: typeof c.hint === 'string' ? c.hint : null,
      count: Array.isArray(c.response_ids) ? c.response_ids.length : 0,
      example_response_ids: Array.isArray(c.response_ids) ? c.response_ids.slice(0, 6) : [],
    }))

  const labels: ResponseLabel[] = labelsIn
    .filter((l: any) => l && typeof l.response_id === 'string')
    .map((l: any) => {
      const understanding_level = parseUnderstandingLevel(l.understanding_level)
      const evaluation_category: EvaluationCategory =
        understanding_level === 'correct'
          ? 'fully_correct'
          : understanding_level === 'mostly_correct' || understanding_level === 'partially_correct'
            ? 'partially_correct'
            : understanding_level === 'incorrect'
              ? 'misconception'
              : 'unclear'
      const explanation = typeof l.explanation === 'string' ? l.explanation.slice(0, 280) : null
      return {
        response_id: String(l.response_id),
        understanding_level,
        is_correct: isFullyCorrect(understanding_level),
        evaluation_category,
        misconception_label: typeof l.misconception_label === 'string' ? l.misconception_label.slice(0, 120) : null,
        misconception_variant: null,
        cluster_id: typeof l.cluster_id === 'string' ? l.cluster_id : null,
        reasoning_summary: explanation,
        missing_key_idea: null,
        key_concepts_detected: [],
        missing_key_concepts: [],
        explanation,
      } satisfies ResponseLabel
    })

  const summary = typeof json?.summary === 'string' ? json.summary : ''
  return { ok: true, analysis: { clusters, labels, summary }, rawJson: json, rawText: result.rawText, promptMessages: messages }
}

type GroupedQuestionResponse = {
  grouped_response_id: string
  normalized_answer: string
  representative_answer_text: string
  count: number
  response_ids: string[]
  average_confidence: number | null
  explanation_samples?: string[]
}

type PerQuestionPromptQuestion = {
  question_id: string
  question_no: number
  prompt: string
  correct_answer: string | null
  lesson_concept?: string | null
  target_misconception?: string | null
  strong_answer_criteria?: string[]
  misconception_variants?: string[]
  unique_response_count: number
  total_response_count: number
  grouped_responses: Array<{
    grouped_response_id: string
    answer_text: string
    count: number
    average_confidence: number | null
    explanation_samples?: string[]
  }>
}

type PerQuestionPromptResult = {
  promptJson: {
    version: string
    session: {
      session_id: string
      session_code: string
      condition: Session['condition']
      status: Session['status']
    }
    round_number: 1 | 2
    question: PerQuestionPromptQuestion
  }
  messages: Array<{ role: 'system' | 'user'; content: string }>
}

type PerQuestionAIResult = {
  question_id: string
  question_no: number
  response_breakdown?: {
    fully_correct: number
    partially_correct: number
    relevant_incomplete: number
    misconception: number
    unclear: number
  }
  top_misconceptions: Array<ReturnType<typeof normalizeTopMisconception>>
  teacher_interpretation?: string
  suggested_teacher_action?: string
  response_labels: SessionAnalysisResponseLabel[]
}

type PerQuestionExecutionResult =
  | {
      ok: true
      aiResult: PerQuestionAIResult
      promptJson: Record<string, unknown>
      raw_response_json: Record<string, unknown>
      cacheHit: boolean
      aiCalled: boolean
      elapsedMs: number
    }
  | {
      ok: false
      error: string
      promptJson?: Record<string, unknown>
      rawText?: string
      cacheHit: boolean
      aiCalled: boolean
      elapsedMs: number
    }

const perQuestionAnalysisCache = new Map<
  string,
  {
    promptJson: Record<string, unknown>
    aiResult: PerQuestionAIResult
    raw_response_json: Record<string, unknown>
  }
>()

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []

  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results = new Array<R>(items.length)
  let nextIndex = 0

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1
      if (currentIndex >= items.length) return
      results[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()))
  return results
}

function groupResponsesForAnalysis(options: {
  responses: Array<Pick<Response, 'response_id' | 'answer' | 'confidence' | 'explanation'>>
}) {
  const groups = new Map<
    string,
    {
      normalized_answer: string
      representative_answer_text: string
      count: number
      response_ids: string[]
      confidences: number[]
      explanation_samples: string[]
    }
  >()

  for (const response of options.responses) {
    const normalized_answer = normalize(response.answer)
    const key = normalized_answer || '__EMPTY__'
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      existing.response_ids.push(response.response_id)
      if (
        String(response.answer || '').trim().length >
        String(existing.representative_answer_text || '').trim().length
      ) {
        existing.representative_answer_text = String(response.answer || '')
      }
      if (typeof response.confidence === 'number') existing.confidences.push(response.confidence)
      if (
        typeof response.explanation === 'string' &&
        response.explanation.trim() &&
        existing.explanation_samples.length < 2
      ) {
        existing.explanation_samples.push(response.explanation.trim().slice(0, 180))
      }
    } else {
      groups.set(key, {
        normalized_answer,
        representative_answer_text: String(response.answer || ''),
        count: 1,
        response_ids: [response.response_id],
        confidences: typeof response.confidence === 'number' ? [response.confidence] : [],
        explanation_samples:
          typeof response.explanation === 'string' && response.explanation.trim()
            ? [response.explanation.trim().slice(0, 180)]
            : [],
      })
    }
  }

  const groupedResponses: GroupedQuestionResponse[] = [...groups.values()]
    .sort((a, b) => b.count - a.count || a.normalized_answer.localeCompare(b.normalized_answer))
    .map((group, index) => ({
      grouped_response_id: `G${index + 1}`,
      normalized_answer: group.normalized_answer,
      representative_answer_text: group.representative_answer_text,
      count: group.count,
      response_ids: group.response_ids,
      average_confidence: mean(group.confidences),
      explanation_samples: group.explanation_samples,
    }))

  return groupedResponses
}

function computeQuestionFingerprint(options: {
  session: Session
  question: SessionQuestion
  roundNumber: 1 | 2
  groupedResponses: GroupedQuestionResponse[]
}) {
  const ctx = getUnionFindQuestionContext({
    position: options.question.position,
    prompt: options.question.prompt,
  })
  const promptVersion = getAnalysisPromptVersion({
    condition: options.session.condition,
    roundNumber: options.roundNumber,
  })
  return sha256(
    JSON.stringify({
      version: 'per_question_analysis_v2_compact_prompt',
      prompt_profile: options.session.condition === 'baseline' ? 'baseline_misconception_compact_v3' : 'treatment_compact_v1',
      schema_mode: options.session.condition === 'baseline' ? 'baseline_misconception_compact' : 'treatment_compact',
      prompt_version: promptVersion,
      session_id: options.session.id,
      question_id: options.question.question_id,
      round_number: options.roundNumber,
      prompt: options.question.prompt,
      correct_answer: options.question.correct_answer || null,
      context: ctx || null,
      grouped_responses: options.groupedResponses.map((group) => ({
        normalized_answer: group.normalized_answer,
        representative_answer_text: group.representative_answer_text,
        count: group.count,
        response_ids: [...group.response_ids].sort(),
      })),
    })
  )
}

function buildPerQuestionPrompt(options: {
  session: Session
  question: SessionQuestion
  groupedResponses: GroupedQuestionResponse[]
  roundNumber: 1 | 2
}): PerQuestionPromptResult {
  const { session, question, groupedResponses, roundNumber } = options
  const promptVersion = getAnalysisPromptVersion({
    condition: session.condition,
    roundNumber,
  })
  const ctx = getUnionFindQuestionContext({
    position: question.position,
    prompt: question.prompt,
  })

  const promptQuestion: PerQuestionPromptQuestion = {
    question_id: question.question_id,
    question_no: question.position,
    prompt: question.prompt,
    correct_answer: question.correct_answer,
    lesson_concept: ctx?.lesson_concept ?? null,
    target_misconception: ctx?.target_misconception ?? null,
    strong_answer_criteria: ctx?.strong_answer_criteria ?? [],
    misconception_variants: ctx?.misconception_variants ?? [],
    unique_response_count: groupedResponses.length,
    total_response_count: groupedResponses.reduce((sum, group) => sum + group.count, 0),
    grouped_responses: groupedResponses.map((group) => ({
      grouped_response_id: group.grouped_response_id,
      answer_text: group.representative_answer_text,
      count: group.count,
      average_confidence: group.average_confidence,
      explanation_samples: group.explanation_samples && group.explanation_samples.length > 0 ? group.explanation_samples : undefined,
    })),
  }

  const promptJson = {
    version: 'analysis_prompt_per_question_v3_split_schema',
    analysis_version: 'analysis_v1',
    prompt_version: promptVersion,
    schema_version: session.condition === 'baseline' ? 'baseline_misconception_compact_v2' : 'treatment_compact_v1',
    session: {
      session_id: session.id,
      session_code: session.session_code,
      condition: session.condition,
      status: session.status,
    },
    round_number: roundNumber,
    question: promptQuestion,
  }

  const isBaseline = session.condition === 'baseline'
  const treatmentFocus =
    roundNumber === 2
      ? 'These are revised answers after teacher feedback. Analyze only the revised responses as the current state and focus on what still needs repair.'
      : 'These are initial treatment answers before revision. Focus on the top misconceptions the teacher should address before opening revision.'

  const schemaText = isBaseline
    ? `{
  "question_id": string,
  "question_no": number,
  "response_breakdown": {
    "fully_correct": number,
    "partially_correct": number,
    "relevant_incomplete": number,
    "misconception": number,
    "unclear": number
  },
  "top_misconceptions": [
    {
      "label": string,
      "count": number,
      "description": string,
      "why_students_think_this": string,
      "teacher_move": string
    }
  ],
  "teacher_interpretation": string | null,
  "suggested_teacher_action": string | null,
  "response_labels": [
    {
      "grouped_response_id": string,
      "category": "fully_correct" | "partially_correct" | "relevant_incomplete" | "misconception" | "unclear",
      "is_correct": boolean | null,
      "misconception_label": string | null,
      "reasoning_summary": string | null
    }
  ]
}`
    : `{
  "question_id": string,
  "question_no": number,
  "response_breakdown": {
    "strong_correct": number,
    "partially_correct": number,
    "target_misconception": number,
    "other_misconception": number,
    "unclear": number
  },
  "top_misconceptions": [
    {
      "label": string,
      "count": number,
      "description": string,
      "hint": string
    }
  ],
  "teacher_interpretation": string,
  "suggested_teacher_action": string,
  "response_labels": [
    {
      "grouped_response_id": string,
      "category": "strong_correct" | "partially_correct" | "target_misconception" | "other_misconception" | "unclear",
      "is_correct": boolean | null,
      "misconception_label": string | null,
      "reasoning_summary": string | null,
      "missing_key_idea": string | null
    }
  ]
}`

  const system = isBaseline
    ? `You are analyzing short open-ended student responses from a live data structures lesson.
Your job is to identify misconceptions, not just summarize answer wording.

Lesson context:
- concept being taught
- target misconception
- strong answer criteria
- known misconception variants

Important distinction:
- Use misconception when a response shows a wrong rule, wrong mental model, wrong structural interpretation, or wrong complexity claim.
- Use relevant_incomplete only when the response is on-topic but missing a key idea without stating a false rule.

For this lesson, prioritize concept-level misconception labels such as:
- Direct union only
- No transitive merge
- Single-index QuickFind update
- Parent vs component confusion
- Root merge confusion
- O(1) complexity misconception

Do not just repeat student wording.
Do not overuse "relevant_incomplete".
If a response contains a false claim, classify it as a misconception.

Return ONLY valid JSON using this schema:
${schemaText}

Requirements:
- Return exactly one JSON object and nothing else.
- Do not wrap the JSON in markdown fences.
- Preserve grouped_response_id exactly.
- All output must be in English.
- misconception_label must be null unless category = "misconception".
- reasoning_summary: max 12 words.
- teacher_interpretation: one short sentence.
- suggested_teacher_action: one short sentence.
- description: one short sentence.
- why_students_think_this: one short sentence.
- teacher_move: one short sentence.
- Return at most 2 top_misconceptions.
- top_misconceptions should prioritize conceptual importance, not just wording frequency.
- Merge semantically similar wrong answers into the same misconception label.`
    : `Analyze one open-ended classroom question. Grade conceptually, not by exact wording.
${treatmentFocus}
Return only JSON using this schema:
${schemaText}
Rules:
- Return exactly one JSON object and nothing else.
- Do not wrap the JSON in markdown fences.
- Preserve grouped_response_id exactly.
- Use stable misconception labels when target_misconception or misconception_variants fit.
- Return at most 2 top_misconceptions.
- misconception_label: max 4 words.
- reasoning_summary: max 12 words.
- missing_key_idea: max 6 words, only for relevant but incomplete answers.
- hint, description, teacher_interpretation, suggested_teacher_action: each max 1 short sentence.
- Keep output brief.
- For round 1, make hints directly usable for immediate teacher explanation before revision opens.
- For round 2, do not compare to round 1 or mention improvement in prose; only describe the revised-answer state.`

  const user = isBaseline
    ? `Analyze this baseline question.

Question:
${question.prompt}

Correct answer:
${question.correct_answer || ''}

Lesson concept:
${ctx?.lesson_concept ?? ''}

Target misconception:
${ctx?.target_misconception ?? ''}

Strong answer criteria:
${JSON.stringify(ctx?.strong_answer_criteria ?? [])}

Known misconception variants:
${JSON.stringify(ctx?.misconception_variants ?? [])}

Grouped student responses:
${JSON.stringify(promptQuestion.grouped_responses)}

Your goal:
- identify the main conceptual misconceptions
- classify clearly wrong reasoning as misconception
- use relevant_incomplete only for on-topic but non-false partial answers
- produce concise teacher-usable misconception summaries
- keep the JSON compact enough to finish completely`
    : `Analyze this treatment question for round ${roundNumber}.

Question:
${question.prompt}

Correct answer:
${question.correct_answer || ''}

Lesson concept:
${ctx?.lesson_concept ?? ''}

Target misconception:
${ctx?.target_misconception ?? ''}

Strong answer criteria:
${JSON.stringify(ctx?.strong_answer_criteria ?? [])}

Known misconception variants:
${JSON.stringify(ctx?.misconception_variants ?? [])}

Grouped student responses:
${JSON.stringify(promptQuestion.grouped_responses)}

Your goal:
- label each grouped response conceptually
- return only the top 2 misconceptions
- keep hints short and teacher-usable
- ${roundNumber === 2 ? 'treat these as revised answers only' : 'support the teacher before revision opens'}`
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]

  return { promptJson, messages }
}

function expandGroupedLabelsToResponses(options: {
  question: SessionQuestion
  groupedResponses: GroupedQuestionResponse[]
  responseLabels: any[]
}) {
  const groupedById = new Map(options.groupedResponses.map((group) => [group.grouped_response_id, group]))
  const expanded: SessionAnalysisResponseLabel[] = []

  for (const item of Array.isArray(options.responseLabels) ? options.responseLabels : []) {
    const groupId = typeof item?.grouped_response_id === 'string' ? item.grouped_response_id : ''
    const group = groupedById.get(groupId)
    if (!group) continue
    const base = normalizeSessionResponseLabel({
      ...item,
      response_id: group.response_ids[0],
      question_id: options.question.question_id,
      cluster_id: typeof item?.cluster_id === 'string' ? item.cluster_id : null,
      explanation: null,
    })

    for (const responseId of group.response_ids) {
      expanded.push({
        ...base,
        response_id: responseId,
        question_id: options.question.question_id,
      })
    }
  }

  return expanded
}

async function analyzeGroupedQuestionWithAI(options: {
  session: Session
  question: SessionQuestion
  groupedResponses: GroupedQuestionResponse[]
  roundNumber: 1 | 2
}): Promise<PerQuestionExecutionResult> {
  const startedAt = Date.now()
  const fingerprint = computeQuestionFingerprint(options)
  const cached = perQuestionAnalysisCache.get(fingerprint)
  if (cached) {
    return {
      ok: true,
      aiResult: cached.aiResult,
      promptJson: cached.promptJson,
      raw_response_json: { ...cached.raw_response_json, cache_hit: true },
      cacheHit: true,
      aiCalled: false,
      elapsedMs: Date.now() - startedAt,
    }
  }

  const { promptJson, messages } = buildPerQuestionPrompt(options)
  const result = await openaiChatJson({
    messages,
    maxTokens: options.session.condition === 'baseline' ? 800 : 900,
    timeoutMs: 100000,
  })

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      promptJson,
      rawText: result.rawText,
      cacheHit: false,
      aiCalled: true,
      elapsedMs: Date.now() - startedAt,
    }
  }

  const json = result.json
  const aiResult: PerQuestionAIResult = {
    question_id: options.question.question_id,
    question_no: options.question.position,
    response_breakdown:
      json?.response_breakdown && typeof json.response_breakdown === 'object'
        ? {
            fully_correct: Number(json.response_breakdown.strong_correct ?? json.response_breakdown.fully_correct ?? 0),
            partially_correct: Number(json.response_breakdown.partially_correct || 0),
            relevant_incomplete: Number(json.response_breakdown.relevant_incomplete || 0),
            misconception: Number(
              json.response_breakdown.target_misconception ??
                json.response_breakdown.misconception ??
                0
            ) + Number(json.response_breakdown.other_misconception || 0),
            unclear: Number(json.response_breakdown.unclear || 0),
          }
        : undefined,
    top_misconceptions: Array.isArray(json?.top_misconceptions)
      ? json.top_misconceptions.map((x: any) => normalizeTopMisconception(x))
      : [],
    teacher_interpretation:
      typeof json?.teacher_interpretation === 'string' ? json.teacher_interpretation.slice(0, 220) : undefined,
    suggested_teacher_action:
      typeof json?.suggested_teacher_action === 'string' ? json.suggested_teacher_action.slice(0, 220) : undefined,
    response_labels: expandGroupedLabelsToResponses({
      question: options.question,
      groupedResponses: options.groupedResponses,
      responseLabels: Array.isArray(json?.response_labels) ? json.response_labels : [],
    }),
  }

  const raw_response_json = {
    version: 'analysis_raw_per_question_v1',
    session_id: options.session.id,
    session_code: options.session.session_code,
    question_id: options.question.question_id,
    round_number: options.roundNumber,
    parsed: json,
    heuristic_fallback: false,
    raw_text: result.rawText || null,
    cache_hit: false,
    fingerprint,
  }

  perQuestionAnalysisCache.set(fingerprint, {
    promptJson,
    aiResult,
    raw_response_json,
  })

  return {
    ok: true,
    aiResult,
    promptJson,
    raw_response_json,
    cacheHit: false,
    aiCalled: true,
    elapsedMs: Date.now() - startedAt,
  }
}

function normalizeSessionResponseLabel(input: any): SessionAnalysisResponseLabel {
  // Support both the old combined-prompt output shape and the newer misconception-driven shape.
  // New shape uses `category` instead of `evaluation_category`.
  const category = typeof input?.category === 'string' ? input.category : null
  const evaluation_category =
    category === 'strong_correct' || category === 'fully_correct'
      ? 'fully_correct'
      : category === 'partially_correct'
        ? 'partially_correct'
        : category === 'relevant_incomplete'
          ? 'relevant_incomplete'
        : category === 'target_misconception' || category === 'other_misconception'
          ? 'misconception'
          : category === 'misconception'
            ? 'misconception'
          : category === 'unclear'
            ? 'unclear'
            : parseEvaluationCategory(input?.evaluation_category)

  const understanding_level =
    typeof input?.understanding_level === 'string'
      ? parseUnderstandingLevel(input.understanding_level)
      : categoryToUnderstandingLevel(evaluation_category)

  const is_correct =
    typeof input?.is_correct === 'boolean' ? input.is_correct : isFullyCorrect(understanding_level)
  return {
    response_id: String(input?.response_id || ''),
    question_id: String(input?.question_id || ''),
    is_correct,
    understanding_level,
    evaluation_category,
    misconception_label: typeof input?.misconception_label === 'string' ? input.misconception_label.slice(0, 120) : null,
    misconception_variant: typeof input?.misconception_variant === 'string' ? input.misconception_variant.slice(0, 160) : null,
    cluster_id: typeof input?.cluster_id === 'string' ? input.cluster_id.slice(0, 30) : null,
    reasoning_summary:
      typeof input?.reasoning_summary === 'string' ? input.reasoning_summary.slice(0, 280) : null,
    missing_key_idea: typeof input?.missing_key_idea === 'string' ? input.missing_key_idea.slice(0, 180) : null,
    key_concepts_detected: Array.isArray(input?.key_concepts_detected)
      ? input.key_concepts_detected.filter((v: unknown) => typeof v === 'string').slice(0, 8)
      : [],
    missing_key_concepts: Array.isArray(input?.missing_key_concepts)
      ? input.missing_key_concepts.filter((v: unknown) => typeof v === 'string').slice(0, 8)
      : [],
    explanation: null,
  }
}

function normalizeTopMisconception(input: any): {
  label: string
  variant: string
  count: number
  hint: string
  description: string
  interpretation: string
  why_students_think_this: string
  teacher_move: string
  representative_answers: string[]
} {
  return {
    label: typeof input?.label === 'string' ? input.label.slice(0, 120) : 'Misconception',
    variant: typeof input?.variant === 'string' ? input.variant.slice(0, 120) : '',
    count: typeof input?.count === 'number' ? input.count : 0,
    hint:
      typeof input?.hint === 'string'
        ? input.hint.slice(0, 220)
        : typeof input?.teacher_move === 'string'
          ? input.teacher_move.slice(0, 220)
          : '',
    description: typeof input?.description === 'string' ? input.description.slice(0, 260) : '',
    interpretation:
      typeof input?.interpretation === 'string'
        ? input.interpretation.slice(0, 260)
        : typeof input?.why_students_think_this === 'string'
          ? input.why_students_think_this.slice(0, 260)
          : '',
    why_students_think_this:
      typeof input?.why_students_think_this === 'string' ? input.why_students_think_this.slice(0, 260) : '',
    teacher_move: typeof input?.teacher_move === 'string' ? input.teacher_move.slice(0, 220) : '',
    representative_answers: Array.isArray(input?.representative_answers)
      ? input.representative_answers.filter((v: unknown) => typeof v === 'string').slice(0, 4).map((s: string) => s.slice(0, 220))
      : [],
  }
}

export async function buildRoundAnalysis(options: {
  session: Session
  questions: SessionQuestion[]
  responses: Response[]
  roundNumber: 1 | 2
}): Promise<{
  analysis: SessionRoundAnalysis
  labelsByResponseId: Map<string, ResponseLabel>
  rawAi?: { prompt_json: Record<string, unknown>; raw_response_json: Record<string, unknown> }
}> {
  const { session, questions, responses, roundNumber } = options
  const startedAt = Date.now()
  const promptVersion = getAnalysisPromptVersion({
    condition: session.condition,
    roundNumber,
  })
  const sortedQuestions = questions.slice().sort((a, b) => a.position - b.position)
  const responsesByQuestionId = new Map<string, Response[]>()
  for (const response of responses) {
    const questionId = String(response.question_id || '')
    if (!questionId) continue
    const existing = responsesByQuestionId.get(questionId)
    if (existing) existing.push(response)
    else responsesByQuestionId.set(questionId, [response])
  }

  const aiResponseLabels = new Map<string, SessionAnalysisResponseLabel>()

  const perQuestionModel = new Map<
    string,
    {
      response_breakdown?: {
        fully_correct: number
        partially_correct: number
        relevant_incomplete: number
        misconception: number
        unclear: number
      }
      top_misconceptions: Array<ReturnType<typeof normalizeTopMisconception>>
      teacher_interpretation?: string
      suggested_teacher_action?: string
    }
  >()

  const aiQuestionInsights = new Map<string, Array<{ label: string; variant: string; hint: string; description: string; interpretation: string; why_students_think_this: string; teacher_move: string; representative_answers: string[] }>>()
  const rawPromptByQuestion: Record<string, unknown> = {}
  const rawResponseByQuestion: Record<string, unknown> = {}
  const concurrencyLimit = 2
  const questionTasks = sortedQuestions.map((question) => {
    const qResponses = responsesByQuestionId.get(question.question_id) || []
    const groupedResponses = groupResponsesForAnalysis({ responses: qResponses })
    const questionContext = getUnionFindQuestionContext({
      position: question.position,
      prompt: question.prompt,
    })
    const shouldUseAI = Boolean(questionContext) || !isFixedAnswerQuestion(question)

    return {
      question,
      qResponses,
      groupedResponses,
      shouldUseAI,
    }
  })

  const taskResults = await mapWithConcurrency(questionTasks, concurrencyLimit, async (task) => {
    const taskStartedAt = Date.now()
    if (!task.shouldUseAI || task.groupedResponses.length === 0) {
      const elapsedMs = Date.now() - taskStartedAt
      console.info(
        `[analysis] question_id=${task.question.question_id} position=${task.question.position} cache=miss ai_called=false elapsed_ms=${elapsedMs}`
      )
      return {
        question: task.question,
        result: null as PerQuestionExecutionResult | null,
      }
    }

    const result = await analyzeGroupedQuestionWithAI({
      session,
      question: task.question,
      groupedResponses: task.groupedResponses,
      roundNumber,
    })

    console.info(
      `[analysis] question_id=${task.question.question_id} position=${task.question.position} cache=${result.cacheHit ? 'hit' : 'miss'} ai_called=${result.aiCalled} elapsed_ms=${result.elapsedMs}`
    )

    return {
      question: task.question,
      result,
    }
  })

  for (const taskResult of taskResults) {
    const question = taskResult.question
    const groupedAi = taskResult.result
    if (!groupedAi) continue

    if (!groupedAi.ok) {
      const errorMessage = groupedAi.error
      rawPromptByQuestion[question.question_id] = groupedAi.promptJson || {}
      rawResponseByQuestion[question.question_id] = {
        version: 'analysis_raw_per_question_v1',
        question_id: question.question_id,
        error: errorMessage,
        heuristic_fallback: true,
        raw_text: groupedAi.rawText || null,
        cache_hit: groupedAi.cacheHit,
        ai_called: groupedAi.aiCalled,
        elapsed_ms: groupedAi.elapsedMs,
      }
      continue
    }

    rawPromptByQuestion[question.question_id] = groupedAi.promptJson
    rawResponseByQuestion[question.question_id] = {
      ...groupedAi.raw_response_json,
      ai_called: groupedAi.aiCalled,
      elapsed_ms: groupedAi.elapsedMs,
    }

    for (const item of groupedAi.aiResult.response_labels) {
      const label = normalizeSessionResponseLabel(item)
      if (label.response_id) aiResponseLabels.set(label.response_id, label)
    }

    perQuestionModel.set(question.question_id, {
      response_breakdown: groupedAi.aiResult.response_breakdown,
      top_misconceptions: groupedAi.aiResult.top_misconceptions,
      teacher_interpretation: groupedAi.aiResult.teacher_interpretation,
      suggested_teacher_action: groupedAi.aiResult.suggested_teacher_action,
    })

    aiQuestionInsights.set(
      question.question_id,
      groupedAi.aiResult.top_misconceptions.map((entry) => ({
        label: entry.label,
        variant: entry.variant,
        hint: entry.hint || '',
        description: entry.description || '',
        interpretation: entry.interpretation || '',
        why_students_think_this: entry.why_students_think_this || '',
        teacher_move: entry.teacher_move || '',
        representative_answers: entry.representative_answers || [],
      }))
    )

  }

  const totalsConfidenceBreakdown: SessionRoundAnalysis['totals']['confidence_breakdown'] = {
    '1': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
    '2': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
    '3': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
    '4': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
    '5': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
  }

  const labelsByResponseId = new Map<string, ResponseLabel>()
  const allResponseLabels: SessionAnalysisResponseLabel[] = []
  const perQuestion: QuestionAnalysis[] = []
  const allConf: number[] = []
  const totalsEval = {
    correct: 0,
    mostly_correct: 0,
    partially_correct: 0,
    incorrect: 0,
    unclear: 0,
  }

  const topMisconceptionLimit = session.condition === 'treatment' ? 2 : 5

  for (const question of sortedQuestions) {
    const qResponses = responsesByQuestionId.get(question.question_id) || []
    const fallback = makeFallbackClusters(question, qResponses)
    const fallbackLabelMap = new Map(fallback.labels.map((label) => [label.response_id, label]))
    const correctKey = question.correct_answer ? normalize(question.correct_answer) : ''
    const fixedAnswer = isFixedAnswerQuestion(question)
    const conf = qResponses
      .map((response) => response.confidence)
      .filter((value): value is Response['confidence'] => typeof value === 'number')
    allConf.push(...conf)

    const fullLabels: ResponseLabel[] = qResponses.map((response) => {
      const aiLabel = aiResponseLabels.get(response.response_id)
      const fallbackLabel = fallbackLabelMap.get(response.response_id)
      // IMPORTANT: if AI labeling is missing, do not default to heuristic "exact-match" labels for open-ended questions.
      // We'll fill conservatively below.
      let evaluation_category: EvaluationCategory = aiLabel?.evaluation_category ?? 'unclear'
      let understanding_level: UnderstandingLevel =
        aiLabel?.understanding_level ?? categoryToUnderstandingLevel(evaluation_category)
      const out: ResponseLabel = {
        response_id: response.response_id,
        understanding_level,
        is_correct: aiLabel ? isFullyCorrect(understanding_level) : null,
        evaluation_category,
        misconception_label: aiLabel?.misconception_label ?? fallbackLabel?.misconception_label ?? null,
        misconception_variant: aiLabel?.misconception_variant ?? null,
        cluster_id: aiLabel?.cluster_id ?? fallbackLabel?.cluster_id ?? null,
        reasoning_summary: aiLabel?.reasoning_summary ?? null,
        missing_key_idea: aiLabel?.missing_key_idea ?? null,
        key_concepts_detected: aiLabel?.key_concepts_detected || [],
        missing_key_concepts: aiLabel?.missing_key_concepts || [],
        explanation: null,
      }

      // If model didn't label:
      // - Exact match can mark fully_correct (weak fallback).
      // - For open-ended questions, do NOT mark non-matching answers as misconception by default.
      // - Only treat non-match as incorrect for clearly fixed-answer questions.
      if (!aiLabel) {
        const exactMatch = Boolean(correctKey) && normalize(response.answer) === correctKey
        if (exactMatch) {
          out.evaluation_category = 'fully_correct'
          out.understanding_level = 'correct'
          out.is_correct = true
          out.misconception_label = null
          out.cluster_id = null
          out.reasoning_summary = out.reasoning_summary || 'Matched expected answer.'
        } else if (fixedAnswer && correctKey) {
          // Fixed-answer style: non-match is treated as incorrect.
          out.evaluation_category = 'misconception'
          out.understanding_level = 'incorrect'
          out.is_correct = false
          out.reasoning_summary =
            out.reasoning_summary || 'Did not match expected fixed-answer response.'
          // Prefer any heuristic misconception label if present; otherwise keep null.
        } else {
          // Open-ended: be conservative.
          const hasContent = String(response.answer || '').trim().length >= 12
          out.evaluation_category = hasContent ? 'relevant_incomplete' : 'unclear'
          out.understanding_level = hasContent ? 'partially_correct' : 'unclear'
          out.is_correct = null
          out.misconception_label = null
          out.cluster_id = null
          out.missing_key_idea = hasContent ? 'Missing key idea' : null
          out.reasoning_summary =
            out.reasoning_summary ||
            'AI label missing; conservatively treated as unclear/partial rather than incorrect.'
        }
      }

      if (out.understanding_level === 'correct') {
        out.cluster_id = null
        out.misconception_label = null
      } else if (out.evaluation_category === 'misconception' && !out.misconception_label) {
        out.misconception_label = fallbackLabel?.misconception_label || 'Misconception'
      }

      labelsByResponseId.set(out.response_id, out)
      allResponseLabels.push({
        response_id: out.response_id,
        question_id: question.question_id,
        is_correct: out.is_correct,
        understanding_level: out.understanding_level,
        evaluation_category: out.evaluation_category,
        misconception_label: out.misconception_label,
        misconception_variant: out.misconception_variant ?? null,
        cluster_id: out.cluster_id,
        reasoning_summary: out.reasoning_summary,
        missing_key_idea: out.missing_key_idea ?? null,
        key_concepts_detected: out.key_concepts_detected,
        missing_key_concepts: out.missing_key_concepts,
        explanation: null,
      })
      return out
    })

    const questionConfidenceBreakdown: QuestionAnalysis['confidence_breakdown'] = {
      '1': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
      '2': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
      '3': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
      '4': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
      '5': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
    }

    const evalBreakdown = {
      correct: 0,
      mostly_correct: 0,
      partially_correct: 0,
      incorrect: 0,
      unclear: 0,
    }
    const qualityBreakdown = {
      fully_correct: 0,
      partially_correct: 0,
      relevant_incomplete: 0,
      misconception: 0,
      unclear: 0,
    }

    for (const response of qResponses) {
      const label = labelsByResponseId.get(response.response_id)
      const key = String(response.confidence) as keyof QuestionAnalysis['confidence_breakdown']
      if (!questionConfidenceBreakdown[key]) continue
      questionConfidenceBreakdown[key].total += 1
      totalsConfidenceBreakdown[key].total += 1
      const lvl = label?.understanding_level || 'unclear'
      if (lvl in evalBreakdown) (evalBreakdown as any)[lvl] += 1
      if (lvl in totalsEval) (totalsEval as any)[lvl] += 1
      const cat = label?.evaluation_category || 'unclear'
      // Heuristic: treat "partially_correct" responses with no misconception label but a missing key idea
      // as "relevant_incomplete" for baseline teaching usefulness.
      if (
        cat === 'partially_correct' &&
        !label?.misconception_label &&
        label?.missing_key_idea
      ) {
        qualityBreakdown.relevant_incomplete += 1
      } else if (cat in qualityBreakdown) {
        ;(qualityBreakdown as any)[cat] += 1
      }
      if (label?.is_correct === true) {
        questionConfidenceBreakdown[key].correct += 1
        totalsConfidenceBreakdown[key].correct += 1
      } else if (label?.is_correct === false) {
        questionConfidenceBreakdown[key].incorrect += 1
        totalsConfidenceBreakdown[key].incorrect += 1
      } else {
        questionConfidenceBreakdown[key].unknown += 1
        totalsConfidenceBreakdown[key].unknown += 1
      }
    }

    const derivedCorrectCount = fullLabels.filter((label) => label.is_correct === true).length
    const percentFullyCorrect = qResponses.length > 0 ? Math.round((derivedCorrectCount / qResponses.length) * 100) : null
    const percentCorrect = percentFullyCorrect
    const avgConfidence = mean(conf)

    const representative_examples: Partial<Record<EvaluationCategory, string>> = {}
    for (const response of qResponses) {
      const label = labelsByResponseId.get(response.response_id)
      const cat = label?.evaluation_category
      if (!cat) continue
      if (!representative_examples[cat]) {
        representative_examples[cat] = String(response.answer || '').slice(0, 280)
      }
    }

    const answerById = new Map(qResponses.map((r) => [r.response_id, r.answer]))
    const misconceptionCounts = new Map<string, { label: string; count: number; hint: string; description: string; interpretation: string; why_students_think_this: string; teacher_move: string; reps: string[] }>()
    for (const label of fullLabels) {
      if (label.evaluation_category !== 'misconception') continue
      const misconceptionLabel = String(label.misconception_label || '').trim()
      if (!misconceptionLabel) continue
      const canon = canonicalizeLabel(misconceptionLabel)
      if (!canon) continue
      const hintMatch = aiQuestionInsights
        .get(question.question_id)
        ?.find((entry) => canonicalizeLabel(entry.label) === canon)
      const existing = misconceptionCounts.get(canon)
      if (existing) {
        existing.count += 1
        if (misconceptionLabel.length > existing.label.length) existing.label = misconceptionLabel
        if (!existing.hint && hintMatch?.hint) existing.hint = hintMatch.hint
        if (!existing.description && hintMatch?.description) existing.description = hintMatch.description
        if (!existing.interpretation && hintMatch?.interpretation) existing.interpretation = hintMatch.interpretation
        if (!existing.why_students_think_this && hintMatch?.why_students_think_this) existing.why_students_think_this = hintMatch.why_students_think_this
        if (!existing.teacher_move && hintMatch?.teacher_move) existing.teacher_move = hintMatch.teacher_move
        if (existing.reps.length < 3) {
          existing.reps.push(String(answerById.get(label.response_id) || misconceptionLabel).slice(0, 220))
        }
      } else {
        misconceptionCounts.set(canon, {
          label: misconceptionLabel.length > 120 ? `${misconceptionLabel.slice(0, 117)}...` : misconceptionLabel,
          count: 1,
          hint: hintMatch?.hint || (question.correct_answer ? `Contrast with correct answer: ${question.correct_answer}` : ''),
          description: hintMatch?.description || '',
          interpretation: hintMatch?.interpretation || '',
          why_students_think_this: hintMatch?.why_students_think_this || '',
          teacher_move: hintMatch?.teacher_move || '',
          reps: [String(answerById.get(label.response_id) || misconceptionLabel).slice(0, 220)],
        })
      }
    }

    const sortedMisconceptions = [...misconceptionCounts.values()].sort((a, b) => b.count - a.count)
    const modelQ = perQuestionModel.get(question.question_id)
    const modelMisconceptions = (modelQ?.top_misconceptions || [])
      .filter((x) => x && x.label && x.count > 0)
      .slice(0, topMisconceptionLimit)
      .map((entry, index): MisconceptionCluster => ({
        cluster_id: `C${index + 1}`,
        label: entry.label,
        variant: entry.variant || null,
        description: entry.description || null,
        interpretation: entry.interpretation || null,
        why_students_think_this: entry.why_students_think_this || entry.interpretation || null,
        teacher_move: entry.teacher_move || entry.hint || null,
        count: entry.count,
        hint: entry.hint || entry.teacher_move || null,
        example_response_ids: [] as string[],
        representative_answers: entry.representative_answers || [],
      }))

    const computedMisconceptions: MisconceptionCluster[] = sortedMisconceptions
      .slice(0, topMisconceptionLimit)
      .map((entry, index): MisconceptionCluster => ({
        cluster_id: `C${index + 1}`,
        label: entry.label,
        description: entry.description || null,
        interpretation: entry.interpretation || null,
        why_students_think_this: entry.why_students_think_this || entry.interpretation || null,
        teacher_move: entry.teacher_move || entry.hint || null,
        count: entry.count,
        hint: entry.hint || entry.teacher_move || null,
        example_response_ids: [] as string[],
        representative_answers: entry.reps,
      }))

    const topMisconceptions: MisconceptionCluster[] =
      modelMisconceptions.length > 0 ? modelMisconceptions : computedMisconceptions

    if (topMisconceptions.length === 0) {
      topMisconceptions.push(...fallback.clusters.slice(0, topMisconceptionLimit))
    }

    // Prefer model-written teacher guidance when available (prompt is question-aware).
    const teacher_interpretation =
      typeof modelQ?.teacher_interpretation === 'string' && modelQ.teacher_interpretation.trim()
        ? modelQ.teacher_interpretation.trim()
        : topMisconceptions[0]?.description
          ? topMisconceptions[0].description
          : qualityBreakdown.misconception > 0 && topMisconceptions[0]?.label
            ? `Many students show a misconception about: ${topMisconceptions[0].label}.`
          : qualityBreakdown.relevant_incomplete > 0
            ? 'Many responses are relevant but incomplete (on-topic, but missing key defining ideas).'
            : qualityBreakdown.partially_correct > 0
              ? 'Several responses show partial understanding with important gaps.'
              : 'Response quality is mixed; review examples to calibrate instruction.'

    const suggested_teacher_action =
      typeof modelQ?.suggested_teacher_action === 'string' && modelQ.suggested_teacher_action.trim()
        ? modelQ.suggested_teacher_action.trim()
        : topMisconceptions[0]?.teacher_move
          ? String(topMisconceptions[0].teacher_move)
        : topMisconceptions[0]?.hint
          ? String(topMisconceptions[0].hint)
          : question.correct_answer
            ? `Reinforce the key idea(s): ${question.correct_answer}`
            : 'Reinforce the key defining idea(s) and do a quick check-for-understanding.'

    // If model provides a breakdown, trust it for the main buckets and keep our "relevant_incomplete"
    // heuristic additive (it is a teacher-centric split of partial responses).
    if (modelQ?.response_breakdown) {
      qualityBreakdown.fully_correct = modelQ.response_breakdown.fully_correct
      qualityBreakdown.partially_correct = modelQ.response_breakdown.partially_correct
      qualityBreakdown.relevant_incomplete = modelQ.response_breakdown.relevant_incomplete
      qualityBreakdown.misconception = modelQ.response_breakdown.misconception
      qualityBreakdown.unclear = modelQ.response_breakdown.unclear
    }

    const correctNode = {
      id: 'correct',
      label: 'Correct',
      count: derivedCorrectCount,
      kind: 'correct' as const,
    }
    const clusterNodes = topMisconceptions.map((cluster, index) => ({
      id: cluster.cluster_id || `C${index + 1}`,
      label: cluster.label,
      count: cluster.count,
      kind: 'cluster' as const,
    }))
    const unknownNode = {
      id: 'unknown',
      label: 'Unlabeled',
      count: fullLabels.filter((label) => label.is_correct === null).length,
      kind: 'unknown' as const,
    }

    perQuestion.push({
      question_id: question.question_id,
      question_no: question.position,
      position: question.position,
      prompt: question.prompt,
      correct_answer: question.correct_answer,
      submission_count: qResponses.length,
      response_count: qResponses.length,
      avg_confidence: avgConfidence,
      average_confidence: avgConfidence,
      percent_correct: percentCorrect,
      percent_fully_correct: percentFullyCorrect,
      evaluation_breakdown: evalBreakdown,
      response_quality_breakdown: qualityBreakdown,
      representative_examples,
      teacher_interpretation,
      suggested_teacher_action,
      confidence_breakdown: questionConfidenceBreakdown,
      clusters: topMisconceptions,
      top_misconceptions: topMisconceptions,
      response_labels: fullLabels,
      graph: {
        nodes: [correctNode, ...clusterNodes, unknownNode].filter((node) => node.count > 0),
        links: [],
      },
    })
  }

  const avgConfidence = mean(allConf)
  const totalsQuality = {
    fully_correct: 0,
    partially_correct: 0,
    relevant_incomplete: 0,
    misconception: 0,
    unclear: 0,
  }
  for (const label of labelsByResponseId.values()) {
    const cat = label.evaluation_category || 'unclear'
    if (cat in totalsQuality) {
      ;(totalsQuality as any)[cat] += 1
    } else {
      totalsQuality.unclear += 1
    }
  }
  const totals = {
    total_submissions: responses.length,
    average_confidence: avgConfidence,
    avg_confidence: avgConfidence,
    percent_correct: responses.length > 0 ? Math.round((totalsEval.correct / responses.length) * 100) : null,
    percent_fully_correct: responses.length > 0 ? Math.round((totalsEval.correct / responses.length) * 100) : null,
    evaluation_breakdown: totalsEval,
    response_quality_breakdown: totalsQuality,
    confidence_breakdown: totalsConfidenceBreakdown,
  }

  const topClassIssues = perQuestion
    .flatMap((question) => question.top_misconceptions.slice(0, 1).map((entry) => `${question.question_no || question.position}: ${entry.label}`))
    .slice(0, 5)

  const teachingSuggestions = perQuestion
    .map((question) => question.suggested_teacher_action)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .slice(0, 5)

  const teaching_summary = {
    overall_summary:
      session.condition === 'baseline'
        ? 'Baseline round analysis generated.'
        : roundNumber === 1
          ? 'Treatment round 1 analysis generated. Use the top misconceptions to plan instruction, then open revision.'
          : 'Treatment final analysis generated. Review improvement and remaining misconceptions.',
    top_class_issues: topClassIssues,
    teaching_suggestions: teachingSuggestions,
  }

  const analysis: SessionRoundAnalysis = {
    version: 'analysis_v1',
    session_id: session.id,
    session_code: session.session_code,
    condition: session.condition,
    round_number: roundNumber,
    created_at: new Date().toISOString(),
    totals,
    per_question: perQuestion.sort((a, b) => a.position - b.position),
    response_labels: allResponseLabels,
    teaching_summary,
    summary_text: teaching_summary.overall_summary,
  }

  const rawAi = {
    prompt_json: {
      version: 'analysis_prompt_per_question_bundle_v1',
      analysis_version: 'analysis_v1',
      prompt_version: promptVersion,
      schema_version: session.condition === 'baseline' ? 'baseline_misconception_compact_v2' : 'treatment_compact_v1',
      session_id: session.id,
      condition: session.condition,
      round_number: roundNumber,
      questions: rawPromptByQuestion,
    },
    raw_response_json: {
      version: 'analysis_raw_per_question_bundle_v1',
      analysis_version: 'analysis_v1',
      prompt_version: promptVersion,
      session_id: session.id,
      session_code: session.session_code,
      condition: session.condition,
      round_number: roundNumber,
      questions: rawResponseByQuestion,
    },
  }

  console.info(
    `[analysis] session_id=${session.id} round=${roundNumber} condition=${session.condition} prompt_version=${promptVersion} total_questions=${sortedQuestions.length} total_responses=${responses.length} elapsed_ms=${Date.now() - startedAt}`
  )

  return { analysis, labelsByResponseId, rawAi }
}
