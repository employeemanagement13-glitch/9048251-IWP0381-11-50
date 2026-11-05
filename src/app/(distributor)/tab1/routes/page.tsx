import { getDmRoutes, getRouteAssignments, getDispatchSummaries } from "@/lib/actions/routes";
import { getEmployeesForDropdown } from "@/lib/actions/invoices";
import { RoutesClient } from "./RoutesClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Route Assignments" };

export default async function RoutesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const today = new Date().toISOString().split("T")[0];
  const fromDate = typeof params.from === "string" ? params.from : today;
  const toDate = typeof params.to === "string" ? params.to : today;

  const [registry, assignments, employees, dispatchSummaries] = await Promise.all([
    getDmRoutes(),
    getRouteAssignments({ dateFrom: fromDate, dateTo: toDate }),
    getEmployeesForDropdown(),
    getDispatchSummaries(fromDate, toDate),
  ]);

  return (
    <div className="p-6">
      <PageHeader
        title="Routes & Assignments"
        subtitle="Tab 1, Page 2 — Manage DM registry and daily truck dispatch"
      />
      <RoutesClient
        registry={registry}
        assignments={assignments}
        employees={employees}
        dispatchSummaries={dispatchSummaries}
        fromDate={fromDate}
        toDate={toDate}
      />
    </div>
  );
}
