import { getConfidenceLevel } from '@/lib/confidence'

export type LiveRenderCluster = {
  cluster_id: string
  label: string
  summary: string
  count: number
  average_confidence: number
  representative_answers?: string[]
  response_ids?: string[]
  conceptual_alignment?: number
  understanding_bucket?: UnderstandingBucket
}

export type UnderstandingBucket = 'needs_attention' | 'mixed_reasoning' | 'strong_alignment' | 'unclear'

export type LiveRenderAnalysis = {
  version: 'live_question_clusters_v1' | 'live_question_clusters_v2'
  question_prompt: string
  clusters: LiveRenderCluster[]
}

export type ResolvedRenderedCluster = LiveRenderCluster & {
  displayLabel: string
  rank: number
  percentage: number | null
  patternLabel: string
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/**
 * Confidence-based, non-evaluative palette. Color reflects each cluster's mean
 * self-reported student confidence — low/mid/high, using the same bins as
 * lib/confidence.ts. It does NOT encode correctness, conceptual alignment, or
 * misconception: a purple bubble isn't "wrong," it just means students in that
 * pattern reported lower confidence on average than students in a yellow one.
 *
 * Fill opacity ("intensity") scales continuously with the score within its
 * bin (0.32-0.9) rather than always being fully solid — this is what keeps
 * the bubbles looking soft/pastel instead of flat and saturated.
 */
function getConfidenceIntensity(score: number) {
  return clamp(0.28 + ((score - 1) / 4) * 0.62, 0.32, 0.9)
}

export function getClusterPatternColor(averageConfidence: number | null | undefined) {
  const score =
    averageConfidence === null || averageConfidence === undefined || !Number.isFinite(averageConfidence)
      ? 3
      : averageConfidence
  const intensity = getConfidenceIntensity(score)
  const level = getConfidenceLevel(score)

  if (level === 'high') {
    return { fill: `rgba(255, 228, 144, ${intensity})`, border: 'rgba(255, 199, 84, 0.88)', dot: '#F0B93B' }
  }
  if (level === 'low') {
    return { fill: `rgba(231, 223, 255, ${intensity})`, border: 'rgba(169, 119, 255, 0.82)', dot: '#A977FF' }
  }
  return { fill: `rgba(216, 232, 243, ${intensity})`, border: 'rgba(123, 175, 212, 0.92)', dot: '#7BAFD4' }
}

/**
 * Alignment-bucket x-position — this IS a correctness/understanding-level
 * axis, unlike everything else in this file. Only meant to be used for views
 * where that framing is intentional (baseline sessions, and the revision
 * round of treatment sessions) — the initial round of a treatment session
 * should keep using neutral rank-based positioning instead (see the
 * `neutralHorizontalOrder` flag at the call site in session-detail-client.tsx).
 * Clusters without a real `understanding_bucket`/`conceptual_alignment` from
 * the clustering pipeline resolve to 'unclear' (center) rather than being
 * placed on either side without evidence.
 */
const BUCKET_CENTERS: Record<UnderstandingBucket, number> = {
  needs_attention: 0.18,
  mixed_reasoning: 0.5,
  strong_alignment: 0.82,
  unclear: 0.5,
}

function normalizeAlignment(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return clamp(numeric, -1, 1)
}

function normalizeBucket(value: unknown): UnderstandingBucket | null {
  if (
    value === 'needs_attention' ||
    value === 'mixed_reasoning' ||
    value === 'strong_alignment' ||
    value === 'unclear'
  ) {
    return value
  }
  return null
}

export function inferBucketFromAlignment(alignment: number): UnderstandingBucket {
  if (alignment >= 0.6) return 'strong_alignment'
  if (alignment >= 0.1) return 'mixed_reasoning'
  if (alignment <= -0.3) return 'needs_attention'
  return 'unclear'
}

function hashString(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

function deterministicUnit(value: string) {
  return hashString(value) / 0xffffffff
}

export function resolveClusterAlignment(cluster: {
  conceptual_alignment?: number
  understanding_bucket?: UnderstandingBucket
}) {
  const resolvedAlignment = normalizeAlignment(cluster.conceptual_alignment)
  const resolvedBucket = normalizeBucket(cluster.understanding_bucket) ?? inferBucketFromAlignment(resolvedAlignment)
  return { resolvedAlignment, resolvedBucket }
}

export function getClusterBucketX(cluster: {
  cluster_id: string
  conceptual_alignment?: number
  understanding_bucket?: UnderstandingBucket
}) {
  const { resolvedAlignment, resolvedBucket } = resolveClusterAlignment(cluster)
  const center = BUCKET_CENTERS[resolvedBucket]
  const jitter = (deterministicUnit(cluster.cluster_id) * 2 - 1) * 0.05
  const alignmentNudge = resolvedAlignment * 0.02
  return clamp(center + jitter + alignmentNudge, 0.08, 0.92)
}

export function getClusterDisplayLabel(label: string) {
  return String(label || '').replace(/^(True|False|Uncertain):\s*/i, '').trim() || 'Response pattern'
}

export function getPatternLabel(rank: number) {
  return `Pattern ${rank}`
}

/**
 * Ranks clusters by size (largest first) and attaches purely descriptive,
 * non-evaluative metadata. Rank order is a size fact, not a correctness claim.
 */
export function resolveRenderedClusters(clusters: LiveRenderCluster[]): ResolvedRenderedCluster[] {
  const totalResponses = clusters.reduce((sum, cluster) => sum + cluster.count, 0)
  return clusters
    .slice()
    .sort((a, b) => b.count - a.count)
    .map((cluster, index) => {
      const rank = index + 1
      return {
        ...cluster,
        displayLabel: getClusterDisplayLabel(cluster.label),
        rank,
        percentage: totalResponses > 0 ? Math.round((cluster.count / totalResponses) * 1000) / 10 : null,
        patternLabel: getPatternLabel(rank),
      }
    })
}

export function resolveRenderedCluster(
  cluster: LiveRenderCluster,
  allClustersInAttempt: LiveRenderCluster[]
): ResolvedRenderedCluster {
  const resolved = resolveRenderedClusters(allClustersInAttempt)
  return (
    resolved.find((entry) => entry.cluster_id === cluster.cluster_id) || {
      ...cluster,
      displayLabel: getClusterDisplayLabel(cluster.label),
      rank: 1,
      percentage: null,
      patternLabel: getPatternLabel(1),
    }
  )
}
