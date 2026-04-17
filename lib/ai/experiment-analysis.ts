import type { Response, Session, SessionQuestion } from '@/lib/types/database'
import { openaiChatJson } from '@/lib/ai/openai-json'

export type UnderstandingLevel = 'correct' | 'mostly_correct' | 'partially_correct' | 'incorrect' | 'unclear'

export type ResponseLabel = {
  response_id: string
  understanding_level: UnderstandingLevel
  is_correct: boolean | null
  misconception_label: string | null
  cluster_id: string | null
  explanation: string | null
}

export type MisconceptionCluster = {
  cluster_id: string
  label: string
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
  misconception_label: string | null
  cluster_id: string | null
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
    return {
      response_id: r.response_id,
      understanding_level,
      is_correct: isCorrect,
      misconception_label: isCorrect === false ? (clusters.find(c => c.cluster_id === cluster)?.label || 'Incorrect') : null,
      cluster_id: cluster,
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
    .map((l: any) => ({
      response_id: String(l.response_id),
      understanding_level: parseUnderstandingLevel(l.understanding_level),
      is_correct: isFullyCorrect(parseUnderstandingLevel(l.understanding_level)),
      misconception_label: typeof l.misconception_label === 'string' ? l.misconception_label.slice(0, 120) : null,
      cluster_id: typeof l.cluster_id === 'string' ? l.cluster_id : null,
      explanation: typeof l.explanation === 'string' ? l.explanation.slice(0, 280) : null,
    }))

  const summary = typeof json?.summary === 'string' ? json.summary : ''
  return { ok: true, analysis: { clusters, labels, summary }, rawJson: json, rawText: result.rawText, promptMessages: messages }
}

type SessionAnalysisPromptResponse = {
  response_id: string
  question_id: string
  answer_text: string
  confidence: number | null
  explanation: string | null
  original_response_id: string | null
  question_type: Response['question_type']
}

type SessionAnalysisPromptQuestion = {
  question_id: string
  question_no: number
  prompt: string
  correct_answer: string | null
  response_count: number
  responses: SessionAnalysisPromptResponse[]
}

function buildCombinedSessionPrompt(options: {
  session: Session
  questions: SessionQuestion[]
  responses: Response[]
  roundNumber: 1 | 2
}) {
  const { session, questions, responses, roundNumber } = options
  const questionById = new Map(questions.map((q) => [q.question_id, q]))
  const groupedQuestions: SessionAnalysisPromptQuestion[] = questions
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((question) => {
      const qResponses = responses
        .filter((r) => r.question_id === question.question_id)
        .map<SessionAnalysisPromptResponse>((r) => ({
          response_id: r.response_id,
          question_id: r.question_id || question.question_id,
          answer_text: r.answer,
          confidence: typeof r.confidence === 'number' ? r.confidence : null,
          explanation: r.explanation,
          original_response_id: r.original_response_id,
          question_type: r.question_type,
        }))

      return {
        question_id: question.question_id,
        question_no: question.position,
        prompt: question.prompt,
        correct_answer: question.correct_answer,
        response_count: qResponses.length,
        responses: qResponses,
      }
    })

  const promptJson = {
    version: 'analysis_prompt_v2',
    session: {
      session_id: session.id,
      session_code: session.session_code,
      condition: session.condition,
      status: session.status,
    },
    round_number: roundNumber,
    questions: groupedQuestions.map((q) => ({
      question_id: q.question_id,
      question_no: q.question_no,
      prompt: q.prompt,
      correct_answer: q.correct_answer,
      response_count: q.response_count,
    })),
    responses_by_question: groupedQuestions,
  }

  const system = `You are an educational measurement assistant helping a classroom teacher. Return ONLY valid JSON (no markdown or code fences).
Use this exact shape:
{
  "round_number": 1 | 2,
  "condition": "baseline" | "treatment",
  "totals": {
    "total_submissions": number,
    "percent_fully_correct": number,
    "average_confidence": number,
    "evaluation_breakdown": {
      "correct": number,
      "mostly_correct": number,
      "partially_correct": number,
      "incorrect": number,
      "unclear": number
    }
  },
  "per_question": [
    {
      "question_id": string,
      "question_no": number,
      "prompt": string,
      "response_count": number,
      "percent_fully_correct": number,
      "average_confidence": number,
      "evaluation_breakdown": {
        "correct": number,
        "mostly_correct": number,
        "partially_correct": number,
        "incorrect": number,
        "unclear": number
      },
      "top_misconceptions": [
        { "label": string, "count": number, "description": string, "interpretation": string, "representative_answers": [string], "hint": string }
      ]
    }
  ],
  "response_labels": [
    {
      "response_id": string,
      "question_id": string,
      "understanding_level": "correct" | "mostly_correct" | "partially_correct" | "incorrect" | "unclear",
      "misconception_label": string | null,
      "cluster_id": string | null,
      "explanation": string | null
    }
  ],
  "teaching_summary": {
    "overall_summary": string,
    "top_class_issues": [string],
    "teaching_suggestions": [string]
  }
}
Rules:
- Use the provided questions and grouped responses.
- Evaluate conceptual correctness relative to the intended correct answer. Do NOT rely on exact string matching.
- Classify each response using understanding_level.
- Clusters should group semantically similar misunderstandings from incorrect/partial responses.
- Count misconceptions consistently across the whole session.
- Keep labels short, teacher-friendly, and stable across similar responses.
- Return one object for the entire session/round.`

  const user = JSON.stringify(promptJson)
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]

  return { promptJson, messages, questionMap: questionById }
}

