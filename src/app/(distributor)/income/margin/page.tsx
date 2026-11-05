import { getSchemeIncome } from "@/lib/actions/scheme-income";
import { getProducts } from "@/lib/actions/products";
import { getInvoices } from "@/lib/actions/invoices";
import { getVendorAccounts } from "@/lib/actions/bank-accounts";
import { PageHeader } from "@/components/layout/PageHeader";
import { IncomeMarginClient } from "./IncomeMarginClient";

export const metadata = { title: "Income Sources | Margin & Incentives" };

export default async function IncomeMarginPage() {
  const [schemeRows, products, invoices, vendorAccounts] = await Promise.all([
    getSchemeIncome(),
    getProducts(),
    getInvoices(),
    getVendorAccounts(),
  ]);
  
  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Income Management"
        subtitle="Margin calculator + CCBPL scheme income tracker"
      />
      <IncomeMarginClient
        schemeRows={schemeRows}
        products={products}
        invoices={invoices}
        vendorAccounts={vendorAccounts}
      />
    </div>
  );
}


