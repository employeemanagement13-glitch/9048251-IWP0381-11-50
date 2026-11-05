import { getEmployeeById } from "@/lib/actions/employees";
import { notFound } from "next/navigation";
import { EmployeeLedgerClient } from "./EmployeeLedgerClient";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  try {
    const employee = await getEmployeeById(id);
    return {
      title: employee ? `Ledger — ${employee.full_name}` : "Employee Ledger",
    };
  } catch {
    return { title: "Employee Ledger" };
  }
}

export default async function EmployeeLedgerPage({ params }: Props) {
  const { id } = await params;
  const employee = await getEmployeeById(id);

  if (!employee) {
    notFound();
  }

  return (
    <div className="p-6 space-y-4">
      <EmployeeLedgerClient employee={employee} />
    </div>
  );
}
