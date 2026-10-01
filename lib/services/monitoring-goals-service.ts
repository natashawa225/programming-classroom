import { createAdminClient } from '@/lib/supabase/server'

export type HistoricalEvidenceItem = {
  sessionId: string
  sessionCode: string
  sessionDate: string
  topicDomain: string
  questionId: string
  questionPosition: number
  questionPrompt: string
  clusterId: string
  clusterLabel: string
  clusterDescription: string
  prevalenceCount: number
  totalResponses: number
  prevalencePercentage: number
  analysisRunId: string
  evidenceQuotes: Array<{ response_id: string; exact_quote: string }>
  sampleResponses: Array<{ response_id: string; answer: string; explanation?: string; confidence?: number }>
  observedPatternNote: string
}

export type CandidateMonitoringGoal = {
  candidateKey: string
  title: string
  description: string
  pedagogicalRationale: string
  evidenceItems: HistoricalEvidenceItem[]
}

export type MonitoringGoal = {
  id: string
  teacherId: string
  courseId: string
  candidateKey: string
  title: string
  description: string
  status: 'active' | 'paused' | 'completed'
  originType: 'historical_evidence' | 'manual_creation'
  originSessionId: string | null
  originQuestionId: string | null
  evidenceSummary: Record<string, any>
  createdAt: string
  updatedAt: string
}

// In-memory fallback store for robust local dev when DB table is not pre-migrated
const memoryGoalsStore: MonitoringGoal[] = []

