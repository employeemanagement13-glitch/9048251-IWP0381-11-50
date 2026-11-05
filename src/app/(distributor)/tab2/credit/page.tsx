import { getShops, getAllShopPayments } from "@/lib/actions/shops";
import { getInvoices } from "@/lib/actions/invoices";
import { getBankAccounts } from "@/lib/actions/bank-accounts";
import { getSettings } from "@/lib/actions/settings";
import { CreditClient } from "./CreditClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Credit Used & Recovery" };

export default async function CreditPage() {
  const [{ settings }, shops, invoices, bankAccounts, shopPayments] = await Promise.all([
    getSettings(),
    getShops(),
    getInvoices(),
    getBankAccounts(),
    getAllShopPayments(),
  ]);

  return (
    <div className="p-6">
      <PageHeader
        title="Credit Used & Recovery"
        subtitle="Sales & Credit — Track credit outlets, unpaid credit invoices, overdue status and payments"
      />
      <CreditClient
        initialShops={shops}
        invoices={invoices}
        bankAccounts={bankAccounts}
        creditInvoicesLimit={settings?.credit_invoices_limit ?? 1}
        initialPayments={shopPayments}
      />
    </div>
  );
}

