export type UnionFindQuestionContext = {
  lesson_concept: string
  target_misconception: string
  strong_answer_criteria: string[]
  misconception_variants: string[]
}

function normalizePrompt(prompt: string) {
  return String(prompt || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * MVP-only: question-specific config for the 4 union-find lecture questions.
 * This is intentionally hardcoded to ship in 3 days without DB redesign.
 *
 * We match primarily by question position (1-4) and secondarily by prompt keywords.
 */
export function getUnionFindQuestionContext(options: {
  position: number
  prompt: string
}): UnionFindQuestionContext | null {
  const p = normalizePrompt(options.prompt)
  const pos = options.position

  // Q1: connected components + transitivity
  if (
    pos === 1 ||
    p.includes('connected component') ||
    p.includes('transitiv') ||
    p.includes('connectivity')
  ) {
    return {
      lesson_concept:
        'Connected components and transitivity: “connected” means there exists a path, not necessarily a direct edge.',
      target_misconception:
        'Direct-edge-only thinking: students treat “connected” as only immediately adjacent, ignoring transitivity via a path.',
      strong_answer_criteria: [
        'Explicitly states the transitive conclusion: if A–B and B–C then A is connected to C.',
        'Uses the component/path framing (“same connected component”, “there is a path A→…→C”).',
        'Does not require a direct A–C edge to claim connectivity.',
      ],
      misconception_variants: [
        '“A and C are connected only if there is a direct edge A–C.”',
        'Treats connection as a one-step relationship (adjacency) rather than path reachability.',
        'Says “not necessarily” even when given A–B and B–C.',
      ],
    }
  }

  // Q2: QuickFind id[] meaning
  if (
    pos === 2 ||
    p.includes('quickfind') ||
    p.includes('id[]') ||
    p.includes('id array')
  ) {
    return {
      lesson_concept:
        'QuickFind: `id[i]` is a component identifier (all items in the same component share the same id).',
      target_misconception:
        'Parent-pointer confusion: students think `id[]` stores parent links (tree) like QuickUnion.',
      strong_answer_criteria: [
        'States `id[i]` is the component id for i (not a parent pointer).',
        'Explains union(p,q) finds pid=id[p] and qid=id[q], then scans id[] and relabels all entries equal to one id to the other.',
        'Mentions why union is expensive in QuickFind (linear scan / many updates).',
      ],
      misconception_variants: [
        '“id[i] points to its parent/root.”',
        'Describes a tree structure in QuickFind.',
        'Says union only updates one link/pointer.',
      ],
    }
  }

  // Q3: QuickUnion roots + linking choice
  if (
    pos === 3 ||
    p.includes('quickunion') ||
    p.includes('root') ||
    p.includes('smaller') ||
    p.includes('larger')
  ) {
    return {
      lesson_concept:
        'QuickUnion: components are trees; a root is a node whose parent is itself; union links root-to-root to merge components.',
      target_misconception:
        'Element-only linking: students link p directly to q (not roots), or think union only connects the named elements rather than merging whole components.',
      strong_answer_criteria: [
        'Defines/identifies a root (parent[root] = root).',
        'Describes union as: find root(p) and root(q), then set one root’s parent to the other root.',
        'States that linking roots merges entire components (all nodes in the trees), not just p and q.',
      ],
      misconception_variants: [
        '“union just sets parent[p]=q” (no root finding).',
        'Says union connects only p and q, leaving the rest unchanged.',
        'Misdefines root (e.g., “root is last inserted” / “root is smallest index”).',
      ],
    }
  }

  // Q4: Weighted QuickUnion + logarithmic performance
  if (
    pos === 4 ||
    p.includes('weighted') ||
    p.includes('log') ||
    p.includes('performance') ||
    p.includes('size')
  ) {
    return {
      lesson_concept:
        'Weighted QuickUnion: track tree size/rank and always link the smaller tree under the larger to keep trees shallow.',
      target_misconception:
        'Performance-mechanism confusion: students confuse weighting with path compression, or fail to connect weighting to bounded height/logarithmic performance.',
      strong_answer_criteria: [
        'States the rule: link smaller-size (or lower-rank) root under larger-size root.',
        'Explains the purpose: prevent tall chains, keep height small.',
        'Connects weighting to logarithmic height / faster finds (without requiring exact big-O phrasing).',
      ],
      misconception_variants: [
        'Equates weighting with path compression.',
        'Claims weighting only affects union cost, not find (no effect on height).',
        'Claims worst-case height remains linear even with weighting.',
      ],
    }
  }

  return null
}
