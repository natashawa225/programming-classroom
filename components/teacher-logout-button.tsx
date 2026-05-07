'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function TeacherLogoutButton({
  variant = 'outline',
  className,
}: {
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link' | 'destructive'
  className?: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const handleLogout = async () => {
    try {
      setPending(true)
      const response = await fetch('/api/teacher/logout', {
        method: 'POST',
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to log out.')
      }

      router.replace('/teacher/login')
      router.refresh()
    } catch (error) {
      console.error('teacher logout error', error)
      setPending(false)
    }
  }

  return (
    <Button variant={variant} type="button" onClick={handleLogout} disabled={pending} className={cn(className)}>
      {pending ? 'Logging Out...' : 'Log Out'}
    </Button>
  )
}
