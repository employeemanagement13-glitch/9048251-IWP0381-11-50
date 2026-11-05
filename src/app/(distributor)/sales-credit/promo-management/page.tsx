import { PageHeader } from "@/components/layout/PageHeader";
import { PromoManagementClient } from "./PromoManagementClient";

export const metadata = { title: "Promo Management" };

export default function PromoManagementPage() {
  return (
    <div className="p-2 sm:p-4 md:p-6 space-y-3 sm:space-y-4 min-w-0">
      <PageHeader
        title="Promo Management"
        subtitle="Import and review daily promo discount invoices by shop"
      />
      <PromoManagementClient />
    </div>
  );
}
