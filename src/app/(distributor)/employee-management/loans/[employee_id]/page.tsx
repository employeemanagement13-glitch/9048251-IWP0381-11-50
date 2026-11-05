import { getEmployeeById, getLoans, getEmployeeRunningBalance } from "@/lib/actions/employees";
import { getBankAccounts } from "@/lib/actions/bank-accounts";
import { notFound } from "next/navigation";
import { EmployeeLoansDetailClient } from "./EmployeeLoansDetailClient";

interface Props {
  params: Promise<{ employee_id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { employee_id } = await params;
  try {
    const employee = await getEmployeeById(employee_id);
    return {
      title: employee ? `Loan Ledger — ${employee.full_name}` : "Employee Loan Ledger",
    };
  } catch {
    return { title: "Employee Loan Ledger" };
  }
}

export default async function EmployeeLoansDetailPage({ params }: Props) {
  const { employee_id } = await params;
  const [employee, loans, runningBalance, bankAccounts] = await Promise.all([
    getEmployeeById(employee_id),
    getLoans(employee_id),
    getEmployeeRunningBalance(employee_id),
    getBankAccounts(),
  ]);

  if (!employee) {
    notFound();
  }

  return (
    <div className="p-6 space-y-4">
      <EmployeeLoansDetailClient
        employee={employee}
        initialLoans={loans}
        runningBalance={runningBalance}
        bankAccounts={bankAccounts}
      />
    </div>
  );
}
