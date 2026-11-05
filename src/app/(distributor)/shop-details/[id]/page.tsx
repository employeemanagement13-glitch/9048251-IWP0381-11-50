import { getShopById, getShopLedger } from "@/lib/actions/shops";
import { getShopInvoicesWithDiscounts } from "@/lib/actions/discounts";
import { ShopProfileClient } from "./ShopProfileClient";
import { PageHeader } from "@/components/layout/PageHeader";
import { notFound } from "next/navigation";

interface ShopProfilePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: ShopProfilePageProps) {
  const { id } = await params;
  try {
    const shop = await getShopById(id);
    return {
      title: shop?.shop_name ? `${shop.shop_name} - Outlet Details | Distroline` : "Outlet Details",
    };
  } catch {
    return { title: "Outlet Details" };
  }
}

export default async function ShopProfilePage({ params }: ShopProfilePageProps) {
  const { id } = await params;

  let shop;
  let invoices: any[] = [];
  let ledgerEntries: any[] = [];
  try {
    shop = await getShopById(id);
    if (!shop) return notFound();
    [invoices, ledgerEntries] = await Promise.all([
      getShopInvoicesWithDiscounts(id),
      getShopLedger(id),
    ]);
  } catch (err) {
    return notFound();
  }

  return (
    <div className="p-6">
      <PageHeader
        title={`${shop.shop_name} — Account Ledger`}
        subtitle="View continuous running shop statement, invoices, payments, and balance ledger"
      />
      <ShopProfileClient shop={shop} invoices={invoices} initialLedger={ledgerEntries} />
    </div>
  );
}
