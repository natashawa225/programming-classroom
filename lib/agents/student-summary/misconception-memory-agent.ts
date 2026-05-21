import { createAdminClient } from '@/lib/supabase/server'

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'uncategorized'
}

function alignmentOf(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function isConcernBucket(bucket: string) {
  return ['mixed_reasoning', 'needs_attention', 'unclear'].includes(bucket)
}

function isConcernCluster(membership: any) {
  const alignment = alignmentOf(membership.conceptual_alignment)
  const bucket = String(membership.understanding_bucket || '')
  return isConcernBucket(bucket) || (alignment !== null && alignment < 0.6)
}

function isStrongCluster(membership: any) {
  const alignment = alignmentOf(membership.conceptual_alignment)
  const bucket = String(membership.understanding_bucket || '')
  return bucket === 'strong_alignment' || (alignment !== null && alignment >= 0.75)
}

async function insertGlobalEventIfNew(input: {
  supabase: ReturnType<typeof createAdminClient>
  sessionId: string
  questionId: string
  attemptType: string
  clusterId: string
  concept: string
  misconceptionKey: string
}) {
  const { data, error } = await input.supabase
    .from('misconception_memory_events')
    .upsert(
      {
        session_id: input.sessionId,
        question_id: input.questionId,
        attempt_type: input.attemptType,
        cluster_id: input.clusterId,
        concept: input.concept,
        misconception_key: input.misconceptionKey,
      },
      {
        onConflict: 'session_id,question_id,attempt_type,cluster_id,misconception_key',
        ignoreDuplicates: true,
      }
    )
    .select('id')

  if (error) throw error
  return (data || []).length > 0
}

async function insertStudentEventIfNew(input: {
  supabase: ReturnType<typeof createAdminClient>
  sessionId: string
  participantId: string
  questionId: string
  attemptType: string
  clusterId: string
  concept: string
  misconceptionKey: string
  status: 'active' | 'improving' | 'resolved'
}) {
  const { data, error } = await input.supabase
    .from('student_misconception_memory_events')
    .upsert(
      {
        session_id: input.sessionId,
        participant_id: input.participantId,
        question_id: input.questionId,
        attempt_type: input.attemptType,
        cluster_id: input.clusterId,
        concept: input.concept,
        misconception_key: input.misconceptionKey,
        status: input.status,
      },
      {
        onConflict: 'session_id,participant_id,question_id,attempt_type,misconception_key',
        ignoreDuplicates: true,
      }
    )
    .select('id')

  if (error) throw error
  return (data || []).length > 0
}

export async function updateMisconceptionMemoryFromSession(sessionId: string) {
  const supabase = createAdminClient()
  const [{ data: cards, error }, { data: memberships, error: membershipsError }] = await Promise.all([
    supabase
      .from('cluster_feedback_cards')
      .select('question_id, attempt_type, cluster_id, cluster_label, likely_gap')
      .eq('session_id', sessionId),
    supabase
      .from('student_cluster_memberships')
      .select('participant_id, question_id, attempt_type, cluster_id, cluster_label, conceptual_alignment, understanding_bucket')
      .eq('session_id', sessionId),
  ])

  if (error) throw error
  if (membershipsError) throw membershipsError

  let updated = 0
  let studentUpdated = 0
  const membershipsByCluster = new Map<string, any[]>()
  for (const membership of memberships || []) {
    const key = `${membership.question_id}:${membership.attempt_type}:${membership.cluster_id}`
    const list = membershipsByCluster.get(key) || []
    list.push(membership)
    membershipsByCluster.set(key, list)
  }

  const cardByCluster = new Map((cards || []).map((card: any) => [
    `${card.question_id}:${card.attempt_type}:${card.cluster_id}`,
    card,
  ]))
  const membershipByParticipantQuestionAttempt = new Map<string, any>()
  for (const membership of memberships || []) {
    membershipByParticipantQuestionAttempt.set(
      `${membership.participant_id}:${membership.question_id}:${membership.attempt_type}`,
      membership
    )
  }

  for (const card of cards || []) {
    const clusterMemberships = membershipsByCluster.get(`${card.question_id}:${card.attempt_type}:${card.cluster_id}`) || []
    const hasConcern = clusterMemberships.some(isConcernCluster)
    if (!hasConcern) continue

    const label = String(card.likely_gap || card.cluster_label || '').trim()
    if (!label) continue
    const misconceptionKey = slugify(label)
    const concept = `question:${card.question_id}`
    const isNewEvent = await insertGlobalEventIfNew({
      supabase,
      sessionId,
      questionId: card.question_id,
      attemptType: card.attempt_type,
      clusterId: card.cluster_id,
      concept,
      misconceptionKey,
    })
    if (!isNewEvent) continue

    const { data: existing, error: lookupError } = await supabase
      .from('misconception_memory')
      .select('id, evidence_count')
      .eq('concept', concept)
      .eq('misconception_key', misconceptionKey)
      .maybeSingle()

    if (lookupError) throw lookupError

    const { error: upsertError } = await supabase
      .from('misconception_memory')
      .upsert(
        {
          concept,
          misconception_key: misconceptionKey,
          description: label,
          common_patterns: [card.cluster_label].filter(Boolean),
          repair_strategies: [],
          evidence_count: existing ? Number(existing.evidence_count || 0) + 1 : 1,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'concept,misconception_key' }
      )

    if (upsertError) throw upsertError
    updated += 1
  }

  for (const membership of memberships || []) {
    const concern = isConcernCluster(membership)
    const strong = isStrongCluster(membership)
    const card = cardByCluster.get(`${membership.question_id}:${membership.attempt_type}:${membership.cluster_id}`)
    const description = String(card?.likely_gap || membership.cluster_label || 'Reasoning pattern needs review.').trim()
    const misconceptionKey = slugify(description || membership.cluster_label || membership.cluster_id)
    const concept = `question:${membership.question_id}`

    if (concern) {
      const isNewEvent = await insertStudentEventIfNew({
        supabase,
        sessionId,
        participantId: membership.participant_id,
        questionId: membership.question_id,
        attemptType: membership.attempt_type,
        clusterId: membership.cluster_id,
        concept,
        misconceptionKey,
        status: 'active',
      })
      if (!isNewEvent) continue

      const { data: existing, error: lookupError } = await supabase
        .from('student_misconception_memory')
        .select('id, evidence_count, resolved_count')
        .eq('participant_id', membership.participant_id)
        .eq('concept', concept)
        .eq('misconception_key', misconceptionKey)
        .maybeSingle()

      if (lookupError) throw lookupError
      const evidenceCount = existing ? Number(existing.evidence_count || 0) : 0
      const resolvedCount = existing ? Number(existing.resolved_count || 0) : 0

      const { error: upsertError } = await supabase
        .from('student_misconception_memory')
        .upsert(
          {
            participant_id: membership.participant_id,
            concept,
            misconception_key: misconceptionKey,
            description,
            evidence_count: evidenceCount + 1,
            resolved_count: resolvedCount,
            status: resolvedCount > 0 ? 'improving' : 'active',
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'participant_id,concept,misconception_key' }
        )

      if (upsertError) throw upsertError
      studentUpdated += 1
      continue
    }

    if (!strong || membership.attempt_type !== 'revision') continue

    const initialMembership = membershipByParticipantQuestionAttempt.get(
      `${membership.participant_id}:${membership.question_id}:initial`
    )
    if (!initialMembership || !isConcernCluster(initialMembership)) continue

    const initialCard = cardByCluster.get(
      `${initialMembership.question_id}:${initialMembership.attempt_type}:${initialMembership.cluster_id}`
    )
    const initialDescription = String(
      initialCard?.likely_gap ||
      initialMembership.cluster_label ||
      ''
    ).trim()
    if (!initialDescription) continue
    const initialMisconceptionKey = slugify(initialDescription)

    const { data: initialConcernMemory, error: initialLookupError } = await supabase
      .from('student_misconception_memory')
      .select('id, misconception_key, evidence_count, resolved_count')
      .eq('participant_id', membership.participant_id)
      .eq('concept', concept)
      .eq('misconception_key', initialMisconceptionKey)
      .in('status', ['active', 'improving'])
      .maybeSingle()

    if (initialLookupError) throw initialLookupError
    if (!initialConcernMemory) continue

    const isNewEvent = await insertStudentEventIfNew({
      supabase,
      sessionId,
      participantId: membership.participant_id,
      questionId: membership.question_id,
      attemptType: membership.attempt_type,
      clusterId: membership.cluster_id,
      concept,
      misconceptionKey: initialConcernMemory.misconception_key,
      status: 'improving',
    })
    if (!isNewEvent) continue

    const evidenceCount = Number(initialConcernMemory.evidence_count || 0)
    const nextResolved = Number(initialConcernMemory.resolved_count || 0) + 1
    const { error: resolveError } = await supabase
      .from('student_misconception_memory')
      .update({
        resolved_count: nextResolved,
        status: nextResolved >= evidenceCount ? 'resolved' : 'improving',
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', initialConcernMemory.id)

    if (resolveError) throw resolveError
    studentUpdated += 1
  }

  return { updated, studentUpdated }
}
