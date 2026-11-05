import { TopBar } from "@/components/layout/TopBar";
import { getBanner } from "@/lib/actions/admin";
import { checkTenantAccess } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { DynamicSidebar } from "@/components/layout/DynamicSidebar";
import { SidebarProvider } from "@/components/layout/SidebarContext";

export const dynamic = "force-dynamic";

export default async function DistributorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Disable caching for this layout to ensure real-time flag updates
  noStore();
  // Check tenant access before rendering any distributor page
  let accessCheck = await checkTenantAccess();
  
  if (!accessCheck.authorized && accessCheck.reason === "check_failed") {
    await new Promise((res) => setTimeout(res, 1000));
    accessCheck = await checkTenantAccess();
  }

  if (!accessCheck.authorized) {
    if (accessCheck.reason === "not_authenticated") {
      redirect("/unauthorized?reason=no_tenant");
    } else if (accessCheck.reason === "no_tenant_assigned") {
      redirect("/unauthorized?reason=no_tenant");
    } else if (accessCheck.reason === "tenant_disabled") {
      redirect("/unauthorized?reason=tenant_disabled");
    } else {
      redirect("/unauthorized?reason=access_denied");
    }
  }

  const tenantId = accessCheck.tenantId;

  // Fetch banner, feature flags, and alert settings in parallel for maximum speed
  const { createAdminClient } = await import("@/lib/supabase/server");
  const client = createAdminClient();

  const [
    banner,
    { data: globalFlags },
    { data: tenantFlags },
    { data: globalAlerts },
    { data: tenantAlerts },
  ] = await Promise.all([
    getBanner(),
    client.from("global_feature_flags").select("flag_key, enabled"),
    tenantId
      ? client.from("tenant_feature_flags").select("flag_key, enabled").eq("tenant_id", tenantId)
      : Promise.resolve({ data: [] as Array<{ flag_key: string; enabled: boolean }> }),
    client.from("global_alert_settings").select("alert_type, enabled"),
    tenantId
      ? client.from("tenant_alert_settings").select("*").eq("tenant_id", tenantId).maybeSingle()
      : Promise.resolve({ data: null as any }),
  ]);

  // Get enabled feature flags for this tenant
  let enabledFlags: string[] = [];
  if (tenantId) {
    const { getAllHierarchyFlagKeys } = await import("@/config/featureFlagsHierarchy");
    const allHierarchyKeys = getAllHierarchyFlagKeys();

    const globalDisabled = new Set(
      globalFlags?.filter((gf) => !gf.enabled).map((gf) => gf.flag_key) ?? []
    );
    const tenantDisabled = new Set(
      tenantFlags?.filter((tf: any) => !tf.enabled).map((tf: any) => tf.flag_key) ?? []
    );

    const enabledHierarchy = allHierarchyKeys.filter(
      (k) => !globalDisabled.has(k) && !tenantDisabled.has(k)
    );

    const enabledDb =
      globalFlags
        ?.filter((gf) => gf.enabled && !tenantDisabled.has(gf.flag_key))
        .map((gf) => gf.flag_key) ?? [];

    enabledFlags = Array.from(new Set([...enabledHierarchy, ...enabledDb]));

    const isGlobalCashEnabled = globalAlerts?.find(a => a.alert_type === "cash_not_deposited")?.enabled ?? true;
    const isLocalCashEnabled = tenantAlerts?.cash_not_deposited_enabled ?? false;
    const cashEnabled = isGlobalCashEnabled && isLocalCashEnabled;

    const isGlobalOverdueEnabled = globalAlerts?.find(a => a.alert_type === "overdue_threshold")?.enabled ?? true;
    const isLocalOverdueEnabled = tenantAlerts?.overdue_threshold_enabled ?? false;
    const overdueEnabled = isGlobalOverdueEnabled && isLocalOverdueEnabled;

    if (cashEnabled || overdueEnabled) {
      enabledFlags.push("alert_page_enabled");
    }
    if (cashEnabled) enabledFlags.push("alert_cash_not_deposited");
    if (overdueEnabled) enabledFlags.push("alert_overdue_threshold");
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen h-[100dvh] min-h-screen min-h-[100dvh] overflow-hidden bg-[var(--background)]">
        {/* DynamicSidebar is a client component that subscribes to Supabase Realtime
            so tab visibility updates instantly when an admin changes flag settings,
            without requiring the distributor to manually refresh the page. */}
        <DynamicSidebar initialFlags={enabledFlags} tenantId={tenantId ?? ''} />
        <div className="flex flex-col flex-1 min-w-0 h-full min-h-full overflow-hidden bg-[var(--background)]">
          <TopBar distroName={accessCheck.distroName || undefined} />
          <main className="flex-1 overflow-y-auto p-2 sm:p-4 md:p-5 bg-[var(--background)]">
            <div className="mx-auto max-w-7xl w-full space-y-3 sm:space-y-4 min-w-0">
              {banner && (
                <div className="rounded-[var(--radius)] border border-[var(--primary-light)] bg-[var(--primary-light)] px-3 sm:px-4 py-2 sm:py-3 text-[0.71875rem] font-semibold text-[var(--primary-dark)]">
                  📢 {banner.message}
                </div>
              )}
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

