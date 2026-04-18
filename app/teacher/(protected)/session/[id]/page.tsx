import { notFound } from 'next/navigation'
import { getSession, getSessionParticipants, getSessionQuestions, getSessionResponses } from '@/lib/supabase/queries'
import SessionDetailClient from './session-detail-client'

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: sessionId } = await params

  try {
    const [session, participants, questions, responses] = await Promise.all([
      getSession(sessionId),
      getSessionParticipants(sessionId),
      getSessionQuestions(sessionId),
      getSessionResponses(sessionId),
    ])

    return (
      <SessionDetailClient
        initialSession={session}
        initialQuestions={questions || []}
        initialParticipants={participants || []}
        initialResponses={responses || []}
      />
    )
  } catch (err) {
    console.error('Error loading session page:', err)
    notFound()
  }
}
