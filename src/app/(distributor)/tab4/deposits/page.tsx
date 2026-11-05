import { getCashDeposits } from "@/lib/actions/cash";
import { DepositsClient } from "./DepositsClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Cash Deposits" };

export default async function DepositsPage() {
  const deposits = await getCashDeposits();
  return (
    <div className="p-6">
      <PageHeader
        title="Deposits Register"
        subtitle="Tab 4, Page 2 — Bank deposit tracking and reconciliation logs"
      />
      <DepositsClient initialDeposits={deposits} />
    </div>
  );
}

