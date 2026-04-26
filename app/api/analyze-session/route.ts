import { buildRoundAnalysis, getAnalysisPromptVersion } from '@/lib/ai/experiment-analysis'
import {
  getSession,
  getSessionQuestions,
  getSessionResponses,
  createAnalysisRun,
  updateAnalysisRun,
  upsertResponseAiLabels,
  logTeacherAction,
  getLatestCompletedAnalysisRun,
  getLatestInProgressAnalysisRun,
} from '@/lib/supabase/queries'
import { getTeacherSession } from '@/lib/teacher-auth'
import { NextRequest, NextResponse } from 'next/server'

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

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'like',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'with',
  'using',
  'used',
  'use',
  'are',
  'was',
  'were',
  'after',
  'before',
  'once',
  'only',
])

function normalizeToken(token: string) {
  let out = String(token || '').trim().toLowerCase()
  if (!out) return ''
  if (out.length > 4 && out.endsWith('ies')) return `${out.slice(0, -3)}y`
  if (out.length > 4 && out.endsWith('ses')) return out.slice(0, -2)
  if (out.length > 4 && out.endsWith('s') && !out.endsWith('ss') && !out.endsWith('us') && !out.endsWith('is')) {
    out = out.slice(0, -1)
  }
  return out
}

function comparisonTokenSet(label: string) {
  const tokens = canonicalizeLabel(label)
    .split(' ')
    .map(normalizeToken)
    .filter((token) => token && !STOPWORDS.has(token))
  return new Set(tokens)
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

function parseUnderstandingLevel(input: unknown) {
  const s = String(input || '').toLowerCase().replace(/[\s_-]+/g, '_').trim()
  if (s === 'correct') return 'correct'
  if (s === 'mostly_correct' || s === 'mostlycorrect') return 'mostly_correct'
  if (s === 'partially_correct' || s === 'partiallycorrect') return 'partially_correct'
  if (s === 'incorrect') return 'incorrect'
  return 'unclear'
}

function levelScore(level: ReturnType<typeof parseUnderstandingLevel>) {
  if (level === 'correct') return 4
  if (level === 'mostly_correct') return 3
  if (level === 'partially_correct') return 2
  if (level === 'incorrect') return 1
  return 0
}

function isLikelyFixedAnswerQuestion(question: { correct_answer?: string | null } | null | undefined) {
  const ca = String(question?.correct_answer || '').trim()
  if (!ca) return false
  const len = ca.length
  const words = ca.split(/\s+/).filter(Boolean).length
  if (/^o\([^)]+\)$/i.test(ca)) return true
  if (len <= 24 && words <= 4) return true
  if (words === 1 && len <= 32) return true
  return false
}

function responsePairKey(response: { session_participant_id?: string | null; question_id?: string | null }) {
  return `${response.session_participant_id || ''}::${response.question_id || ''}`
}

function getLabelForResponse(responseId: string, labelMap: Map<string, any>, fallbackResponse: any) {
  const lab = labelMap.get(responseId)
  if (typeof lab?.misconception_label === 'string' && lab.misconception_label.trim()) return lab.misconception_label.trim()
  if (typeof lab?.evaluation_category === 'string' && lab.evaluation_category.trim()) return lab.evaluation_category.trim()
  if (typeof lab?.understanding_level === 'string' && lab.understanding_level.trim()) return lab.understanding_level.trim()
  if (fallbackResponse?.is_correct === true) return 'correct'
  if (fallbackResponse?.is_correct === false) return 'incorrect'
  return null
}

