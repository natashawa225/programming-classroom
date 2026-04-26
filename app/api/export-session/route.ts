import {
  getLiveQuestionAnalyses,
  getSession,
  getSessionParticipants,
  getSessionResponses,
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

    const [session, participants, responses, liveQuestionAnalyses] = await Promise.all([
      getSession(sessionId),
      getSessionParticipants(sessionId),
      getSessionResponses(sessionId),
      getLiveQuestionAnalyses(sessionId),
    ])

    if (format === 'json') {
      return NextResponse.json({
        session,
        participants,
        responses,
        liveQuestionAnalyses,
      })
    }

    const csvData = generateCSV(session, participants, responses, liveQuestionAnalyses)

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
  liveQuestionAnalyses: any[]
): string {
  const lines: string[] = []

  lines.push('Session Export')
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
  lines.push(`Live Phase,${escapeCSV(session.live_phase || '')}`)
  lines.push(`Current Question Position,${escapeCSV(String(session.current_question_position ?? ''))}`)
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
  lines.push('Session Participant ID,Anonymized Label,Question ID,Question Position,Question Type,Attempt Type,Round,Answer,Confidence,Explanation,Correct,Time Taken (s),Original Response ID,Submitted At')
  responses.forEach((response: any) => {
    lines.push(
      [
        escapeCSV(response.session_participant_id),
        escapeCSV(response.session_participants?.anonymized_label || ''),
        escapeCSV(response.question_id || ''),
        escapeCSV(String(response.session_questions?.position ?? '')),
        response.question_type,
        response.attempt_type || '',
        response.round_number,
        escapeCSV(response.answer),
        response.confidence,
        escapeCSV(response.explanation || ''),
        response.is_correct === null ? '' : String(response.is_correct),
        response.time_taken_seconds === null || response.time_taken_seconds === undefined ? '' : String(response.time_taken_seconds),
        escapeCSV(response.original_response_id || ''),
        response.created_at ? new Date(response.created_at).toISOString() : '',
      ].join(',')
    )
  })
  lines.push('')

  if (liveQuestionAnalyses.length > 0) {
    lines.push('Live Question Analyses')
    lines.push('Question ID,Attempt Type,Analysis JSON,Generated At')
    liveQuestionAnalyses.forEach((analysis: any) => {
      lines.push(
        [
          escapeCSV(analysis.question_id),
          escapeCSV(analysis.attempt_type),
          escapeCSV(JSON.stringify(analysis.analysis_json || {})),
          analysis.generated_at ? new Date(analysis.generated_at).toISOString() : '',
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
