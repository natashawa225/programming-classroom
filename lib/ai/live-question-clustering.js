"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiveClusteringError = void 0;
exports.clusterLiveQuestionResponses = clusterLiveQuestionResponses;
const openai_json_1 = require("@/lib/ai/openai-json");
const cluster_guardrail_1 = require("@/lib/ai/cluster-guardrail");
function clampClusterCount(count) {
    if (count < 1)
        return 1;
    if (count > 5)
        return 5;
    return count;
}
function safeLabel(text, index) {
    const trimmed = String(text || '').trim();
    return trimmed || `Cluster ${index + 1}`;
}
function safeSummary(text) {
    const trimmed = String(text || '').trim();
    return trimmed || 'Students in this cluster used a similar line of reasoning.';
}
function normalizeAnswer(answer) {
    return String(answer || '')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ');
}
function normalizeBareText(answer) {
    return String(answer || '')
        .trim()
        .toLowerCase()
        .replace(/[’‘]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[。！？!?.,，、；;:：]+$/g, '')
        .replace(/\s+/g, ' ');
}
function classifyBareAnswer(answer) {
    const normalized = normalizeBareText(answer);
    if (!normalized)
        return { bare: false, bare_answer_kind: null };
    const compact = normalized.replace(/\s+/g, '');
    const affirm = new Set([
        'yes',
        'y',
        'true',
        'correct',
        'right',
        'yeah',
        'yep',
        '是',
        '对',
        '正确',
        '對',
        '正確',
    ]);
    const reject = new Set([
        'no',
        'n',
        'false',
        'incorrect',
        'wrong',
        '不是',
        '不对',
        '不對',
        '错误',
        '錯誤',
        '否',
    ]);
    const uncertain = new Set([
        'idk',
        "i don't know",
        'i dont know',
        'i do not know',
        'dont know',
        "don't know",
        'not sure',
        'unsure',
        '不知道',
        '不确定',
        '不確定',
    ]);
    if (affirm.has(normalized) || affirm.has(compact))
        return { bare: true, bare_answer_kind: 'affirm' };
    if (reject.has(normalized) || reject.has(compact))
        return { bare: true, bare_answer_kind: 'reject' };
    if (uncertain.has(normalized) || uncertain.has(compact))
        return { bare: true, bare_answer_kind: 'uncertain' };
    return { bare: false, bare_answer_kind: null };
}
function summarizeAnswerStem(answer) {
    const normalized = normalizeAnswer(answer);
    if (!normalized)
        return 'Students expressed a similar idea with overlapping wording.';
    const words = normalized.split(' ').filter(Boolean).slice(0, 8);
    return words.length > 0
        ? `Students used similar wording around "${words.join(' ')}".`
        : 'Students expressed a similar idea with overlapping wording.';
}
function normalizeReferenceAlignment(raw) {
    if (!raw || typeof raw !== 'object')
        return undefined;
    const level = String(raw.alignment_level || raw.level || '').toLowerCase();
    const validLevel = level === 'strong' || level === 'partial' || level === 'limited' ? level : 'partial';
    const explanation = typeof raw.explanation === 'string' ? raw.explanation : '';
    const alignedIds = Array.isArray(raw.aligned_reference_ids)
        ? raw.aligned_reference_ids.map((id) => String(id || '')).filter(Boolean)
        : [];
    return {
        alignment_level: validLevel,
        explanation,
        aligned_reference_ids: alignedIds,
    };
}
function buildClusterFromResponses(label, summary, rows, index, rawReferenceAlignment) {
    const averageConfidence = rows.length > 0
        ? Number((rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length).toFixed(2))
        : 0;
    const refAlignment = normalizeReferenceAlignment(rawReferenceAlignment);
    const validated = (0, cluster_guardrail_1.validateNonEvaluativeCluster)({
        label: safeLabel(label, index),
        summary: safeSummary(summary),
        reference_alignment: refAlignment,
    });
    const representative = rows.slice(0, 3);
    const evidenceSpans = representative.map((row) => ({
        response_id: row.response_id,
        exact_quote: row.answer.slice(0, 150),
    }));
    return {
        cluster_id: `cluster_${index + 1}`,
        label: validated.label,
        summary: validated.summary,
        count: rows.length,
        average_confidence: averageConfidence,
        representative_answers: representative.map((row) => row.answer),
        response_ids: rows.map((row) => row.response_id),
        evidence_spans: evidenceSpans,
        reference_alignment: validated.reference_alignment,
        was_sanitized: validated.wasSanitized,
    };
}
function normalizeFinalClusters(clusters, responses, context = {}) {
    const responseMap = new Map(responses.map((response) => [response.response_id, response]));
    const assigned = new Set();
    const normalized = [];
    for (const cluster of clusters) {
        const rows = [];
        const localSeen = new Set();
        for (const rawId of Array.isArray(cluster.response_ids) ? cluster.response_ids : []) {
            const id = String(rawId || '').trim();
            if (!id || localSeen.has(id) || assigned.has(id))
                continue;
            const row = responseMap.get(id);
            if (!row)
                continue;
            localSeen.add(id);
            assigned.add(id);
            rows.push(row);
        }
        if (rows.length === 0)
            continue;
        normalized.push(buildClusterFromResponses(cluster.label, cluster.summary, rows, normalized.length, cluster.reference_alignment));
    }
    const unassignedRows = responses.filter((response) => !assigned.has(response.response_id));
    if (unassignedRows.length > 0) {
        console.warn('[live-clustering] final normalization found unassigned responses', {
            question_id: context.questionId,
            attempt_type: context.attemptType,
            unassigned_response_ids: unassignedRows.map((response) => response.response_id),
            unassigned_count: unassignedRows.length,
        });
        if (normalized.length === 0 || normalized.length < 5) {
            normalized.push(buildClusterFromResponses('Other response patterns', 'Responses that were not assigned by the model were grouped locally to preserve exact response coverage.', unassignedRows, normalized.length));
        }
        else {
            const smallestIndex = normalized.reduce((bestIndex, cluster, index, array) => {
                return cluster.count < array[bestIndex].count ? index : bestIndex;
            }, 0);
            const target = normalized[smallestIndex];
            const mergedRows = [...target.response_ids, ...unassignedRows.map((row) => row.response_id)]
                .map((id) => responseMap.get(id))
                .filter(Boolean);
            normalized[smallestIndex] = buildClusterFromResponses(target.label, target.summary, mergedRows, smallestIndex);
        }
    }
    if (normalized.length <= 5) {
        return normalized.map((cluster, index) => {
            const rows = cluster.response_ids.map((id) => responseMap.get(id)).filter(Boolean);
            return buildClusterFromResponses(cluster.label, cluster.summary, rows, index);
        });
    }
    console.warn('[live-clustering] final normalization merged overflow clusters', {
        question_id: context.questionId,
        attempt_type: context.attemptType,
        cluster_count_before_merge: normalized.length,
        overflow_count: normalized.length - 4,
    });
    const kept = normalized.slice(0, 4);
    const overflowRows = normalized
        .slice(4)
        .flatMap((cluster) => cluster.response_ids)
        .map((id) => responseMap.get(id))
        .filter(Boolean);
    const merged = [
        ...kept,
        buildClusterFromResponses('Other response patterns', 'Additional response groups were merged locally to keep the live view within five clusters.', overflowRows, 4),
    ];
    return merged.map((cluster, index) => {
        const rows = cluster.response_ids.map((id) => responseMap.get(id)).filter(Boolean);
        return buildClusterFromResponses(cluster.label, cluster.summary, rows, index);
    });
}
function validateClusterIntegrity(analysis, responses) {
    const expectedIds = new Set(responses.map((response) => response.response_id));
    const seen = new Set();
    const duplicateIds = new Set();
    const unknownIds = new Set();
    const countMismatches = [];
    let sumCount = 0;
    for (const cluster of analysis.clusters) {
        const ids = Array.isArray(cluster.response_ids) ? cluster.response_ids : [];
        if (cluster.count !== ids.length) {
            countMismatches.push({
                cluster_id: cluster.cluster_id,
                count: cluster.count,
                response_id_count: ids.length,
            });
        }
        sumCount += cluster.count;
        for (const rawId of ids) {
            const id = String(rawId || '').trim();
            if (!expectedIds.has(id))
                unknownIds.add(id);
            if (seen.has(id))
                duplicateIds.add(id);
            seen.add(id);
        }
    }
    const missingIds = [...expectedIds].filter((id) => !seen.has(id));
    const ok = analysis.total_responses === responses.length &&
        sumCount === responses.length &&
        seen.size === responses.length &&
        duplicateIds.size === 0 &&
        unknownIds.size === 0 &&
        missingIds.length === 0 &&
        countMismatches.length === 0;
    return {
        ok,
        sumCount,
        uniqueAssignedCount: seen.size,
        duplicateIds: [...duplicateIds],
        unknownIds: [...unknownIds],
        missingIds,
        countMismatches,
    };
}
function finalizeClusterAnalysis(analysis, responses, context = {}) {
    const normalizedClusters = normalizeFinalClusters(analysis.clusters, responses, context);
    const finalized = {
        ...analysis,
        total_responses: responses.length,
        cluster_count: normalizedClusters.length,
        clusters: normalizedClusters,
    };
    const validation = validateClusterIntegrity(finalized, responses);
    if (validation.ok)
        return finalized;
    console.error('[live-clustering] final cluster integrity validation failed; using deterministic fallback', {
        question_id: context.questionId,
        attempt_type: context.attemptType,
        total_responses: responses.length,
        cluster_count: finalized.cluster_count,
        sum_cluster_count: validation.sumCount,
        unique_assigned_count: validation.uniqueAssignedCount,
        duplicate_response_ids: validation.duplicateIds,
        unknown_response_ids: validation.unknownIds,
        missing_response_ids: validation.missingIds,
        count_mismatches: validation.countMismatches,
    });
    const fallback = buildFallbackClusters(responses, 'Cluster integrity validation failed after normalization; deterministic fallback used.');
    fallback.question_prompt = analysis.question_prompt;
    fallback.attempt_type = analysis.attempt_type;
    fallback.clusters = normalizeFinalClusters(postProcessBareAnswerClusters(fallback.clusters, responses), responses, context);
    fallback.total_responses = responses.length;
    fallback.cluster_count = fallback.clusters.length;
    return fallback;
}
function getBareClusterDescriptor(kind) {
    if (kind === 'uncertain') {
        return {
            label: 'Uncertain answer only - no reasoning given',
            summary: 'Students gave an answer-only response expressing uncertainty (e.g. "not sure", "idk") without explaining their thinking.',
        };
    }
    if (kind === 'affirm') {
        return {
            label: 'Affirmative answer only - no reasoning given',
            summary: 'Students gave a short affirmative answer (e.g. "yes"/"agree"/"true") without explaining their reasoning.',
        };
    }
    return {
        label: 'Negative answer only - no reasoning given',
        summary: 'Students gave a short negative answer (e.g. "no"/"disagree"/"false") without explaining their reasoning.',
    };
}
class LiveClusteringError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'LiveClusteringError';
        this.code = code;
    }
}
exports.LiveClusteringError = LiveClusteringError;
function sanitizeModelClusters(rawClusters, responses) {
    const responseMap = new Map(responses.map((response) => [response.response_id, response]));
    const assigned = new Set();
    const sanitized = [];
    for (const [index, cluster] of rawClusters.entries()) {
        const localSeen = new Set();
        const ids = Array.isArray(cluster?.response_ids)
            ? cluster.response_ids
                .map((value) => String(value || '').trim())
                .filter((value) => {
                if (!value || localSeen.has(value) || assigned.has(value) || !responseMap.has(value))
                    return false;
                localSeen.add(value);
                return true;
            })
            : [];
        if (ids.length === 0)
            continue;
        ids.forEach((id) => assigned.add(id));
        const rows = ids.map((id) => responseMap.get(id)).filter(Boolean);
        sanitized.push(buildClusterFromResponses(cluster?.label, cluster?.summary, rows, index, cluster?.reference_alignment));
    }
    const unassigned = responses.filter((response) => !assigned.has(response.response_id));
    if (unassigned.length > 0) {
        if (sanitized.length === 0)
            return [];
        console.warn('[live-clustering] model omitted response_ids; merging unassigned responses into an existing cluster', {
            omitted_response_ids: unassigned.map((response) => response.response_id),
            omitted_count: unassigned.length,
            cluster_count_before_merge: sanitized.length,
        });
        const targetIndex = sanitized.reduce((bestIndex, cluster, index, array) => {
            return cluster.count < array[bestIndex].count ? index : bestIndex;
        }, 0);
        const target = sanitized[targetIndex];
        const mergedRows = [...target.response_ids, ...unassigned.map((row) => row.response_id)]
            .map((id) => responseMap.get(id))
            .filter(Boolean);
        sanitized[targetIndex] = buildClusterFromResponses(target.label, target.summary, mergedRows, targetIndex, target.reference_alignment);
    }
    if (sanitized.length <= 5)
        return sanitized;
    console.warn('[live-clustering] model returned more than 5 clusters; merging overflow clusters', {
        cluster_count_before_merge: sanitized.length,
        overflow_count: sanitized.length - 4,
    });
    const kept = sanitized.slice(0, 4);
    const overflowRows = sanitized
        .slice(4)
        .flatMap((cluster) => cluster.response_ids)
        .map((id) => responseMap.get(id))
        .filter(Boolean);
    kept.push(buildClusterFromResponses('Additional response patterns', 'The model returned more than five clusters, so smaller overflow groups were merged to preserve every response.', overflowRows, 4));
    return kept;
}
function getBareClusterKey(response) {
    return response.bare_answer_kind || 'uncertain';
}
function postProcessBareAnswerClusters(clusters, responses) {
    const responseMap = new Map(responses.map((response) => [response.response_id, response]));
    const processed = [];
    for (const cluster of clusters) {
        const rows = cluster.response_ids
            .map((id) => responseMap.get(id))
            .filter(Boolean);
        const bareRows = rows.filter((row) => row.bare);
        const explainedRows = rows.filter((row) => !row.bare);
        if (explainedRows.length > 0) {
            processed.push(buildClusterFromResponses(cluster.label, cluster.summary, explainedRows, processed.length));
        }
        const groupedBareRows = new Map();
        for (const row of bareRows) {
            const key = getBareClusterKey(row);
            groupedBareRows.set(key, [...(groupedBareRows.get(key) || []), row]);
        }
        for (const key of ['affirm', 'reject', 'uncertain']) {
            const groupRows = groupedBareRows.get(key);
            if (!groupRows || groupRows.length === 0)
                continue;
            const descriptor = getBareClusterDescriptor(key);
            processed.push(buildClusterFromResponses(descriptor.label, descriptor.summary, groupRows, processed.length));
        }
    }
    return validateExactResponseCoverage(processed, responses);
}
function validateExactResponseCoverage(clusters, responses) {
    const expectedIds = new Set(responses.map((response) => response.response_id));
    const seen = new Set();
    const duplicateIds = new Set();
    for (const cluster of clusters) {
        for (const id of cluster.response_ids) {
            if (seen.has(id))
                duplicateIds.add(id);
            seen.add(id);
        }
    }
    const missingIds = [...expectedIds].filter((id) => !seen.has(id));
    const unknownIds = [...seen].filter((id) => !expectedIds.has(id));
    if (missingIds.length > 0 || duplicateIds.size > 0 || unknownIds.length > 0) {
        console.warn('[live-clustering] local cluster coverage repair needed', {
            missing_response_ids: missingIds,
            duplicate_response_ids: [...duplicateIds],
            unknown_response_ids: unknownIds,
        });
        const responseMap = new Map(responses.map((response) => [response.response_id, response]));
        const repaired = [];
        const assigned = new Set();
        for (const cluster of clusters) {
            const rows = cluster.response_ids
                .filter((id) => expectedIds.has(id) && !assigned.has(id))
                .map((id) => responseMap.get(id))
                .filter(Boolean);
            if (rows.length === 0)
                continue;
            rows.forEach((row) => assigned.add(row.response_id));
            repaired.push(buildClusterFromResponses(cluster.label, cluster.summary, rows, repaired.length));
        }
        const repairedMissingRows = responses.filter((response) => !assigned.has(response.response_id));
        if (repairedMissingRows.length > 0) {
            repaired.push(buildClusterFromResponses('Additional response patterns', 'Responses that were omitted during local validation were merged into a final catch-all group.', repairedMissingRows, repaired.length));
        }
        return repaired;
    }
    return clusters.map((cluster, index) => ({
        ...cluster,
        cluster_id: `cluster_${index + 1}`,
        count: cluster.response_ids.length,
    }));
}
function buildFallbackClusters(responses, fallbackReason, rawExcerpt) {
    const grouped = new Map();
    for (const response of responses) {
        const key = normalizeAnswer(response.answer) || response.response_id;
        const existing = grouped.get(key);
        if (existing) {
            existing.push(response);
        }
        else {
            grouped.set(key, [response]);
        }
    }
    const sortedGroups = Array.from(grouped.values()).sort((a, b) => {
        if (b.length !== a.length)
            return b.length - a.length;
        return b.reduce((sum, row) => sum + row.confidence, 0) - a.reduce((sum, row) => sum + row.confidence, 0);
    });
    const repeatedGroups = sortedGroups.filter((rows) => rows.length > 1);
    const singletonRows = sortedGroups.filter((rows) => rows.length === 1).flat();
    const fallbackGroups = [
        ...repeatedGroups,
        ...(singletonRows.length > 0 ? [singletonRows] : []),
    ];
    const targetClusterCount = responses.length === 1 ? 1 : clampClusterCount(fallbackGroups.length || 1);
    const limitedGroups = fallbackGroups.length <= targetClusterCount
        ? fallbackGroups
        : [
            ...fallbackGroups.slice(0, targetClusterCount - 1),
            fallbackGroups.slice(targetClusterCount - 1).flat(),
        ];
    const clusters = limitedGroups.map((rows, index) => {
        const isMergedOverflowGroup = fallbackGroups.length > targetClusterCount && index === limitedGroups.length - 1;
        const isSingletonFallbackGroup = rows.length > 1 && rows.every((row) => {
            return grouped.get(normalizeAnswer(row.answer) || row.response_id)?.length === 1;
        });
        const label = isMergedOverflowGroup
            ? 'Mixed response patterns'
            : isSingletonFallbackGroup
                ? 'Unclustered singleton responses'
                : `Similar response pattern ${index + 1}`;
        const summary = isMergedOverflowGroup
            ? 'Students gave varied answers that could not be separated further without AI clustering.'
            : isSingletonFallbackGroup
                ? 'AI clustering was unavailable, so singleton wording variants are grouped together rather than split into artificial clusters.'
                : summarizeAnswerStem(rows[0]?.answer || '');
        return buildClusterFromResponses(label, summary, rows, index);
    });
    return {
        version: 'live_question_clusters_v2',
        question_prompt: '',
        attempt_type: 'initial',
        total_responses: responses.length,
        cluster_count: clusters.length,
        source: 'fallback',
        fallback_reason: fallbackReason,
        fallback_debug: {
            error: fallbackReason,
            raw_excerpt: rawExcerpt ? rawExcerpt.slice(0, 280) : null,
        },
        clusters,
    };
}
async function clusterLiveQuestionResponses(input) {
    const cleanedResponses = input.responses
        .map((response) => {
        const answer = String(response.answer || '').trim();
        const bareClassification = classifyBareAnswer(answer);
        return {
            response_id: String(response.response_id),
            answer,
            confidence: Math.max(1, Math.min(5, Math.round(Number(response.confidence) || 0))),
            bare: bareClassification.bare,
            bare_answer_kind: bareClassification.bare_answer_kind,
        };
    })
        .filter((response) => response.response_id && response.answer);
    if (cleanedResponses.length === 0) {
        throw new LiveClusteringError('no_responses', 'No responses are available for this question attempt.');
    }
    const numberedResponses = cleanedResponses
        .map((response, index) => {
        return `${index + 1}. response_id=${response.response_id}\nconfidence=${response.confidence}\nbare=${response.bare}\nanswer=${response.answer}`;
    })
        .join('\n\n');
    const refAnswerFormatted = input.referenceAnswers && input.referenceAnswers.length > 0
        ? [
            'Reference answers / valid reasoning examples (topic context only — not an answer key, not for grading):',
            input.referenceAnswers.map((ref, idx) => `${idx + 1}. [reference_id=${ref.reference_id}] ${ref.answer_text}`).join('\n'),
        ].join('\n')
        : `Reference answer (topic context only — not an answer key, not for grading): \n${input.correctAnswer || ''}`;
    const result = await (0, openai_json_1.openaiChatJson)({
        maxTokens: 1600,
        timeoutMs: 100000,
        messages: [
            {
                role: 'system',
                content: [
                    'You cluster short student answers for one open-ended classroom question into 1 to 5 groups based strictly on shared UNDERLYING REASONING PATTERNS or CONCEPTUAL UNDERSTANDING — not by correctness, final answer, keywords, or surface wording.',
                    '',
                    'CORE CLUSTERING RULE:',
                    '• Two responses must NOT be placed in the same cluster merely because they reach the same conclusion or contain the same final answer. If they use materially different reasoning, causal explanations, interpretations of the mechanism, or conceptual models, they MUST be placed in different clusters.',
                    '• Conversely, two responses may remain in the same cluster even if one contains a minor factual error or different wording, provided that both demonstrate the same underlying reasoning approach.',
                    '',
                    'CLUSTERING PRINCIPLES:',
                    '1. REASONING TAKES PRIORITY OVER FINAL ANSWER: First identify how the student explains, justifies, or arrives at the answer. Do not use correctness or final answer output as the primary clustering criterion.',
                    '2. DO NOT MERGE DIFFERENT REASONING JUST BECAUSE CONCLUSION IS THE SAME: Example: two students may both propose "max = arr[0]", but if one explains the negative-value initialization problem while another believes changing the loop index is the underlying cause, they represent different reasoning patterns and MUST be placed in separate clusters.',
                    '3. DO NOT SPLIT SOLELY BECAUSE OF A MINOR ERROR: A small factual mistake or typo does not automatically create a new cluster when the student\'s underlying reasoning approach is otherwise the same. Split ONLY when the error reveals a materially different conceptual interpretation or reasoning approach.',
                    '4. SEPARATE MATERIALLY DIFFERENT CONCEPTUAL MODELS: If students explain the same code/concept using different causal mechanisms, interpretations, or mental models, keep them separate even when their final answers happen to match.',
                    '5. CORRECT AND INCORRECT RESPONSES CAN COEXIST IN THE SAME CLUSTER: Clustering is NOT correctness classification. Do NOT create clusters such as "correct", "incorrect", "right answers", "wrong answers", or "misconceptions". Correctness/reference alignment is represented separately in reference_alignment, NOT in cluster boundaries.',
                    '6. USE THE SMALLEST MEANINGFUL SET OF REASONING PATTERNS: Do not create a separate cluster for every minor surface variation. Merge responses when their underlying reasoning is substantially the same. Split when combining them would hide a meaningful difference in how students understand or reason about the question.',
                    '7. DO NOT INFER REASONING THAT IS NOT EXPRESSED: Base cluster assignments strictly on evidence present in the student\'s response. If the reasoning is too short or ambiguous to distinguish, use a neutral descriptive cluster rather than inventing an unexpressed interpretation.',
                    '',
                    'THE MERGE/SPLIT DECISION TEST:',
                    'For every proposed merge, ask: "If these two responses were shown to a lecturer, would placing them together hide a meaningful difference in how the students reasoned or understood the concept?" If YES, separate them. If NO, keep them together.',
                    '',
                    'NEUTRAL DESCRIPTIVE LABELS & STRICT PROHIBITED WORDS:',
                    'Cluster labels and summaries must describe the observed reasoning pattern neutrally.',
                    '• STRICTLY FORBIDDEN WORDS in labels, summaries, and alignment explanations: "correct", "correctly", "incorrect", "incorrectly", "wrong", "right", "misconception", "error", "errors", "flawed", "accurate", "inaccurate", "good", "bad".',
                    '• Replace "correctly identifies X" with "identifies X" or "proposes X".',
                    '• Replace "contains errors in loop" with "modifies loop boundary" or "adjusts loop condition".',
                    '• Describe WHAT students stated or did using purely descriptive, non-evaluative language.',
                    '',
                    'REFERENCE ANSWERS:',
                    'Reference answers provide contextual grounding only — they MUST NOT determine cluster boundaries. First identify student reasoning patterns; assess reference alignment separately afterward.',
                    '',
                    'Return concise JSON only. Use classroom-safe, neutral language.',
                ].join('\n'),
            },
            {
                role: 'user',
                content: [
                    `Question id: ${input.questionId}`,
                    `Question position: ${input.questionPosition}`,
                    `Question prompt:\n${input.questionPrompt}`,
                    refAnswerFormatted,
                    `Lesson concept (topic context only):\n${input.lessonContext?.lesson_concept || ''}`,
                    `Attempt type: ${input.attemptType}`,
                    'Student responses:',
                    numberedResponses,
                    'Return JSON with this shape:',
                    JSON.stringify({
                        clusters: [
                            {
                                cluster_id: 'cluster_1',
                                label: 'neutral description of the shared reasoning pattern or approach',
                                summary: 'one-sentence neutral description of what students in this cluster said',
                                reference_alignment: {
                                    aligned_reference_ids: ['reference_id_1'],
                                    alignment_level: 'strong',
                                    explanation: 'one neutral sentence describing conceptual overlap with reference reasoning examples',
                                },
                                response_ids: ['...'],
                            },
                        ],
                    }, null, 2),
                    'Rules:',
                    '- Every response_id must appear in exactly one cluster.',
                    '- Cluster strictly by underlying reasoning pattern and conceptual model — NEVER by correctness or final answer match.',
                    '- Do NOT merge responses with different reasoning just because their final conclusion/answer matches.',
                    '- Do NOT split responses with the same reasoning model merely because of minor factual typos or errors.',
                    '- Correct and incorrect responses can coexist in the same cluster if they share the underlying reasoning pattern.',
                    '- Ask for every proposed merge: "If shown to a lecturer, would placing these together hide a meaningful difference in how students reasoned?" If yes, separate; if no, keep together.',
                    '- Always include the exact response_ids in each cluster matching the response_id field of each input response.',
                    '- label = short neutral name of the shared reasoning pattern or concept. No True/False/Correct/Incorrect/Misconception wording or prefix.',
                    '- summary = one neutral sentence describing what students in the cluster said or did. Never state or imply whether it is right, wrong, or a misconception.',
                    '- reference_alignment.alignment_level must be "strong", "partial", or "limited". Never use evaluative terms like "correct", "wrong", or "misconception".',
                    '- Do not judge correctness, identify misconceptions, infer learning outcomes, or recommend teaching actions anywhere in a label, summary, or alignment explanation.',
                    '- Responses marked bare=true contain no reasoning. Always place them in a separate cluster from explained responses. Do not split bare responses further by confidence.',
                    '- Treat reference answers as topic context only, never as an answer key for grading or defining cluster boundaries.',
                ].join('\n\n'),
            },
        ],
    });
    if (!result.ok) {
        const fallbackReason = typeof result.error === 'string' && result.error.trim()
            ? result.error
            : 'OpenAI clustering request failed.';
        console.error('[live-clustering] openai failure:', fallbackReason);
        const fallback = buildFallbackClusters(cleanedResponses, fallbackReason, result.rawText || null);
        fallback.question_prompt = input.questionPrompt;
        fallback.attempt_type = input.attemptType;
        fallback.clusters = postProcessBareAnswerClusters(fallback.clusters, cleanedResponses);
        fallback.cluster_count = fallback.clusters.length;
        return finalizeClusterAnalysis(fallback, cleanedResponses, {
            questionId: input.questionId,
            attemptType: input.attemptType,
        });
    }
    let rawClusters = Array.isArray(result.json?.clusters) ? result.json.clusters : [];
    const initialGuardrailCheck = (0, cluster_guardrail_1.validateClusterSet)(rawClusters);
    // GUARDRAIL RE-PROMPT RETRY LOOP
    if (!initialGuardrailCheck.ok) {
        const prohibitedMatches = Array.from(new Set(initialGuardrailCheck.violations.flatMap((v) => v.prohibitedMatches)));
        console.warn('[live-clustering] guardrail validation failed; initiating LLM re-prompt', {
            prohibitedMatches,
            questionId: input.questionId,
        });
        const retryResult = await (0, openai_json_1.openaiChatJson)({
            maxTokens: 1600,
            timeoutMs: 100000,
            messages: [
                {
                    role: 'system',
                    content: `You cluster short student answers for one open-ended classroom question into 1 to 5 groups based on shared reasoning pattern or approach.\n\nCRITICAL FIX REQUIRED: Your previous response was REJECTED because it contained prohibited evaluative words: [${prohibitedMatches.join(', ')}]. You must describe WHAT students said without judging correctness, calling anything wrong or a misconception, or diagnosing misunderstandings. Use purely neutral, descriptive classroom language.`,
                },
                {
                    role: 'user',
                    content: [
                        `Question id: ${input.questionId}`,
                        `Question prompt:\n${input.questionPrompt}`,
                        'Student responses:',
                        numberedResponses,
                        'Return valid JSON only matching the schema.',
                    ].join('\n\n'),
                },
            ],
        });
        if (retryResult.ok && Array.isArray(retryResult.json?.clusters)) {
            const retryGuardrailCheck = (0, cluster_guardrail_1.validateClusterSet)(retryResult.json.clusters);
            if (retryGuardrailCheck.ok) {
                console.info('[live-clustering] guardrail re-prompt succeeded neutrally');
                rawClusters = retryResult.json.clusters;
            }
            else {
                console.error('[live-clustering] guardrail re-prompt failed second validation; falling back to deterministic neutral clusters');
                const fallback = buildFallbackClusters(cleanedResponses, 'Guardrail validation failed after re-prompting; deterministic neutral fallback used.', retryResult.rawText || null);
                fallback.question_prompt = input.questionPrompt;
                fallback.attempt_type = input.attemptType;
                fallback.clusters = postProcessBareAnswerClusters(fallback.clusters, cleanedResponses);
                fallback.cluster_count = fallback.clusters.length;
                return finalizeClusterAnalysis(fallback, cleanedResponses, {
                    questionId: input.questionId,
                    attemptType: input.attemptType,
                });
            }
        }
    }
    const clusters = postProcessBareAnswerClusters(sanitizeModelClusters(rawClusters, cleanedResponses), cleanedResponses);
    if (clusters.length === 0) {
        const fallbackReason = 'OpenAI returned cluster JSON, but it could not be mapped to the submitted responses.';
        const fallback = buildFallbackClusters(cleanedResponses, fallbackReason, result.rawText || null);
        fallback.question_prompt = input.questionPrompt;
        fallback.attempt_type = input.attemptType;
        fallback.clusters = postProcessBareAnswerClusters(fallback.clusters, cleanedResponses);
        fallback.cluster_count = fallback.clusters.length;
        return finalizeClusterAnalysis(fallback, cleanedResponses, {
            questionId: input.questionId,
            attemptType: input.attemptType,
        });
    }
    return finalizeClusterAnalysis({
        version: 'live_question_clusters_v2',
        question_prompt: input.questionPrompt,
        attempt_type: input.attemptType,
        total_responses: cleanedResponses.length,
        cluster_count: clusters.length,
        source: 'openai',
        fallback_reason: null,
        fallback_debug: null,
        clusters,
    }, cleanedResponses, {
        questionId: input.questionId,
        attemptType: input.attemptType,
    });
}
