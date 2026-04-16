import type { Response, Session, SessionQuestion } from '@/lib/types/database'
import { openaiChatJson } from '@/lib/ai/openai-json'

export type ResponseLabel = {
  response_id: string
  is_correct: boolean | null
  misconception_label: string | null
  cluster_id: string | null
  explanation: string | null
}

export type MisconceptionCluster = {
  cluster_id: string
  label: string
  description?: string | null
  count: number
  hint?: string | null
  example_response_ids?: string[]
}

export type QuestionAnalysis = {
  question_id: string
  position: number
  prompt: string
  correct_answer: string | null
  submission_count: number
  avg_confidence: number | null
  percent_correct: number | null
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
    avg_confidence: number | null
    percent_correct: number | null
    confidence_breakdown: Record<
      '1' | '2' | '3' | '4' | '5',
      { correct: number; incorrect: number; unknown: number; total: number }
    >
  }
  per_question: QuestionAnalysis[]
  summary_text: string
  transitions?: {
    total_pairs: number
    incorrect_to_correct: { count: number; percent: number | null }
    correct_to_incorrect: { count: number; percent: number | null }
    stayed_correct: { count: number; percent: number | null }
    stayed_incorrect: { count: number; percent: number | null }
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
    return {
      response_id: r.response_id,
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
  responses: Array<Pick<Response, 'response_id' | 'answer' | 'confidence'>>
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
  const reference = question.correct_answer ? `Reference answer:\n${question.correct_answer}\n` : 'No reference answer provided.\n'

  const responseList = responses.map((r) => ({
    response_id: r.response_id,
    answer_text: r.answer,
    confidence: r.confidence,
  }))

  const system = `You are an educational measurement assistant. Return ONLY valid JSON (no markdown). The JSON must follow this schema:
{
  "summary": string,
  "clusters": [{"cluster_id": "C1", "label": string, "description": string, "hint": string, "response_ids": [string]}],
  "response_labels": [{"response_id": string, "is_correct": true|false|null, "cluster_id": string|null, "misconception_label": string|null, "explanation": string|null}]
}
Rules:
- "cluster_id" must be like C1, C2, ...
- If a response is correct, set cluster_id=null and misconception_label=null.
- If you cannot judge correctness without a reference answer, set is_correct=null.
- Keep labels short and teacher-friendly.`

  const user = `Question prompt:\n${question.prompt}\n\n${reference}\nStudent responses:\n${JSON.stringify(responseList)}`

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
      is_correct: typeof l.is_correct === 'boolean' ? l.is_correct : null,
      misconception_label: typeof l.misconception_label === 'string' ? l.misconception_label.slice(0, 120) : null,
      cluster_id: typeof l.cluster_id === 'string' ? l.cluster_id : null,
      explanation: typeof l.explanation === 'string' ? l.explanation.slice(0, 280) : null,
    }))

  const summary = typeof json?.summary === 'string' ? json.summary : ''
  return { ok: true, analysis: { clusters, labels, summary }, rawJson: json, rawText: result.rawText, promptMessages: messages }
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

  const perQuestion: QuestionAnalysis[] = []
  const labelsByResponseId = new Map<string, ResponseLabel>()
  let allConf: number[] = []
  const totalsConfidenceBreakdown: SessionRoundAnalysis['totals']['confidence_breakdown'] = {
    '1': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
    '2': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
    '3': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
    '4': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
    '5': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
  }
  let totalsCorrectCount = 0
  let totalsLabeledCount = 0
  const promptQuestions: any[] = []
  const aiResults: any[] = []

  for (const q of questions) {
    const qResponses = responses.filter((r) => r.question_id === q.question_id)
    const conf = qResponses.map(r => r.confidence).filter((c): c is number => typeof c === 'number')
    allConf = allConf.concat(conf)
    const correctKey = q.correct_answer ? normalize(q.correct_answer) : ''

    // Limit payload to keep OpenAI call stable.
    const payloadResponses = qResponses.slice(0, 60).map((r) => ({
      response_id: r.response_id,
      answer: r.answer,
      confidence: r.confidence,
    }))

    const ai = await analyzeQuestionWithAI({ session, question: q, responses: payloadResponses })
    let clusters: MisconceptionCluster[] = []
    let labels: ResponseLabel[] = []
    let summaryText = ''
    let percentCorrect: number | null = null

    if (ai.ok) {
      clusters = ai.analysis.clusters
      labels = ai.analysis.labels
      summaryText = ai.analysis.summary
    } else {
      const fb = makeFallbackClusters(q, qResponses)
      clusters = fb.clusters
      labels = fb.labels
      summaryText = 'AI unavailable; using heuristic grouping.'
    }

    promptQuestions.push({
      question_id: q.question_id,
      position: q.position,
      prompt: q.prompt,
      correct_answer: q.correct_answer,
      response_payload: payloadResponses,
    })
    aiResults.push(
      ai.ok
        ? {
            question_id: q.question_id,
            ok: true,
            raw_text: ai.rawText,
            parsed_json: ai.rawJson,
          }
        : {
            question_id: q.question_id,
            ok: false,
            error: ai.error,
          }
    )

    // Map labels into full response set (if AI only labeled subset, keep others unknown).
    const labelMap = new Map(labels.map((l) => [l.response_id, l]))
    const fullLabels: ResponseLabel[] = qResponses.map((r) => {
      const found = labelMap.get(r.response_id)
      const out: ResponseLabel = found || {
        response_id: r.response_id,
        is_correct: null,
        misconception_label: null,
        cluster_id: null,
        explanation: null,
      }
      // If model didn't label (or couldn't judge), derive correctness if we have a reference answer.
      if (out.is_correct === null && correctKey) {
        out.is_correct = normalize(r.answer) === correctKey
      }
      labelsByResponseId.set(out.response_id, out)
      return out
    })

    // Compute top misconceptions
    const sortedClusters = [...clusters].sort((a, b) => b.count - a.count)
    const topMisconceptions = sortedClusters.slice(0, session.condition === 'treatment' ? 2 : 5)

    const questionConfidenceBreakdown: QuestionAnalysis['confidence_breakdown'] = {
      '1': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
      '2': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
      '3': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
      '4': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
      '5': { correct: 0, incorrect: 0, unknown: 0, total: 0 },
    }

    for (const r of qResponses) {
      const lab = labelsByResponseId.get(r.response_id)
      const c = String(r.confidence) as keyof QuestionAnalysis['confidence_breakdown']
      if (!questionConfidenceBreakdown[c]) continue
      questionConfidenceBreakdown[c].total += 1
      totalsConfidenceBreakdown[c].total += 1
      if (lab?.is_correct === true) {
        questionConfidenceBreakdown[c].correct += 1
        totalsConfidenceBreakdown[c].correct += 1
        totalsCorrectCount += 1
        totalsLabeledCount += 1
      } else if (lab?.is_correct === false) {
        questionConfidenceBreakdown[c].incorrect += 1
        totalsConfidenceBreakdown[c].incorrect += 1
        totalsLabeledCount += 1
      } else {
        questionConfidenceBreakdown[c].unknown += 1
        totalsConfidenceBreakdown[c].unknown += 1
      }
    }

    const derivedCorrectCount = fullLabels.filter((l) => l.is_correct === true).length
    const derivedLabeledCount = fullLabels.filter((l) => typeof l.is_correct === 'boolean').length
    percentCorrect = derivedLabeledCount > 0 ? Math.round((derivedCorrectCount / derivedLabeledCount) * 100) : null

    // Graph-ready nodes: clusters + correct
    const correctNode = {
      id: 'correct',
      label: 'Correct',
      count: derivedCorrectCount,
      kind: 'correct' as const,
    }
    const clusterNodes = sortedClusters.map((c) => ({ id: c.cluster_id, label: c.label, count: c.count, kind: 'cluster' as const }))
    const unknownNode = {
      id: 'unknown',
      label: 'Unlabeled',
      count: fullLabels.filter(l => l.is_correct === null).length,
      kind: 'unknown' as const,
    }

    const analysis: QuestionAnalysis = {
      question_id: q.question_id,
      position: q.position,
      prompt: q.prompt,
      correct_answer: q.correct_answer,
      submission_count: qResponses.length,
      avg_confidence: mean(conf),
      percent_correct: percentCorrect,
      confidence_breakdown: questionConfidenceBreakdown,
      clusters: sortedClusters,
      top_misconceptions: topMisconceptions,
      response_labels: fullLabels,
      graph: {
        nodes: [correctNode, ...clusterNodes, unknownNode].filter(n => n.count > 0),
        links: [], // reserved for future richer viz
      },
    }
    perQuestion.push(analysis)
  }

  const totals = {
    total_submissions: responses.length,
    avg_confidence: mean(allConf),
    percent_correct: totalsLabeledCount > 0 ? Math.round((totalsCorrectCount / totalsLabeledCount) * 100) : null,
    confidence_breakdown: totalsConfidenceBreakdown,
  }

  const summary_text =
    session.condition === 'baseline'
      ? 'Baseline round analysis generated.'
      : roundNumber === 1
        ? 'Treatment round 1 analysis generated. Use the top misconceptions to plan instruction, then open revision.'
        : 'Treatment final analysis generated. Review improvement and remaining misconceptions.'

  const out: SessionRoundAnalysis = {
    version: 'analysis_v1',
    session_id: session.id,
    session_code: session.session_code,
    condition: session.condition,
    round_number: roundNumber,
    created_at: new Date().toISOString(),
    totals,
    per_question: perQuestion.sort((a, b) => a.position - b.position),
    summary_text,
  }

  const rawAi = {
    prompt_json: {
      version: 'analysis_prompt_v1',
      session_id: session.id,
      session_code: session.session_code,
      condition: session.condition,
      round_number: roundNumber,
      questions: promptQuestions,
    },
    raw_response_json: {
      version: 'analysis_raw_v1',
      session_id: session.id,
      round_number: roundNumber,
      per_question: aiResults,
    },
  }

  return { analysis: out, labelsByResponseId, rawAi }
}
