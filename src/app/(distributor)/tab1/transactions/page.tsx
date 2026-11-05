import { PageHeader } from "@/components/layout/PageHeader";
import { getInvoicesPaginated, getShopsForDropdown } from "@/lib/actions/invoices";
import { InvoicesClient } from "../invoices/InvoicesClient";

export const metadata = { title: "Invoices Management" };

function getYesterdayAndToday() {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  return { yesterdayStr, todayStr };
}

export default async function SalesTransactionsPage() {
  const { yesterdayStr, todayStr } = getYesterdayAndToday();

  const [invoicesData, shops] = await Promise.all([
    getInvoicesPaginated({ page: 1, pageSize: 500, dateFrom: yesterdayStr, dateTo: todayStr }),
    getShopsForDropdown(),
  ]);

  return (
    <div className="p-2 sm:p-4 md:p-6 space-y-3 sm:space-y-4 min-w-0">
      <PageHeader
        title="Invoice Generation"
        subtitle="Sales & Credit — Manage daily invoices and report generation"
      />

      <div>
        <InvoicesClient
          initialInvoices={invoicesData.invoices}
          initialPagination={{
            totalCount: invoicesData.totalCount,
            page: invoicesData.page,
            pageSize: invoicesData.pageSize,
            totalPages: invoicesData.totalPages,
          }}
          shops={shops}
          defaultDateFilter={true}
        />
      </div>
    </div>
  );
}
