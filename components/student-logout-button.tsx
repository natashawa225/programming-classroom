'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function StudentLogoutButton({ variant = 'outline' }: { variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link' | 'destructive' }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const handleLogout = async () => {
    try {
      setPending(true)
      const response = await fetch('/api/student/logout', {
        method: 'POST',
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to log out.')
      }

      router.replace('/student/join')
      router.refresh()
    } catch (error) {
      console.error('student logout error', error)
      setPending(false)
    }
  }

  return (
    <Button variant={variant} type="button" onClick={handleLogout} disabled={pending}>
      {pending ? 'Logging Out...' : 'Log Out'}
    </Button>
  )
}
