import type { Metadata } from "next";
import { getCashDeposits } from "@/lib/actions/cash";
import { getBankAccounts, getVendorAccounts, getCashMovements } from "@/lib/actions/bank-accounts";
import { PageHeader } from "@/components/layout/PageHeader";
import { DepositsClient } from "./DepositsClient";

export const metadata: Metadata = {
  title: "Deposits and Movements",
};

export default async function CashBankDepositsPage() {
  const [deposits, transactionAccounts, vendorAccounts, movements] = await Promise.all([
    getCashDeposits(),
    getBankAccounts(),
    getVendorAccounts(),
    getCashMovements(),
  ]);
  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Cash & Bank"
        subtitle="Record deposits to transaction accounts and move cash between accounts"
      />
      <DepositsClient
        initialDeposits={deposits}
        initialMovements={movements}
        transactionAccounts={transactionAccounts}
        vendorAccounts={vendorAccounts}
      />
    </div>
  );
}
