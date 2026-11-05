"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { ExportButtons } from "@/components/export/ExportButtons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { createExpense, updateExpense, deleteExpense, deleteExpenses } from "@/lib/actions/ccbpl";

interface Props {
  initialExpenses: any[];
}

const CATEGORIES = ["Fuel", "Maintenance", "Salary", "Miscellaneous", "Other"];

export function ExpensesClient({ initialExpenses }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [form, setForm] = useState({
    expense_date: new Date().toISOString().split("T")[0],
    category: "Fuel",
    description: "",
    amount: "",
    paid_by: "Owner",
  });

  const resetForm = () => {
    setForm({
      expense_date: new Date().toISOString().split("T")[0],
      category: "Fuel",
      description: "",
      amount: "",
      paid_by: "Owner",
    });
  };

  const handleEdit = (item: any) => {
    setEditingId(item.id);
    setForm({
      expense_date: item.expense_date,
      category: item.category,
      description: item.description || "",
      amount: String(item.amount),
      paid_by: item.paid_by || "Owner",
    });
    setShowModal(true);
  };

    const isAllSelected = initialExpenses.length > 0 && initialExpenses.every((item) => selectedIds.includes(item.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(initialExpenses.map((item) => item.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected expense(s)?`)) return;
    startTransition(async () => {
      try {
        await deleteExpenses(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this expense?")) return;
    startTransition(async () => {
      try {
        await deleteExpense(id);
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
          expense_date: form.expense_date,
          category: form.category,
          description: form.description.trim() || undefined,
          amount: parseFloat(form.amount),
          paid_by: form.paid_by.trim() || undefined,
        };

        if (editingId) {
          await updateExpense(editingId, payload);
        } else {
          await createExpense(payload);
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

  const exportData = initialExpenses.map((e) => ({
    Date: e.expense_date,
    Category: e.category,
    Description: e.description || "",
    Amount: e.amount,
    "Paid By": e.paid_by || "",
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
          <ExportButtons data={exportData} filename="agency_expenses" />
        </div>
        <Button onClick={() => { setEditingId(null); resetForm(); setShowModal(true); }}>
          + Add Expense
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center"><input type="checkbox" checked={isAllSelected} onChange={handleToggleSelectAll} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount (Rs.)</TableHead>
              <TableHead>Paid By</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialExpenses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-zinc-400 py-8">
                  No expenses found
                </TableCell>
              </TableRow>
            ) : (
              initialExpenses.map((item) => (
                <TableRow key={item.id} className={selectedIds.includes(item.id) ? "bg-red-50/50" : ""}>
                  <TableCell className="w-10 text-center"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => setSelectedIds(prev => prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableCell>
                  <TableCell>{item.expense_date}</TableCell>
                  <TableCell className="font-semibold text-zinc-700">{item.category}</TableCell>
                  <TableCell>{item.description || <span className="text-zinc-400">—</span>}</TableCell>
                  <TableCell className="text-right font-medium">
                    Rs. {Number(item.amount).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </TableCell>
                  <TableCell>{item.paid_by || "Owner"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
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
              {editingId ? "Edit Expense" : "Add Expense"}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Date</label>
                <Input
                  type="date"
                  value={form.expense_date}
                  onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Description</label>
                <Input
                  placeholder="e.g. Diesel for TRK-01"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
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
                <label className="block text-sm font-medium text-zinc-700 mb-1">Paid By</label>
                <Input
                  placeholder="e.g. Owner, Driver"
                  value={form.paid_by}
                  onChange={(e) => setForm({ ...form, paid_by: e.target.value })}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Expense"}
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

