import type { Metadata } from "next";
import { getSellInOrders, getProducts } from "@/lib/actions/sell-in";
import { getBankAccounts, getVendorAccounts } from "@/lib/actions/bank-accounts";
import { PageHeader } from "@/components/layout/PageHeader";
import { SellInClient } from "./SellInClient";

export const metadata: Metadata = {
  title: "Sell In (CCBPL Purchases)",
};

export default async function SellInPage() {
  const [orders, bankAccounts, products, vendorAccounts] = await Promise.all([
    getSellInOrders(),
    getBankAccounts(),
    getProducts(),
    getVendorAccounts(),
  ]);
  return (
    <div className="p-2 sm:p-4 md:p-6 space-y-3 sm:space-y-4 min-w-0">
      <PageHeader
        title="Sell In (CCBPL Purchases)"
        subtitle="Inventory — manage CCBPL purchase orders and product stock reception"
      />
      <SellInClient
        initialOrders={orders}
        bankAccounts={bankAccounts}
        products={products}
        vendorAccounts={vendorAccounts}
      />
    </div>
  );
}


