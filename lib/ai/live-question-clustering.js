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
                    'You cluster short student answers for one open-ended classroom question into 1 to 5 groups based on shared reasoning pattern or approach.',
                    '',
                    'Your only job is grouping and describing what students said, not grading it.',
                    'Group responses by the underlying idea, approach, or reasoning pattern students are using — never by whether that idea is correct.',
                    '',
                    'Do not judge correctness, identify misconceptions, infer learning outcomes, or recommend teaching actions.',
                    'Do not label, score, or categorize any response or cluster as correct, incorrect, a misconception, or a level of understanding.',
                    'Do not use words like "correct", "incorrect", "wrong", "misconception", "error", "should", or "misunderstand" in a label or summary.',
                    '',
                    'Important: this question may have multiple teacher-provided reference answers / reasoning examples, but the question is open-ended.',
                    'Students typed free text. Use the reference answers only as topic context to understand what the question is about — never to grade, rank, or flag any response.',
                    'For each cluster, include a reference_alignment object with aligned_reference_ids, alignment_level ("strong", "partial", or "limited"), and a short neutral explanation of conceptual overlap.',
                    '',
                    'Prefer fewer, broader clusters. False splits are worse than broad clusters for this live teacher dashboard.',
                    'When unsure whether two responses are meaningfully different, merge them.',
                    '',
                    'Do not split by language, wording, confidence, answer length, writing quality, or minor detail differences.',
                    'Do not create separate clusters just because one answer is more detailed or polished than another.',
                    '',
                    'Only separate responses when they describe a meaningfully different idea or approach — a distinction a teacher would want to see as a different group of student thinking, not a difference in how good or complete the answer is.',
                    '',
                    'After assigning response_ids to clusters, write a short neutral label and one-sentence summary for each cluster that describes what students in that cluster said or did.',
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
                                label: 'neutral description of the shared idea or approach',
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
                    '- Use 1 to 5 clusters. Use 1 cluster when responses are conceptually homogeneous.',
                    '- If there are fewer than 4 responses, use 1–2 clusters unless there is a clearly different idea or approach.',
                    '- Prefer fewer broader clusters. Merge when in doubt.',
                    '- Separate clusters only when the difference is one a teacher would want to see as a distinct group of student thinking, not a difference in correctness or quality.',
                    '- Always merge responses that express the same underlying idea in different words or languages.',
                    '- Treat equivalent phrasings as one cluster: e.g. "postorder", "after all neighbors processed", "after descendants", "after recursive calls finish", "reverse topological order" may all express the same idea in different words — merge them if they describe the same thing.',
                    '- Do not split by: language, wording, answer length, confidence, or writing quality.',
                    '- Confidence is context for the teacher summary only. Do not use confidence as a reason to create separate clusters.',
                    '- label = short neutral name of the idea or approach. No True/False/Correct/Incorrect/Misconception wording or prefix.',
                    '- summary = one neutral sentence describing what students in the cluster said or did. Never state or imply whether it is right, wrong, or a misconception.',
                    '- reference_alignment.alignment_level must be "strong", "partial", or "limited". Never use evaluative terms like "correct", "wrong", or "misconception".',
                    '- Do not judge correctness, identify misconceptions, infer learning outcomes, or recommend teaching actions anywhere in a label, summary, or alignment explanation.',
                    '- Responses marked bare=true contain no reasoning. Always place them in a separate cluster from explained responses. Do not split bare responses further by confidence.',
                    '- Treat the reference answers as topic context only, never as an answer key for grading responses.',
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
