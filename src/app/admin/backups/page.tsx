import { ensureAllTenantsDailyBackup, getAdminTenantsWithLatestBackup } from "@/lib/actions/backup";
import { AdminBackupsClient } from "./AdminBackupsClient";
import { PageHeader } from "@/components/layout/PageHeader";
import { unstable_noStore as noStore } from "next/cache";

export const metadata = { title: "System Backups" };

export default async function AdminBackupsPage() {
  noStore();
  try {
    await ensureAllTenantsDailyBackup();
  } catch (err: any) {
    console.error("[AdminBackupsPage] ensureAllTenantsDailyBackup error:", err?.message);
  }

  const tenantsWithBackups = await getAdminTenantsWithLatestBackup();

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Backup Management"
        subtitle="List of all distributions with their latest backup files and restoration controls"
      />
      <AdminBackupsClient initialRows={tenantsWithBackups} />
    </div>
  );
}
