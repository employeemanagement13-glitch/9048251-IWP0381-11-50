import { getPurchases } from "@/lib/actions/ccbpl";
import { PurchasingClient } from "./PurchasingClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "CCBPL Purchases" };

export default async function PurchasingPage() {
  const purchases = await getPurchases();
  return (
    <div className="p-6">
      <PageHeader
        title="Purchasing from CCBPL"
        subtitle="Tab 6, Page 2 — Purchase orders and stock arrival tracking"
      />
      <PurchasingClient initialPurchases={purchases} />
    </div>
  );
}

