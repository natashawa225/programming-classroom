import { NextResponse } from 'next/server'
import {
  getCandidateMonitoringGoals,
  getMonitoringGoals,
  createMonitoringGoal,
  updateMonitoringGoalStatus,
} from '@/lib/services/monitoring-goals-service'

export async function GET() {
  try {
    const candidates = getCandidateMonitoringGoals()
    const activeGoals = await getMonitoringGoals('default_teacher')

    return NextResponse.json({
      success: true,
      candidates,
      activeGoals,
    })
  } catch (error: any) {
    console.error('Error in GET /api/teacher/monitoring-goals:', error)
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch monitoring goals' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { candidateKey, title, description, originSessionId, originQuestionId, evidenceSummary } = body

    if (!candidateKey || !title || !description) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: candidateKey, title, description' },
        { status: 400 }
      )
    }

    const goal = await createMonitoringGoal({
      teacherId: 'default_teacher',
      courseId: 'default_course',
      candidateKey,
      title,
      description,
      originSessionId: originSessionId || null,
      originQuestionId: originQuestionId || null,
      evidenceSummary: evidenceSummary || {},
    })

    return NextResponse.json({
      success: true,
      goal,
      message: 'Monitoring goal created. MeshQuiz will check future classroom evidence for potentially relevant patterns.',
    })
  } catch (error: any) {
    console.error('Error in POST /api/teacher/monitoring-goals:', error)
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to create monitoring goal' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { goalId, status } = body

    if (!goalId || !['active', 'paused', 'completed'].includes(status)) {
      return NextResponse.json(
        { success: false, error: 'Invalid goalId or status' },
        { status: 400 }
      )
    }

    await updateMonitoringGoalStatus(goalId, status)

    return NextResponse.json({
      success: true,
      message: `Monitoring goal status updated to ${status}`,
    })
  } catch (error: any) {
    console.error('Error in PATCH /api/teacher/monitoring-goals:', error)
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to update goal status' },
      { status: 500 }
    )
  }
}
