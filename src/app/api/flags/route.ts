import { NextResponse } from 'next/server'
import { createAdminClient, getTenantId } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const tenantId = await getTenantId()
    if (!tenantId) {
      return NextResponse.json({ enabledFlags: [] })
    }

    const supabase = createAdminClient()

    const [
      { data: globalFlags, error: gErr },
      { data: tenantFlags },
      { data: globalAlerts },
      { data: tenantAlerts },
    ] = await Promise.all([
      supabase.from('global_feature_flags').select('flag_key, enabled'),
      supabase.from('tenant_feature_flags').select('flag_key, enabled').eq('tenant_id', tenantId),
      supabase.from('global_alert_settings').select('alert_type, enabled'),
      supabase.from('tenant_alert_settings').select('*').eq('tenant_id', tenantId).maybeSingle(),
    ])

    if (gErr) {
      console.error('[/api/flags] global flags error:', gErr.message)
      return NextResponse.json({ enabledFlags: [] }, { status: 500 })
    }

    const { getAllHierarchyFlagKeys } = await import('@/config/featureFlagsHierarchy')
    const allHierarchyKeys = getAllHierarchyFlagKeys()

    const globalDisabled = new Set(
      globalFlags?.filter((gf) => !gf.enabled).map((gf) => gf.flag_key) ?? []
    )
    const tenantDisabled = new Set(
      tenantFlags?.filter((tf) => !tf.enabled).map((tf) => tf.flag_key) ?? []
    )

    const enabledHierarchy = allHierarchyKeys.filter(
      (k) => !globalDisabled.has(k) && !tenantDisabled.has(k)
    )

    const enabledDb =
      globalFlags
        ?.filter((gf) => gf.enabled && !tenantDisabled.has(gf.flag_key))
        .map((gf) => gf.flag_key) ?? []

    const enabledFlags = Array.from(new Set([...enabledHierarchy, ...enabledDb]))

    const isGlobalCashEnabled = globalAlerts?.find(a => a.alert_type === 'cash_not_deposited')?.enabled ?? true
    const isLocalCashEnabled = tenantAlerts?.cash_not_deposited_enabled ?? false
    const cashEnabled = isGlobalCashEnabled && isLocalCashEnabled

    const isGlobalOverdueEnabled = globalAlerts?.find(a => a.alert_type === 'overdue_threshold')?.enabled ?? true
    const isLocalOverdueEnabled = tenantAlerts?.overdue_threshold_enabled ?? false
    const overdueEnabled = isGlobalOverdueEnabled && isLocalOverdueEnabled

    if (cashEnabled || overdueEnabled) enabledFlags.push('alert_page_enabled')
    if (cashEnabled) enabledFlags.push('alert_cash_not_deposited')
    if (overdueEnabled) enabledFlags.push('alert_overdue_threshold')

    return NextResponse.json({ enabledFlags })
  } catch (err: any) {
    console.error('[/api/flags] unexpected error:', err?.message ?? err)
    return NextResponse.json({ enabledFlags: [] }, { status: 500 })
  }
}
