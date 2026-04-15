import { getSession, getSessionResponses, createAIOutput, logTeacherAction } from '@/lib/supabase/queries'
import { analyzeMisconceptions, generateConfidenceMatrix } from '@/lib/ai/analysis'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { sessionId, teacherId } = await request.json()

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    // Get session and responses
    const session = await getSession(sessionId)
    const responsesData = await getSessionResponses(sessionId)

    if (!responsesData || responsesData.length === 0) {
      return NextResponse.json(
        { error: 'No responses to analyze' },
        { status: 400 }
      )
    }

    const responses = responsesData.map((r: any) => ({
      participantCode: r.session_participants?.anonymized_label || r.session_participant_id || 'Unknown',
      answer: r.answer,
      confidence: r.confidence,
      responseId: r.response_id,
    }))

    let analysis: any = {}

    if (session.condition === 'baseline') {
      // For baseline, we already generated feedback when students submitted
      // This endpoint can aggregate and summarize the feedback
      analysis.type = 'baseline'
      analysis.message = 'Baseline responses have been recorded with individual feedback'

      await createAIOutput(sessionId, session.condition, 'feedback', {
        message: analysis.message,
      })
    } else {
      // For treatment, generate misconception analysis
      const misconceptionAnalysis = await analyzeMisconceptions({
        question: session.question,
        correctAnswer: session.correct_answer,
        responses: responses,
      })

      const confidenceMatrix = await generateConfidenceMatrix(responses)

      // Save analysis to database
      await createAIOutput(sessionId, session.condition, 'misconception_card', {
        misconceptions: misconceptionAnalysis.commonMisconceptions,
        confidenceAnalysis: misconceptionAnalysis.confidenceAnalysis,
      })

      await createAIOutput(sessionId, session.condition, 'confidence_matrix', {
        matrix: confidenceMatrix,
        summary: `${responses.length} students responded`,
      })

      await createAIOutput(sessionId, session.condition, 'teaching_suggestion', {
        suggestions: misconceptionAnalysis.teachingSuggestions,
      })

      analysis = {
        type: 'treatment',
        misconceptions: misconceptionAnalysis.commonMisconceptions,
        confidenceAnalysis: misconceptionAnalysis.confidenceAnalysis,
        confidenceMatrix: confidenceMatrix,
        teachingSuggestions: misconceptionAnalysis.teachingSuggestions,
      }
    }

    // Log the analysis action
    if (teacherId) {
      await logTeacherAction(sessionId, 'ai_analysis_triggered', {
        analysisType: session.condition,
        teacherId,
      })
    }

    return NextResponse.json(analysis)
  } catch (error) {
    console.error('Error analyzing session:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    )
  }
}
