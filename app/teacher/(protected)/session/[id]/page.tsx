import { notFound } from 'next/navigation'
import {
  getLiveQuestionAnalyses,
  getSession,
  getSessionParticipants,
  getSessionQuestions,
  getSessionResponses,
} from '@/lib/supabase/queries'
import SessionDetailClient from './session-detail-client'

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: sessionId } = await params

  try {
    const [session, participants, questions, responses, liveQuestionAnalyses] = await Promise.all([
      getSession(sessionId),
      getSessionParticipants(sessionId),
      getSessionQuestions(sessionId),
      getSessionResponses(sessionId),
      getLiveQuestionAnalyses(sessionId),
    ])

    return (
      <SessionDetailClient
        initialSession={session}
        initialQuestions={questions || []}
        initialParticipants={participants || []}
        initialResponses={responses || []}
        initialLiveQuestionAnalyses={liveQuestionAnalyses || []}
      />
    )
  } catch (err) {
    console.error('Error loading session page:', err)
    notFound()
  }
}
