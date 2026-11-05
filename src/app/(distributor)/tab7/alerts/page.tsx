import { getAlerts } from "@/lib/actions/alerts";
import { AlertsClient } from "./AlertsClient";
import { PageHeader } from "@/components/layout/PageHeader";
import { createClient, getTenantId } from "@/lib/supabase/server";

export const metadata = { title: "Live Alerts Feed" };

export default async function AlertsPage() {
  const alerts = await getAlerts();
  
  const tenantId = await getTenantId();
  const supabase = await createClient();
  
  const { data: globalAlerts } = await supabase.from("global_alert_settings").select("alert_type, enabled");
  const { data: tenantAlerts } = await supabase.from("tenant_alert_settings").select("*").eq("tenant_id", tenantId).single();

  const isGlobalOverdueEnabled = globalAlerts?.find(a => a.alert_type === "overdue_threshold")?.enabled ?? true;
  const overdueEnabled = isGlobalOverdueEnabled;

  const filteredAlerts = alerts.filter(a => a.alert_type === "overdue_threshold");

  return (
    <div className="p-6">
      <PageHeader
        title="Real-Time Alerts Feed"
        subtitle="Tab 7, Page 2 — Live system alerts, deposits notifications, and credit threshold warnings"
      />
      <AlertsClient 
        initialAlerts={filteredAlerts} 
        cashEnabled={false}
        overdueEnabled={overdueEnabled}
      />
    </div>
  );
}

