import { NextRequest, NextResponse } from 'next/server'
import { getTeacherSession } from '@/lib/teacher-auth'
import { getLecturerAnnotationsForSession, saveLecturerAnnotation } from '@/lib/services/pattern-memory-service'
import type { LecturerAnnotation } from '@/lib/types/database'

export async function GET(request: NextRequest) {
  try {
    const teacherSession = await getTeacherSession()
    if (!teacherSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')?.trim()

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing required query parameter: sessionId' }, { status: 400 })
    }

    const annotations = await getLecturerAnnotationsForSession(sessionId)
    return NextResponse.json({ annotations })
  } catch (error) {
    console.error('[teacher-annotation-api] GET error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch annotations' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const teacherSession = await getTeacherSession()
    if (!teacherSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const sessionId = String(body?.sessionId || '').trim()
    const questionId = String(body?.questionId || '').trim()
    const clusterId = String(body?.clusterId || '').trim()
    const actionType = String(body?.actionType || 'annotated') as LecturerAnnotation['action_type']
    const lecturerInterpretation = body?.lecturerInterpretation ? String(body.lecturerInterpretation).trim() : null
    const lecturerDecision = body?.lecturerDecision ? String(body.lecturerDecision).trim() : null
    const customLabel = body?.customLabel ? String(body.customLabel).trim() : null

    if (!sessionId || !questionId || !clusterId) {
      return NextResponse.json({ error: 'Missing required fields: sessionId, questionId, clusterId' }, { status: 400 })
    }

    const annotation = await saveLecturerAnnotation({
      sessionId,
      questionId,
      clusterId,
      actionType,
      lecturerInterpretation,
      lecturerDecision,
      customLabel,
    })

    if (!annotation) {
      return NextResponse.json({ error: 'Failed to record lecturer annotation' }, { status: 500 })
    }

    return NextResponse.json({ annotation })
  } catch (error) {
    console.error('[teacher-annotation-api] error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save annotation' },
      { status: 500 }
    )
  }
}

