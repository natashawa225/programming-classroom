'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function TeacherLoginForm({ showUsername }: { showUsername: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)

    const formData = new FormData(event.currentTarget)
    try {
      const response = await fetch('/api/teacher/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: String(formData.get('username') || ''),
          password: String(formData.get('password') || ''),
        }),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to sign in.')
      }

      router.replace('/teacher/dashboard')
      router.refresh()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to sign in.')
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {showUsername && (
        <div>
          <label htmlFor="username" className="block text-sm font-medium text-foreground mb-3">
            Username
          </label>
          <Input id="username" name="username" type="text" autoComplete="username" required disabled={pending} />
        </div>
      )}

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-foreground mb-3">
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
        />
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? 'Signing In...' : 'Sign In'}
      </Button>
    </form>
  )
}