function normalizeSessionResponseLabel(input: any): SessionAnalysisResponseLabel {
  const understanding_level = parseUnderstandingLevel(input?.understanding_level)
  return {
    response_id: String(input?.response_id || ''),
    question_id: String(input?.question_id || ''),
    is_correct: isFullyCorrect(understanding_level),
    understanding_level,
    misconception_label: typeof input?.misconception_label === 'string' ? input.misconception_label.slice(0, 120) : null,
    cluster_id: typeof input?.cluster_id === 'string' ? input.cluster_id.slice(0, 30) : null,
    explanation: typeof input?.explanation === 'string' ? input.explanation.slice(0, 280) : null,
  }
}

function normalizeTopMisconception(input: any): {
  label: string
  count: number
  hint: string
  description: string
  interpretation: string
} {
  return {
    label: typeof input?.label === 'string' ? input.label.slice(0, 120) : 'Misconception',
    count: typeof input?.count === 'number' ? input.count : 0,
    hint: typeof input?.hint === 'string' ? input.hint.slice(0, 220) : '',
    description: typeof input?.description === 'string' ? input.description.slice(0, 260) : '',
    interpretation: typeof input?.interpretation === 'string' ? input.interpretation.slice(0, 260) : '',
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

  const { promptJson, messages } = buildCombinedSessionPrompt({ session, questions, responses, roundNumber })
  const aiResult = await openaiChatJson({
    messages,
    maxTokens: 4000,
    timeoutMs: 30000,
  })

  const aiJson = aiResult.ok ? aiResult.json : null
  const rawText = aiResult.ok ? aiResult.rawText : null

  const aiResponseLabels = new Map<string, SessionAnalysisResponseLabel>()
  for (const item of Array.isArray(aiJson?.response_labels) ? aiJson.response_labels : []) {
    const label = normalizeSessionResponseLabel(item)
    if (label.response_id) aiResponseLabels.set(label.response_id, label)
  }

  const aiQuestionInsights = new Map<string, Array<{ label: string; hint: string; description: string; interpretation: string }>>()
  for (const question of Array.isArray(aiJson?.per_question) ? aiJson.per_question : []) {
    if (!question || typeof question.question_id !== 'string') continue
    const insights = Array.isArray(question.top_misconceptions)
      ? question.top_misconceptions.map((entry: any) => normalizeTopMisconception(entry))
      : []
    aiQuestionInsights.set(
      question.question_id,
      insights.map((entry: ReturnType<typeof normalizeTopMisconception>) => ({
        label: entry.label,
        hint: entry.hint || '',
        description: entry.description || '',
        interpretation: entry.interpretation || '',
      }))
    )
  }

  const teaching_summary = {
    overall_summary:
      typeof aiJson?.teaching_summary?.overall_summary === 'string'
        ? aiJson.teaching_summary.overall_summary
        : session.condition === 'baseline'
          ? 'Baseline round analysis generated.'
          : roundNumber === 1
            ? 'Treatment round 1 analysis generated. Use the top misconceptions to plan instruction, then open revision.'
            : 'Treatment final analysis generated. Review improvement and remaining misconceptions.',
    top_class_issues: Array.isArray(aiJson?.teaching_summary?.top_class_issues)
      ? aiJson.teaching_summary.top_class_issues.filter((value: unknown) => typeof value === 'string').slice(0, 5)
      : [],
    teaching_suggestions: Array.isArray(aiJson?.teaching_summary?.teaching_suggestions)
      ? aiJson.teaching_summary.teaching_suggestions.filter((value: unknown) => typeof value === 'string').slice(0, 5)
      : [],
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
    const conf = qResponses
      .map((response) => response.confidence)
      .filter((value): value is Response['confidence'] => typeof value === 'number')
    allConf.push(...conf)

    const fullLabels: ResponseLabel[] = qResponses.map((response) => {
      const aiLabel = aiResponseLabels.get(response.response_id)
      const fallbackLabel = fallbackLabelMap.get(response.response_id)
      const understanding_level =
        aiLabel?.understanding_level || fallbackLabel?.understanding_level || 'unclear'
      const out: ResponseLabel = {
        response_id: response.response_id,
        understanding_level,
        is_correct: isFullyCorrect(understanding_level),
        misconception_label: aiLabel?.misconception_label ?? fallbackLabel?.misconception_label ?? null,
        cluster_id: aiLabel?.cluster_id ?? fallbackLabel?.cluster_id ?? null,
        explanation: aiLabel?.explanation ?? fallbackLabel?.explanation ?? null,
      }

      // If model didn't label and we have a reference answer, fall back to exact-match for MVP.
      if (!aiLabel && correctKey) {
        out.understanding_level = normalize(response.answer) === correctKey ? 'correct' : 'incorrect'
        out.is_correct = isFullyCorrect(out.understanding_level)
      }

      if (out.understanding_level === 'correct') {
        out.cluster_id = null
        out.misconception_label = null
      } else if ((out.understanding_level === 'incorrect' || out.understanding_level === 'partially_correct') && !out.misconception_label) {
        out.misconception_label = fallbackLabel?.misconception_label || 'Incorrect response'
      }

      labelsByResponseId.set(out.response_id, out)
      allResponseLabels.push({
        response_id: out.response_id,
        question_id: question.question_id,
        is_correct: out.is_correct,
        understanding_level: out.understanding_level,
        misconception_label: out.misconception_label,
        cluster_id: out.cluster_id,
        explanation: out.explanation,
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

    for (const response of qResponses) {
      const label = labelsByResponseId.get(response.response_id)
      const key = String(response.confidence) as keyof QuestionAnalysis['confidence_breakdown']
      if (!questionConfidenceBreakdown[key]) continue
      questionConfidenceBreakdown[key].total += 1
      totalsConfidenceBreakdown[key].total += 1
      const lvl = label?.understanding_level || 'unclear'
      if (lvl in evalBreakdown) (evalBreakdown as any)[lvl] += 1
      if (lvl in totalsEval) (totalsEval as any)[lvl] += 1
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

    const answerById = new Map(qResponses.map((r) => [r.response_id, r.answer]))
    const misconceptionCounts = new Map<string, { label: string; count: number; hint: string; description: string; interpretation: string; reps: string[] }>()
    for (const label of fullLabels) {
      if (label.understanding_level === 'correct' || label.understanding_level === 'mostly_correct') continue
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
    const topMisconceptions: MisconceptionCluster[] = sortedMisconceptions
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

    if (topMisconceptions.length === 0) {
      topMisconceptions.push(...fallback.clusters.slice(0, topMisconceptionLimit))
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
  const totals = {
    total_submissions: responses.length,
    average_confidence: avgConfidence,
    avg_confidence: avgConfidence,
    percent_correct: responses.length > 0 ? Math.round((totalsEval.correct / responses.length) * 100) : null,
    percent_fully_correct: responses.length > 0 ? Math.round((totalsEval.correct / responses.length) * 100) : null,
    evaluation_breakdown: totalsEval,
    confidence_breakdown: totalsConfidenceBreakdown,
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
    prompt_json: promptJson,
    raw_response_json: {
      version: 'analysis_raw_v2',
      session_id: session.id,
      session_code: session.session_code,
      round_number: roundNumber,
      parsed: aiJson,
      heuristic_fallback: !aiResult.ok,
      raw_text: rawText || null,
    },
  }

  return { analysis, labelsByResponseId, rawAi }
}