export function getCandidateMonitoringGoals(): CandidateMonitoringGoal[] {
  return [
    {
      candidateKey: 'explanation_depth',
      title: 'Explanation depth',
      description: 'Monitor when students provide a conclusion or output without explaining the reasoning or mechanism behind it.',
      pedagogicalRationale: 'Tracks student tendency to state final answers without demonstrating step-by-step conceptual derivation.',
      evidenceItems: [
        {
          sessionId: 'd0fc9938-6ee5-452d-b5de-4d87aedc145f',
          sessionCode: '9U69QQ',
          sessionDate: '2026-05-25',
          topicDomain: 'Hash Tables & Chaining',
          questionId: 'cabe1607-1ccc-4c3b-a938-32ce499898bb',
          questionPosition: 3,
          questionPrompt: 'There is a hash table with separate chaining as collusion resolution strategy. What happens when inserting a duplicate key?',
          clusterId: 'cluster_chaining_dup_1',
          clusterLabel: 'No change because element already exists',
          clusterDescription: 'Students state that the table stays the same or nothing happens without explaining the key search mechanism in the bucket linked list.',
          prevalenceCount: 10,
          totalResponses: 13,
          prevalencePercentage: 76.9,
          analysisRunId: '8fff4a4c-1bfd-411d-8f1b-16ab1b9df65c',
          evidenceQuotes: [
            { response_id: 'r_9u69_q3_1', exact_quote: 'do nothing' },
            { response_id: 'r_9u69_q3_2', exact_quote: 'STAY SAME AS PRIVOUS ONE' },
            { response_id: 'r_9u69_q3_3', exact_quote: '维持原状' },
          ],
          sampleResponses: [
            { response_id: 'r_9u69_q3_1', answer: 'do nothing', confidence: 2 },
            { response_id: 'r_9u69_q3_2', answer: 'STAY SAME AS PRIVOUS ONE', confidence: 3 },
            { response_id: 'r_9u69_q3_3', answer: '维持原状', confidence: 3 },
          ],
          observedPatternNote: '76.9% of responses state the final status ("do nothing" or "remains same") without detailing the hash bucket traversal or equals() comparison.',
        },
        {
          sessionId: '1245452b-637c-4489-ab15-9daddd268bff',
          sessionCode: 'UZM63P',
          sessionDate: '2026-05-26',
          topicDomain: 'Hash Tables & Chaining',
          questionId: '508074c9-c87d-42c6-bdb2-e4f02b23b54d',
          questionPosition: 3,
          questionPrompt: 'There is a hash table with separate chaining as collusion resolution strategy. Describe duplicate insertion behavior.',
          clusterId: 'cluster_chaining_dup_2',
          clusterLabel: 'Bare response without explanation',
          clusterDescription: 'Students state that no change will occur without articulating key equality verification.',
          prevalenceCount: 7,
          totalResponses: 14,
          prevalencePercentage: 50.0,
          analysisRunId: 'cd3c864b-85f0-46b4-b9d6-13df0d48d51a',
          evidenceQuotes: [
            { response_id: 'r_uzm_q3_1', exact_quote: "nothing will happen,it won't add element" },
            { response_id: 'r_uzm_q3_2', exact_quote: '不会有任何事情发生，还是一样的' },
          ],
          sampleResponses: [
            { response_id: 'r_uzm_q3_1', answer: "nothing will happen,it won't add element", confidence: 2 },
            { response_id: 'r_uzm_q3_2', answer: '不会有任何事情发生，还是一样的', confidence: 3 },
          ],
          observedPatternNote: '50.0% of responses state that nothing changes without explaining how the algorithm verifies existing entries.',
        },
        {
          sessionId: '1245452b-637c-4489-ab15-9daddd268bff',
          sessionCode: 'UZM63P',
          sessionDate: '2026-05-26',
          topicDomain: 'Hash Table Resizing',
          questionId: 'e04dfd2d-f7fe-4961-9bc4-88301b1d2367',
          questionPosition: 5,
          questionPrompt: 'We implement hash table resizing to achieve constant time average operations. Which bucket is assigned?',
          clusterId: 'cluster_resizing_bucket',
          clusterLabel: 'correct bucket calculation using modulus',
          clusterDescription: 'Students output the bucket index ("bucket 4") without showing the rehashing or modulus arithmetic step.',
          prevalenceCount: 8,
          totalResponses: 19,
          prevalencePercentage: 42.1,
          analysisRunId: '7f6bbec8-d808-40bf-b8b4-6b2e59d9f4c5',
          evidenceQuotes: [
            { response_id: 'r_uzm_q5_1', exact_quote: '放在bucket4' },
            { response_id: 'r_uzm_q5_2', exact_quote: 'put in the fourth bucket' },
          ],
          sampleResponses: [
            { response_id: 'r_uzm_q5_1', answer: '放在bucket4', confidence: 4 },
            { response_id: 'r_uzm_q5_2', answer: 'put in the fourth bucket', confidence: 4 },
          ],
          observedPatternNote: '42.1% of responses state "bucket 4" without providing the 20 % 8 calculation.',
        },
      ],
    },
    {
      candidateKey: 'examples_vs_principles',
      title: 'General reasoning vs. specific examples',
      description: 'Monitor whether students explain algorithmic behaviour using general principles or primarily through individual examples.',
      pedagogicalRationale: 'Observes whether students rely on plugging in specific numbers rather than stating algebraic or architectural invariants.',
      evidenceItems: [
        {
          sessionId: 'd0fc9938-6ee5-452d-b5de-4d87aedc145f',
          sessionCode: '9U69QQ',
          sessionDate: '2026-05-25',
          topicDomain: 'Hash Tables & Modulus Hashing',
          questionId: '14b6ece8-7116-4ad4-97ff-8919cbf202b6',
          questionPosition: 4,
          questionPrompt: 'We reduce the number of buckets of the hash table, and use modulus of hash code. Why does collision occur?',
          clusterId: 'cluster_modulus_ex_1',
          clusterLabel: 'modulus causes same bucket index',
          clusterDescription: 'Students explain collision by writing out specific modulo calculations (1598 % 10 = 8 and 3328 % 10 = 8).',
          prevalenceCount: 12,
          totalResponses: 13,
          prevalencePercentage: 92.3,
          analysisRunId: '5f4bacd2-842b-4840-92b2-37555e67f300',
          evidenceQuotes: [
            { response_id: 'r_9u69_q4_1', exact_quote: 'hash code both end with 8,after%10 they have a same bucket number' },
            { response_id: 'r_9u69_q4_2', exact_quote: 'both hash codes 1598 and 3328 yield the same remainder (8)' },
          ],
          sampleResponses: [
            { response_id: 'r_9u69_q4_1', answer: 'hash code both end with 8,after%10 they have a same bucket number', confidence: 3 },
            { response_id: 'r_9u69_q4_2', answer: 'The collision occurs because both hash codes 1598 and 3328 yield the same remainder (8) when divide', confidence: 3 },
          ],
          observedPatternNote: '92.3% of responses demonstrate collision using the specific pair (1598, 3328) rather than general modular congruence principles.',
        },
        {
          sessionId: '1245452b-637c-4489-ab15-9daddd268bff',
          sessionCode: 'UZM63P',
          sessionDate: '2026-05-26',
          topicDomain: 'Hash Tables & Modulus Hashing',
          questionId: '8e023465-38b1-4a3a-9b40-8f86bfdd511f',
          questionPosition: 4,
          questionPrompt: 'We reduce the number of buckets of the hash table, and use modulus of hash code. Why does collision occur?',
          clusterId: 'cluster_modulus_ex_2',
          clusterLabel: 'modulus causes same bucket index',
          clusterDescription: 'Students evaluate individual key outputs (1598 % 10 = 8 and 3328 % 10 = 8) to explain collision behavior.',
          prevalenceCount: 5,
          totalResponses: 18,
          prevalencePercentage: 27.8,
          analysisRunId: '1ae3af0a-9227-481d-b717-94c782aec3e7',
          evidenceQuotes: [
            { response_id: 'r_uzm_q4_1', exact_quote: 'bee: 1598 % 10 = 8 dog: 3328 % 10 = 8' },
            { response_id: 'r_uzm_q4_2', exact_quote: '1598 and 3328 have same result after modulus' },
          ],
          sampleResponses: [
            { response_id: 'r_uzm_q4_1', answer: 'Both keys hash to the same bucket index when you apply the modulus operation: bee: 1598 % 10 = 8 dog: 3328 % 10 = 8', confidence: 3 },
            { response_id: 'r_uzm_q4_2', answer: '1598 and 3328 have same result after modulus', confidence: 2 },
          ],
          observedPatternNote: '27.8% of responses rely on explicit arithmetic calculations for key values 1598 and 3328.',
        },
      ],
    },
    {
      candidateKey: 'confidence_and_reasoning_variation',
      title: 'Confidence and reasoning variation',
      description: 'Monitor cases where students express high confidence while providing substantially different levels or forms of reasoning.',
      pedagogicalRationale: 'Identifies variations in metacognition where students hold high self-reported confidence across diverse explanation patterns.',
      evidenceItems: [
        {
          sessionId: '3d614eea-5d84-457d-b2d7-bd6ca0871c21',
          sessionCode: '3EBMDN',
          sessionDate: '2026-05-11',
          topicDomain: 'Union-Find & Graph Connectivity',
          questionId: 'c97c6f01-aad9-4561-91d9-e4cbc698aa62',
          questionPosition: 1,
          questionPrompt: 'Can we just use the Union-Find data structure to answer constant-time connectivity queries in graphs?',
          clusterId: 'cluster_uf_confidence',
          clusterLabel: 'Union-Find constant time applicability',
          clusterDescription: 'Students express high confidence (Confidence 4-5) while presenting contrasting reasoning regarding graph type requirements.',
          prevalenceCount: 18,
          totalResponses: 37,
          prevalencePercentage: 48.6,
          analysisRunId: '1e330a6b-f4bd-4e94-81ee-9896ce1909a3',
          evidenceQuotes: [
            { response_id: 'r_3eb_q1_1', exact_quote: 'Union-Find provides constant time query after path compression' },
            { response_id: 'r_3eb_q1_2', exact_quote: 'Union-Find is for dynamic connectivity in undirected graphs' },
          ],
          sampleResponses: [
            { response_id: 'r_3eb_q1_1', answer: 'Yes. Union-Find provides constant time query after path compression', confidence: 5 },
            { response_id: 'r_3eb_q1_2', answer: 'No because Union-Find is for dynamic connectivity', confidence: 4 },
          ],
          observedPatternNote: 'High confidence ratings (4–5/5) accompany diverse reasoning models regarding Union-Find assumptions.',
        },
        {
          sessionId: 'd0fc9938-6ee5-452d-b5de-4d87aedc145f',
          sessionCode: '9U69QQ',
          sessionDate: '2026-05-25',
          topicDomain: 'Hash Tables & Search Key Types',
          questionId: '789a1985-35f8-4dfa-999e-a549e59356fa',
          questionPosition: 1,
          questionPrompt: 'Do you agree or disagree: "Using BSTs or Red-Black Trees, we can store and search people\'s data with face images as keys"',
          clusterId: 'cluster_face_keys',
          clusterLabel: 'Face images as BST keys',
          clusterDescription: 'High confidence responses (Confidence 4-5) with varying forms of reasoning regarding total ordering capabilities.',
          prevalenceCount: 13,
          totalResponses: 13,
          prevalencePercentage: 100.0,
          analysisRunId: '789a1985-35f8-4dfa-999e-a549e59356fa',
          evidenceQuotes: [
            { response_id: 'r_9u69_q1_1', exact_quote: 'Disagree BSTs and Red-Black tree only rely on total ordering among keys.' },
            { response_id: 'r_9u69_q1_2', exact_quote: 'Agree. Face images can be converted to file size or pixel values.' },
          ],
          sampleResponses: [
            { response_id: 'r_9u69_q1_1', answer: 'Disagree BSTs and Red-Black tree only rely on total ordering among keys. Face images are not comparable.', confidence: 5 },
            { response_id: 'r_9u69_q1_2', answer: 'Agree. Face image file size can be compared.', confidence: 4 },
          ],
          observedPatternNote: '100% of students express high confidence (4–5) while split on key total-ordering prerequisites.',
        },
      ],
    },
  ]
}

