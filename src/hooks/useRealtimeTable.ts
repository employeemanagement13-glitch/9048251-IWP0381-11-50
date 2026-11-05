import { useEffect, useRef } from 'react'
import { useSupabase } from '@/lib/supabase/client'

interface RealtimeConfig {
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE'
  filter?: string
  debounceMs?: number
}

export function useRealtimeTable(
  table: string,
  onchange: (payload?: any) => void,
  config?: RealtimeConfig
) {
  const supabase = useSupabase()

  const callbackRef = useRef(onchange)
  callbackRef.current = onchange

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debounceMs = config?.debounceMs ?? 300

  const channelId = useRef(
    `rt:${table}:${config?.filter ?? 'all'}:${Math.random().toString(36).slice(2)}`
  )

  useEffect(() => {
    const notify = (payload: any) => {
      if (debounceMs > 0) {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          callbackRef.current(payload)
        }, debounceMs)
      } else {
        callbackRef.current(payload)
      }
    }

    const channel = supabase
      .channel(channelId.current)
      .on(
        // @ts-ignore
        'postgres_changes',
        {
          event: config?.event ?? '*',
          schema: 'public',
          table,
          ...(config?.filter ? { filter: config.filter } : {}),
        },
        (payload: any) => {
          notify(payload)
        }
      )
      .subscribe()

    const broadcastChannel = supabase
      .channel(`broadcast_channel_${table}`)
      .on('broadcast', { event: 'change' }, (msg: any) => {
        const payload = msg?.payload
        if (config?.filter && payload) {
          const parts = config.filter.split('=eq.')
          if (parts.length === 2) {
            const field = parts[0].trim()
            const expectedVal = parts[1].trim()
            if (payload[field] && String(payload[field]) !== String(expectedVal)) {
              return
            }
          }
        }
        notify(payload)
      })
      .subscribe()

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      supabase.removeChannel(channel)
      supabase.removeChannel(broadcastChannel)
    }
  }, [supabase, table, config?.event, config?.filter, debounceMs])
}