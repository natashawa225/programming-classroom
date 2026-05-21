import { NextRequest, NextResponse } from 'next/server'
import { generateStudentSummariesForSession } from '@/lib/agents/student-summary'
import { getTeacherSession } from '@/lib/teacher-auth'

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const teacherSession = await getTeacherSession()
    if (!teacherSession) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { sessionId } = await context.params
    const result = await generateStudentSummariesForSession(sessionId)
    return NextResponse.json(result)
  } catch (error) {
    console.error('generate student summaries error', { error, route: '/api/teacher/sessions/[sessionId]/generate-student-summaries' })
    return NextResponse.json(
      {
        ok: false,
        error: 'Could not generate student summaries.',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    )
  }
}
