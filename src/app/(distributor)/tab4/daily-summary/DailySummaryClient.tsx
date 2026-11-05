"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { ExportButtons } from "@/components/export/ExportButtons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { updateInvoiceDelivery, deleteInvoiceFromSummary } from "@/lib/actions/cash";

interface Props {
  initialSummary: any[];
  currentDate: string;
}

export function DailySummaryClient({ initialSummary, currentDate }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useRealtimeTable("invoices", () => router.refresh());

  const [dateFilter, setDateFilter] = useState(currentDate);
  const [activeRow, setActiveRow] = useState<any | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<any | null>(null);

  const [form, setForm] = useState({
    visit_status: "visited",
    delivery_status: "undispatched",
    reason: "",
    amount_received: "0",
  });

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const d = e.target.value;
    setDateFilter(d);
    router.push(`/tab4/daily-summary?date=${d}`);
  };

  const handleEditClick = (inv: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingInvoice(inv);
    setForm({
      visit_status: inv.visit_status || "visited",
      delivery_status: inv.delivery_status || "undispatched",
      reason: inv.reason || "",
      amount_received: String(inv.amount_received ?? "0"),
    });
  };

  const handleDeleteInvoice = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this invoice?")) return;
    startTransition(async () => {
      try {
        await deleteInvoiceFromSummary(id);
        if (activeRow) {
          setActiveRow((prev: any) => ({
            ...prev,
            invoices: prev.invoices.filter((i: any) => i.id !== id),
          }));
        }
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleSaveInvoice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInvoice) return;

    startTransition(async () => {
      try {
        // Reason must be explicitly null (not undefined) when cleared, so Supabase
        // actually writes NULL to the column instead of skipping the field entirely.
        // Also auto-clear reason when switching to a non-failure status.
        const isFailureStatus = form.delivery_status === "pending" || form.delivery_status === "undelivered";
        const reasonValue = isFailureStatus ? (form.reason.trim() || null) : null;

        await updateInvoiceDelivery(editingInvoice.id, {
          visit_status: form.visit_status,
          delivery_status: form.delivery_status,
          reason: reasonValue,
          amount_received: parseFloat(form.amount_received) || 0,
        });
        setEditingInvoice(null);
        setActiveRow(null); // Close drill-down to refresh
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const exportData = initialSummary.map((s) => ({
    Date: s.date,
    "Delivery Man": s.dm_name,
    Route: s.route,
    "Cash Invoices": s.cash_invoice_count,
    "Expected (Rs.)": s.expected,
    "Submitted (Rs.)": s.submitted,
    Difference: s.difference,
    Status: s.status,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div>
          <label className="block text-xs font-semibold text-zinc-500 mb-1 uppercase tracking-wider">
            Filter Date
          </label>
          <Input type="date" value={dateFilter} onChange={handleDateChange} className="w-48" />
        </div>
        <ExportButtons data={exportData} filename={`daily_summary_${dateFilter}`} />
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>DM</TableHead>
              <TableHead>Route</TableHead>
              <TableHead className="text-right">Cash Invoices</TableHead>
              <TableHead className="text-right">Expected (Rs.)</TableHead>
              <TableHead className="text-right">Submitted (Rs.)</TableHead>
              <TableHead className="text-right">Difference</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialSummary.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-zinc-400 py-8">
                  No routes/summaries found for this date
                </TableCell>
              </TableRow>
            ) : (
              initialSummary.map((item) => (
                <TableRow
                  key={item.id}
                  onClick={() => setActiveRow(item)}
                  className="cursor-pointer hover:bg-zinc-50/80"
                >
                  <TableCell>{item.date}</TableCell>
                  <TableCell className="font-semibold text-zinc-700">{item.dm_name}</TableCell>
                  <TableCell>{item.route}</TableCell>
                  <TableCell className="text-right">{item.cash_invoice_count}</TableCell>
                  <TableCell className="text-right">
                    Rs. {Number(item.expected).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    Rs. {Number(item.submitted).toLocaleString()}
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium ${
                      item.difference > 0 ? "text-red-600" : "text-green-600"
                    }`}
                  >
                    Rs. {Number(item.difference).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.status === "SHORTFALL" ? "destructive" : "success"}>
                      {item.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {activeRow && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl p-6 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-zinc-900">
                  Route Assignment Drill-Down: {activeRow.dm_name} ({activeRow.route})
                </h3>
                <p className="text-xs text-zinc-500 mt-1">
                  Expected: Rs. {Number(activeRow.expected).toLocaleString()} | Submitted: Rs.{" "}
                  {Number(activeRow.submitted).toLocaleString()}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setActiveRow(null)}>
                Close
              </Button>
            </div>

            <div className="border border-zinc-200 rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice No</TableHead>
                    <TableHead>Shop</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Grand Total</TableHead>
                    <TableHead>Visit</TableHead>
                    <TableHead>Delivery</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Submitted</TableHead>
                    <TableHead className="text-right">Diff</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeRow.invoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-zinc-400 py-6">
                        No invoices assigned to this route
                      </TableCell>
                    </TableRow>
                  ) : (
                    activeRow.invoices.map((inv: any) => {
                      const diff = inv.grand_total - (inv.amount_received || 0);
                      return (
                        <TableRow key={inv.id}>
                          <TableCell className="font-mono font-medium">{inv.invoice_no}</TableCell>
                          <TableCell>{inv.shop?.shop_name || "—"}</TableCell>
                          <TableCell className="capitalize">{inv.invoice_type}</TableCell>
                          <TableCell className="text-right">
                            Rs. {Number(inv.grand_total).toLocaleString()}
                          </TableCell>
                          <TableCell className="capitalize">{inv.visit_status || "—"}</TableCell>
                          <TableCell className="capitalize">{inv.delivery_status}</TableCell>
                          <TableCell>{inv.reason || <span className="text-zinc-400">—</span>}</TableCell>
                          <TableCell className="text-right">
                            Rs. {Number(inv.amount_received || 0).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right text-red-500">
                            Rs. {Number(diff).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => handleEditClick(inv, e)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-500 hover:text-red-700"
                                onClick={(e) => handleDeleteInvoice(inv.id, e)}
                              >
                                Delete
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      {editingInvoice && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-4">
              Edit Invoice Delivery: {editingInvoice.invoice_no}
            </h3>
            <form onSubmit={handleSaveInvoice} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Visit Status</label>
                <select
                  value={form.visit_status}
                  onChange={(e) => setForm({ ...form, visit_status: e.target.value })}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500"
                >
                  <option value="visited">Visited</option>
                  <option value="unvisited">Unvisited</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Delivery Status</label>
                <select
                  value={form.delivery_status}
                  onChange={(e) => {
                    const newStatus = e.target.value;
                    const isFailure = newStatus === "pending" || newStatus === "undelivered";
                    // Auto-clear reason when switching away from a failure status
                    setForm({ ...form, delivery_status: newStatus, reason: isFailure ? form.reason : "" });
                  }}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500"
                >
                  <option value="undispatched">Undispatched</option>
                  <option value="pending">Pending</option>
                  <option value="delivered">Delivered</option>
                  <option value="undelivered">Undelivered</option>
                </select>
              </div>
              {/* Only show Reason for failure statuses */}
              {(form.delivery_status === "pending" || form.delivery_status === "undelivered") && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Reason</label>
                  <Input
                    placeholder="e.g. Shop was closed"
                    value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Submitted / Received Amount (Rs.)</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount_received}
                  onChange={(e) => setForm({ ...form, amount_received: e.target.value })}
                  required
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Changes"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditingInvoice(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

