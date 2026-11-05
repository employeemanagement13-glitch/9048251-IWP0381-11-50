import { createBrowserClient } from '@supabase/ssr'
import { useMemo } from 'react'

export function useSupabase() {
  return useMemo(() => {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        // Required for Supabase Realtime (postgres_changes) to authenticate via Clerk JWT.
        // Without this, the WebSocket connection uses the anon key only and RLS blocks events.
        accessToken: async () => {
          if (typeof window === 'undefined') return ''
          const clerk = (window as any).Clerk
          if (clerk?.session) {
            const token = await clerk.session.getToken({ template: 'supabase' })
            return token ?? ''
          }
          return ''
        },
        global: {
          fetch: async (url, options = {}) => {
            const headers = new Headers(options?.headers)

            if (typeof window !== 'undefined') {
              const clerk = (window as any).Clerk
              if (clerk?.session) {
                const clerkToken = await clerk.session.getToken({ template: 'supabase' })
                if (clerkToken) {
                  headers.set('Authorization', `Bearer ${clerkToken}`)
                }
              }
            }

            return fetch(url, { ...options, headers })
          },
        },
      }
    )
  }, [])
}
