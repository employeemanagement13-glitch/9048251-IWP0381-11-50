"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { ExportButtons } from "@/components/export/ExportButtons";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/Table";
import {
  createPurchase, updatePurchase, markStockArrived, deletePurchase, deletePurchases,
} from "@/lib/actions/ccbpl";

interface Props {
  initialPurchases: any[];
}

const statusBadge = (status: string) => {
  if (status === "stock_arrived")
    return <Badge variant="success">Stock Arrived</Badge>;
  return <Badge variant="warning">In Progress</Badge>;
};

export function PurchasingClient({ initialPurchases }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeId, setDisputeId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [form, setForm] = useState({
    po_no: "",
    product_name: "",
    ordered_qty: "",
    received_qty: "",
    billed_amount: "",
  });

  const resetForm = (poNo = "") =>
    setForm({ po_no: poNo, product_name: "", ordered_qty: "", received_qty: "", billed_amount: "" });

  const openAdd = () => {
    setEditingId(null);
    
    // Auto-assign PO No: PO-Year-MonthDay
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const basePoNo = `PO-${year}-${month}${day}`;

    let autoPoNo = basePoNo;
    const existingSameDay = initialPurchases.filter((p) => p.po_no?.startsWith(basePoNo));
    if (existingSameDay.length > 0) {
      let maxSuffix = 0;
      existingSameDay.forEach((p) => {
        if (p.po_no === basePoNo) {
          maxSuffix = Math.max(maxSuffix, 1); // Base exists, need at least -2
        } else {
          const match = p.po_no.match(new RegExp(`^${basePoNo}-(\\d+)$`));
          if (match) {
            maxSuffix = Math.max(maxSuffix, parseInt(match[1], 10));
          }
        }
      });
      if (maxSuffix > 0) {
        autoPoNo = `${basePoNo}-${maxSuffix + 1}`;
      }
    }

    resetForm(autoPoNo);
    setShowModal(true);
  };

  const openEdit = (p: any) => {
    setEditingId(p.id);
    setForm({
      po_no: p.po_no || "",
      product_name: p.product_name || "",
      ordered_qty: String(p.ordered_qty ?? ""),
      received_qty: String(p.received_qty ?? ""),
      billed_amount: String(p.billed_amount ?? ""),
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.po_no.trim() || !form.product_name.trim() || !form.ordered_qty) return;

    startTransition(async () => {
      try {
        const payload = {
          po_no: form.po_no.trim(),
          product_name: form.product_name.trim(),
          ordered_qty: parseInt(form.ordered_qty),
          received_qty: form.received_qty ? parseInt(form.received_qty) : undefined,
          billed_amount: form.billed_amount ? parseFloat(form.billed_amount) : undefined,
        };
        if (editingId) {
          await updatePurchase(editingId, payload);
        } else {
          await createPurchase(payload);
        }
        setShowModal(false);
        resetForm();
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleMarkArrived = (id: string) => {
    if (!confirm("Mark this purchase as Stock Arrived? This will update warehouse stock and post to Agency Ledger.")) return;
    startTransition(async () => {
      try {
        await markStockArrived(id);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

    const isAllSelected = initialPurchases.length > 0 && initialPurchases.every((p) => selectedIds.includes(p.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(initialPurchases.map((p) => p.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected purchase order(s)?`)) return;
    startTransition(async () => {
      try {
        await deletePurchases(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this purchase order?")) return;
    startTransition(async () => {
      try {
        await deletePurchase(id);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const exportData = initialPurchases.map((p) => ({
    "PO No": p.po_no,
    Product: p.product_name,
    "Ordered Qty": p.ordered_qty,
    "Received Qty": p.received_qty ?? "",
    "Billed (Rs.)": p.billed_amount ?? "",
    Status: p.status === "stock_arrived" ? "Stock Arrived" : "In Progress",
  }));

  return (
    <div className="space-y-4">
            <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={isAllSelected ? "ghost" : "outline"}
            size="sm"
            onClick={handleToggleSelectAll}
            className="whitespace-nowrap"
          >
            {isAllSelected ? "Deselect All" : "Select All"}
          </Button>
          {selectedIds.length > 0 && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={handleBulkDelete}
              disabled={isPending}
              className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 whitespace-nowrap"
            >
              <Trash2 className="h-4 w-4" />
              Delete ({selectedIds.length})
            </Button>
          )}
          <ExportButtons data={exportData} filename="ccbpl_purchases" />
        </div>
        <Button onClick={openAdd}>+ Add Purchase Order</Button>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center"><input type="checkbox" checked={isAllSelected} onChange={handleToggleSelectAll} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableHead>
              <TableHead>PO No</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Ordered Qty</TableHead>
              <TableHead className="text-right">Received Qty</TableHead>
              <TableHead className="text-right">Billed (Rs.)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialPurchases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-zinc-400 py-8">
                  No purchase orders
                </TableCell>
              </TableRow>
            ) : (
              initialPurchases.map((p) => (
                <TableRow key={p.id} className={selectedIds.includes(p.id) ? "bg-red-50/50" : ""}>
                  <TableCell className="w-10 text-center"><input type="checkbox" checked={selectedIds.includes(p.id)} onChange={() => setSelectedIds(prev => prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableCell>
                  <TableCell className="font-mono font-medium">{p.po_no}</TableCell>
                  <TableCell>{p.product_name}</TableCell>
                  <TableCell className="text-right">{p.ordered_qty.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    {p.received_qty != null ? p.received_qty.toLocaleString() : <span className="text-zinc-400">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    {p.billed_amount != null
                      ? `Rs. ${Number(p.billed_amount).toLocaleString()}`
                      : <span className="text-zinc-400">—</span>}
                  </TableCell>
                  <TableCell>{statusBadge(p.status)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      {p.status === "in_progress" && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleMarkArrived(p.id)}
                          disabled={isPending}
                        >
                          Mark Arrived
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-700"
                        onClick={() => handleDelete(p.id)}
                        disabled={isPending}
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

      {/* Status legend */}
      <div className="flex gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
          In Progress — no warehouse or ledger writes
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          Stock Arrived — warehouse + Agency Ledger updated immediately
        </span>
      </div>

      {/* ADD / EDIT MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-4">
              {editingId ? "Edit Purchase Order" : "Add Purchase Order"}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-zinc-700 mb-1">PO No *</label>
                  <Input
                    placeholder="e.g. PO-2025-01"
                    value={form.po_no}
                    onChange={(e) => setForm({ ...form, po_no: e.target.value })}
                    required
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Product *</label>
                  <Input
                    placeholder="e.g. Coke 1.5L"
                    value={form.product_name}
                    onChange={(e) => setForm({ ...form, product_name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Ordered Qty *</label>
                  <Input
                    type="number"
                    min={1}
                    value={form.ordered_qty}
                    onChange={(e) => setForm({ ...form, ordered_qty: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Received Qty</label>
                  <Input
                    type="number"
                    min={0}
                    value={form.received_qty}
                    onChange={(e) => setForm({ ...form, received_qty: e.target.value })}
                    placeholder="Set before Mark Arrived"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Billed Amount (Rs.)</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.billed_amount}
                    onChange={(e) => setForm({ ...form, billed_amount: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
              </div>
              {!editingId && (
                <p className="text-xs text-zinc-500 bg-zinc-50 rounded p-2 border border-zinc-200">
                  New orders start as <strong>In Progress</strong>. Warehouse stock and Agency Ledger are not affected until you click &ldquo;Mark Arrived&rdquo;.
                </p>
              )}
              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1" disabled={isPending}>
                  {isPending ? "Saving..." : editingId ? "Save Changes" : "Create PO"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
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

