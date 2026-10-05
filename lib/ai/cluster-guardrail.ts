/**
 * Non-Evaluative Guardrail for MeshQuiz Artificial Agency.
 * 
 * DESIGN PRINCIPLE:
 * AI organizes classroom reasoning into inspectable patterns; humans decide what those patterns mean.
 * The AI must NEVER use evaluative language (e.g. correct, wrong, misconception, error, diagnostic claims)
 * in its cluster labels, summaries, or observations.
 * 
 * ARCHITECTURAL FLOW:
 * LLM generation -> Deterministic Validation -> PASS: accept -> FAIL: regenerate with explicit constraint -> REPEATED FAIL: neutral fallback
 */

const PROHIBITED_EVALUATIVE_TERMS = [
  /\bcorrect(ly)?\b/gi,
  /\bincorrect(ly)?\b/gi,
  /\bwrong\b/gi,
  /\bright\b/gi,
  /\bmisconception(s)?\b/gi,
  /\bmisunderstand(ing|s)?\b/gi,
  /\berror(s)?\b/gi,
  /\bgood answer(s)?\b/gi,
  /\bbad answer(s)?\b/gi,
  /\bflawed\b/gi,
  /\bfailed to\b/gi,
  /\baccurate(ly)?\b/gi,
  /\binaccurate(ly)?\b/gi,
  /\bdeficiency\b/gi,
  /\bdeficit(s)?\b/gi,
  /\bremediation\b/gi,
  /\bproblematic\b/gi,
  /\breference answer(s)?\b/gi,
  /\bexpected answer(s)?\b/gi,
]

export type GuardrailValidationResult = {
  ok: boolean
  prohibitedMatches: string[]
  sanitizedText: string
}

export function validateNonEvaluativeText(text: string): GuardrailValidationResult {
  if (!text || typeof text !== 'string') {
    return { ok: true, prohibitedMatches: [], sanitizedText: '' }
  }

  // Strip technical domain phrases (e.g. off-by-one error, compiler error) before checking evaluative terms
  const cleanedForCheck = text.replace(/\b(off-by-one|compiler|compilation|runtime|syntax|type|logic|segmentation)\s+error(s)?\b/gi, '')

  const matches: string[] = []
  for (const pattern of PROHIBITED_EVALUATIVE_TERMS) {
    const found = cleanedForCheck.match(pattern)
    if (found) {
      matches.push(...found)
    }
  }

  let sanitized = text
  for (const pattern of PROHIBITED_EVALUATIVE_TERMS) {
    // Only sanitize evaluative terms when not part of technical domain phrases
    sanitized = sanitized.replace(pattern, (match, p1, offset, string) => {
      const preceding = string.slice(Math.max(0, offset - 20), offset).toLowerCase()
      if (/(off-by-one|compiler|compilation|runtime|syntax|type|logic|segmentation)\s*$/i.test(preceding)) {
        return match
      }
      return 'reasoning aspect'
    })
  }
  sanitized = sanitized.replace(/\s+/g, ' ').trim()

  return {
    ok: matches.length === 0,
    prohibitedMatches: Array.from(new Set(matches)),
    sanitizedText: sanitized,
  }
}

export function sanitizeNonEvaluativeText(text: string): { sanitized: string; flagged: boolean } {
  const result = validateNonEvaluativeText(text)
  return {
    sanitized: result.sanitizedText,
    flagged: !result.ok,
  }
}

export function validateNonEvaluativeCluster<
  T extends {
    label: string
    summary: string
    reference_alignment?: {
      explanation?: string
      alignment_level?: 'strong' | 'partial' | 'limited' | string
      aligned_reference_ids?: string[]
    }
  }
>(cluster: T): T & { wasSanitized: boolean } {
  const labelValidation = validateNonEvaluativeText(cluster.label)
  const summaryValidation = validateNonEvaluativeText(cluster.summary)
  let refExplanationSanitized = cluster.reference_alignment?.explanation
  let refSanitized = false

  if (cluster.reference_alignment?.explanation) {
    const refVal = validateNonEvaluativeText(cluster.reference_alignment.explanation)
    if (!refVal.ok) {
      refExplanationSanitized = refVal.sanitizedText || 'Aligns with reference reasoning aspects.'
      refSanitized = true
    }
  }

  const wasSanitized = !labelValidation.ok || !summaryValidation.ok || refSanitized

  return {
    ...cluster,
    label: labelValidation.ok ? cluster.label : labelValidation.sanitizedText || 'Observed reasoning pattern',
    summary: summaryValidation.ok ? cluster.summary : summaryValidation.sanitizedText || 'Students expressed a similar line of reasoning.',
    reference_alignment: cluster.reference_alignment
      ? {
          ...cluster.reference_alignment,
          explanation: refExplanationSanitized || '',
        }
      : undefined,
    wasSanitized,
  }
}

export function validateClusterSet(
  clusters: Array<{
    label: string
    summary: string
    reference_alignment?: { explanation?: string }
  }>
): {
  ok: boolean
  violations: Array<{ clusterIndex: number; prohibitedMatches: string[] }>
} {
  const violations: Array<{ clusterIndex: number; prohibitedMatches: string[] }> = []

  clusters.forEach((cluster, idx) => {
    const labelValidation = validateNonEvaluativeText(cluster.label)
    const summaryValidation = validateNonEvaluativeText(cluster.summary)
    const refValidation = cluster.reference_alignment?.explanation
      ? validateNonEvaluativeText(cluster.reference_alignment.explanation)
      : { ok: true, prohibitedMatches: [] }

    if (!labelValidation.ok || !summaryValidation.ok || !refValidation.ok) {
      const combined = Array.from(
        new Set([
          ...labelValidation.prohibitedMatches,
          ...summaryValidation.prohibitedMatches,
          ...refValidation.prohibitedMatches,
        ])
      )
      violations.push({ clusterIndex: idx, prohibitedMatches: combined })
    }
  })

  return {
    ok: violations.length === 0,
    violations,
  }
}
