import { getProducts, getReturnableProducts } from "@/lib/actions/reports";
import { PageHeader } from "@/components/layout/PageHeader";
import { StockReportsClient } from "./StockReportsClient";

export const metadata = { title: "Stock Reports" };

export default async function StockReportsPage() {
  const [products, returnableProducts] = await Promise.all([
    getProducts(),
    getReturnableProducts(),
  ]);
  return (
    <div className="p-2 sm:p-4 md:p-6 space-y-3 sm:space-y-4 min-w-0">
      <PageHeader
        title="Stock Reports"
        subtitle="Stock Balance · Balance by Level · Empty Balance · Outlet's Empty Balance · Leased Empties · Waybills Summary"
      />
      <StockReportsClient
        products={products}
        returnableProducts={returnableProducts}
      />
    </div>
  );
}
