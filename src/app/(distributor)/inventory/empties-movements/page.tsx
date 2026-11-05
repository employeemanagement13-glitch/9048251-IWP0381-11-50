import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptiesMovementsClient } from "./EmptiesMovementsClient";
import { getReturnableNonRgbProducts, getImpliedProducts, getOutletsForLease } from "@/lib/actions/leased-empties";

export const metadata: Metadata = { title: "Empties Movements" };

export default async function EmptiesMovementsPage() {
  let returnableNonRgbProducts: Awaited<ReturnType<typeof getReturnableNonRgbProducts>> = [];
  let impliedProducts: Awaited<ReturnType<typeof getImpliedProducts>> = [];
  let outlets: Awaited<ReturnType<typeof getOutletsForLease>> = [];
  try {
    [returnableNonRgbProducts, impliedProducts, outlets] = await Promise.all([
      getReturnableNonRgbProducts({ uniqueByName: false }),
      getImpliedProducts(),
      getOutletsForLease(),
    ]);
  } catch (err: any) {
    console.error("[EmptiesMovementsPage]", err?.message ?? err);
  }

  return (
    <div className="p-2 sm:p-4 md:p-6 space-y-4 min-w-0">
      <PageHeader
        title="Empties Movements"
        subtitle="Inventory — Lease / sell empties to outlets and manage waybills"
      />
      <EmptiesMovementsClient
        returnableNonRgbProducts={returnableNonRgbProducts}
        outlets={outlets}
        impliedProducts={impliedProducts}
      />
    </div>
  );
}
