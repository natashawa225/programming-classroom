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
  onChange: () => void | Promise<void>
  schema?: string
  debounceMs?: number
  pollMs?: number
  pollStrategy?: 'fallback' | 'always'
  debugLabel?: string
}

export function usePostgresChanges({
  tables,
  onChange,
  schema = 'public',
  debounceMs = 150,
  pollMs = 0,
  pollStrategy = 'fallback',
  debugLabel,
}: UsePostgresChangesOptions) {
  const callbackRef = useRef(onChange)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)

  useEffect(() => {
    callbackRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const supabase = createClient()
    const channelName = `realtime:${tables.map(({ table }) => table).join(',')}:${Date.now()}`
    const channel = supabase.channel(channelName)
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let subscribed = false

    const runRefresh = async () => {
      if (inFlightRef.current) {
        if (debugLabel) {
          // eslint-disable-next-line no-console
          console.debug(`[realtime:${debugLabel}] skipped refresh while previous refresh is still running`)
        }
        return
      }

      inFlightRef.current = true
      try {
        await callbackRef.current()
      } finally {
        inFlightRef.current = false
      }
    }

    const scheduleRefresh = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      timerRef.current = setTimeout(() => {
        void runRefresh()
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
      }

      if (
        (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') &&
        pollMs > 0 &&
        pollStrategy === 'fallback' &&
        !pollTimer
      ) {
        pollTimer = setInterval(() => {
          if (document.visibilityState !== 'visible') return
          void runRefresh()
        }, pollMs)
      }
    })

    const startPollIfNotSubscribed =
      pollMs > 0
        ? setTimeout(() => {
            if ((pollStrategy === 'always' || !subscribed) && !pollTimer) {
              pollTimer = setInterval(() => {
                if (document.visibilityState !== 'visible') return
                void runRefresh()
              }, pollMs)
            }
          }, Math.max(2500, Math.min(pollMs, 15000)))
        : null

    const onVisibilityChange =
      pollMs > 0
        ? () => {
            if (document.visibilityState === 'visible') {
              void runRefresh()
            }
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
  }, [tables, schema, debounceMs, pollMs, pollStrategy, debugLabel])
}
