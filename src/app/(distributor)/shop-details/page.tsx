import type { Metadata } from "next";
import { getShops } from "@/lib/actions/shops";
import { ShopDetailsClient } from "./ShopDetailsClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shops Directory",
};

export default async function ShopDetailsPage() {
  const shops = await getShops();

  return (
    <div className="p-6">
      <PageHeader
        title="Shops Directory"
        subtitle="Manage outlet profiles, addresses, channels, and records"
      />
      <ShopDetailsClient initialShops={shops} />
    </div>
  );
}

