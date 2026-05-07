export type UnderstandingBucket =
  | 'needs_attention'
  | 'mixed_reasoning'
  | 'strong_alignment'
  | 'unclear'

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
  teacher_note?: string | null
}

export type LiveRenderAnalysis = {
  version: 'live_question_clusters_v1' | 'live_question_clusters_v2'
  question_prompt: string
  clusters: LiveRenderCluster[]
}

export type ResolvedRenderedCluster = LiveRenderCluster & {
  displayLabel: string
  resolvedAlignment: number
  resolvedBucket: UnderstandingBucket
  migratedFromV1: boolean
}

const BUCKET_CENTERS: Record<UnderstandingBucket, number> = {
  needs_attention: 0.18,
  mixed_reasoning: 0.5,
  strong_alignment: 0.82,
  unclear: 0.5,
}

export function inferAlignmentFromV1Label(label: string): number {
  const lower = String(label || '').trim().toLowerCase()
  if (lower.startsWith('true:')) return 0.7
  if (lower.startsWith('false:')) return -0.7
  return 0
}

export function inferBucketFromAlignment(alignment: number): UnderstandingBucket {
  if (alignment >= 0.6) return 'strong_alignment'
  if (alignment >= 0.1) return 'mixed_reasoning'
  if (alignment <= -0.3) return 'needs_attention'
  return 'unclear'
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
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

export function getClusterDisplayLabel(label: string) {
  return String(label || '').replace(/^(True|False|Uncertain):\s*/i, '').trim() || 'Response pattern'
}

export function getBucketDisplayLabel(bucket: UnderstandingBucket) {
  if (bucket === 'needs_attention') return 'Misconception'
  if (bucket === 'mixed_reasoning') return 'Mixed reasoning'
  if (bucket === 'strong_alignment') return 'Strong alignment'
  return 'Unclear'
}

export function resolveRenderedCluster(
  cluster: LiveRenderCluster,
  version: LiveRenderAnalysis['version']
): ResolvedRenderedCluster {
  const migratedFromV1 = version === 'live_question_clusters_v1'
  const inferredAlignment = migratedFromV1 ? inferAlignmentFromV1Label(cluster.label) : 0
  const resolvedAlignment =
    cluster.conceptual_alignment === undefined || cluster.conceptual_alignment === null
      ? inferredAlignment
      : normalizeAlignment(cluster.conceptual_alignment)
  const resolvedBucket =
    normalizeBucket(cluster.understanding_bucket) ??
    inferBucketFromAlignment(resolvedAlignment)

  return {
    ...cluster,
    displayLabel: getClusterDisplayLabel(cluster.label),
    resolvedAlignment,
    resolvedBucket,
    migratedFromV1,
  }
}

export function getClusterBucketX(cluster: ResolvedRenderedCluster) {
  const center = BUCKET_CENTERS[cluster.resolvedBucket]
  const jitter = (deterministicUnit(cluster.cluster_id) * 2 - 1) * 0.05
  const alignmentNudge = cluster.resolvedAlignment * 0.02
  return clamp(center + jitter + alignmentNudge, 0.08, 0.92)
}

export function getClusterBucketOpacity(bucket: UnderstandingBucket) {
  return bucket === 'unclear' ? 0.82 : 1
}

