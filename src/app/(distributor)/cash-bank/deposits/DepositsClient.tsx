"use client";

import { useState, useTransition, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { ExportButtons } from "@/components/export/ExportButtons";
import { Button } from "@/components/ui/Button";
import { Loader2, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/Table";
import { addDeposit, updateDeposit, deleteDeposit, deleteDeposits, getCashDeposits } from "@/lib/actions/cash";
import { createCashMovement, updateCashMovement, deleteCashMovement, deleteCashMovements, getCashMovements } from "@/lib/actions/bank-accounts";

const TODAY = new Date().toISOString().split("T")[0];
const FIRST = `${TODAY.substring(0, 8)}01`;

const fmt = (n: number) =>
  "Rs. " + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  initialDeposits: any[];
  initialMovements: any[];
  transactionAccounts: any[];
  vendorAccounts: any[];
}

function SearchableAccountSelect({
  value, onChange, accounts, placeholder,
}: {
  value: string;
  onChange: (v: string, type: "transaction" | "vendor") => void;
  accounts: { id: string; label: string; type: "transaction" | "vendor" }[];
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(
    () => accounts.filter((a) => a.label.toLowerCase().includes(q.toLowerCase())),
    [accounts, q]
  );

  const selected = accounts.find((a) => a.id === value);

  return (
    <div className="relative">
      <input
        type="text"
        className="w-full h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
        value={open ? q : (selected?.label || "")}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => { setQ(""); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder || "Search account..."}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
          {filtered.map((a) => (
            <button
              key={a.id}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 flex items-center justify-between gap-2"
              onMouseDown={() => { onChange(a.id, a.type); setOpen(false); setQ(""); }}
            >
              <span>{a.label}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${a.type === "transaction" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>
                {a.type === "transaction" ? "TXN" : "VND"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TransactionAccountSelect({
  value, onChange, accounts, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  accounts: any[];
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = useMemo(
    () => accounts.filter((a) => (a.account_title || "").toLowerCase().includes(q.toLowerCase())),
    [accounts, q]
  );
  const selected = accounts.find((a) => a.id === value);
  return (
    <div className="relative">
      <input
        type="text"
        className="w-full h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
        value={open ? q : (selected?.account_title || "")}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => { setQ(""); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder || "Search transaction account..."}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
          {filtered.map((a) => (
            <button
              key={a.id}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50"
              onMouseDown={() => { onChange(a.id); setOpen(false); setQ(""); }}
            >
              {a.account_title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-zinc-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 text-lg"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function DateRangeBar({
  fromDate, toDate, onFrom, onTo, onLoad, isLoading,
}: {
  fromDate: string; toDate: string;
  onFrom: (v: string) => void; onTo: (v: string) => void;
  onLoad: () => void;
  isLoading?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-zinc-500">From</span>
      <input type="date" value={fromDate} onChange={(e) => onFrom(e.target.value)}
        className="h-9 px-2.5 text-sm border border-zinc-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400" />
      <span className="text-xs font-semibold text-zinc-500">To</span>
      <input type="date" value={toDate} onChange={(e) => onTo(e.target.value)}
        className="h-9 px-2.5 text-sm border border-zinc-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400" />
      <Button variant="outline" size="sm" onClick={onLoad} disabled={isLoading} className="flex items-center gap-1.5 whitespace-nowrap">
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        Load
      </Button>
    </div>
  );
}

function AddDepositSection({
  initialDeposits,
  transactionAccounts,
}: {
  initialDeposits: any[];
  transactionAccounts: any[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fromDate, setFromDate] = useState(FIRST);
  const [toDate, setToDate] = useState(TODAY);
  const [filterFrom, setFilterFrom] = useState(FIRST);
  const [filterTo, setFilterTo] = useState(TODAY);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deposits, setDeposits] = useState(initialDeposits);
  const [isLoading, setIsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [form, setForm] = useState({
    deposit_date: TODAY,
    description: "",
    bank_account_id: "",
    amount: "",
  });

  const sf = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    setDeposits(initialDeposits);
  }, [initialDeposits]);

  const filtered = useMemo(
    () =>
      (deposits || []).filter((d) => {
        const date = (d.deposit_date || d.for_date || "").substring(0, 10);
        if (!date) return true;
        if (filterFrom && date < filterFrom) return false;
        if (filterTo && date > filterTo) return false;
        return true;
      }),
    [deposits, filterFrom, filterTo]
  );

  const isAllSelected = filtered.length > 0 && filtered.every((d) => selectedIds.includes(d.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(filtered.map((d) => d.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected deposit(s)?`)) return;
    startTransition(async () => {
      try {
        await deleteDeposits(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (e: any) {
        alert(e.message);
      }
    });
  };

  const handleLoad = async () => {
    setIsLoading(true);
    try {
      const fresh = await getCashDeposits({ dateFrom: fromDate, dateTo: toDate });
      setDeposits(fresh);
      setFilterFrom(fromDate);
      setFilterTo(toDate);
    } finally {
      setIsLoading(false);
    }
  };

  const openAdd = () => {
    setEditingId(null);
    setForm({ deposit_date: TODAY, description: "", bank_account_id: transactionAccounts[0]?.id || "", amount: "" });
    setShowModal(true);
  };

  const openEdit = (r: any) => {
    setEditingId(r.id);
    setForm({
      deposit_date: (r.deposit_date || r.for_date || TODAY).substring(0, 10),
      description: r.description || "",
      bank_account_id: r.bank_account_id || "",
      amount: String(r.amount),
    });
    setShowModal(true);
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this deposit?")) return;
    setDeletingId(id);
    startTransition(async () => {
      try { await deleteDeposit(id); router.refresh(); }
      catch (e: any) { alert(e.message); }
      finally { setDeletingId(null); }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.bank_account_id || !form.amount) return;
    startTransition(async () => {
      try {
        const payload = {
          deposit_date: form.deposit_date,
          description: form.description,
          bank_account_id: form.bank_account_id,
          amount: parseFloat(form.amount),
        };
        if (editingId) await updateDeposit(editingId, payload);
        else await addDeposit(payload);
        setShowModal(false);
        router.refresh();
      } catch (e: any) { alert(e.message); }
    });
  };

  const accLabel = (id: string) => {
    if (!id) return "—";
    return transactionAccounts.find((a) => a.id === id)?.account_title || id;
  };

  const exportData = useMemo(() => {
    return filtered.map((d) => ({
      Date: (d.deposit_date || d.for_date || "").substring(0, 10),
      Description: d.description || d.bank_name || d.bank_ref_no || "",
      Account: accLabel(d.bank_account_id),
      Amount: Number(d.amount || 0),
    }));
  }, [filtered, transactionAccounts]);

  const totalAmount = useMemo(() => {
    return filtered.reduce((sum, d) => sum + Number(d.amount || 0), 0);
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeBar
            fromDate={fromDate} toDate={toDate}
            onFrom={setFromDate} onTo={setToDate} onLoad={handleLoad}
            isLoading={isLoading}
          />
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
        <Button onClick={openAdd} className="flex items-center gap-1.5">
          <span>+ Add Deposit</span>
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={handleToggleSelectAll}
                  className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                  title="Select All"
                />
              </TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-zinc-400 py-10">
                  No deposits for this period
                </TableCell>
              </TableRow>
            ) : (
              <>
                {filtered.map((r) => (
                  <TableRow key={r.id} className={selectedIds.includes(r.id) ? "bg-red-50/50" : ""}>
                    <TableCell className="w-10 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(r.id)}
                        onChange={() =>
                          setSelectedIds((prev) =>
                            prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                          )
                        }
                        className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                      />
                    </TableCell>
                    <TableCell className="text-xs font-mono">{(r.deposit_date || r.for_date || "").substring(0, 10)}</TableCell>
                    <TableCell className="text-zinc-600">{r.description || r.bank_name || r.bank_ref_no || "—"}</TableCell>
                    <TableCell className="text-xs">{accLabel(r.bank_account_id)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold text-xs">{fmt(r.amount)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
                        <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700 min-w-[2rem] flex items-center justify-center"
                          onClick={() => handleDelete(r.id)} disabled={deletingId === r.id || isPending}>
                          {deletingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Delete"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-zinc-50 font-bold border-t border-zinc-200">
                  <TableCell colSpan={4} className="text-xs text-zinc-700">
                    Total Deposits ({filtered.length})
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-zinc-900">
                    {fmt(totalAmount)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>

      {showModal && (
        <Modal title={editingId ? "Edit Deposit" : "Add Deposit"} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Date *">
              <Input type="date" value={form.deposit_date} onChange={(e) => sf("deposit_date", e.target.value)} required />
            </Field>
            <Field label="Description *">
              <Input placeholder="e.g. Daily cash deposit" value={form.description}
                onChange={(e) => sf("description", e.target.value)} required />
            </Field>
            <Field label="Account *">
              <TransactionAccountSelect
                value={form.bank_account_id}
                onChange={(v) => sf("bank_account_id", v)}
                accounts={transactionAccounts}
                placeholder="Search transaction account..."
              />
            </Field>
            <Field label="Amount (Rs.) *">
              <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount}
                onChange={(e) => sf("amount", e.target.value)} required />
            </Field>
            <div className="flex gap-2 pt-1">
              <Button type="submit" className="flex-1 flex items-center justify-center gap-1.5" disabled={isPending}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPending ? "Saving..." : "Save"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function MoveCashSection({
  initialMovements, transactionAccounts, vendorAccounts,
}: {
  initialMovements: any[];
  transactionAccounts: any[];
  vendorAccounts: any[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fromDate, setFromDate] = useState(FIRST);
  const [toDate, setToDate] = useState(TODAY);
  const [filterFrom, setFilterFrom] = useState(FIRST);
  const [filterTo, setFilterTo] = useState(TODAY);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [movements, setMovements] = useState(initialMovements);
  const [isLoading, setIsLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [form, setForm] = useState({
    movement_date: TODAY,
    description: "",
    from_account_id: "",
    from_account_type: "transaction" as "transaction" | "vendor",
    to_account_id: "",
    to_account_type: "transaction" as "transaction" | "vendor",
    amount: "",
  });

  const sf = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const allAccounts = useMemo(() => [
    ...transactionAccounts.map((a) => ({ id: a.id, label: a.account_title, type: "transaction" as const })),
    ...vendorAccounts.map((a) => ({ id: a.id, label: a.account_title, type: "vendor" as const })),
  ], [transactionAccounts, vendorAccounts]);

  useEffect(() => {
    setMovements(initialMovements);
  }, [initialMovements]);

  const filtered = useMemo(
    () => movements.filter((m) => m.movement_date >= filterFrom && m.movement_date <= filterTo),
    [movements, filterFrom, filterTo]
  );

  const isAllSelected = filtered.length > 0 && filtered.every((m) => selectedIds.includes(m.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(filtered.map((m) => m.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected cash movement(s)?`)) return;
    startTransition(async () => {
      try {
        await deleteCashMovements(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (e: any) {
        alert(e.message);
      }
    });
  };

  const handleLoad = async () => {
    setIsLoading(true);
    try {
      const fresh = await getCashMovements({ dateFrom: fromDate, dateTo: toDate });
      setMovements(fresh);
      setFilterFrom(fromDate);
      setFilterTo(toDate);
    } finally {
      setIsLoading(false);
    }
  };

  const openAdd = () => {
    setEditingId(null);
    setForm({
      movement_date: TODAY, description: "",
      from_account_id: "", from_account_type: "transaction",
      to_account_id: "", to_account_type: "transaction",
      amount: "",
    });
    setShowModal(true);
  };

  const openEdit = (r: any) => {
    setEditingId(r.id);
    setForm({
      movement_date: r.movement_date,
      description: r.description || "",
      from_account_id: r.from_account_id,
      from_account_type: r.from_account_type,
      to_account_id: r.to_account_id,
      to_account_type: r.to_account_type,
      amount: String(r.amount),
    });
    setShowModal(true);
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this movement?")) return;
    startTransition(async () => {
      try { await deleteCashMovement(id); router.refresh(); }
      catch (e: any) { alert(e.message); }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.from_account_id || !form.to_account_id || !form.amount) return;
    startTransition(async () => {
      try {
        const payload = {
          movement_date: form.movement_date,
          description: form.description,
          from_account_id: form.from_account_id,
          from_account_type: form.from_account_type,
          to_account_id: form.to_account_id,
          to_account_type: form.to_account_type,
          amount: parseFloat(form.amount),
        };
        if (editingId) await updateCashMovement(editingId, payload);
        else await createCashMovement(payload);
        setShowModal(false);
        router.refresh();
      } catch (e: any) { alert(e.message); }
    });
  };

  const accLabel = (id: string) => allAccounts.find((a) => a.id === id)?.label || id;

  const exportData = useMemo(() => {
    return filtered.map((m) => ({
      Date: (m.movement_date || "").substring(0, 10),
      Description: m.description || "",
      "From Account": accLabel(m.from_account_id),
      "To Account": accLabel(m.to_account_id),
      Amount: Number(m.amount || 0),
    }));
  }, [filtered, allAccounts]);

  const totalAmount = useMemo(() => {
    return filtered.reduce((sum, m) => sum + Number(m.amount || 0), 0);
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeBar
            fromDate={fromDate} toDate={toDate}
            onFrom={setFromDate} onTo={setToDate} onLoad={handleLoad}
            isLoading={isLoading}
          />
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
          <ExportButtons data={exportData} filename="cash_movements" />
        </div>
        <Button onClick={openAdd} className="flex items-center gap-1.5">
          <span>+ Move Cash</span>
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={handleToggleSelectAll}
                  className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                  title="Select All"
                />
              </TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>From → To</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-zinc-400 py-10">
                  No cash movements for this period
                </TableCell>
              </TableRow>
            ) : (
              <>
                {filtered.map((r) => (
                  <TableRow key={r.id} className={selectedIds.includes(r.id) ? "bg-red-50/50" : ""}>
                    <TableCell className="w-10 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(r.id)}
                        onChange={() =>
                          setSelectedIds((prev) =>
                            prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                          )
                        }
                        className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                      />
                    </TableCell>
                    <TableCell className="text-xs font-mono">{r.movement_date}</TableCell>
                    <TableCell className="text-zinc-600">{r.description || "—"}</TableCell>
                    <TableCell className="text-xs">
                      <span className="font-medium">{accLabel(r.from_account_id)}</span>
                      <span className="text-zinc-400 mx-1.5">→</span>
                      <span className="font-medium">{accLabel(r.to_account_id)}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold text-xs">{fmt(r.amount)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
                        <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700 min-w-[2rem] flex items-center justify-center"
                          onClick={() => handleDelete(r.id)} disabled={deletingId === r.id || isPending}>
                          {deletingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Delete"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-zinc-50 font-bold border-t border-zinc-200">
                  <TableCell colSpan={4} className="text-xs text-zinc-700">
                    Total Movements ({filtered.length})
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-zinc-900">
                    {fmt(totalAmount)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>

      {showModal && (
        <Modal title={editingId ? "Edit Movement" : "Move Cash"} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Date *">
              <Input type="date" value={form.movement_date} onChange={(e) => sf("movement_date", e.target.value)} required />
            </Field>
            <Field label="Description">
              <Input placeholder="e.g. Transfer to vendor" value={form.description}
                onChange={(e) => sf("description", e.target.value)} />
            </Field>
            <Field label="From *">
              <SearchableAccountSelect
                value={form.from_account_id}
                onChange={(id, type) => setForm((f) => ({ ...f, from_account_id: id, from_account_type: type }))}
                accounts={allAccounts}
                placeholder="Search source account..."
              />
            </Field>
            <Field label="To *">
              <SearchableAccountSelect
                value={form.to_account_id}
                onChange={(id, type) => setForm((f) => ({ ...f, to_account_id: id, to_account_type: type }))}
                accounts={allAccounts}
                placeholder="Search destination account..."
              />
            </Field>
            <Field label="Amount (Rs.) *">
              <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount}
                onChange={(e) => sf("amount", e.target.value)} required />
            </Field>
            <div className="flex gap-2 pt-1">
              <Button type="submit" className="flex-1 flex items-center justify-center gap-1.5" disabled={isPending}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPending ? "Saving..." : "Save"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

type ActiveTab = "deposit" | "movement";

export function DepositsClient({ initialDeposits, initialMovements, transactionAccounts, vendorAccounts }: Props) {
  const router = useRouter();
  useRealtimeTable("cash_deposits", () => router.refresh());
  useRealtimeTable("cash_movements", () => router.refresh());

  const [activeTab, setActiveTab] = useState<ActiveTab>("deposit");

  return (
    <div className="space-y-5">
      <div className="flex gap-1 bg-zinc-100 rounded-lg p-1">
        {([
          { key: "deposit", label: "Add Deposit" },
          { key: "movement", label: "Move Cash" },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={[
              "px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-150",
              activeTab === t.key
                ? "bg-white shadow-sm font-semibold"
                : "text-zinc-600 hover:text-zinc-900 hover:bg-white/60",
            ].join(" ")}
            style={activeTab === t.key ? { color: "var(--primary)" } : {}}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "deposit" && (
        <AddDepositSection
          initialDeposits={initialDeposits}
          transactionAccounts={transactionAccounts}
        />
      )}
      {activeTab === "movement" && (
        <MoveCashSection
          initialMovements={initialMovements}
          transactionAccounts={transactionAccounts}
          vendorAccounts={vendorAccounts}
        />
      )}
    </div>
  );
}
