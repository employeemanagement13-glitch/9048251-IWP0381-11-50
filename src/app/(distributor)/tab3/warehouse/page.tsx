import { getWarehouseStock } from "@/lib/actions/inventory";
import { WarehouseClient } from "./WarehouseClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Warehouse Stock" };

export default async function WarehousePage() {
  const stock = await getWarehouseStock();

  return (
    <div className="p-6">
      <PageHeader
        title="Warehouse Stock"
        subtitle="Tab 3, Page 1 — Real-time physical inventory levels and stock reservation details"
      />
      <WarehouseClient initialStock={stock} />
    </div>
  );
}

