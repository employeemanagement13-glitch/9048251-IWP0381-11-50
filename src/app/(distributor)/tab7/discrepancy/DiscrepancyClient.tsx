"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { updateDiscrepancy, deleteDiscrepancy } from "@/lib/actions/discrepancy";

interface Props {
  initialDiscrepancies: any[];
}

export function DiscrepancyClient({ initialDiscrepancies }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [form, setForm] = useState({
    status: "pending",
    reason: "",
  });

  const handleEditClick = (item: any) => {
    setEditingItem(item);
    setForm({
      status: item.status,
      reason: item.reason || "",
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this discrepancy record?")) return;
    startTransition(async () => {
      try {
        await deleteDiscrepancy(id);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.status === "resolved" && !form.reason.trim()) {
      alert("A typed reason is required to resolve a discrepancy.");
      return;
    }

    startTransition(async () => {
      try {
        await updateDiscrepancy(editingItem.id, {
          status: form.status as any,
          reason: form.status === "resolved" ? form.reason.trim() : undefined,
        });
        setEditingItem(null);
        setForm({ status: "pending", reason: "" });
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="warning">Pending</Badge>;
      case "disputed":
        return <Badge variant="destructive">Disputed</Badge>;
      case "resolved":
        return <Badge variant="success">Resolved</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const exportData = initialDiscrepancies.map((d) => ({
    Product: d.product_name,
    "System Qty": d.system_qty,
    "Physical Qty": d.physical_qty,
    Diff: d.diff,
    "Audit Date": d.audit_date,
    Status: d.status,
    Reason: d.reason || "",
  }));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <ExportButtons data={exportData} filename="stock_discrepancy_report" />
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">System Qty</TableHead>
              <TableHead className="text-right">Physical Qty</TableHead>
              <TableHead className="text-right">Diff</TableHead>
              <TableHead>Audit Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialDiscrepancies.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-zinc-400 py-8">
                  No stock discrepancies reported
                </TableCell>
              </TableRow>
            ) : (
              initialDiscrepancies.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-semibold text-zinc-800">{item.product_name}</TableCell>
                  <TableCell className="text-right">{item.system_qty.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{item.physical_qty.toLocaleString()}</TableCell>
                  <TableCell
                    className={`text-right font-bold ${
                      item.diff > 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {item.diff > 0 ? "+" : ""}
                    {item.diff}
                  </TableCell>
                  <TableCell>{item.audit_date}</TableCell>
                  <TableCell>
                    <div>{getStatusBadge(item.status)}</div>
                    {item.status === "resolved" && item.reason && (
                      <div className="text-xs text-zinc-500 italic mt-0.5" title={item.reason}>
                        Reason: {item.reason}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => handleEditClick(item)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-700"
                        onClick={() => handleDelete(item.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {editingItem && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-4">Edit Stock Discrepancy</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500"
                >
                  <option value="pending">Pending</option>
                  <option value="disputed">Disputed</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>
              {form.status === "resolved" && (
                <div>
                  <label className="block text-sm font-medium text-red-600 mb-1">
                    Resolution Reason *
                  </label>
                  <Input
                    placeholder="Provide reason for discrepancy resolution..."
                    value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    required
                  />
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Changes"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditingItem(null)}>
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

