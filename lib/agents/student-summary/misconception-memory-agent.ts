import { createAdminClient } from '@/lib/supabase/server'

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'uncategorized'
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
  const cardByCluster = new Map((cards || []).map((card: any) => [
    `${card.question_id}:${card.attempt_type}:${card.cluster_id}`,
    card,
  ]))

  for (const card of cards || []) {
    const label = String(card.likely_gap || card.cluster_label || '').trim()
    if (!label) continue
    const misconceptionKey = slugify(label)
    const concept = `question:${card.question_id}`

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

  let studentUpdated = 0
  for (const membership of memberships || []) {
    const alignment = membership.conceptual_alignment === null || membership.conceptual_alignment === undefined
      ? null
      : Number(membership.conceptual_alignment)
    const bucket = String(membership.understanding_bucket || '')
    const isConcern =
      ['mixed_reasoning', 'needs_attention', 'unclear'].includes(bucket) ||
      (alignment !== null && alignment < 0.6)
    const isStrong = bucket === 'strong_alignment' || (alignment !== null && alignment >= 0.75)
    const card = cardByCluster.get(`${membership.question_id}:${membership.attempt_type}:${membership.cluster_id}`)
    const description = String(card?.likely_gap || membership.cluster_label || 'Reasoning pattern needs review.').trim()
    const misconceptionKey = slugify(description || membership.cluster_label || membership.cluster_id)
    const concept = `question:${membership.question_id}`

    if (isStrong) {
      const { data: existingForConcept, error: conceptLookupError } = await supabase
        .from('student_misconception_memory')
        .select('id, evidence_count, resolved_count')
        .eq('participant_id', membership.participant_id)
        .eq('concept', concept)
        .in('status', ['active', 'improving'])

      if (conceptLookupError) throw conceptLookupError

      for (const memory of existingForConcept || []) {
        const evidenceCount = Number(memory.evidence_count || 0)
        const nextResolved = Number(memory.resolved_count || 0) + 1
        const { error: resolveError } = await supabase
          .from('student_misconception_memory')
          .update({
            resolved_count: nextResolved,
            status: nextResolved >= evidenceCount ? 'resolved' : 'improving',
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', memory.id)

        if (resolveError) throw resolveError
        studentUpdated += 1
      }

      if (!isConcern) continue
    }

    const { data: existing, error: lookupError } = await supabase
      .from('student_misconception_memory')
      .select('id, evidence_count, resolved_count')
      .eq('participant_id', membership.participant_id)
      .eq('concept', concept)
      .eq('misconception_key', misconceptionKey)
      .maybeSingle()

    if (lookupError) throw lookupError
    if (!isConcern && !existing) continue

    const evidenceCount = existing ? Number(existing.evidence_count || 0) : 0
    const resolvedCount = existing ? Number(existing.resolved_count || 0) : 0
    const nextEvidence = evidenceCount + 1
    const nextResolved = resolvedCount
    const status =
      nextResolved > 0 && nextResolved >= nextEvidence
        ? 'resolved'
        : nextResolved > 0
          ? 'improving'
          : 'active'

    const { error: upsertError } = await supabase
      .from('student_misconception_memory')
      .upsert(
        {
          participant_id: membership.participant_id,
          concept,
          misconception_key: misconceptionKey,
          description,
          evidence_count: Math.max(nextEvidence, 1),
          resolved_count: nextResolved,
          status,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'participant_id,concept,misconception_key' }
      )

    if (upsertError) throw upsertError
    studentUpdated += 1
  }

  return { updated, studentUpdated }
}
