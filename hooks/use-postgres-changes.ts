'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

type PostgresChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*'

interface UsePostgresChangesOptions {
  tables: Array<{
    table: string
    event?: PostgresChangeEvent
    filter?: string
  }>
  onChange: () => void
  schema?: string
  debounceMs?: number
}

export function usePostgresChanges({
  tables,
  onChange,
  schema = 'public',
  debounceMs = 150,
}: UsePostgresChangesOptions) {
  const callbackRef = useRef(onChange)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    callbackRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const supabase = createClient()
    const channelName = `realtime:${tables.map(({ table }) => table).join(',')}:${Date.now()}`
    const channel = supabase.channel(channelName)

    const scheduleRefresh = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      timerRef.current = setTimeout(() => {
        callbackRef.current()
      }, debounceMs)
    }

    tables.forEach(({ table, event = '*', filter }) => {
      channel.on(
        'postgres_changes',
        {
          event,
          schema,
          table,
          ...(filter ? { filter } : {}),
        },
        scheduleRefresh
      )
    })

    channel.subscribe()

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      supabase.removeChannel(channel)
    }
  }, [tables, schema, debounceMs])
}
