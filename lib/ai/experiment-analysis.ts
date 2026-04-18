import type { Response, Session, SessionQuestion } from '@/lib/types/database'
import { createHash } from 'crypto'
import { openaiChatJson } from '@/lib/ai/openai-json'
import { getUnionFindQuestionContext } from '@/lib/ai/union-find-question-config'

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
  transitions?: {
    incorrect_to_correct: number
    correct_to_incorrect: number
    no_change: number
  }
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
- Keep labels short and teacher-friendly.`

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
  grouped_responses: GroupedQuestionResponse[]
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
    strong_correct: number
    partially_correct: number
    target_misconception: number
    other_misconception: number
    unclear: number
  }
  top_misconceptions: Array<ReturnType<typeof normalizeTopMisconception>>
  teacher_interpretation?: string
  suggested_teacher_action?: string
  response_labels: SessionAnalysisResponseLabel[]
  summary?: string
}

const perQuestionAnalysisCache = new Map<
  string,
  {
    promptJson: Record<string, unknown>
    aiResult: PerQuestionAIResult
    raw_response_json: Record<string, unknown>
  }
>()

function groupResponsesForAnalysis(options: {
  responses: Array<Pick<Response, 'response_id' | 'answer' | 'confidence'>>
}) {
  const groups = new Map<
    string,
    {
      normalized_answer: string
      representative_answer_text: string
      count: number
      response_ids: string[]
      confidences: number[]
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
    } else {
      groups.set(key, {
        normalized_answer,
        representative_answer_text: String(response.answer || ''),
        count: 1,
        response_ids: [response.response_id],
        confidences: typeof response.confidence === 'number' ? [response.confidence] : [],
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
  return sha256(
    JSON.stringify({
      version: 'per_question_analysis_v1',
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
    grouped_responses: groupedResponses,
  }

  const promptJson = {
    version: 'analysis_prompt_per_question_v1',
    session: {
      session_id: session.id,
      session_code: session.session_code,
      condition: session.condition,
      status: session.status,
    },
    round_number: roundNumber,
    question: promptQuestion,
  }

  const modeLine =
    session.condition === 'baseline'
      ? 'MODE: BASELINE round 1 diagnostic. Focus on misconception diagnosis; do not over-emphasize grading.'
      : roundNumber === 1
        ? 'MODE: TREATMENT round 1 diagnostic + repair prep. Include repair-oriented hints for the top misconceptions.'
        : 'MODE: TREATMENT round 2 revision analysis. Analyze ONLY the round-2 responses; do not compare to round 1 inside this output.'

  const system = `
You are an educational analysis assistant helping a teacher interpret open-ended in-class quiz responses for one question at a time.

These are NOT multiple-choice answers and should NOT be graded with a simplistic right/wrong mindset.

You will be given:
- the question prompt
- the intended/correct answer
- the lesson concept
- the target misconception
- what a strong answer should include
- common misconception variants
- grouped unique student answers with counts and response_ids

${modeLine}

Return ONLY valid JSON.

Use this schema:
{
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
"variant": string,
"count": number,
"description": string,
"interpretation": string,
"representative_answers": [string],
"hint": string
}
],
"teacher_interpretation": string,
"suggested_teacher_action": string
,
"summary": string,
"response_labels": [
{
"grouped_response_id": string,
"question_id": string,
"category": "strong_correct" | "partially_correct" | "target_misconception" | "other_misconception" | "unclear",
"is_correct": boolean | null,
"misconception_label": string | null,
"misconception_variant": string | null,
"reasoning_summary": string | null,
"missing_key_idea": string | null,
"key_concepts_detected": [string],
"missing_key_concepts": [string]
}
}

Rules:

