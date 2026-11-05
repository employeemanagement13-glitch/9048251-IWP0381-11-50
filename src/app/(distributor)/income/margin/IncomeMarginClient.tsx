"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Trash2, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { ExportButtons } from "@/components/export/ExportButtons";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/Table";
import { createSchemeIncome, updateSchemeIncome, deleteSchemeIncome, deleteSchemeIncomes } from "@/lib/actions/scheme-income";
import { parseProducts } from "@/lib/parsers/products";
import { calculateProductSalesFromInvoices } from "@/lib/utils/invoice-products";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const TODAY = new Date().toISOString().split("T")[0];
const FIRST_DAY_OF_MONTH = `${TODAY.substring(0, 8)}01`;

const fmt  = (n: number) => "Rs. " + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtD = (n: number) => "Rs. " + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtExact = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });

function monthToLabel(isoMonth: string) {
  const [y, m] = isoMonth.split("-");
  return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

type Tab = "margin" | "scheme";

interface Props { schemeRows: any[]; products: any[]; invoices?: any[]; vendorAccounts?: any[] }

export function IncomeMarginClient({ schemeRows, products, invoices = [], vendorAccounts = [] }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("margin");

  return (
    <div className="space-y-5">
      <div className="flex gap-1 bg-zinc-100 rounded-lg p-1">
        {([
          { key: "margin", label: "Margin Calculator" },
          { key: "scheme", label: "Incentive & Company Deposits" },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
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

      {activeTab === "margin"  && <MarginCalculator products={products} invoices={invoices} />}
      {activeTab === "scheme"  && <SchemeIncomeHead initialRows={schemeRows} vendorAccounts={vendorAccounts} />}
    </div>
  );
}

function MarginCalculator({ products, invoices = [] }: { products: any[]; invoices?: any[] }) {
  const [fromDate, setFromDate] = useState(FIRST_DAY_OF_MONTH);
  const [toDate, setToDate]     = useState(TODAY);
  const [appliedFrom, setAppliedFrom] = useState(FIRST_DAY_OF_MONTH);
  const [appliedTo, setAppliedTo]     = useState(TODAY);
  const [isLoading, setIsLoading]     = useState(false);

  const handleLoad = () => {
    setIsLoading(true);
    setTimeout(() => {
      setAppliedFrom(fromDate);
      setAppliedTo(toDate);
      setIsLoading(false);
    }, 150);
  };

  const { rows, totalMargin } = useMemo(() => {
    return calculateProductSalesFromInvoices(invoices, products, appliedFrom, appliedTo);
  }, [invoices, products, appliedFrom, appliedTo]);

  const exportData = rows.map((r) => ({
    Product: r.product,
    "Sales (units)": r.sales,
    "Case Profit (Rs.)": r.caseProfit,
    "Profit (Rs.)": r.profit.toFixed(2),
    "Running Balance (Rs.)": r.runningBalance.toFixed(2),
    "From Date": appliedFrom,
    "To Date": appliedTo,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-zinc-500">From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-9 px-2.5 py-1 text-sm border border-zinc-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-zinc-500">To</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-9 px-2.5 py-1 text-sm border border-zinc-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
          <Button
            size="sm"
            onClick={handleLoad}
            disabled={isLoading}
            className="flex items-center gap-1 h-9 px-3"
          >
            {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>Load</span>
          </Button>
          <ExportButtons data={exportData} filename="income_margin" />
        </div>
        <div className={`text-sm font-semibold rounded-lg px-4 py-1.5 border ${
          totalMargin >= 0 ? "text-green-700 bg-green-50 border-green-200" : "text-red-700 bg-red-50 border-red-200"
        }`}>
          Total Profit: {fmtD(totalMargin)}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Sales (units)</TableHead>
              <TableHead className="text-right">Case Profit (Rs.)</TableHead>
              <TableHead className="text-right">Profit (Rs.)</TableHead>
              <TableHead className="text-right">Running Balance (Rs.)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-zinc-400 py-8">
                  No products sold between {fromDate} and {toDate}
                </TableCell>
              </TableRow>
            ) : rows.map((r) => {
              return (
                <TableRow key={r.product}>
                  <TableCell className="font-medium">{r.product}</TableCell>
                  <TableCell className="text-right">{r.sales}</TableCell>
                  <TableCell className={`text-right font-mono font-semibold ${
                    !r.hasPrices ? "text-zinc-300" : r.caseProfit >= 0 ? "text-green-700" : "text-red-600"
                  }`}>
                    {r.hasPrices ? fmtExact(r.caseProfit) : "-"}
                  </TableCell>
                  <TableCell className={`text-right font-mono font-bold ${
                    !r.hasPrices ? "text-zinc-300" : r.profit >= 0 ? "text-green-700" : "text-red-600"
                  }`}>
                    {r.hasPrices ? fmtD(r.profit) : "-"}
                  </TableCell>
                  <TableCell className={`text-right font-mono font-bold ${
                    r.runningBalance >= 0 ? "text-emerald-700" : "text-red-600"
                  }`}>
                    {fmtD(r.runningBalance)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-zinc-400 italic">
        Formula: Case Profit = Sell Out Price - Sell In Price. Profit = Case Profit * Sales (units). Running Balance = Cumulative sum of Profit. Sales data is pulled from invoices created in the selected date range.
      </p>
    </div>
  );
}

const BLANK_SCHEME = {
  description: "",
  amount: "",
  income_month: `${TODAY.substring(0, 7)}-01`,
  vendor_account_id: "",
  income_date: TODAY,
};

function SchemeIncomeHead({ initialRows, vendorAccounts }: { initialRows: any[]; vendorAccounts: any[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fromDate, setFromDate]       = useState(FIRST_DAY_OF_MONTH);
  const [toDate, setToDate]           = useState(TODAY);
  const [appliedFrom, setAppliedFrom] = useState(FIRST_DAY_OF_MONTH);
  const [appliedTo, setAppliedTo]     = useState(TODAY);
  const [isLoading, setIsLoading]     = useState(false);
  const [showModal, setShowModal]     = useState(false);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [form, setForm]               = useState({ ...BLANK_SCHEME });

  const handleLoad = () => {
    setIsLoading(true);
    setTimeout(() => {
      setAppliedFrom(fromDate);
      setAppliedTo(toDate);
      setIsLoading(false);
    }, 150);
  };

  const sf = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const filtered = initialRows.filter((r) => {
    const d = (r.income_date || r.income_month || "").slice(0, 10);
    if (!d) return false;
    return d >= appliedFrom && d <= appliedTo;
  });

  const totalScheme = filtered.reduce((s, r) => s + Number(r.amount || 0), 0);

  const openAdd = () => {
    setEditingId(null);
    setForm({
      ...BLANK_SCHEME,
      income_month: `${TODAY.substring(0, 7)}-01`,
      income_date: TODAY,
    });
    setShowModal(true);
  };

  const openEdit = (r: any) => {
    setEditingId(r.id);
    setForm({
      description: r.description || "",
      amount: String(r.amount),
      income_month: r.income_month,
      vendor_account_id: r.vendor_account_id || r.bank_account_id || "",
      income_date: r.income_date || TODAY,
    });
    setShowModal(true);
  };

  const isAllSelected = filtered.length > 0 && filtered.every((r) => selectedIds.includes(r.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(filtered.map((r) => r.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Delete ${selectedIds.length} selected income record(s)?`)) return;
    setIsBulkDeleting(true);
    startTransition(async () => {
      try {
        await deleteSchemeIncomes(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (e: any) { alert(e.message); }
      finally { setIsBulkDeleting(false); }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this income entry?")) return;
    setDeletingId(id);
    startTransition(async () => {
      try { await deleteSchemeIncome(id); router.refresh(); }
      catch (e: any) { alert(e.message); }
      finally { setDeletingId(null); }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        const derivedMonth = form.income_date ? `${form.income_date.substring(0, 7)}-01` : `${TODAY.substring(0, 7)}-01`;
        const payload = {
          scheme_type: "other" as any,
          description: form.description || undefined,
          amount: parseFloat(form.amount),
          income_month: derivedMonth,
          vendor_account_id: form.vendor_account_id || undefined,
          income_date: form.income_date || undefined,
        };
        if (editingId) await updateSchemeIncome(editingId, payload);
        else           await createSchemeIncome(payload);
        setShowModal(false);
        router.refresh();
      } catch (e: any) { alert(e.message); }
    });
  };

  const exportData = filtered.map((r) => ({
    Description: r.description || "",
    "Amount (Rs.)": r.amount,
    Date: r.income_date || r.income_month || "",
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-zinc-500">From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-9 px-2.5 py-1 text-sm border border-zinc-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-zinc-500">To</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-9 px-2.5 py-1 text-sm border border-zinc-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
          <Button
            size="sm"
            onClick={handleLoad}
            disabled={isLoading}
            className="flex items-center gap-1 h-9 px-3"
          >
            {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>Load</span>
          </Button>
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
                disabled={isBulkDeleting || isPending}
                className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 whitespace-nowrap"
              >
                {isBulkDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete ({selectedIds.length})
              </Button>
            )}
          </div>
          <ExportButtons data={exportData} filename="scheme_income" />
        </div>
        <Button onClick={openAdd}>+ Add Incentive / Company Income</Button>
      </div>

      {filtered.length > 0 && (
        <div className="flex justify-start">
          <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3 flex flex-col justify-between w-48">
            <p className="text-xs text-zinc-500">Total Incentive / Company Income</p>
            <p className="text-lg font-bold" style={{ color: "var(--primary)" }}>Rs. {totalScheme.toLocaleString()}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center"><input type="checkbox" checked={isAllSelected} onChange={handleToggleSelectAll} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount (Rs.)</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-zinc-400 py-8">
                  No Incentive / Company Income recorded between {fromDate} and {toDate}
                </TableCell>
              </TableRow>
            ) : filtered.map((r) => (
              <TableRow key={r.id} className={selectedIds.includes(r.id) ? "bg-red-50/50" : ""}>
                <TableCell className="w-10 text-center"><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => setSelectedIds(prev => prev.includes(r.id) ? prev.filter(id => id !== r.id) : [...prev, r.id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableCell>
                <TableCell className="text-zinc-600">{r.description || "— "}</TableCell>
                <TableCell className="text-xs">{r.income_date || (r.income_month ? monthToLabel(r.income_month) : "— ")}</TableCell>
                <TableCell className="text-right font-bold" style={{ color: "var(--primary)" }}>
                  Rs. {Number(r.amount).toLocaleString()}
                </TableCell>
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
          </TableBody>
        </Table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-4">
              {editingId ? "Edit Incentive / Company Income" : "Add Incentive / Company Income"}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Description *</label>
                <Input
                  value={form.description}
                  onChange={(e) => sf("description", e.target.value)}
                  placeholder="e.g. Target Incentive"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Amount (Rs.) *</label>
                <Input
                  type="number" min="0" step="0.01"
                  value={form.amount}
                  onChange={(e) => sf("amount", e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Income Date *</label>
                <Input
                  type="date"
                  value={form.income_date}
                  onChange={(e) => sf("income_date", e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Link to Vendor Account</label>
                <select
                  className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white"
                  value={form.vendor_account_id}
                  onChange={(e) => sf("vendor_account_id", e.target.value)}
                >
                  <option value="">— None (unlinked) —</option>
                  {vendorAccounts.map((b: any) => (
                    <option key={b.id} value={b.id}>
                      {b.account_title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1 flex items-center justify-center gap-1.5" disabled={isPending}>
                  {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isPending ? "Saving..." : "Save"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
