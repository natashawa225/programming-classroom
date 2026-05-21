'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export default function StudentJoin() {
  const router = useRouter()
  const [participantId, setParticipantId] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/student/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          participantId,
          password,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to log in.')
      }

      router.push('/student/sessions')
    } catch (err) {
      console.error('Error logging in:', err)
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
            Student Login
          </h1>
          <p className="text-lg text-foreground/70">
            Enter your participant ID and password to continue
          </p>
        </div>

        {/* Form Card */}
        <Card className="p-8">
          <form onSubmit={handleLogin} className="space-y-6">
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
              disabled={loading || !participantId.trim() || !password}
              size="lg"
            >
              {loading ? 'Logging in...' : 'Log In'}
            </Button>
          </form>

          <div className="mt-8 pt-8 border-t border-border/40">
            <p className="text-sm text-foreground/60 text-center">
              You will enter the session code on your dashboard.
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