* Do not rely on exact string matching.
* Do not mark a response wrong just because wording differs from the intended answer.
* Use "strong_correct" only when the defining idea is clearly present and there is no major conceptual error.
* Use "partially_correct" when the response contains a correct core idea but is incomplete, weakly justified, or missing an important detail.
* Use "target_misconception" when the response demonstrates the main misconception this checkpoint is designed to diagnose.
* Use "other_misconception" when the response is conceptually wrong, but in a way different from the target misconception.
* Use "unclear" when the answer is too vague, off-topic, contradictory, or not interpretable.
* Keep misconception labels short, concept-based, and teacher-friendly.
* Prefer stable conceptual labels such as "direct-edge-only thinking" over repeating raw student wording.
* Representative answers should be anonymized and short.
* The input answers are deduplicated. Label each grouped answer once, based on the representative answer text, and account for its frequency count in the breakdowns and top misconceptions.
* Use the provided grouped_response_id exactly in response_labels.
* Do not invent grouped_response_ids or omit any grouped answer.
* For baseline: hints can be empty or generic; prioritize diagnosis and interpretation.
* For treatment round 1: hints MUST be specific, teacher-actionable repair guidance for the top misconceptions.
* For treatment round 2: still provide hints, but do NOT attempt to compare to round 1 inside this response.
`

  const user = JSON.stringify(promptJson)
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
}): Promise<
  | {
      ok: true
      aiResult: PerQuestionAIResult
      promptJson: Record<string, unknown>
      raw_response_json: Record<string, unknown>
    }
  | {
      ok: false
      error: string
      promptJson?: Record<string, unknown>
    }
> {
  const fingerprint = computeQuestionFingerprint(options)
  const cached = perQuestionAnalysisCache.get(fingerprint)
  if (cached) {
    return {
      ok: true,
      aiResult: cached.aiResult,
      promptJson: cached.promptJson,
      raw_response_json: { ...cached.raw_response_json, cache_hit: true },
    }
  }

  const { promptJson, messages } = buildPerQuestionPrompt(options)
  const result = await openaiChatJson({
    messages,
    maxTokens: 1400,
    timeoutMs: 30000,
  })

  if (!result.ok) {
    return { ok: false, error: result.error, promptJson }
  }

  const json = result.json
  const aiResult: PerQuestionAIResult = {
    question_id: options.question.question_id,
    question_no: options.question.position,
    response_breakdown:
      json?.response_breakdown && typeof json.response_breakdown === 'object'
        ? {
            strong_correct: Number(json.response_breakdown.strong_correct || 0),
            partially_correct: Number(json.response_breakdown.partially_correct || 0),
            target_misconception: Number(json.response_breakdown.target_misconception || 0),
            other_misconception: Number(json.response_breakdown.other_misconception || 0),
            unclear: Number(json.response_breakdown.unclear || 0),
          }
        : undefined,
    top_misconceptions: Array.isArray(json?.top_misconceptions)
      ? json.top_misconceptions.map((x: any) => normalizeTopMisconception(x))
      : [],
    teacher_interpretation:
      typeof json?.teacher_interpretation === 'string' ? json.teacher_interpretation : undefined,
    suggested_teacher_action:
      typeof json?.suggested_teacher_action === 'string' ? json.suggested_teacher_action : undefined,
    response_labels: expandGroupedLabelsToResponses({
      question: options.question,
      groupedResponses: options.groupedResponses,
      responseLabels: Array.isArray(json?.response_labels) ? json.response_labels : [],
    }),
    summary: typeof json?.summary === 'string' ? json.summary : undefined,
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

  return { ok: true, aiResult, promptJson, raw_response_json }
}

function normalizeSessionResponseLabel(input: any): SessionAnalysisResponseLabel {
  // Support both the old combined-prompt output shape and the newer misconception-driven shape.
  // New shape uses `category` instead of `evaluation_category`.
  const category = typeof input?.category === 'string' ? input.category : null
  const evaluation_category =
    category === 'strong_correct'
      ? 'fully_correct'
      : category === 'partially_correct'
        ? 'partially_correct'
        : category === 'target_misconception' || category === 'other_misconception'
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
  representative_answers: string[]
} {
  return {
    label: typeof input?.label === 'string' ? input.label.slice(0, 120) : 'Misconception',
    variant: typeof input?.variant === 'string' ? input.variant.slice(0, 120) : '',
    count: typeof input?.count === 'number' ? input.count : 0,
    hint: typeof input?.hint === 'string' ? input.hint.slice(0, 220) : '',
    description: typeof input?.description === 'string' ? input.description.slice(0, 260) : '',
    interpretation: typeof input?.interpretation === 'string' ? input.interpretation.slice(0, 260) : '',
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

  const aiResponseLabels = new Map<string, SessionAnalysisResponseLabel>()

  const perQuestionModel = new Map<
    string,
    {
      response_breakdown?: {
        strong_correct: number
        partially_correct: number
        target_misconception: number
        other_misconception: number
        unclear: number
      }
      top_misconceptions: Array<ReturnType<typeof normalizeTopMisconception>>
      teacher_interpretation?: string
      suggested_teacher_action?: string
    }
  >()

  const aiQuestionInsights = new Map<string, Array<{ label: string; variant: string; hint: string; description: string; interpretation: string; representative_answers: string[] }>>()
  const rawPromptByQuestion: Record<string, unknown> = {}
  const rawResponseByQuestion: Record<string, unknown> = {}
  const questionSummaries: string[] = []

  for (const question of questions.slice().sort((a, b) => a.position - b.position)) {
    const qResponses = responses.filter((response) => response.question_id === question.question_id)
    const groupedResponses = groupResponsesForAnalysis({ responses: qResponses })
    const questionContext = getUnionFindQuestionContext({
      position: question.position,
      prompt: question.prompt,
    })
    const shouldUseAI = Boolean(questionContext) || !isFixedAnswerQuestion(question)

    if (!shouldUseAI || groupedResponses.length === 0) continue

    const groupedAi = await analyzeGroupedQuestionWithAI({
      session,
      question,
      groupedResponses,
      roundNumber,
    })

    if (!groupedAi.ok) {
      const errorMessage = groupedAi.error
      rawPromptByQuestion[question.question_id] = groupedAi.promptJson || {}
      rawResponseByQuestion[question.question_id] = {
        version: 'analysis_raw_per_question_v1',
        question_id: question.question_id,
        error: errorMessage,
        heuristic_fallback: true,
      }
      continue
    }

    rawPromptByQuestion[question.question_id] = groupedAi.promptJson
    rawResponseByQuestion[question.question_id] = groupedAi.raw_response_json

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
        representative_answers: entry.representative_answers || [],
      }))
    )

    if (groupedAi.aiResult.summary?.trim()) {
      questionSummaries.push(groupedAi.aiResult.summary.trim())
    }
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

  for (const question of questions.slice().sort((a, b) => a.position - b.position)) {
    const qResponses = responses.filter((response) => response.question_id === question.question_id)
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
    const misconceptionCounts = new Map<string, { label: string; count: number; hint: string; description: string; interpretation: string; reps: string[] }>()
    for (const label of fullLabels) {
      if (label.evaluation_category !== 'misconception' && label.evaluation_category !== 'partially_correct') continue
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
        count: entry.count,
        hint: entry.hint || null,
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
        count: entry.count,
        hint: entry.hint || null,
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
        : topMisconceptions[0]?.hint
          ? String(topMisconceptions[0].hint)
          : question.correct_answer
            ? `Reinforce the key idea(s): ${question.correct_answer}`
            : 'Reinforce the key defining idea(s) and do a quick check-for-understanding.'

    // If model provides a breakdown, trust it for the main buckets and keep our "relevant_incomplete"
    // heuristic additive (it is a teacher-centric split of partial responses).
    if (modelQ?.response_breakdown) {
      qualityBreakdown.fully_correct = modelQ.response_breakdown.strong_correct
      qualityBreakdown.partially_correct = modelQ.response_breakdown.partially_correct
      qualityBreakdown.misconception =
        modelQ.response_breakdown.target_misconception + modelQ.response_breakdown.other_misconception
      qualityBreakdown.unclear = modelQ.response_breakdown.unclear
      // Keep relevant_incomplete as a split of partially_correct (not an extra bucket).
      if (qualityBreakdown.relevant_incomplete > 0) {
        const take = Math.min(qualityBreakdown.relevant_incomplete, qualityBreakdown.partially_correct)
        qualityBreakdown.relevant_incomplete = take
        qualityBreakdown.partially_correct = Math.max(0, qualityBreakdown.partially_correct - take)
      }
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
      questionSummaries[0] ||
      (session.condition === 'baseline'
        ? 'Baseline round analysis generated.'
        : roundNumber === 1
          ? 'Treatment round 1 analysis generated. Use the top misconceptions to plan instruction, then open revision.'
          : 'Treatment final analysis generated. Review improvement and remaining misconceptions.'),
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
      session_id: session.id,
      round_number: roundNumber,
      questions: rawPromptByQuestion,
    },
    raw_response_json: {
      version: 'analysis_raw_per_question_bundle_v1',
      session_id: session.id,
      session_code: session.session_code,
      round_number: roundNumber,
      questions: rawResponseByQuestion,
    },
  }

  return { analysis, labelsByResponseId, rawAi }
}
