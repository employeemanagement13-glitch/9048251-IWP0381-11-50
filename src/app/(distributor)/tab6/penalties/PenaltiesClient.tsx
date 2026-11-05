"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import {
  createPenalty,
  updatePenalty,
  disputePenalty,
  deletePenalty, deletePenalties,
} from "@/lib/actions/ccbpl";

interface Props {
  initialPenalties: any[];
}

export function PenaltiesClient({ initialPenalties }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [showModal, setShowModal] = useState(false);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activePenalty, setActivePenalty] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [form, setForm] = useState({
    penalty_date: new Date().toISOString().split("T")[0],
    ccbpl_ref: "",
    amount: "",
    reason: "",
    status: "pending",
    dispute_note: "",
  });

  const resetForm = () => {
    setForm({
      penalty_date: new Date().toISOString().split("T")[0],
      ccbpl_ref: "",
      amount: "",
      reason: "",
      status: "pending",
      dispute_note: "",
    });
  };

  const handleEdit = (item: any) => {
    setEditingId(item.id);
    setForm({
      penalty_date: item.penalty_date,
      ccbpl_ref: item.ccbpl_ref || "",
      amount: String(item.amount),
      reason: item.reason || "",
      status: item.status,
      dispute_note: item.dispute_note || "",
    });
    setShowModal(true);
  };

  const handleDisputeClick = (item: any) => {
    setActivePenalty(item);
    setForm((f) => ({ ...f, dispute_note: item.dispute_note || "" }));
    setShowDisputeModal(true);
  };

  const handleDisputeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePenalty) return;

    startTransition(async () => {
      try {
        await disputePenalty(activePenalty.id, form.dispute_note.trim());
        setShowDisputeModal(false);
        setActivePenalty(null);
        resetForm();
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

    const isAllSelected = initialPenalties.length > 0 && initialPenalties.every((item) => selectedIds.includes(item.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(initialPenalties.map((item) => item.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected penalty record(s)?`)) return;
    startTransition(async () => {
      try {
        await deletePenalties(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this penalty?")) return;
    startTransition(async () => {
      try {
        await deletePenalty(id);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.amount) return;

    startTransition(async () => {
      try {
        const payload = {
          penalty_date: form.penalty_date,
          ccbpl_ref: form.ccbpl_ref.trim() || undefined,
          amount: parseFloat(form.amount),
          reason: form.reason.trim() || undefined,
          status: form.status,
          dispute_note: form.dispute_note.trim() || undefined,
        };

        if (editingId) {
          await updatePenalty(editingId, payload);
        } else {
          await createPenalty(payload);
        }
        setShowModal(false);
        setEditingId(null);
        resetForm();
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
      case "settled":
      case "resolved":
        return <Badge variant="success">Resolved</Badge>;
      case "paid":
        return <Badge variant="default">Paid</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const exportData = initialPenalties.map((p) => ({
    Date: p.penalty_date,
    "CCBPL Ref": p.ccbpl_ref || "",
    Amount: p.amount,
    Reason: p.reason || "",
    Status: p.status,
    "Dispute Note": p.dispute_note || "",
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
          <ExportButtons data={exportData} filename="ccbpl_penalties" />
        </div>
        <Button onClick={() => { setEditingId(null); resetForm(); setShowModal(true); }}>
          + Add Penalty
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center"><input type="checkbox" checked={isAllSelected} onChange={handleToggleSelectAll} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableHead>
              <TableHead>Date</TableHead>
              <TableHead>CCBPL Ref</TableHead>
              <TableHead className="text-right">Amount (Rs.)</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialPenalties.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-zinc-400 py-8">
                  No penalties registered
                </TableCell>
              </TableRow>
            ) : (
              initialPenalties.map((item) => (
                <TableRow key={item.id} className={selectedIds.includes(item.id) ? "bg-red-50/50" : ""}>
                  <TableCell className="w-10 text-center"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => setSelectedIds(prev => prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableCell>
                  <TableCell>{item.penalty_date}</TableCell>
                  <TableCell className="font-mono">{item.ccbpl_ref || <span className="text-zinc-400">—</span>}</TableCell>
                  <TableCell className="text-right font-medium">
                    Rs. {Number(item.amount).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </TableCell>
                  <TableCell>
                    <div>{item.reason || <span className="text-zinc-400">—</span>}</div>
                    {item.status === "disputed" && item.dispute_note && (
                      <div className="text-xs text-red-500 mt-1 italic">
                        Dispute Note: {item.dispute_note}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{getStatusBadge(item.status)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      {item.status !== "disputed" && item.status !== "resolved" && item.status !== "settled" && (
                        <Button size="sm" variant="outline" onClick={() => handleDisputeClick(item)}>
                          Dispute
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => handleEdit(item)}>
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
              {editingId ? "Edit Penalty" : "Add Penalty"}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Date</label>
                <Input
                  type="date"
                  value={form.penalty_date}
                  onChange={(e) => setForm({ ...form, penalty_date: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">CCBPL Ref</label>
                <Input
                  placeholder="e.g. PEN-2025-01"
                  value={form.ccbpl_ref}
                  onChange={(e) => setForm({ ...form, ccbpl_ref: e.target.value })}
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
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Reason</label>
                <Input
                  placeholder="e.g. Display compliance failure"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
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
                  <option value="disputed">Disputed</option>
                  <option value="paid">Paid</option>
                  <option value="resolved">Resolved</option>
                  <option value="settled">Settled</option>
                </select>
              </div>
              {form.status === "disputed" && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Dispute Note</label>
                  <Input
                    placeholder="Provide details about the dispute..."
                    value={form.dispute_note}
                    onChange={(e) => setForm({ ...form, dispute_note: e.target.value })}
                  />
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Penalty"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDisputeModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-4">Dispute Penalty</h3>
            <form onSubmit={handleDisputeSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Dispute Note *</label>
                <Input
                  placeholder="Explain why this penalty is disputed..."
                  value={form.dispute_note}
                  onChange={(e) => setForm({ ...form, dispute_note: e.target.value })}
                  required
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1" disabled={isPending}>
                  {isPending ? "Submitting Dispute..." : "Confirm Dispute"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowDisputeModal(false)}>
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

