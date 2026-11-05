import { getTenantConfig, getTenants, getGlobalAlertSettings, getTenantAlertSettings } from "@/lib/actions/admin";
import { TenantConfigClient } from "./TenantConfigClient";
import { PageHeader } from "@/components/layout/PageHeader";
import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  try {
    const tenants = await getTenants();
    const tenant = tenants.find((t) => t.id === id);
    return {
      title: tenant?.name ? `Tenant Config — ${tenant.name}` : "Tenant Configuration",
    };
  } catch {
    return { title: "Tenant Configuration" };
  }
}

export default async function TenantConfigPage({ params }: PageProps) {
  noStore();
  const { id } = await params;
  const tenants = await getTenants();
  const tenant = tenants.find((t) => t.id === id);
  if (!tenant) notFound();

  const config = await getTenantConfig(id);
  const globalAlerts = await getGlobalAlertSettings();
  const tenantAlerts = await getTenantAlertSettings(id);

  return (
    <div className="p-6">
      <PageHeader
        title={`Configure: ${tenant.distro_name}`}
        subtitle="Distribution feature flags matrix and alert rules monitor"
      />
      <TenantConfigClient
        tenantId={id}
        initialConfig={config}
        tenant={tenant}
        globalAlerts={globalAlerts}
        tenantAlerts={tenantAlerts}
      />
    </div>
  );
}
