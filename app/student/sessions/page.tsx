'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getActiveSessions } from '@/lib/supabase/queries'

export default function StudentSessions() {
  const router = useRouter()
  const [anonymizedLabel, setAnonymizedLabel] = useState<string | null>(null)
  const [activeSessions, setActiveSessions] = useState<Array<{
    id: string
    session_code: string
    question: string
    status?: string
  }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const label = sessionStorage.getItem('anonymizedLabel')
    if (label) setAnonymizedLabel(label)

    const loadSessions = async () => {
      try {
        const sessions = await getActiveSessions()
        setActiveSessions(sessions.map(session => ({
          id: session.id,
          session_code: session.session_code,
          question: session.question,
          status: session.status,
        })))
      } catch (error) {
        console.error('Error loading active sessions:', error)
      } finally {
        setLoading(false)
      }
    }

    loadSessions()
  }, [router])

  const handleStartSession = (sessionId: string) => {
    router.push(`/student/respond/${sessionId}`)
  }

  const handleLogout = () => {
    sessionStorage.removeItem('anonymizedLabel')
    sessionStorage.removeItem('studentName')
    sessionStorage.removeItem('studentId')
    sessionStorage.removeItem('sessionId')
    sessionStorage.removeItem('sessionCode')
    router.push('/role-select')
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-foreground/60">Loading...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Active Sessions</h1>
            {anonymizedLabel && (
              <p className="text-sm text-foreground/60 mt-1">You are: {anonymizedLabel}</p>
            )}
          </div>
          <Button variant="outline" onClick={handleLogout}>
            Log Out
          </Button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {activeSessions.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="text-5xl mb-4">⏳</div>
            <h2 className="text-2xl font-bold text-foreground mb-4">No Active Sessions</h2>
            <p className="text-foreground/70 mb-6">
              Wait for your instructor to start a session. You can refresh the page to check for new sessions.
            </p>
            <Button onClick={() => window.location.reload()} variant="outline">
              Refresh Page
            </Button>
          </Card>
        ) : (
          <div className="grid gap-6">
            {activeSessions.map((session) => (
              <Card key={session.id} className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground">{session.session_code}</h2>
                    <p className="text-foreground/70 mt-2">{session.question}</p>
                  </div>
                  <span className="px-3 py-1 rounded-full text-sm font-medium bg-primary/20 text-primary">
                    {session.status ? session.status.charAt(0).toUpperCase() + session.status.slice(1) : 'Live'}
                  </span>
                </div>

                <div className="mb-6 p-4 rounded-lg bg-secondary/30">
                  <p className="text-foreground font-medium">Question:</p>
                  <p className="text-foreground/70 mt-2">{session.question}</p>
                </div>

                <Button
                  onClick={() => handleStartSession(session.id)}
                  className="w-full md:w-auto"
                >
                  Answer Question
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