export async function getMonitoringGoals(teacherId = 'default_teacher'): Promise<MonitoringGoal[]> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('monitoring_goals')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      // Handle missing table gracefully in local environment
      if (error.code === 'PGRST205' || error.message?.includes('does not exist')) {
        return memoryGoalsStore.filter((g) => g.teacherId === teacherId || teacherId === 'default_teacher')
      }
      console.warn('Error fetching monitoring_goals from DB:', error.message)
      return memoryGoalsStore
    }

    if (!data || data.length === 0) {
      return memoryGoalsStore
    }

    return data.map((row: any) => ({
      id: row.id,
      teacherId: row.teacher_id,
      courseId: row.course_id,
      candidateKey: row.candidate_key,
      title: row.title,
      description: row.description,
      status: row.status,
      originType: row.origin_type,
      originSessionId: row.origin_session_id,
      originQuestionId: row.origin_question_id,
      evidenceSummary: row.evidence_summary || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  } catch (err) {
    console.warn('Fallback to in-memory store for monitoring_goals:', err)
    return memoryGoalsStore
  }
}

export async function createMonitoringGoal(input: {
  teacherId?: string
  courseId?: string
  candidateKey: string
  title: string
  description: string
  originSessionId?: string | null
  originQuestionId?: string | null
  evidenceSummary?: Record<string, any>
}): Promise<MonitoringGoal> {
  const newGoal: MonitoringGoal = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `mg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    teacherId: input.teacherId || 'default_teacher',
    courseId: input.courseId || 'default_course',
    candidateKey: input.candidateKey,
    title: input.title,
    description: input.description,
    status: 'active',
    originType: 'historical_evidence',
    originSessionId: input.originSessionId || null,
    originQuestionId: input.originQuestionId || null,
    evidenceSummary: input.evidenceSummary || {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('monitoring_goals')
      .insert({
        id: newGoal.id,
        teacher_id: newGoal.teacherId,
        course_id: newGoal.courseId,
        candidate_key: newGoal.candidateKey,
        title: newGoal.title,
        description: newGoal.description,
        status: newGoal.status,
        origin_type: newGoal.originType,
        origin_session_id: newGoal.originSessionId,
        origin_question_id: newGoal.originQuestionId,
        evidence_summary: newGoal.evidenceSummary,
        created_at: newGoal.createdAt,
        updated_at: newGoal.updatedAt,
      })
      .select()
      .single()

    if (error) {
      console.warn('DB Insert failed for monitoring_goals, saving to memory fallback:', error.message)
      memoryGoalsStore.unshift(newGoal)
      return newGoal
    }

    return {
      id: data.id,
      teacherId: data.teacher_id,
      courseId: data.course_id,
      candidateKey: data.candidate_key,
      title: data.title,
      description: data.description,
      status: data.status,
      originType: data.origin_type,
      originSessionId: data.origin_session_id,
      originQuestionId: data.origin_question_id,
      evidenceSummary: data.evidence_summary || {},
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }
  } catch (err) {
    console.warn('Exception inserting monitoring_goal, using memory fallback:', err)
    memoryGoalsStore.unshift(newGoal)
    return newGoal
  }
}

export async function updateMonitoringGoalStatus(
  goalId: string,
  status: 'active' | 'paused' | 'completed'
): Promise<boolean> {
  const goalInMemory = memoryGoalsStore.find((g) => g.id === goalId)
  if (goalInMemory) {
    goalInMemory.status = status
    goalInMemory.updatedAt = new Date().toISOString()
  }

  try {
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('monitoring_goals')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', goalId)

    if (error) {
      console.warn('DB Update failed for monitoring_goal status:', error.message)
    }
    return true
  } catch (err) {
    console.warn('Exception updating monitoring_goal status:', err)
    return true
  }
}
