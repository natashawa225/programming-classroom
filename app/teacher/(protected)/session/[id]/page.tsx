import Link from 'next/link'
import {
  getLiveQuestionAnalyses,
  getSession,
  getSessionParticipants,
  getSessionQuestions,
  getSessionResponses,
} from '@/lib/supabase/queries'
import { Button } from '@/components/ui/button'
import SessionDetailClient from './session-detail-client'

function getLoadErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'Session not found') {
      return 'This session is not available yet. If you just created it, wait a moment and try again.'
    }
    if (error.message.includes('Connect Timeout Error') || error.message.includes('fetch failed')) {
      return 'The app could not reach Supabase in time. Please check your network connection, then reload this session page.'
    }
    return error.message
  }

  return 'Failed to load this session.'
}

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

    return (
      <main className="min-h-screen bg-[linear-gradient(180deg,#edf4fa_0%,#f7fbff_100%)] px-6 py-16 text-foreground lg:px-8">
        <div className="mx-auto max-w-3xl rounded-[32px] bg-white p-8 shadow-[0_16px_40px_rgba(28,26,36,0.08)]">
          <p className="text-[12px] uppercase tracking-[0.18em] text-foreground/45">Live classroom session</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">Session unavailable right now</h1>
          <p className="mt-4 max-w-2xl text-base leading-8 text-foreground/72">
            {getLoadErrorMessage(err)}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={`/teacher/session/${sessionId}`}>
              <Button className="rounded-full px-5">Try again</Button>
            </Link>
            <Link href="/teacher/dashboard">
              <Button variant="outline" className="rounded-full px-5">
                Back to dashboard
              </Button>
            </Link>
          </div>
        </div>
      </main>
    )
  }
}
