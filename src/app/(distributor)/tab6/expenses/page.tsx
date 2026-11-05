import { getExpenses } from "@/lib/actions/ccbpl";
import { ExpensesClient } from "./ExpensesClient";
import { PageHeader } from "@/components/layout/PageHeader";

export const metadata = { title: "Agency Expenses" };

export default async function ExpensesPage() {
  const expenses = await getExpenses();
  return (
    <div className="p-6">
      <PageHeader
        title="Agency Expenses"
        subtitle="Tab 6, Page 3 — Day-to-day running costs and expense tracking"
      />
      <ExpensesClient initialExpenses={expenses} />
    </div>
  );
}

