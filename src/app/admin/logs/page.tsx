import { getLogs } from "@/lib/actions/admin";
import { LogsClient } from "./LogsClient";
import { PageHeader } from "@/components/layout/PageHeader";
import { unstable_noStore as noStore } from "next/cache";

export const metadata = { title: "Audit Logs" };

export default async function AdminLogsPage() {
  noStore();
  const logs = await getLogs();

  return (
    <div className="p-6">
      <PageHeader
        title="Access Logs Audit"
        subtitle="Platform audit logs, session IP tracking, and route visits"
      />
      <LogsClient initialLogs={logs} />
    </div>
  );
}

