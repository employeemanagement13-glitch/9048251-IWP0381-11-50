import { getInvoicesPaginated, getShopsForDropdown } from "@/lib/actions/invoices";
import { InvoicesClient } from "./InvoicesClient";

export const metadata = { title: "Sales Invoices" };

export default async function InvoicesPage() {
  const [invoicesData, shops] = await Promise.all([
    getInvoicesPaginated({ page: 1, pageSize: 500 }),
    getShopsForDropdown(),
  ]);

  return (
    <div className="p-2 sm:p-4 md:p-6 min-w-0">
      <InvoicesClient 
        initialInvoices={invoicesData.invoices} 
        initialPagination={{
          totalCount: invoicesData.totalCount,
          page: invoicesData.page,
          pageSize: invoicesData.pageSize,
          totalPages: invoicesData.totalPages,
        }}
        shops={shops} 
      />
    </div>
  );
}

