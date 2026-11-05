"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { Button } from "@/components/ui/Button";
import { Trash2 } from "lucide-react";
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
import { addDeposit, updateDeposit, deleteDeposit, deleteDeposits } from "@/lib/actions/cash";

interface Props {
  initialDeposits: any[];
}

export function DepositsClient({ initialDeposits }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useRealtimeTable("cash_deposits", () => router.refresh());

  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [form, setForm] = useState({
    deposit_date: new Date().toISOString().split("T")[0],
    amount: "",
    bank_name: "",
    bank_ref_no: "",
    for_date: new Date().toISOString().split("T")[0],
    status: "deposited",
    amount_change_reason: "",
  });

  const [originalAmount, setOriginalAmount] = useState<number | null>(null);

  const resetForm = () => {
    setForm({
      deposit_date: new Date().toISOString().split("T")[0],
      amount: "",
      bank_name: "",
      bank_ref_no: "",
      for_date: new Date().toISOString().split("T")[0],
      status: "deposited",
      amount_change_reason: "",
    });
    setOriginalAmount(null);
  };

  const handleEditClick = (item: any) => {
    setEditingItem(item);
    setOriginalAmount(Number(item.amount));
    setForm({
      deposit_date: item.deposit_date,
      amount: String(item.amount),
      bank_name: item.bank_name || "",
      bank_ref_no: item.bank_ref_no || "",
      for_date: item.for_date,
      status: item.status,
      amount_change_reason: item.amount_change_reason || "",
    });
    setShowModal(true);
  };

    const isAllSelected = initialDeposits.length > 0 && initialDeposits.every((d) => selectedIds.includes(d.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(initialDeposits.map((d) => d.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected deposit record(s)?`)) return;
    startTransition(async () => {
      try {
        await deleteDeposits(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this deposit record?")) return;
    startTransition(async () => {
      try {
        await deleteDeposit(id);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.amount || !form.deposit_date || !form.for_date) return;

    const currentAmount = parseFloat(form.amount);
    const amountChanged = originalAmount !== null && originalAmount !== currentAmount;

    startTransition(async () => {
      try {
        const payload: any = {
          deposit_date: form.deposit_date,
          amount: currentAmount,
          bank_name: form.bank_name.trim() || null,
          bank_ref_no: form.bank_ref_no.trim() || null,
          for_date: form.for_date,
          status: form.status,
        };

        if (amountChanged) {
          payload.amount_change_reason = form.amount_change_reason.trim();
        }

        if (editingItem) {
          await updateDeposit(editingItem.id, payload);
        } else {
          await addDeposit(payload);
        }
        setShowModal(false);
        setEditingItem(null);
        resetForm();
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const exportData = initialDeposits.map((d) => ({
    "Deposit Date": d.deposit_date,
    Amount: d.amount,
    "Bank Name": d.bank_name || "",
    "Bank Ref No": d.bank_ref_no || "",
    "For Date": d.for_date,
    Status: d.status,
    "Change Reason": d.amount_change_reason || "",
  }));

  return (
    <div className="space-y-4">
            <div className="flex justify-between items-center">
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
          <ExportButtons data={exportData} filename="cash_deposits" />
        </div>
        <Button onClick={() => { setEditingItem(null); resetForm(); setShowModal(true); }}>
          + Add Deposit Record
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center"><input type="checkbox" checked={isAllSelected} onChange={handleToggleSelectAll} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableHead>
              <TableHead>Deposit Date</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Amount (Rs.)</TableHead>
              <TableHead>Bank</TableHead>
              <TableHead>Bank Ref No</TableHead>
              <TableHead>For Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialDeposits.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-zinc-400 py-8">
                  No deposits recorded
                </TableCell>
              </TableRow>
            ) : (
              initialDeposits.map((item) => (
                <TableRow key={item.id} className={selectedIds.includes(item.id) ? "bg-red-50/50" : ""}>
                  <TableCell className="w-10 text-center"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => setSelectedIds(prev => prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableCell>
                  <TableCell>{item.deposit_date}</TableCell>
                  <TableCell>
                    {item.invoice ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-mono font-medium" style={{color:'var(--primary)'}}>{item.invoice.invoice_no}</span>
                        <Badge variant={item.invoice.invoice_type === "cash" ? "default" : "secondary"} >
                          {item.invoice.invoice_type}
                        </Badge>
                      </div>
                    ) : (
                      <span className="text-zinc-400 text-xs">Manual</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <div>
                      Rs. {Number(item.amount).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                    {item.amount_change_reason && (
                      <div className="text-xs text-red-500 italic mt-0.5" title={item.amount_change_reason}>
                        Reason: {item.amount_change_reason}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{item.bank_name || <span className="text-zinc-400">—</span>}</TableCell>
                  <TableCell className="font-mono">{item.bank_ref_no || <span className="text-zinc-400">—</span>}</TableCell>
                  <TableCell>{item.for_date}</TableCell>
                  <TableCell>
                    <Badge variant={item.status === "deposited" ? "success" : "warning"}>
                      {item.status}
                    </Badge>
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

      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-4">
              {editingItem ? "Edit Deposit" : "Add Deposit Record"}
            </h3>
            {/* Show note for auto-generated deposits */}
            {editingItem?.invoice && editingItem.status === "pending" && (
              <div className="mb-4 text-xs bg-[var(--primary-light)] border border-red-200 rounded-lg px-3 py-2" style={{color:'var(--primary-dark)'}}>
                <strong>Auto-generated</strong> from invoice <span className="font-mono">{editingItem.invoice.invoice_no}</span> ({editingItem.invoice.invoice_type}).
                Amount updates automatically when the invoice&apos;s submitted amount changes.
                Mark as <strong>Deposited</strong> once you confirm the bank deposit.
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Deposit Date</label>
                <Input
                  type="date"
                  value={form.deposit_date}
                  onChange={(e) => setForm({ ...form, deposit_date: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">For Date</label>
                <Input
                  type="date"
                  value={form.for_date}
                  onChange={(e) => setForm({ ...form, for_date: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Amount (Rs.)</label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  required
                />
              </div>
              {editingItem && originalAmount !== parseFloat(form.amount) && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Reason for Amount Change (optional)</label>
                  <Input
                    placeholder="Describe reason for adjustment (optional)..."
                    value={form.amount_change_reason}
                    onChange={(e) => setForm({ ...form, amount_change_reason: e.target.value })}
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Bank Name</label>
                <Input
                  placeholder="e.g. HBL Main"
                  value={form.bank_name}
                  onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Bank Ref No</label>
                <Input
                  placeholder="e.g. HBL-TXN-8845"
                  value={form.bank_ref_no}
                  onChange={(e) => setForm({ ...form, bank_ref_no: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500"
                >
                  <option value="pending">Pending</option>
                  <option value="deposited">Deposited</option>
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Record"}
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

