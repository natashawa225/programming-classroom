import { NextResponse } from 'next/server'
import { assertTeacherAuthenticated } from '@/lib/teacher-auth'
import { getSessionsByTeacher } from '@/lib/supabase/queries'

export async function GET() {
  try {
    const teacherSession = await assertTeacherAuthenticated()
    const sessions = await getSessionsByTeacher(teacherSession.teacherId)
    return NextResponse.json({ sessions })
  } catch (error) {
    console.error('teacher sessions error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load sessions.' },
      { status: 500 }
    )
  }
}
