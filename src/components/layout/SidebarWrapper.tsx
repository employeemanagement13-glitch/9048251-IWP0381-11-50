'use client'

import { useState, useEffect, useCallback } from 'react'
import { Sidebar } from './Sidebar'
import { useRealtimeTable } from '@/hooks/useRealtimeTable'

interface Props {
  /** Initial enabled flags computed server-side in the distributor layout. */
  initialFlags: string[]
  /**
   * The authenticated tenant's UUID. Used to scope the
   * `tenant_feature_flags` subscription so we only react to changes
   * relevant to this distributor (not other tenants).
   */
  tenantId: string
}

/**
 * Client-side wrapper around <Sidebar> that keeps the list of enabled feature
 * flags up-to-date in real-time.
 *
 * Problem: The distributor layout is a Server Component — it computes
 * `enabledFlags` at render time and passes them to <Sidebar>. When an admin
 * changes a flag, the sidebar only updates after a full page reload.
 *
 * Solution: This wrapper holds `flags` in local state (seeded from SSR props),
 * subscribes to `global_feature_flags` and `tenant_feature_flags` via Supabase
 * Realtime, and calls `/api/flags` to fetch fresh flag data whenever a change
 * event arrives. The Sidebar re-renders with the new flags immediately.
 */
export function SidebarWrapper({ initialFlags, tenantId }: Props) {
  const [flags, setFlags] = useState<string[]>(initialFlags)

  // Keep in sync when the server re-renders (e.g. on navigation or router.refresh)
  useEffect(() => {
    setFlags(initialFlags)
  }, [initialFlags])

  // Fetch the full computed list of enabled flags from the server.
  // Called on every realtime change event to get the authoritative state.
  const refreshFlags = useCallback(async () => {
    try {
      const res = await fetch(`/api/flags?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setFlags(data.enabledFlags ?? [])
    } catch (err) {
      console.error('[SidebarWrapper] Failed to refresh flags:', err)
    }
  }, [])

  // Subscribe: any change to any global flag → refresh sidebar
  useRealtimeTable('global_feature_flags', refreshFlags)

  // Subscribe: any change to this tenant's flag overrides → refresh sidebar
  useRealtimeTable('tenant_feature_flags', refreshFlags, {
    filter: `tenant_id=eq.${tenantId}`,
  })

  return <Sidebar enabledFlags={flags} />
}

