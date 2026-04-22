import type { Response, Session, SessionParticipant } from '@/lib/types/database'

export type SessionRoundMetricSummary = {
  studentsJoined: number
  studentsResponded: number
  participationRate: number | null
  totalSubmissions: number
  completionRate: number | null
  questionCount: number
  roundNumber: 1 | 2
}

type MetricInput = {
  session?: Session | null
  participants: SessionParticipant[]
  responses: Response[]
  roundNumber?: 1 | 2
  questionCount?: number
}

function uniqueParticipantCount(items: Pick<SessionParticipant, 'session_participant_id'>[]) {
  return new Set(items.map((item) => item.session_participant_id)).size
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, value))
}

export function inferViewingRound(session?: Session | null, responses: Pick<Response, 'round_number'>[] = []): 1 | 2 {
  if (!session) return 1
  const hasRound2Responses = responses.some((response) => (response.round_number ?? 1) === 2)
  if (
    session.condition === 'treatment' &&
    (session.status === 'revision' || session.live_phase === 'question_revision_open' || session.live_phase === 'question_revision_closed' || hasRound2Responses)
  ) {
    return 2
  }
  return 1
}

export function summarizeSessionRoundMetrics({
  session,
  participants,
  responses,
  roundNumber,
  questionCount = 1,
}: MetricInput): SessionRoundMetricSummary {
  const activeRound = roundNumber ?? inferViewingRound(session, responses)
  const roundResponses = responses.filter((response) => (response.round_number ?? 1) === activeRound)
  const joined = uniqueParticipantCount(participants)
  const responded = new Set(roundResponses.map((response) => response.session_participant_id)).size
  const totalSubmissions = roundResponses.length

  const participationRate = joined > 0 ? clampPercent((responded / joined) * 100) : null
  const completionRate =
    joined > 0 && questionCount > 1 ? clampPercent((totalSubmissions / (joined * questionCount)) * 100) : null

  return {
    studentsJoined: joined,
    studentsResponded: responded,
    participationRate,
    totalSubmissions,
    completionRate,
    questionCount,
    roundNumber: activeRound,
  }
}
