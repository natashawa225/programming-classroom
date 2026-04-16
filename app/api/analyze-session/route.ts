import { buildRoundAnalysis } from '@/lib/ai/experiment-analysis'
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
      if (completed?.summary_json) {
        return NextResponse.json(completed.summary_json)
      }
    }

    // Create a run upfront so we can block duplicates while OpenAI is running.
    const run = await createAnalysisRun({
      sessionId,
      condition: session.condition,
      sessionStatus: session.status,
      roundNumber: rn as 1 | 2,
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
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
            isCorrect: lab?.is_correct ?? null,
            misconceptionLabel: lab?.misconception_label ?? null,
            clusterId: lab?.cluster_id ?? null,
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

        // If we have a stored round-1 analysis, use its labels when available.
        const round1Correctness = new Map<string, boolean | null>()
        const compare = (analysis as any).compare_to_round_1
        if (compare?.per_question && Array.isArray(compare.per_question)) {
          for (const q of compare.per_question) {
            const labels = q?.response_labels
            if (!Array.isArray(labels)) continue
            for (const l of labels) {
              if (typeof l?.response_id === 'string' && typeof l?.is_correct === 'boolean') {
                round1Correctness.set(l.response_id, l.is_correct)
              }
            }
          }
        }

        const deriveCorrect = (responseId: string, fallbackResponse: any): boolean | null => {
          const fromAi = round1Correctness.get(responseId)
          if (typeof fromAi === 'boolean') return fromAi
          const q = fallbackResponse?.question_id ? questionById.get(fallbackResponse.question_id) : null
          const correctKey = q?.correct_answer ? normalize(q.correct_answer) : ''
          if (!correctKey) return null
          return normalize(fallbackResponse?.answer || '') === correctKey
        }

        const round2Correctness = new Map<string, boolean | null>()
        for (const r2 of responsesData) {
          const lab = labelsByResponseId.get(r2.response_id)
          if (typeof lab?.is_correct === 'boolean') {
            round2Correctness.set(r2.response_id, lab.is_correct)
            continue
          }
          const q = r2.question_id ? questionById.get(r2.question_id) : null
          const correctKey = q?.correct_answer ? normalize(q.correct_answer) : ''
          if (!correctKey) {
            round2Correctness.set(r2.response_id, null)
          } else {
            round2Correctness.set(r2.response_id, normalize(r2.answer || '') === correctKey)
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
            round1Responses.find(
              (r) =>
                r.session_participant_id === r2.session_participant_id &&
                r.question_id === r2.question_id
            ) ||
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

        ;(analysis as any).transitions = {
          total_pairs: totalPairs,
          incorrect_to_correct: { count: incorrectToCorrect, percent: percent(incorrectToCorrect) },
          correct_to_incorrect: { count: correctToIncorrect, percent: percent(correctToIncorrect) },
          stayed_correct: { count: stayedCorrect, percent: percent(stayedCorrect) },
          stayed_incorrect: { count: stayedIncorrect, percent: percent(stayedIncorrect) },
        }
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

          const countsToMap = (clusters: any[]) => {
            // Map canonical -> { displayLabel, roundCount }
            const out = new Map<string, { label: string; count: number; tokens: Set<string> }>()
            for (const c of Array.isArray(clusters) ? clusters : []) {
              const label = typeof c?.label === 'string' ? c.label : null
              const count = typeof c?.count === 'number' ? c.count : 0
              if (!label || count <= 0) continue
              const canon = canonicalizeLabel(label)
              if (!canon) continue
              const existing = out.get(canon)
              if (existing) {
                existing.count += count
                // Keep a nicer/longer label for display.
                if (label.length > existing.label.length) existing.label = label
              } else {
                out.set(canon, { label, count, tokens: comparisonTokenSet(label) })
              }
            }
            return out
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
              const round1 = countsToMap(q1?.clusters || q1?.top_misconceptions || [])
              const round2Raw = countsToMap(q2?.clusters || q2?.top_misconceptions || [])

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
