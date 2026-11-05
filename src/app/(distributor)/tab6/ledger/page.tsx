import { getLedger } from "@/lib/actions/ledger";
import { LedgerClient } from "./LedgerClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Agency Ledger" };

export default async function LedgerPage() {
  const ledger = await getLedger();
  return (
    <div className="p-6">
      <PageHeader
        title="Agency Ledger"
        subtitle="Tab 6, Page 1 — running balance with negative-balance model"
      />
      <LedgerClient initialLedger={ledger} />
    </div>
  );
}

