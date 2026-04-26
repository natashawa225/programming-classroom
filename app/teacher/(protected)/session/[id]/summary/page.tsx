import Link from 'next/link'
import { Button } from '@/components/ui/button'
import SummaryClient from './summary-client'
import { generateSessionSummary, getStoredSessionSummary, storeSessionSummary } from '@/lib/session-summary'
import { getSession } from '@/lib/supabase/queries'

export const dynamic = 'force-dynamic'

function getLoadErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'Failed to load this session summary.'
}

export default async function SessionSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: sessionId } = await params

  try {
    const [storedSummary, session] = await Promise.all([
      getStoredSessionSummary(sessionId),
      getSession(sessionId),
    ])

    let summary = storedSummary
    if (!summary) {
      summary = await generateSessionSummary({ sessionId })
      await storeSessionSummary(sessionId, summary)
    }

    return <SummaryClient sessionId={sessionId} sessionCondition={session.condition} initialSummary={summary} />
  } catch (error) {
    console.error('Error loading session summary:', error)

    return (
      <main className="min-h-screen bg-[linear-gradient(180deg,#edf4fa_0%,#f7fbff_100%)] px-6 py-16 text-foreground lg:px-8">
        <div className="mx-auto max-w-3xl rounded-[32px] bg-white p-8 shadow-[0_16px_40px_rgba(28,26,36,0.08)]">
          <p className="text-[12px] uppercase tracking-[0.18em] text-foreground/45">Teacher session summary</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">Summary unavailable right now</h1>
          <p className="mt-4 max-w-2xl text-base leading-8 text-foreground/72">{getLoadErrorMessage(error)}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={`/teacher/session/${sessionId}/summary`}>
              <Button className="rounded-full px-5">Try again</Button>
            </Link>
            <Link href={`/teacher/session/${sessionId}`}>
              <Button variant="outline" className="rounded-full px-5">
                Back to session
              </Button>
            </Link>
          </div>
        </div>
      </main>
    )
  }
}
