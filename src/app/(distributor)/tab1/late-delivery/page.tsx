import { getLateDeliveries } from "@/lib/actions/late-delivery";
import { LateDeliveryClient } from "./LateDeliveryClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Late Deliveries" };

export default async function LateDeliveryPage() {
  const lateDeliveries = await getLateDeliveries();

  return (
    <div className="p-6">
      <PageHeader 
        title="Late Delivery Tracker" 
        subtitle="Tab 1, Page 3 — Monitor delayed shipments and resolve disputes" 
      />
      <LateDeliveryClient initialData={lateDeliveries} />
    </div>
  );
}

