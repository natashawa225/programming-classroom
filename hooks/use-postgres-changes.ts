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
  pollMs?: number
  debugLabel?: string
}

export function usePostgresChanges({
  tables,
  onChange,
  schema = 'public',
  debounceMs = 150,
  pollMs = 0,
  debugLabel,
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
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let subscribed = false

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

    const subscription = channel.subscribe((status) => {
      if (debugLabel) {
        // eslint-disable-next-line no-console
        console.debug(`[realtime:${debugLabel}] ${status}`)
      }

      if (status === 'SUBSCRIBED') {
        subscribed = true
        scheduleRefresh()
      }

      if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && pollMs > 0 && !pollTimer) {
        pollTimer = setInterval(() => callbackRef.current(), pollMs)
      }
    })

    const startPollIfNotSubscribed =
      pollMs > 0
        ? setTimeout(() => {
            if (!subscribed && !pollTimer) {
              pollTimer = setInterval(() => callbackRef.current(), pollMs)
            }
          }, 2500)
        : null

    const onVisibilityChange =
      pollMs > 0
        ? () => {
            if (document.visibilityState === 'visible') callbackRef.current()
          }
        : null

    if (onVisibilityChange) {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      if (startPollIfNotSubscribed) {
        clearTimeout(startPollIfNotSubscribed)
      }

      if (onVisibilityChange) {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }

      if (pollTimer) {
        clearInterval(pollTimer)
      }

      void subscription.unsubscribe()
      supabase.removeChannel(channel)
    }
  }, [tables, schema, debounceMs, pollMs, debugLabel])
}
