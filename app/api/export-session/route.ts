import {
  getSession,
  getSessionParticipants,
  getSessionResponses,
  getSessionAIOutputs,
} from '@/lib/supabase/queries'
import { getTeacherSession } from '@/lib/teacher-auth'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const teacherSession = await getTeacherSession()
    if (!teacherSession) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sessionId = request.nextUrl.searchParams.get('sessionId')
    const format = request.nextUrl.searchParams.get('format') || 'csv'

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const [session, participants, responses, aiOutputs] = await Promise.all([
      getSession(sessionId),
      getSessionParticipants(sessionId),
      getSessionResponses(sessionId),
      getSessionAIOutputs(sessionId),
    ])

    if (format === 'json') {
      return NextResponse.json({
        session,
        participants,
        responses,
        aiOutputs,
      })
    }

    const csvData = generateCSV(session, participants, responses, aiOutputs)

    return new NextResponse(csvData, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="session-${sessionId}-export.csv"`,
      },
    })
  } catch (error) {
    console.error('Error exporting session:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 }
    )
  }
}

function generateCSV(
  session: any,
  participants: any[],
  responses: any[],
  aiOutputs: any[]
): string {
  const lines: string[] = []

  lines.push('SMART-Draft Session Export')
  lines.push('')
  lines.push('Session Information')
  lines.push(`Session Code,${escapeCSV(session.session_code)}`)
  lines.push(`Condition,${session.condition}`)
  lines.push(`Question,${escapeCSV(session.question)}`)
  lines.push(`Answer Options,${escapeCSV((session.answer_options || []).join(' | '))}`)
  lines.push(`Correct Answer,${escapeCSV(session.correct_answer)}`)
  lines.push(`Transfer Question,${escapeCSV(session.transfer_question || '')}`)
  lines.push(`Transfer Options,${escapeCSV((session.transfer_options || []).join(' | '))}`)
  lines.push(`Transfer Correct Answer,${escapeCSV(session.transfer_correct_answer || '')}`)
  lines.push(`Status,${session.status}`)
  lines.push(`Created,${new Date(session.created_at).toISOString()}`)
  lines.push('')

  lines.push('Session Participants')
  lines.push('Session Participant ID,Anonymized Label,Student ID,Student Name,Joined At')
  participants.forEach((participant: any) => {
    lines.push(
      [
        escapeCSV(participant.session_participant_id),
        escapeCSV(participant.anonymized_label || ''),
        escapeCSV(participant.student_id || ''),
        escapeCSV(participant.student_name || ''),
        participant.joined_at ? new Date(participant.joined_at).toISOString() : '',
      ].join(',')
    )
  })
  lines.push('')

  lines.push('Student Responses')
  lines.push('Session Participant ID,Anonymized Label,Question Type,Round,Answer,Confidence,Explanation,Correct,Submitted At')
  responses.forEach((response: any) => {
    lines.push(
      [
        escapeCSV(response.session_participant_id),
        escapeCSV(response.session_participants?.anonymized_label || ''),
        response.question_type,
        response.round_number,
        escapeCSV(response.answer),
        response.confidence,
        escapeCSV(response.explanation || ''),
        response.is_correct === null ? '' : String(response.is_correct),
        response.created_at ? new Date(response.created_at).toISOString() : '',
      ].join(',')
    )
  })
  lines.push('')

  if (aiOutputs.length > 0) {
    lines.push('AI Analysis Outputs')
    lines.push('Condition,Round,Teacher Summary,Student Summary,Raw Response,Created At')
    aiOutputs.forEach((output: any) => {
      lines.push(
        [
          output.condition,
          output.round_number,
          escapeCSV(JSON.stringify(output.teacher_summary || {})),
          escapeCSV(JSON.stringify(output.student_summary || {})),
          escapeCSV(output.raw_response || ''),
          output.created_at ? new Date(output.created_at).toISOString() : '',
        ].join(',')
      )
    })
    lines.push('')
  }

  lines.push('Summary Statistics')
  lines.push(`Total Responses,${responses.length}`)
  const avgConfidence =
    responses.length > 0
      ? (responses.reduce((sum: number, r: any) => sum + r.confidence, 0) / responses.length).toFixed(1)
      : '0.0'
  lines.push(`Average Confidence,${avgConfidence}/5`)
  lines.push(`High Confidence (4-5),${responses.filter((r: any) => r.confidence >= 4).length}`)
  lines.push(`Medium Confidence (3),${responses.filter((r: any) => r.confidence === 3).length}`)
  lines.push(`Low Confidence (1-2),${responses.filter((r: any) => r.confidence <= 2).length}`)

  return lines.join('\n')
}

function escapeCSV(value: string): string {
  if (!value) return ''
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
