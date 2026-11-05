import { getProductsGroupedByCategory, getProductCategories } from "@/lib/actions/products";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProductsClient } from "./ProductsClient";

export const metadata = { title: "Products Menu" };

export default async function ProductsPage() {
  const [{ grouped, uncategorised }, categories] = await Promise.all([
    getProductsGroupedByCategory(),
    getProductCategories(),
  ]);

  return (
    <div className="p-6">
      <PageHeader
        title="Product Catalogue"
        subtitle="Setup & Masters — Manage categories (Heads), products, pricing, and packing"
      />
      <ProductsClient
        grouped={grouped}
        uncategorised={uncategorised}
        categories={categories}
      />
    </div>
  );
}
