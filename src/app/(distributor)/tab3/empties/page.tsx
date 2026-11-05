import { getEmptiesLog, getWarehouseStock, getEmptiesOnHand } from "@/lib/actions/inventory";
import { getShops } from "@/lib/actions/shops";
import { getInvoices } from "@/lib/actions/invoices";
import { EmptiesClient } from "./EmptiesClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Empties Log" };

export default async function EmptiesPage() {
  const [empties, stock, shops, invoices, onHand] = await Promise.all([
    getEmptiesLog(),
    getWarehouseStock(),
    getShops(),
    getInvoices(),
    getEmptiesOnHand(),
  ]);

  return (
    <div className="p-6">
      <PageHeader
        title="Empties Log"
        subtitle="Tab 3, Page 5 — Log returnable bottles and crates, manage deposits and check on-hand balances"
      />
      <EmptiesClient
        initialEmpties={empties}
        shops={shops}
        products={stock}
        invoices={invoices}
        emptiesOnHand={onHand}
      />
    </div>
  );
}

