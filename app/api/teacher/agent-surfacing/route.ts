import { NextRequest, NextResponse } from 'next/server'
import { getTeacherSession } from '@/lib/teacher-auth'
import { getLiveQuestionAnalyses, getSessionQuestions } from '@/lib/supabase/queries'
import { evaluateBoundedAgentObservations } from '@/lib/services/bounded-agency-service'
import type { LiveQuestionClusterAnalysis } from '@/lib/ai/live-question-clustering'

export async function POST(request: NextRequest) {
  try {
    const teacherSession = await getTeacherSession()
    if (!teacherSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const sessionId = String(body?.sessionId || '').trim()
    const questionId = String(body?.questionId || '').trim()

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const [questions, analyses] = await Promise.all([
      getSessionQuestions(sessionId),
      getLiveQuestionAnalyses(sessionId),
    ])

    const targetQuestion = questionId
      ? questions.find((q) => q.question_id === questionId)
      : questions[0]

    if (!targetQuestion) {
      return NextResponse.json({ observations: [] })
    }

    const latestAnalysisRow = analyses.find((a) => a.question_id === targetQuestion.question_id)
    if (!latestAnalysisRow?.analysis_json) {
      return NextResponse.json({ observations: [] })
    }

    const analysis = latestAnalysisRow.analysis_json as unknown as LiveQuestionClusterAnalysis
    const observations = await evaluateBoundedAgentObservations({
      sessionId,
      questionId: targetQuestion.question_id,
      questionPrompt: targetQuestion.prompt,
      analysis,
    })

    return NextResponse.json({ observations })
  } catch (error) {
    console.error('[agent-surfacing-api] error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to evaluate observations' },
      { status: 500 }
    )
  }
}
