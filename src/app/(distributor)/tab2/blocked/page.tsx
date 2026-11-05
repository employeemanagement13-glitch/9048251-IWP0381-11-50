import { getBlockedShops } from "@/lib/actions/shops";
import { BlockedClient } from "./BlockedClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Blocked Shops" };

export default async function BlockedPage() {
  const blockedShops = await getBlockedShops();

  return (
    <div className="p-6">
      <PageHeader
        title="Blocked Shops"
        subtitle="Setup & Masters — Manage blocked retailer shops and unblock them"
      />
      <BlockedClient blockedShops={blockedShops} />
    </div>
  );
}

