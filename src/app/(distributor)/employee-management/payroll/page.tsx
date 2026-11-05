import { getPayrollRuns } from "@/lib/actions/payroll";
import { getEmployees, getLatestEmployeeBalances } from "@/lib/actions/employees";
import { getBankAccounts } from "@/lib/actions/bank-accounts";
import { getCurrentDistroName } from "@/lib/actions/settings";
import { PageHeader } from "@/components/layout/PageHeader";
import { PayrollRunsClient } from "./PayrollRunsClient";

export const metadata = { title: "Payroll Runs" };

export default async function PayrollRunsPage() {
  const [runs, employees, bankAccounts, employeeBalances, distroName] = await Promise.all([
    getPayrollRuns(),
    getEmployees(),
    getBankAccounts(),
    getLatestEmployeeBalances(),
    getCurrentDistroName(),
  ]);
  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Payroll Runs"
        subtitle="Employee Management — generate monthly payslips and record salary expenses"
      />
      <PayrollRunsClient
        initialRuns={runs}
        employees={employees}
        bankAccounts={bankAccounts}
        employeeBalances={employeeBalances}
        distributorName={distroName || undefined}
      />
    </div>
  );
}

