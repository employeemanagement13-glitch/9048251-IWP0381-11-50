import { getEmployees } from "@/lib/actions/employees";
import { EmployeesClient } from "./EmployeesClient";
import { Suspense } from "react";

export const metadata = {
  title: "Employees",
};

export default async function EmployeesPage() {
  const employees = await getEmployees();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Employees</h1>
        <p className="text-zinc-500 mt-1">
          Manage Delivery Men and Presellers
        </p>
      </div>

      <Suspense fallback={<div>Loading employees...</div>}>
        <EmployeesClient initialEmployees={employees} />
      </Suspense>
    </div>
  );
}

