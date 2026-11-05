import { getDmRoutes, getLoaders } from "@/lib/actions/routes";
import { getEmployeesForDropdown } from "@/lib/actions/invoices";
import { DmRoutesClient } from "./DmRoutesClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Sale Vehicles & Loaders" };

export default async function DmRoutesPage() {
  const [registry, loaders, employees] = await Promise.all([
    getDmRoutes(),
    getLoaders(),
    getEmployeesForDropdown(),
  ]);

  return (
    <div className="p-6">
      <PageHeader
        title="Sale Vehicles"
        subtitle="Prerequisites — Sale Vehicles & Folk Lifters Registry"
      />
      <DmRoutesClient registry={registry} loaders={loaders} employees={employees} />
    </div>
  );
}
