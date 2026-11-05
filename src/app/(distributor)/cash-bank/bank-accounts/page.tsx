import type { Metadata } from "next";
import { getBankAccounts, getVendorAccounts } from "@/lib/actions/bank-accounts";
import { PageHeader } from "@/components/layout/PageHeader";
import { BankAccountsClient } from "./BankAccountsClient";

export const metadata: Metadata = {
  title: "Accounts | Transaction & Vendor",
};

export default async function BankAccountsPage() {
  const [bankAccounts, vendorAccounts] = await Promise.all([
    getBankAccounts(),
    getVendorAccounts(),
  ]);
  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Transaction & Vendor Accounts"
        subtitle="Cash & Bank — manage transaction accounts and vendor accounts"
      />
      <BankAccountsClient initialAccounts={bankAccounts} initialVendorAccounts={vendorAccounts} />
    </div>
  );
}


