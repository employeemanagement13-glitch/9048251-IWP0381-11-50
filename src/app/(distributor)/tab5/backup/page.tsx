import { getBackups, ensureDailyBackupForTenant } from "@/lib/actions/backup";
import { getTenantId } from "@/lib/supabase/server";
import { BackupClient } from "./BackupClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Data Backup" };

export default async function BackupPage() {
  const tenantId = await getTenantId();
  if (tenantId) {
    try {
      await ensureDailyBackupForTenant(tenantId);
    } catch (e: any) {
      console.error("[BackupPage] ensureDailyBackup error:", e?.message);
    }
  }

  const backups = await getBackups();
  return (
    <div className="p-6">
      <PageHeader
        title="Data Backup"
        subtitle="Tab 5, Page 1 — Backup and download tenant-scoped data safely"
      />
      <BackupClient initialBackups={backups} />
    </div>
  );
}

