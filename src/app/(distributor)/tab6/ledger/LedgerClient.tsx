"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
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
import { addRevenue } from "@/lib/actions/ledger";

interface Props {
  initialLedger: any[];
}

export function LedgerClient({ initialLedger }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    entry_date: new Date().toISOString().split("T")[0],
    description: "",
    amount: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim() || !form.amount) return;

    startTransition(async () => {
      try {
        await addRevenue({
          entry_date: form.entry_date,
          description: form.description.trim(),
          amount: parseFloat(form.amount),
        });
        setShowModal(false);
        setForm({
          entry_date: new Date().toISOString().split("T")[0],
          description: "",
          amount: "",
        });
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const exportData = initialLedger.map((item) => ({
    Date: item.entry_date,
    Description: item.description,
    Amount: item.amount,
    Balance: item.balance,
  }));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <ExportButtons data={exportData} filename="agency_ledger" />
        <Button onClick={() => setShowModal(true)}>+ Add Revenue</Button>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount In</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialLedger.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-zinc-400 py-8">
                  No ledger entries
                </TableCell>
              </TableRow>
            ) : (
              initialLedger.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.entry_date}</TableCell>
                  <TableCell>{item.description}</TableCell>
                  <TableCell
                    className={`text-right font-medium ${
                      item.amount >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {item.amount >= 0 ? "+" : ""}
                    {Number(item.amount).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </TableCell>
                  <TableCell
                    className={`text-right font-bold ${
                      item.balance >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {Number(item.balance).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
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
            <h3 className="text-lg font-bold text-zinc-900 mb-4">Add Revenue</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Date</label>
                <Input
                  type="date"
                  value={form.entry_date}
                  onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Description</label>
                <Input
                  placeholder="e.g. Cash Collected from DM"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Amount In (Rs.)</label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  required
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1" disabled={isPending}>
                  {isPending ? "Adding..." : "Add Entry"}
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

