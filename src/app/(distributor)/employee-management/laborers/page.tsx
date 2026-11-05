import { getLaborers } from "@/lib/actions/laborers";
import { PageHeader } from "@/components/layout/PageHeader";
import { LaborersClient } from "./LaborersClient";

export const metadata = { title: "Laborers | Employee Management" };

export default async function LaborersPage() {
  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Laborers"
        subtitle="Employee Management — track laborers, work durations, and deployed personnel"
      />
      <LaborersClient initialLaborers={[]} />
    </div>
  );
}
