import { getDiscrepancyReport } from "@/lib/actions/discrepancy";
import { DiscrepancyClient } from "./DiscrepancyClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Discrepancies" };

export default async function DiscrepancyPage() {
  const discrepancyData = await getDiscrepancyReport();

  return (
    <div className="p-6">
      <PageHeader
        title="Stock Discrepancy Report"
        subtitle="Tab 7, Page 1 — Investigational review of audit discrepancies (non-zero differences only)"
      />
      <DiscrepancyClient initialDiscrepancies={discrepancyData} />
    </div>
  );
}

