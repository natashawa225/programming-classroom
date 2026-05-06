export type ConfidenceLevel = 'low' | 'mid' | 'high' | 'unknown'

export type ConfidenceBin = {
  level: Exclude<ConfidenceLevel, 'unknown'>
  label: string
  min: number
  max: number
}

export const CONFIDENCE_BINS: ConfidenceBin[] = [
  { level: 'low', label: 'Low', min: 1.0, max: 2.9 },
  { level: 'mid', label: 'Mid', min: 3.0, max: 3.9 },
  { level: 'high', label: 'High', min: 4.0, max: 5.0 },
]

export function getConfidenceLevel(value: number | null | undefined): ConfidenceLevel {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'unknown'
  if (value >= CONFIDENCE_BINS[2].min) return 'high'
  if (value >= CONFIDENCE_BINS[1].min) return 'mid'
  if (value >= CONFIDENCE_BINS[0].min) return 'low'
  return 'unknown'
}

export function getConfidenceBin(level: ConfidenceLevel) {
  return CONFIDENCE_BINS.find((bin) => bin.level === level) ?? null
}

export function formatConfidenceBinRange(level: ConfidenceLevel) {
  const bin = getConfidenceBin(level)
  return bin ? `${bin.min.toFixed(1)}-${bin.max.toFixed(1)}` : 'Unknown'
}
