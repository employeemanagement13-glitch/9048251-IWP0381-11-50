import { getGlobalFlags, getGlobalAlertSettings, getBanner } from "@/lib/actions/admin";
import { AdminSettingsClient } from "./AdminSettingsClient";
import { PageHeader } from "@/components/layout/PageHeader";
import { unstable_noStore as noStore } from "next/cache";

export const metadata = { title: "Admin Settings" };

export default async function AdminSettingsPage() {
  noStore();
  const globalFlags = await getGlobalFlags();
  const globalAlerts = await getGlobalAlertSettings();
  const banner = await getBanner();

  return (
    <div className="p-6">
      <PageHeader
        title="Global System Settings"
        subtitle="Platform-wide tabs control, alert triggers, and emergency announcement composer"
      />
      <AdminSettingsClient
        initialFlags={globalFlags}
        initialAlerts={globalAlerts}
        initialBanner={banner}
      />
    </div>
  );
}

