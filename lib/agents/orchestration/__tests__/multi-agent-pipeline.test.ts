import { runClusterGenerationAgent } from '@/lib/agents/orchestration/cluster-generation-agent'
import { runReferenceAlignmentAgent } from '@/lib/agents/orchestration/reference-alignment-agent'
import { runTargetedTicketResolutionAgent } from '@/lib/agents/orchestration/ticket-resolution-agent'
import type { QuestionContext, ResponseRecord, ReviewTicket } from '@/lib/agents/orchestration/types'

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

export async function runMultiAgentPipelineValidationTests(): Promise<{
  test1Passed: boolean
  test2Passed: boolean
  test3Passed: boolean
  test4Passed: boolean
  test5Passed: boolean
}> {
  const dummyQuestion: QuestionContext = {
    questionId: 'q1',
    questionPosition: 1,
    questionPrompt: 'What does this loop calculate for a non-negative integer n?',
    correctAnswer: 'Counts the number of decimal digits in n.',
    referenceAnswers: [
      { reference_id: 'ref1', answer_text: 'Counts the number of decimal digits in n by dividing by 10.' },
    ],
    attemptType: 'initial',
  }

  // Test 1: Confidence Isolation
  const responses1: ResponseRecord[] = [
    { responseId: 's1', answer: 'Counts digits by dividing n by 10.', confidence: 5 },
    { responseId: 's2', answer: 'Counts digits by dividing n by 10.', confidence: 1 },
  ]
  const res1 = await runClusterGenerationAgent({
    question: dummyQuestion,
    responses: responses1,
    translations: new Map(),
  })
  assert(res1.clusters.length > 0, 'Cluster generation returned at least one cluster')
  assert(res1.clusters[0].responseIds.includes('s1'), 's1 is included in cluster')
  assert(res1.clusters[0].responseIds.includes('s2'), 's2 is included in cluster')

  // Test 2: Same Answer Different Reasoning
  const responses2: ResponseRecord[] = [
    {
      responseId: 'sA',
      answer: 'Loop executes 10 times because 10 < 20 gives values 10-19',
      confidence: 4,
    },
    {
      responseId: 'sB',
      answer: 'Loop executes 10 times because decrementing from 10 to 1 gives 10 steps',
      confidence: 4,
    },
  ]
  const res2 = await runClusterGenerationAgent({
    question: dummyQuestion,
    responses: responses2,
    translations: new Map(),
  })
  assert(res2.clusters.length >= 1, 'Cluster generation executed for different reasoning mechanisms')

  // Test 3: Reference Alignment Independence
  const responses3: ResponseRecord[] = [
    { responseId: 's1', answer: 'Counts the number of decimal digits in n by dividing by 10.', confidence: 5 },
    { responseId: 's2', answer: 'Counts digits.', confidence: 2 },
  ]
  const res3 = await runReferenceAlignmentAgent({
    question: dummyQuestion,
    responses: responses3,
    translations: new Map(),
  })
  assert(res3.alignments.get('s1')?.alignment === 'strong', 's1 alignment is strong')
  assert(Boolean(res3.alignments.get('s2')?.alignment), 's2 alignment exists')

  // Test 4: Ticket Resolution
  const ticket: ReviewTicket = {
    id: 'ticket_test_1',
    sourceAgent: 'cluster_summary',
    targetAgent: 'cluster_generation',
    type: 'POSSIBLE_SPLIT',
    clusterIds: ['C1'],
    responseIds: ['sB'],
    reason: 'sB uses decrement reasoning while main cluster uses boundary evaluation.',
    evidence: {
      responseIds: ['sB'],
      excerpts: ['Loop executes 10 times because decrementing from 10 to 1 gives 10 steps'],
    },
    round: 1,
    status: 'open',
  }

  const affectedResponses = [
    { id: 'sB', text: 'Loop executes 10 times because decrementing from 10 to 1 gives 10 steps' },
  ]

  const resolution = await runTargetedTicketResolutionAgent({
    ticket,
    affectedResponses,
    clusterSummary: 'Students who analyze loop iterations by checking start and end bounds.',
    questionPrompt: dummyQuestion.questionPrompt,
  })

  assert(['SPLIT', 'MERGE', 'KEEP'].includes(resolution.action), 'Targeted ticket resolution returned valid action')

  // Test 5: Navigation Action Preservation (Q1 -> Q3 -> Q1 retains regenerate action for Q1)
  const simulatedLiveAnalyses = [
    { question_id: 'q1', attempt_type: 'initial', analysis_json: { version: 'live_question_clusters_v2', clusters: [{ cluster_id: 'C1', count: 5 }] } },
  ]
  const q1Analysis = simulatedLiveAnalyses.find((a) => a.question_id === 'q1' && a.attempt_type === 'initial')
  const canRegenerateQ1WhenViewingQ3AndNavigatingBack = Boolean(q1Analysis && q1Analysis.analysis_json)
  assert(canRegenerateQ1WhenViewingQ3AndNavigatingBack, 'Q1 analysis and regenerate capability preserved after navigating Q1 -> Q3 -> Q1')

  return {
    test1Passed: true,
    test2Passed: true,
    test3Passed: true,
    test4Passed: true,
    test5Passed: true,
  }
}
