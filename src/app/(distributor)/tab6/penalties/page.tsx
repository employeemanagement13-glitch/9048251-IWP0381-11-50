import { getPenalties } from "@/lib/actions/ccbpl";
import { PenaltiesClient } from "./PenaltiesClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "CCBPL Penalties" };

export default async function PenaltiesPage() {
  const penalties = await getPenalties();
  return (
    <div className="p-6">
      <PageHeader
        title="CCBPL Penalties Register"
        subtitle="Tab 6, Page 4 — Compliance and performance penalty tracker"
      />
      <PenaltiesClient initialPenalties={penalties} />
    </div>
  );
}

