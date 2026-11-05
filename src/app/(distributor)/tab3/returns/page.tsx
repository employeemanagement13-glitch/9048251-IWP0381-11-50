import { getReturns, getWarehouseStock } from "@/lib/actions/inventory";
import { getShops } from "@/lib/actions/shops";
import { getInvoices } from "@/lib/actions/invoices";
import { ReturnsClient } from "./ReturnsClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Returns & Wayback" };

export default async function ReturnsPage() {
  const [returnsList, shops, invoices, stock] = await Promise.all([
    getReturns(),
    getShops(),
    getInvoices(),
    getWarehouseStock(),
  ]);

  return (
    <div className="p-6">
      <PageHeader
        title="Returns & Wayback"
        subtitle="Tab 3, Page 3 — Log customer returns, approve stock restoration or document rejection reasons"
      />
      <ReturnsClient
        initialReturns={returnsList}
        shops={shops}
        invoices={invoices}
        products={stock}
      />
    </div>
  );
}

