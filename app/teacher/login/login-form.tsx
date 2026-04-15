'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { teacherLogin, type TeacherLoginState } from '@/app/teacher/auth-actions'

export default function TeacherLoginForm({ showUsername }: { showUsername: boolean }) {
  const [state, action, pending] = useActionState<TeacherLoginState, FormData>(
    teacherLogin,
    { error: null }
  )

  return (
    <form action={action} className="space-y-6">
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

      {state.error && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <p className="text-sm text-destructive">{state.error}</p>
        </div>
      )}

      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? 'Signing In...' : 'Sign In'}
      </Button>
    </form>
  )
}

