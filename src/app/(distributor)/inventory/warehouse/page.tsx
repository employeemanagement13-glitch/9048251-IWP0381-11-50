import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { redirect } from "next/navigation";

import { DamagedClient } from "../../tab3/damaged/DamagedClient";
import { WarehouseCatalogueClient } from "./WarehouseCatalogueClient";
import { WarehouseHeaderActions } from "./WarehouseHeaderActions";

import { getDamagedStock, getWarehouseProductNames } from "@/lib/actions/inventory";
import { getPurchases } from "@/lib/actions/ccbpl";

import { 
  getWarehouseCategories, 
  getWarehouseStandardLevels, 
  getWarehouseRGBLevels, 
  getWarehouseEmptiesLevels,
  getPendingReturnsInvoices,
  getCategoryHasStock,
  getProductsForStockReport,
} from "@/lib/actions/warehouse-catalogue";
import { getReturnableNonRgbProducts, getOutletsForLease } from "@/lib/actions/leased-empties";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const params = await searchParams;
  let headName = "Warehouse Stock";

  try {
    const categories = await getWarehouseCategories();
    const defaultHead = categories.length > 0 ? categories[0].id : "damaged";
    const head = typeof params.head === "string" ? params.head : defaultHead;

    if (head === "damaged") {
      headName = "Damaged Stock";
    } else {
      const activeCategory = categories.find((c: any) => c.id === head);
      if (activeCategory?.title) {
        headName = activeCategory.title;
      }
    }
  } catch {
    // fallback
  }

  return {
    title: `${headName} - Warehouse Stock`,
  };
}

export default async function UnifiedWarehousePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const categories = await getWarehouseCategories();

  const defaultHead = categories.length > 0 ? categories[0].id : "damaged";
  const head = typeof params.head === "string" ? params.head : defaultHead;

  const activeCategory = categories.find((c: any) => c.id === head);

  if (head !== "damaged" && !activeCategory && categories.length > 0) {
    redirect(`?head=${categories[0].id}`);
  }

  let damagedProps: { damaged: any[]; purchases: any[]; stock: any[] } | null = null;
  let catalogueProps: { type: "standard" | "rgb" | "empties" | "implied"; data: any; pendingReturns: any[]; allProducts: any[] } | null = null;

  if (head === "damaged") {
    const [damaged, purchases, stock] = await Promise.all([
      getDamagedStock(),
      getPurchases(),
      getWarehouseProductNames(),
    ]);
    damagedProps = { damaged, purchases, stock };
  } else if (activeCategory) {
    const isImplied = Boolean(activeCategory.is_implied);
    const returnType: "standard" | "rgb" | "empties" | "implied" = isImplied
      ? "implied"
      : !activeCategory.is_returnable
        ? "standard"
        : activeCategory.is_rgb
          ? "rgb"
          : "empties";

    const [data, pendingReturns] = await Promise.all([
      getWarehouseStandardLevels(activeCategory.id),
      getPendingReturnsInvoices(isImplied ? "empties" : returnType === "implied" ? "empties" : returnType),
    ]);

    catalogueProps = {
      type: returnType,
      data,
      pendingReturns,
      allProducts: [],
    };
  }

  const [allStockProducts, returnableNonRgb, outlets] = await Promise.all([
    getProductsForStockReport(),
    getReturnableNonRgbProducts(),
    getOutletsForLease(),
  ]);

  if (catalogueProps) {
    catalogueProps.allProducts = allStockProducts;
  }

  const impliedProducts = allStockProducts.filter((p: any) => {
    return (
      Boolean(p.product_categories?.is_implied) ||
      (p.product_name || "").toUpperCase().includes("IMPLIED") ||
      (p.product_code || "").startsWith("80000")
    );
  });

  const tabs = [
    ...categories.map((c: any) => ({ key: c.id, label: c.title })),
    { key: "damaged", label: "Damaged Stock" },
  ];

  return (
    <div className="p-2 sm:p-4 md:p-6 space-y-3 sm:space-y-4 min-w-0">
      <PageHeader
        title="Warehouse Stock"
        subtitle="Inventory — Manage physical stock by catalogue heads, damages, and returns"
        action={
          <WarehouseHeaderActions
            allProducts={allStockProducts}
            impliedProducts={impliedProducts}
            returnableNonRgbProducts={returnableNonRgb}
            outlets={outlets}
          />
        }
      />

      {/* Unified MDOS Red Heads — pill style matching StockReports */}
      <div className="flex flex-wrap gap-1.5 sm:gap-2 pb-1 overflow-x-auto">
        {tabs.map((v) => (
          <Link
            key={v.key}
            href={`?head=${v.key}`}
            className={[
              "px-3 py-1.5 text-xs font-semibold rounded-full border transition-all whitespace-nowrap shrink-0",
              head === v.key
                ? "border-transparent shadow-sm"
                : "bg-white border-zinc-200 text-zinc-600 hover:border-zinc-400",
            ].join(" ")}
            style={head === v.key ? { background: "var(--primary)", color: "#fff" } : {}}
          >
            {v.label}
          </Link>
        ))}
      </div>

      {/* Render Active Head */}
      <div>
        {activeCategory && catalogueProps && (
          <WarehouseCatalogueClient
            category={activeCategory}
            type={catalogueProps.type}
            data={catalogueProps.data}
            pendingReturns={catalogueProps.pendingReturns}
            allProducts={catalogueProps.allProducts}
          />
        )}
        {head === "damaged" && damagedProps && (
          <DamagedClient 
            initialDamaged={damagedProps.damaged} 
            products={damagedProps.stock} 
            purchases={damagedProps.purchases} 
          />
        )}
      </div>
    </div>
  );
}
