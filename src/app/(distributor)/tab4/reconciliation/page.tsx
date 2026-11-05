import { getReconciliation } from "@/lib/actions/cash";
import { ReconciliationClient } from "./ReconciliationClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Daily Reconciliation" };

interface PageProps {
  searchParams: Promise<{ date?: string; status?: string }>;
}

export default async function ReconciliationPage({ searchParams }: PageProps) {
  const { date, status } = await searchParams;
  const targetDate = date || new Date().toISOString().split("T")[0];
  const reconciliationData = await getReconciliation(targetDate);

  return (
    <div className="p-6">
      <PageHeader
        title="Cash Reconciliation Dashboard"
        subtitle="Tab 4, Page 3 — Reconcile delivered cash invoices against bank deposits"
      />
      <ReconciliationClient
        initialData={reconciliationData}
        currentDate={targetDate}
        currentStatus={status || "all"}
      />
    </div>
  );
}