function getQuestionMisconceptionCounts(question: any) {
  const counts = new Map<string, { label: string; count: number; tokens: Set<string> }>()

  const addLabel = (label: string, count: number) => {
    const canon = canonicalizeLabel(label)
    if (!canon || count <= 0) return
    const existing = counts.get(canon)
    if (existing) {
      existing.count += count
      if (label.length > existing.label.length) existing.label = label
    } else {
      counts.set(canon, { label, count, tokens: comparisonTokenSet(label) })
    }
  }

  if (Array.isArray(question?.response_labels)) {
    for (const label of question.response_labels) {
      if (label?.evaluation_category !== 'misconception') continue
      if (typeof label?.misconception_label !== 'string' || !label.misconception_label.trim()) continue
      addLabel(label.misconception_label.trim(), 1)
    }
  }

  if (counts.size === 0) {
    for (const cluster of Array.isArray(question?.clusters || question?.top_misconceptions) ? (question.clusters || question.top_misconceptions) : []) {
      const label = typeof cluster?.label === 'string' ? cluster.label : ''
      const count = typeof cluster?.count === 'number' ? cluster.count : 0
      if (label && count > 0) addLabel(label, count)
    }
  }

  return counts
}

function getStoredAnalysisPromptVersion(promptJson: Record<string, any> | null | undefined) {
  if (!promptJson || typeof promptJson !== 'object') return null
  if (typeof promptJson.prompt_version === 'string' && promptJson.prompt_version.trim()) {
    return promptJson.prompt_version.trim()
  }
  const questions = promptJson?.questions
  if (!questions || typeof questions !== 'object') return null
  const first = Object.values(questions)[0] as any
  return typeof first?.prompt_version === 'string' ? first.prompt_version : null
}

