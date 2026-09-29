'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export default function StudentJoin() {
  const router = useRouter()
  const [sessionCode, setSessionCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/student/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionCode: sessionCode.trim().toUpperCase(),
          nickname: nickname.trim(),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to join session.')
      }

      router.push(`/student/respond/${payload.session.id}`)
    } catch (err) {
      console.error('Error joining session:', err)
      setError(err instanceof Error ? err.message : 'An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-md px-4">
        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-bold text-foreground mb-3">
            Join Session
          </h1>
          <p className="text-lg text-foreground/70">
            Enter your session code to get started
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
                placeholder="e.g., ABC123"
                className="w-full text-center text-xl tracking-widest uppercase font-semibold h-12"
                disabled={loading}
                required
              />
            </div>

            <div>
              <label htmlFor="nickname" className="block text-sm font-medium text-foreground mb-3">
                Nickname <span className="text-xs font-normal text-foreground/50">(First-time joiners)</span>
              </label>
              <Input
                id="nickname"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="e.g., Alice"
                className="w-full h-12 text-lg"
                disabled={loading}
              />
            </div>

            {error && (
              <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-12 text-base font-semibold"
              disabled={loading || !sessionCode.trim()}
              size="lg"
            >
              {loading ? 'Joining Session...' : 'Join Session'}
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-border/40">
            <p className="text-sm text-foreground/60 text-center">
              Enter session code.
            </p>
          </div>
        </Card>

        {/* Back Link */}
        <div className="mt-8 text-center">
          <Link href="/" className="text-foreground/60 hover:text-foreground transition-colors">
            ← Back to Role Selection
          </Link>
        </div>
      </div>
    </main>
  )
}
