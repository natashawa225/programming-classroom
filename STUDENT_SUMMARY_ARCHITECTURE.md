# Student Summary Architecture

This first version uses a local TypeScript "cluster-then-feedback" pipeline rather than a separate Python/LangGraph service.

## Flow

1. Existing live clustering produces `live_question_analyses.analysis_json`.
2. `clustering-agent.ts` syncs `response_ids` from each cluster into `student_cluster_memberships`.
3. `cluster-feedback-agent.ts` generates one reusable feedback card per cluster and caches it in `cluster_feedback_cards`.
4. `misconception-memory-agent.ts` updates both global `misconception_memory` and per-student `student_misconception_memory`.
5. `improvement-agent.ts` deterministically compares each student's initial and revision attempts.
6. `synthesis-agent.ts` assembles a cached `student_summary_snapshots` JSON payload.

The expensive LLM call happens once per cluster feedback card, not once per student.

## Idempotent Memory

Misconception aggregates are updated through event tables:

- `misconception_memory_events`
- `student_misconception_memory_events`

Each event is unique by session, question, attempt, cluster, and misconception key. Re-running teacher generation for the same session therefore does not inflate `evidence_count`.

Global misconception memory only records clusters with concerning evidence: `mixed_reasoning`, `needs_attention`, `unclear`, or `conceptual_alignment < 0.6`. Strong/aligned clusters are not stored as misconceptions just because they have improvement advice.

Student memory records concern evidence idempotently. Strong revision clusters can move existing memories for that same question concept toward `improving` or `resolved`, but only when a new resolution event is inserted.

## Movement Labels

Student improvement uses deterministic labels:

- `strong_improvement`
- `partial_improvement`
- `stable_strong`
- `stable_needs_review`
- `possible_regression`
- `confidence_miscalibration`
- `no_revision`
- `no_response`
- `unclear`

These labels are rendered with friendly student-facing names such as "Strong improvement", "Review again", and "Confidence check".

## Validation And Fallbacks

All LLM/agent JSON outputs are validated with Zod in `schemas.ts`.

- Invalid cluster feedback output saves a deterministic fallback card.
- Optional student summary polish falls back to the deterministic template.
- Missing cluster analysis marks summaries as `analysis_status: "partial"`.
- Fallback AI output marks summaries as `analysis_status: "fallback"`.

Student and teacher UIs render visible warning states for partial and fallback analysis.

## Optional Hybrid LLM Synthesis

By default, student summaries are deterministic.

Set `ENABLE_STUDENT_SUMMARY_LLM_POLISH=true` to let the synthesis agent polish the top-level student summary. The LLM receives only privacy-safe structured evidence:

- the student's own answers and revisions
- confidence and movement deltas
- cached cluster feedback cards
- student-level misconception memory

It never receives raw class responses, other student IDs, rankings, or private teacher notes.

The optional polish does not generate per-question cards. Those remain deterministic so they preserve the student's actual answers, cluster feedback, and movement labels while reducing token cost.

## Privacy Rule

Student pages show only the logged-in participant's own answers plus cluster-level feedback. The summary API verifies that the participant joined the requested session before returning anything.

## Later LangGraph Migration

The files under `lib/agents/student-summary` intentionally mirror agent boundaries:

- Clustering Agent
- Cluster Feedback Agent
- Misconception Memory Agent
- Student Improvement Agent
- Summary/Synthesis Agent

A future LangGraph supervisor can orchestrate these same steps without changing the core data contracts.

## Research Inspiration

The implementation follows a cluster-mediated feedback pattern inspired by:

- Kaleeswaran et al. 2016, cluster submissions by solution strategy and validate feedback per cluster.
- Michalenko et al. 2017, misconception detection from textual responses.
- AutoFeedback 2024, separating feedback generation/checking to reduce over-praise and over-inference.

These references are architectural context only; this app currently uses the existing Next.js/Supabase stack.
