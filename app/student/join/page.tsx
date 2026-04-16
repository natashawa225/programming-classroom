'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { joinSessionWithParticipantCredentials } from '@/lib/supabase/queries'

export default function StudentJoin() {
  const router = useRouter()
  const [sessionCode, setSessionCode] = useState('')
  const [participantId, setParticipantId] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { session } = await joinSessionWithParticipantCredentials({
        sessionCode,
        participantId,
        password,
      })

      router.push(`/student/respond/${session.id}`)
    } catch (err) {
      console.error('Error joining:', err)
      setError(err instanceof Error ? err.message : 'An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-md px-4">
        {/* Header */}
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Join a Session
          </h1>
          <p className="text-lg text-foreground/70">
            Enter your participant ID, password, and session code
          </p>
        </div>

        {/* Form Card */}
        <Card className="p-8">
          <form onSubmit={handleJoin} className="space-y-6">
            <div>
              <label htmlFor="sessionCode" className="block text-sm font-medium text-foreground mb-3">
                Session Code
              </label>
              <Input
                id="sessionCode"
                type="text"
                value={sessionCode}
                onChange={(e) => setSessionCode(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                placeholder="e.g., DATA-STRUCTURES-01"
                className="w-full text-center text-lg tracking-widest"
                disabled={loading}
                required
              />
            </div>

            <div>
              <label htmlFor="participantId" className="block text-sm font-medium text-foreground mb-3">
                Participant ID
              </label>
              <Input
                id="participantId"
                type="text"
                value={participantId}
                onChange={(e) => setParticipantId(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                placeholder="e.g., p001"
                className="w-full text-center text-lg tracking-widest"
                disabled={loading}
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-3">
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your unique password"
                className="w-full"
                disabled={loading}
                required
              />
            </div>

            {error && (
              <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={loading || !sessionCode.trim() || !participantId.trim() || !password}
              size="lg"
            >
              {loading ? 'Joining...' : 'Join Session'}
            </Button>
          </form>

          <div className="mt-8 pt-8 border-t border-border/40">
            <p className="text-sm text-foreground/60 text-center">
              Ask your instructor for the session code.
            </p>
          </div>
        </Card>

        {/* Back Link */}
        <div className="mt-8 text-center">
          <Link href="/role-select" className="text-foreground/60 hover:text-foreground transition-colors">
            ← Back to Role Selection
          </Link>
        </div>
      </div>
    </main>
  )
}
