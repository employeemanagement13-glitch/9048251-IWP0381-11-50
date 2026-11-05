import { getTenants } from "@/lib/actions/admin";
import { AdminDashboardClient } from "./AdminDashboardClient";
import { PageHeader } from "@/components/layout/PageHeader";
import { unstable_noStore as noStore } from "next/cache";

export const metadata = { title: "Admin Dashboard" };

export default async function AdminDashboardPage() {
  noStore();
  const tenants = await getTenants();

  return (
    <div className="p-6">
      <PageHeader
        title="Admin Platform Dashboard"
        subtitle="Full Tenant/Distribution CRUD control and access toggles"
      />
      <AdminDashboardClient initialTenants={tenants} />
    </div>
  );
}

