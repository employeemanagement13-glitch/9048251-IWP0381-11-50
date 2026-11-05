import { getStockAudits } from "@/lib/actions/inventory";
import { AuditClient } from "./AuditClient";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  getWarehouseCategories,
  getWarehouseStandardLevels,
  getWarehouseRGBLevels,
  getWarehouseEmptiesLevels,
} from "@/lib/actions/warehouse-catalogue";

export const metadata = { title: "Stock Audits" };

export default async function AuditPage() {
  const [audits, categories] = await Promise.all([
    getStockAudits(),
    getWarehouseCategories(),
  ]);

  const productRows: { id: string; product_name: string; qty_total: number; category_type: string }[] = [];
  const seen = new Set<string>();

  for (const cat of categories) {
    let rows: any[] = [];
    if (!cat.is_returnable) {
      rows = await getWarehouseStandardLevels(cat.id);
    } else if (cat.is_rgb) {
      rows = await getWarehouseRGBLevels();
    } else {
      rows = await getWarehouseEmptiesLevels();
    }
    for (const r of rows) {
      if (!seen.has(r.product_name)) {
        seen.add(r.product_name);
        productRows.push({
          id: r.product_id || r.product_name,
          product_name: r.product_name,
          qty_total: Number(r.total_qty ?? 0),
          category_type: !cat.is_returnable ? "standard" : cat.is_rgb ? "rgb" : "empties",
        });
      }
    }
  }

  productRows.sort((a, b) => a.product_name.localeCompare(b.product_name));

  return (
    <div className="p-6">
      <PageHeader
        title="Stock Count & Audit"
        subtitle="Tab 3, Page 4 — Schedule audits, record physical counts, correct inventory discrepancies"
      />
      <AuditClient initialAudits={audits} warehouseProducts={productRows} />
    </div>
  );
}
