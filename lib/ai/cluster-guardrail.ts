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

  const matches: string[] = []
  for (const pattern of PROHIBITED_EVALUATIVE_TERMS) {
    const found = text.match(pattern)
    if (found) {
      matches.push(...found)
    }
  }

  let sanitized = text
  for (const pattern of PROHIBITED_EVALUATIVE_TERMS) {
    sanitized = sanitized.replace(pattern, 'reasoning aspect')
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

export function validateNonEvaluativeCluster(cluster: {
  label: string
  summary: string
}): { label: string; summary: string; wasSanitized: boolean } {
  const labelValidation = validateNonEvaluativeText(cluster.label)
  const summaryValidation = validateNonEvaluativeText(cluster.summary)

  return {
    label: labelValidation.ok ? cluster.label : labelValidation.sanitizedText || 'Observed reasoning pattern',
    summary: summaryValidation.ok ? cluster.summary : summaryValidation.sanitizedText || 'Students expressed a similar line of reasoning.',
    wasSanitized: !labelValidation.ok || !summaryValidation.ok,
  }
}

export function validateClusterSet(clusters: Array<{ label: string; summary: string }>): {
  ok: boolean
  violations: Array<{ clusterIndex: number; prohibitedMatches: string[] }>
} {
  const violations: Array<{ clusterIndex: number; prohibitedMatches: string[] }> = []

  clusters.forEach((cluster, idx) => {
    const labelValidation = validateNonEvaluativeText(cluster.label)
    const summaryValidation = validateNonEvaluativeText(cluster.summary)

    if (!labelValidation.ok || !summaryValidation.ok) {
      const combined = Array.from(
        new Set([...labelValidation.prohibitedMatches, ...summaryValidation.prohibitedMatches])
      )
      violations.push({ clusterIndex: idx, prohibitedMatches: combined })
    }
  })

  return {
    ok: violations.length === 0,
    violations,
  }
}
