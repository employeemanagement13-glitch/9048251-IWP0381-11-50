import { getEmployees, getLatestEmployeeBalances } from "@/lib/actions/employees";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmployeeLoansDirectoryClient } from "./EmployeeLoansDirectoryClient";

export const metadata = { title: "Employee Loans" };

export default async function EmployeeLoansPage() {
  const [employees, employeeBalances] = await Promise.all([
    getEmployees(),
    getLatestEmployeeBalances(),
  ]);

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Employee Loans"
        subtitle="Employee Management — track running loan balances and individual employee loans"
      />
      <EmployeeLoansDirectoryClient
        employees={employees}
        employeeBalances={employeeBalances}
      />
    </div>
  );
}
