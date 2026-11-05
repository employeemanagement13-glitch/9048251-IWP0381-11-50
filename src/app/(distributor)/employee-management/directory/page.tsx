import { getEmployees } from "@/lib/actions/employees";
import { getBankAccounts } from "@/lib/actions/bank-accounts";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmployeeDirectoryClient } from "./EmployeeDirectoryClient";

export const metadata = { title: "Employee Directory" };

export default async function EmployeeDirectoryPage() {
  const [employees, bankAccounts] = await Promise.all([
    getEmployees(),
    getBankAccounts(),
  ]);
  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Employee Directory"
        subtitle="Employee Management — all staff records, salaries, references and linked routes"
      />
      <EmployeeDirectoryClient initialEmployees={employees} bankAccounts={bankAccounts} />
    </div>
  );
}