export async function POST(request: NextRequest) {
  try {
    const teacherSession = await getTeacherSession()
    if (!teacherSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { sessionId, roundNumber, forceRegenerate } = await request.json()

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const session = await getSession(sessionId)
    const [questions, allResponses] = await Promise.all([
      getSessionQuestions(sessionId),
      getSessionResponses(sessionId),
    ])

    const rn = Number(roundNumber) === 2 ? 2 : 1
    const responsesData = (allResponses || []).filter(r => (r.round_number ?? 1) === rn)
    const round2Responses = (allResponses || []).filter(r => (r.round_number ?? 1) === 2)
    const currentPromptVersion = getAnalysisPromptVersion({
      condition: session.condition,
      roundNumber: rn as 1 | 2,
    })

    if (session.condition === 'treatment' && rn === 2) {
      if (session.status === 'revision') {
        return NextResponse.json(
          { error: 'Finish revision before generating final analysis.' },
          { status: 409 }
        )
      }
      if (round2Responses.length === 0) {
        return NextResponse.json(
          { error: 'No revision responses available yet for final analysis.' },
          { status: 400 }
        )
      }
      const round1Completed = await getLatestCompletedAnalysisRun(sessionId, 1)
      if (!round1Completed?.summary_json) {
        return NextResponse.json(
          { error: 'Generate round 1 treatment analysis before running final analysis.' },
          { status: 409 }
        )
      }
    }

    if (session.condition === 'treatment' && rn === 1 && (session.status === 'draft' || session.status === 'live')) {
      return NextResponse.json(
        { error: 'Round 1 treatment analysis is only available after round 1 has been closed.' },
        { status: 409 }
      )
    }

    if (!responsesData || responsesData.length === 0) {
      return NextResponse.json(
        { error: 'No responses to analyze' },
        { status: 400 }
      )
    }

    // Guard: if there's an analysis in progress, never start another run.
    const inProgress = await getLatestInProgressAnalysisRun(sessionId, rn as 1 | 2)
    if (inProgress) {
      return NextResponse.json(
        {
          status: inProgress.status,
          analysis_run_id: inProgress.analysis_run_id,
          created_at: inProgress.created_at,
        },
        { status: 202 }
      )
    }

    // Guard: reuse existing completed analysis unless explicitly forced.
    if (!forceRegenerate) {
      const completed = await getLatestCompletedAnalysisRun(sessionId, rn as 1 | 2)
      const storedPromptVersion = getStoredAnalysisPromptVersion(
        completed?.prompt_json as Record<string, any> | null | undefined
      )
      const canReuse = Boolean(
        completed?.summary_json && storedPromptVersion && storedPromptVersion === currentPromptVersion
      )
      console.info(
        `[analysis] session_id=${sessionId} round=${rn} condition=${session.condition} prompt_version=${currentPromptVersion} reuse=${canReuse} stored_prompt_version=${storedPromptVersion || 'none'}`
      )
      if (canReuse) {
        return NextResponse.json(completed.summary_json)
      }
      if (completed?.summary_json && storedPromptVersion && storedPromptVersion !== currentPromptVersion) {
        console.info(
          `[analysis] session_id=${sessionId} round=${rn} condition=${session.condition} prompt_version=${currentPromptVersion} stale_completed_run=true stored_prompt_version=${storedPromptVersion}`
        )
      }
    }

    // Create a run upfront so we can block duplicates while OpenAI is running.
    const run = await createAnalysisRun({
      sessionId,
      condition: session.condition,
      sessionStatus: session.status,
      roundNumber: rn as 1 | 2,
      model: 'gpt-4.1-mini',
      status: 'running',
    })

    let analysis: any
    let labelsByResponseId: any
    let rawAi: any

    try {
      const built = await buildRoundAnalysis({
        session,
        questions,
        responses: responsesData,
        roundNumber: rn as 1 | 2,
      })
      analysis = built.analysis as any
      labelsByResponseId = built.labelsByResponseId
      rawAi = built.rawAi
    } catch (e: any) {
      await updateAnalysisRun({
        analysisRunId: run.analysis_run_id,
        status: 'failed',
        errorMessage: e instanceof Error ? e.message : 'Analysis failed',
      })
      throw e
    }

    // Persist run + labels for research/export.
    try {
      // For treatment final analysis, attach comparison vs latest round-1 analysis if available.
      if (session.condition === 'treatment' && rn === 2) {
        try {
          const round1Run = await getLatestCompletedAnalysisRun(sessionId, 1)
          if (round1Run?.summary_json) {
            ;(analysis as any).compare_to_round_1 = round1Run.summary_json
          }
        } catch {}
      }

      // NOTE: transition + misconception comparison are computed later in this file and stay on analysis JSON.

      const labelRows = responsesData
        .filter((r) => r.question_id)
        .map((r) => {
          const lab = labelsByResponseId.get(r.response_id)
          return {
            analysisRunId: run.analysis_run_id,
            sessionId,
            questionId: r.question_id as string,
            roundNumber: rn as 1 | 2,
            responseId: r.response_id,
            understandingLevel: lab?.understanding_level ?? null,
            evaluationCategory: lab?.evaluation_category ?? null,
            isCorrect: lab?.is_correct ?? null,
            misconceptionLabel: lab?.misconception_label ?? null,
            clusterId: lab?.cluster_id ?? null,
            reasoningSummary: lab?.reasoning_summary ?? null,
            explanation: lab?.explanation ?? null,
          }
        })

      await upsertResponseAiLabels(labelRows)
    } catch (e) {
      // Keep endpoint robust even if label persistence fails.
    }

    if (session.condition === 'treatment' && rn === 2) {
      // Compute round-1 → round-2 transitions using original_response_id (fallback to exact-match correctness).
      try {
        const questionById = new Map((questions || []).map((q) => [q.question_id, q]))
        const round1Responses = (allResponses || []).filter((r) => (r.round_number ?? 1) === 1)
        const round1ById = new Map(round1Responses.map((r) => [r.response_id, r]))
        const round1ByPair = new Map(round1Responses.map((r) => [responsePairKey(r), r]))

        // If we have a stored round-1 analysis, use its labels when available.
        const round1Correctness = new Map<string, boolean | null>()
        const round1Levels = new Map<string, ReturnType<typeof parseUnderstandingLevel>>()
        const compare = (analysis as any).compare_to_round_1
        const round1LabelArrays: any[] = []
        if (Array.isArray(compare?.response_labels)) round1LabelArrays.push(compare.response_labels)
        if (compare?.per_question && Array.isArray(compare.per_question)) {
          for (const q of compare.per_question) {
            if (Array.isArray(q?.response_labels)) round1LabelArrays.push(q.response_labels)
          }
        }
        for (const arr of round1LabelArrays) {
          for (const l of arr) {
            if (typeof l?.response_id !== 'string') continue
            if (typeof l?.is_correct === 'boolean') {
              round1Correctness.set(l.response_id, l.is_correct)
            }
            if (l?.understanding_level) {
              round1Levels.set(l.response_id, parseUnderstandingLevel(l.understanding_level))
            }
          }
        }

        const deriveCorrect = (responseId: string, fallbackResponse: any): boolean | null => {
          const fromAi = round1Correctness.get(responseId)
          if (typeof fromAi === 'boolean') return fromAi
          const q = fallbackResponse?.question_id ? questionById.get(fallbackResponse.question_id) : null
          const correctKey = q?.correct_answer ? normalize(q.correct_answer) : ''
          if (!correctKey || !isLikelyFixedAnswerQuestion(q)) return null
          return normalize(fallbackResponse?.answer || '') === correctKey
        }

        const round2Correctness = new Map<string, boolean | null>()
        const round2Levels = new Map<string, ReturnType<typeof parseUnderstandingLevel>>()
        for (const r2 of responsesData) {
          const lab = labelsByResponseId.get(r2.response_id)
          if (typeof lab?.is_correct === 'boolean') round2Correctness.set(r2.response_id, lab.is_correct)
          if (lab?.understanding_level) {
            round2Levels.set(r2.response_id, parseUnderstandingLevel(lab.understanding_level))
          }
          if (!round2Correctness.has(r2.response_id)) {
            const q = r2.question_id ? questionById.get(r2.question_id) : null
            const correctKey = q?.correct_answer ? normalize(q.correct_answer) : ''
            if (!correctKey || !isLikelyFixedAnswerQuestion(q)) {
              round2Correctness.set(r2.response_id, null)
            } else {
              round2Correctness.set(r2.response_id, normalize(r2.answer || '') === correctKey)
            }
          }
        }

        let totalPairs = 0
        let incorrectToCorrect = 0
        let correctToIncorrect = 0
        let stayedCorrect = 0
        let stayedIncorrect = 0

        for (const r2 of responsesData) {
          const originalId = r2.original_response_id || null
          const r1 =
            (originalId && round1ById.get(originalId)) ||
            round1ByPair.get(responsePairKey(r2)) ||
            null

          if (!r1) continue

          const c1 = deriveCorrect(r1.response_id, r1)
          const c2 = round2Correctness.get(r2.response_id) ?? null
          if (typeof c1 !== 'boolean' || typeof c2 !== 'boolean') continue
          totalPairs += 1
          if (c1 === false && c2 === true) incorrectToCorrect += 1
          else if (c1 === true && c2 === false) correctToIncorrect += 1
          else if (c1 === true && c2 === true) stayedCorrect += 1
          else if (c1 === false && c2 === false) stayedIncorrect += 1
        }

        const percent = (n: number) => (totalPairs > 0 ? Math.round((n / totalPairs) * 100) : null)
        const noChange = stayedCorrect + stayedIncorrect

        ;(analysis as any).transitions = {
          incorrect_to_correct: incorrectToCorrect,
          correct_to_incorrect: correctToIncorrect,
          no_change: noChange,
        }
        ;(analysis as any).transition_metrics = {
          total_pairs: totalPairs,
          incorrect_to_correct: { count: incorrectToCorrect, percent: percent(incorrectToCorrect) },
          correct_to_incorrect: { count: correctToIncorrect, percent: percent(correctToIncorrect) },
          stayed_correct: { count: stayedCorrect, percent: percent(stayedCorrect) },
          stayed_incorrect: { count: stayedIncorrect, percent: percent(stayedIncorrect) },
        }

        // Quality-based transitions (preferred for open-ended responses).
        let qualityPairs = 0
        let improved = 0
        let worsened = 0
        let unchanged = 0
        let movedToFullyCorrect = 0
        let sumScoreDelta = 0

        for (const r2 of responsesData) {
          const originalId = r2.original_response_id || null
          const r1 =
            (originalId && round1ById.get(originalId)) ||
            round1ByPair.get(responsePairKey(r2)) ||
            null
          if (!r1) continue

          const l1 = round1Levels.get(r1.response_id)
          const l2 = round2Levels.get(r2.response_id)
          if (!l1 || !l2) continue
          qualityPairs += 1
          const d = levelScore(l2) - levelScore(l1)
          sumScoreDelta += d
          if (d > 0) improved += 1
          else if (d < 0) worsened += 1
          else unchanged += 1
          if (l1 !== 'correct' && l2 === 'correct') movedToFullyCorrect += 1
        }

        ;(analysis as any).quality_transitions = {
          total_pairs: qualityPairs,
          improved,
          worsened,
          unchanged,
          moved_to_fully_correct: movedToFullyCorrect,
          avg_score_delta: qualityPairs > 0 ? Number((sumScoreDelta / qualityPairs).toFixed(2)) : null,
        }

        const round1LabelMap = new Map<string, any>()
        for (const arr of round1LabelArrays) {
          for (const l of arr) {
            if (typeof l?.response_id === 'string') {
              round1LabelMap.set(l.response_id, l)
            }
          }
        }

        const questionTransitionMap = new Map<
          string,
          {
            question_id: string
            position: number
            total_pairs: number
            incorrect_to_correct: number
            correct_to_incorrect: number
            stayed_correct: number
            stayed_incorrect: number
            examples: {
              incorrect_to_correct: any[]
              correct_to_incorrect: any[]
              stayed_correct: any[]
              stayed_incorrect: any[]
            }
          }
        >()

        const pushExample = (bucket: any[], example: any) => {
          if (bucket.length < 2) bucket.push(example)
        }

        for (const r2 of responsesData) {
          const originalId = r2.original_response_id || null
          const r1 =
            (originalId && round1ById.get(originalId)) ||
            round1ByPair.get(responsePairKey(r2)) ||
            null

          if (!r1 || !r2.question_id) continue

          const c1 = deriveCorrect(r1.response_id, r1)
          const c2 = round2Correctness.get(r2.response_id) ?? null
          if (typeof c1 !== 'boolean' || typeof c2 !== 'boolean') continue

          const q = questionById.get(r2.question_id)
          const entry =
            questionTransitionMap.get(r2.question_id) ||
            {
              question_id: r2.question_id,
              position: q?.position ?? 0,
              total_pairs: 0,
              incorrect_to_correct: 0,
              correct_to_incorrect: 0,
              stayed_correct: 0,
              stayed_incorrect: 0,
              examples: {
                incorrect_to_correct: [],
                correct_to_incorrect: [],
                stayed_correct: [],
                stayed_incorrect: [],
              },
            }

          entry.total_pairs += 1

          const example = {
            round1_response_id: r1.response_id,
            round2_response_id: r2.response_id,
            round1_answer: r1.answer,
            round2_answer: r2.answer,
            round1_label: getLabelForResponse(r1.response_id, round1LabelMap, r1),
            round2_label: getLabelForResponse(r2.response_id, labelsByResponseId, r2),
          }

          if (c1 === false && c2 === true) {
            entry.incorrect_to_correct += 1
            pushExample(entry.examples.incorrect_to_correct, example)
          } else if (c1 === true && c2 === false) {
            entry.correct_to_incorrect += 1
            pushExample(entry.examples.correct_to_incorrect, example)
          } else if (c1 === true && c2 === true) {
            entry.stayed_correct += 1
            pushExample(entry.examples.stayed_correct, example)
          } else if (c1 === false && c2 === false) {
            entry.stayed_incorrect += 1
            pushExample(entry.examples.stayed_incorrect, example)
          }

          questionTransitionMap.set(r2.question_id, entry)
        }

        ;(analysis as any).per_question_transition_breakdown = Array.from(questionTransitionMap.values())
          .map((entry) => {
            const percentFor = (n: number) => (entry.total_pairs > 0 ? Math.round((n / entry.total_pairs) * 100) : null)
            const noChange = entry.stayed_correct + entry.stayed_incorrect
            return {
              question_id: entry.question_id,
              position: entry.position,
              total_pairs: entry.total_pairs,
              incorrect_to_correct: { count: entry.incorrect_to_correct, percent: percentFor(entry.incorrect_to_correct) },
              correct_to_incorrect: { count: entry.correct_to_incorrect, percent: percentFor(entry.correct_to_incorrect) },
              stayed_correct: { count: entry.stayed_correct, percent: percentFor(entry.stayed_correct) },
              stayed_incorrect: { count: entry.stayed_incorrect, percent: percentFor(entry.stayed_incorrect) },
              no_change: { count: noChange, percent: percentFor(noChange) },
              examples: entry.examples,
            }
          })
          .sort((a, b) => a.position - b.position)
      } catch {}

      // Simple misconception delta summary (label-based) for quick teacher readout.
      try {
        const compare = (analysis as any).compare_to_round_1
        if (compare?.per_question && Array.isArray(compare.per_question)) {
          const round1ByQ = new Map<string, any>(
            compare.per_question
              .filter((q: any) => q && typeof q.question_id === 'string')
              .map((q: any) => [q.question_id, q])
          )
          const classify = (round1: number, round2: number) => {
            if (round1 > 0 && round2 === 0) return 'resolved'
            if (round1 === 0 && round2 > 0) return 'emerging'
            if (round1 > 0 && round2 > 0 && round2 < round1) return 'reduced'
            if (round1 > 0 && round2 > 0 && round2 >= round1) return 'persistent'
            return 'other'
          }

          const makePriority = (classification: string, round1: number, round2: number, delta: number) => {
            const classWeight =
              classification === 'persistent' ? 4 :
              classification === 'emerging' ? 3 :
              classification === 'reduced' ? 2 :
              classification === 'resolved' ? 1 : 0
            // Prioritize what is still present (round2), then large changes.
            return classWeight * 10000 + round2 * 100 + Math.abs(delta) * 10 + round1
          }

          const alignRound2KeyToRound1 = (
            round1: Map<string, { label: string; count: number; tokens: Set<string> }>,
            round2Key: string,
            round2Tokens: Set<string>
          ) => {
            if (round1.has(round2Key)) return round2Key
            let bestKey: string | null = null
            let bestScore = 0
            for (const [k, v] of round1.entries()) {
              const overlap = jaccard(round2Tokens, v.tokens)
              const shared = [...round2Tokens].filter((t) => v.tokens.has(t)).length
              const containment =
                round2Tokens.size > 0 && v.tokens.size > 0
                  ? Math.min(shared / Math.min(round2Tokens.size, v.tokens.size), 1)
                  : 0
              const substringBonus = k.includes(round2Key) || round2Key.includes(k) ? 0.08 : 0
              const score = Math.max(overlap, containment) + substringBonus
              if (score > bestScore) {
                bestScore = score
                bestKey = k
              }
            }
            // Conservative threshold to avoid bad merges.
            if (bestKey && bestScore >= 0.8) return bestKey
            return round2Key
          }

          ;(analysis as any).misconception_comparison = (analysis as any).per_question
            .map((q2: any) => {
              const q1 = round1ByQ.get(q2.question_id)
              const round1 = getQuestionMisconceptionCounts(q1)
              const round2Raw = getQuestionMisconceptionCounts(q2)

              // Align round2 keys into round1 "namespace" when labels are very similar.
              const round2Aligned = new Map<string, { label: string; count: number }>()
              for (const [canon, info] of round2Raw.entries()) {
                const alignedKey = alignRound2KeyToRound1(round1, canon, info.tokens)
                const existing = round2Aligned.get(alignedKey)
                if (existing) {
                  existing.count += info.count
                  if (info.label.length > existing.label.length) existing.label = info.label
                } else {
                  round2Aligned.set(alignedKey, { label: info.label, count: info.count })
                }
              }

              const canonKeys = new Set<string>([...round1.keys(), ...round2Aligned.keys()])
              const items = [...canonKeys]
                .map((canon) => {
                  const r1 = round1.get(canon)?.count || 0
                  const r2 = round2Aligned.get(canon)?.count || 0
                  const delta = r2 - r1
                  const classification = classify(r1, r2)
                  return {
                    label: (round2Aligned.get(canon)?.label || round1.get(canon)?.label || canon) as string,
                    canonical_label: canon,
                    round1: r1,
                    round2: r2,
                    delta,
                    classification,
                    priority: makePriority(classification, r1, r2, delta),
                  }
                })
                .filter((x) => x.round1 > 0 || x.round2 > 0)

              const resolved = items.filter((i) => i.classification === 'resolved')
              const reduced = items.filter((i) => i.classification === 'reduced')
              const persistent = items.filter((i) => i.classification === 'persistent')
              const emerging = items.filter((i) => i.classification === 'emerging')
              const sortByPriority = (list: typeof items) => [...list].sort((a, b) => b.priority - a.priority)

              const counts = {
                resolved: resolved.length,
                reduced: reduced.length,
                persistent: persistent.length,
                emerging: emerging.length,
              }

              const unresolvedCommon = [...persistent, ...emerging].sort((a, b) => b.priority - a.priority)[0]
              const hasChange = items.length > 0
              const summary_line =
                !hasChange
                  ? 'No major misconception changes detected.'
                  : counts.resolved > 0 && counts.persistent === 0 && counts.emerging === 0 && counts.reduced === 0
                    ? 'Most major misconceptions were resolved.'
                    : counts.emerging > 0 && counts.persistent === 0 && counts.resolved === 0
                      ? 'A new misconception emerged after revision.'
                      : counts.persistent > 0 && counts.reduced > 0
                        ? 'Some misconceptions decreased, but one remains common.'
                        : counts.persistent > 0 || counts.emerging > 0
                          ? 'Some misconceptions remain active and should be addressed directly.'
                          : 'Misconceptions mostly improved, with a few details still worth reinforcing.'

              const suggested_action =
                !hasChange
                  ? 'No major instructional adjustment is needed right now.'
                  : unresolvedCommon && q2?.correct_answer
                    ? `Briefly reinforce why the correct answer is ${q2.correct_answer} and address "${unresolvedCommon.label}" directly.`
                    : unresolvedCommon
                      ? `Address "${unresolvedCommon.label}" directly and ask for a quick check-for-understanding.`
                      : q2?.correct_answer
                        ? `Briefly reinforce why the correct answer is ${q2.correct_answer}.`
                        : 'Address the persistent/new misconceptions directly and ask for a quick check-for-understanding.'

              const deltasSorted = sortByPriority(items)
              const grouped_deltas = {
                resolved: sortByPriority(resolved),
                reduced: sortByPriority(reduced),
                persistent: sortByPriority(persistent),
                emerging: sortByPriority(emerging),
              }

              return {
                question_id: q2.question_id,
                position: q2.position,
                summary_line,
                suggested_action,
                counts,
                grouped_deltas,
                // Keep raw deltas for debugging/export, but also provide a teacher-sorted list.
                deltas: deltasSorted,
              }
            })
            .filter((x: any) => x && x.deltas && x.deltas.length > 0)
        }
      } catch {}
    }

    // Finalize analysis run record (stores the full JSON the UI should render).
    try {
      await updateAnalysisRun({
        analysisRunId: run.analysis_run_id,
        status: 'completed',
        promptJson: rawAi?.prompt_json as any,
        rawResponseJson: rawAi?.raw_response_json as any,
        summaryJson: analysis as any,
      })
    } catch {}

    await logTeacherAction(sessionId, 'ai_analysis_triggered', {
      analysisType: session.condition,
      roundNumber: rn,
    })

    return NextResponse.json(analysis)
  } catch (error) {
    console.error('Error analyzing session:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    )
  }
}
