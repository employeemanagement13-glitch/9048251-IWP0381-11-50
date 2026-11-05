import { getDamagedStock, getWarehouseProductNames } from "@/lib/actions/inventory";
import { getPurchases } from "@/lib/actions/ccbpl";
import { DamagedClient } from "./DamagedClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Damaged Stock" };

export default async function DamagedPage() {
  const [damaged, stock, purchases] = await Promise.all([
    getDamagedStock(),
    getWarehouseProductNames(),
    getPurchases(),
  ]);

  return (
    <div className="p-6">
      <PageHeader
        title="Damaged Stock Register"
        subtitle="Tab 3, Page 2 — Log flappy or defective items, file complaints and monitor adjustments"
      />
      <DamagedClient initialDamaged={damaged} products={stock} purchases={purchases} />
    </div>
  );
}

