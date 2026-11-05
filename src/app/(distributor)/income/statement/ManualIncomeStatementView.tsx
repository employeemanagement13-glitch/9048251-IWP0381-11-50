"use client";

import { useState, useEffect, useTransition, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import {
  getManualStatementData,
  saveSalesRevenueRecord,
  saveCOGSRecord,
  saveOtherIncomeRecord,
  saveExpenseRecord,
  deleteManualRecord,
  ManualStatementData,
  COGSLineItem,
  ManualStatementRecord,
} from "@/lib/actions/manual-income-statement";
import { getProducts } from "@/lib/actions/products";
import { Plus, Edit2, Trash2, X, Search, Loader2 } from "lucide-react";
import { ManualIncomeStatementExportButtons } from "@/components/export/ManualIncomeStatementExportButtons";

interface Props {
  monthYear: string;
}

const fmt = (n: number) =>
  "Rs. " +
  Number(n || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function formatOpexDate(d?: string | null) {
  if (!d) return "";
  const parts = d.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return d;
}

export function ManualIncomeStatementView({ monthYear }: Props) {
  const [isPending, startTransition] = useTransition();
  const [data, setData] = useState<ManualStatementData>({
    revenue: null,
    cogs: null,
    otherIncome: [],
    opex: [],
  });
  const [productsList, setProductsList] = useState<any[]>([]);

  const [revenueModalOpen, setRevenueModalOpen] = useState(false);
  const [revenueDesc, setRevenueDesc] = useState("Net Sales Revenue");
  const [revenueAmount, setRevenueAmount] = useState("");
  const [revenueEditId, setRevenueEditId] = useState<string | undefined>(undefined);

  const [cogsModalOpen, setCogsModalOpen] = useState(false);
  const [cogsLineItems, setCogsLineItems] = useState<COGSLineItem[]>([]);
  const [cogsEditId, setCogsEditId] = useState<string | undefined>(undefined);
  const [productSearch, setProductSearch] = useState("");
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);

  const [otherIncomeModalOpen, setOtherIncomeModalOpen] = useState(false);
  const [otherIncomeDesc, setOtherIncomeDesc] = useState("");
  const [otherIncomeAmount, setOtherIncomeAmount] = useState("");
  const [otherIncomeEditId, setOtherIncomeEditId] = useState<string | undefined>(undefined);

  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split("T")[0]);
  const [expenseDesc, setExpenseDesc] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseEditId, setExpenseEditId] = useState<string | undefined>(undefined);

  const refreshData = () => {
    startTransition(async () => {
      const res = await getManualStatementData(monthYear);
      setData(res);
    });
  };

  useEffect(() => {
    refreshData();
    getProducts().then((p) => setProductsList(p || []));
  }, [monthYear]);

  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return productsList.slice(0, 20);
    const q = productSearch.toLowerCase();
    return productsList.filter(
      (p) =>
        (p.product_code || "").toLowerCase().includes(q) ||
        (p.product_name || "").toLowerCase().includes(q)
    );
  }, [productsList, productSearch]);

  const revVal = data.revenue?.amount ?? 0;
  const cogsVal = data.cogs?.amount ?? 0;
  const grossProfit = revVal - cogsVal;
  const otherIncomeVal = data.otherIncome.reduce((s, x) => s + (x.amount || 0), 0);
  const totalIncome = grossProfit + otherIncomeVal;
  const opexVal = data.opex.reduce((s, x) => s + (x.amount || 0), 0);
  const netProfit = totalIncome - opexVal;

  const openAddRevenue = () => {
    setRevenueDesc(data.revenue?.description || "Net Sales Revenue");
    setRevenueAmount(data.revenue?.amount ? String(data.revenue.amount) : "");
    setRevenueEditId(data.revenue?.id);
    setRevenueModalOpen(true);
  };

  const handleSaveRevenue = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(revenueAmount);
    if (isNaN(amt)) return;
    startTransition(async () => {
      await saveSalesRevenueRecord(monthYear, revenueDesc, amt, revenueEditId);
      setRevenueModalOpen(false);
      refreshData();
    });
  };

  const handleDeleteRevenue = () => {
    if (!data.revenue) return;
    if (!confirm("Are you sure you want to delete this Sales Revenue entry?")) return;
    startTransition(async () => {
      await deleteManualRecord(data.revenue!.id, monthYear, "revenue");
      refreshData();
    });
  };

  const openAddCOGS = () => {
    if (data.cogs) {
      setCogsLineItems(data.cogs.line_items || []);
      setCogsEditId(data.cogs.id);
    } else {
      setCogsLineItems([]);
      setCogsEditId(undefined);
    }
    setProductSearch("");
    setCogsModalOpen(true);
  };

  const handleAddProductToCOGS = (prod: any) => {
    const existingIndex = cogsLineItems.findIndex((it) => it.product_id === prod.id);
    if (existingIndex >= 0) {
      const copy = [...cogsLineItems];
      copy[existingIndex].sold_qty += 1;
      copy[existingIndex].amount = copy[existingIndex].purchase_rate * copy[existingIndex].sold_qty;
      setCogsLineItems(copy);
    } else {
      const rate = Number(prod.purchase_rate) || 0;
      const newItem: COGSLineItem = {
        id: crypto.randomUUID(),
        product_id: prod.id,
        code: prod.product_code || "",
        name: prod.product_name || "",
        purchase_rate: rate,
        sold_qty: 1,
        amount: rate * 1,
      };
      setCogsLineItems([...cogsLineItems, newItem]);
    }
    setProductSearch("");
    setProductDropdownOpen(false);
  };

  const handleUpdateCOGSLine = (idx: number, field: "purchase_rate" | "sold_qty", val: number) => {
    const copy = [...cogsLineItems];
    copy[idx][field] = val;
    copy[idx].amount = (copy[idx].purchase_rate || 0) * (copy[idx].sold_qty || 0);
    setCogsLineItems(copy);
  };

  const handleRemoveCOGSLine = (idx: number) => {
    setCogsLineItems(cogsLineItems.filter((_, i) => i !== idx));
  };

  const handleSaveCOGS = (e: React.FormEvent) => {
    e.preventDefault();
    if (cogsLineItems.length === 0) return;
    startTransition(async () => {
      await saveCOGSRecord(monthYear, cogsLineItems, cogsEditId);
      setCogsModalOpen(false);
      refreshData();
    });
  };

  const handleDeleteCOGS = () => {
    if (!data.cogs) return;
    if (!confirm("Are you sure you want to delete this COGS entry?")) return;
    startTransition(async () => {
      await deleteManualRecord(data.cogs!.id, monthYear, "cogs");
      refreshData();
    });
  };

  const openAddOtherIncome = () => {
    setOtherIncomeDesc("");
    setOtherIncomeAmount("");
    setOtherIncomeEditId(undefined);
    setOtherIncomeModalOpen(true);
  };

  const openEditOtherIncome = (item: ManualStatementRecord) => {
    setOtherIncomeDesc(item.description);
    setOtherIncomeAmount(String(item.amount));
    setOtherIncomeEditId(item.id);
    setOtherIncomeModalOpen(true);
  };

  const handleSaveOtherIncome = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(otherIncomeAmount);
    if (isNaN(amt)) return;
    startTransition(async () => {
      await saveOtherIncomeRecord(monthYear, otherIncomeDesc, amt, otherIncomeEditId);
      setOtherIncomeModalOpen(false);
      refreshData();
    });
  };

  const handleDeleteOtherIncome = (item: ManualStatementRecord) => {
    if (!confirm(`Delete "${item.description}"?`)) return;
    startTransition(async () => {
      await deleteManualRecord(item.id, monthYear, "other_income");
      refreshData();
    });
  };

  const openAddExpense = () => {
    setExpenseDate(new Date().toISOString().split("T")[0]);
    setExpenseDesc("");
    setExpenseAmount("");
    setExpenseEditId(undefined);
    setExpenseModalOpen(true);
  };

  const openEditExpense = (item: ManualStatementRecord) => {
    setExpenseDate(item.entry_date || new Date().toISOString().split("T")[0]);
    setExpenseDesc(item.description);
    setExpenseAmount(String(item.amount));
    setExpenseEditId(item.id);
    setExpenseModalOpen(true);
  };

  const handleSaveExpense = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(expenseAmount);
    if (isNaN(amt)) return;
    startTransition(async () => {
      await saveExpenseRecord(monthYear, expenseDesc, amt, expenseDate, expenseEditId);
      setExpenseModalOpen(false);
      refreshData();
    });
  };

  const handleDeleteExpense = (item: ManualStatementRecord) => {
    if (!confirm(`Delete "${item.description}"?`)) return;
    startTransition(async () => {
      await deleteManualRecord(item.id, monthYear, "opex");
      refreshData();
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-zinc-900">
            Manual Income Statement — {monthYear}
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Manually created income statement template for {monthYear}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ManualIncomeStatementExportButtons data={data} monthYear={monthYear} />
          <div
            className={`text-sm font-bold px-4 py-1.5 rounded-lg border ${
              netProfit >= 0
                ? "bg-green-50 border-green-200 text-green-700"
                : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            Net Profit (Pre-Tax): {fmt(netProfit)}
          </div>
        </div>
      </div>

      <div className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-2.5 flex flex-wrap gap-4 items-center">
        <div>
          <span className="font-semibold text-zinc-500">Sales Revenue:</span>{" "}
          <span className="font-bold text-zinc-900">{fmt(revVal)}</span>
        </div>
        <span className="text-zinc-300">|</span>
        <div>
          <span className="font-semibold text-zinc-500">COGS:</span>{" "}
          <span className="font-bold text-zinc-900">{fmt(cogsVal)}</span>
        </div>
        <span className="text-zinc-300">|</span>
        <div>
          <span className="font-semibold text-zinc-500">Gross Profit:</span>{" "}
          <span className={`font-bold ${grossProfit >= 0 ? "text-emerald-700" : "text-red-700"}`}>
            {fmt(grossProfit)}
          </span>
        </div>
        <span className="text-zinc-300">|</span>
        <div>
          <span className="font-semibold text-zinc-500">Other Income:</span>{" "}
          <span className="font-bold text-zinc-900">{fmt(otherIncomeVal)}</span>
        </div>
        <span className="text-zinc-300">|</span>
        <div>
          <span className="font-semibold text-zinc-500">Total OPEX:</span>{" "}
          <span className="font-bold text-zinc-900">{fmt(opexVal)}</span>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50 border-b border-zinc-200">
              <TableHead className="font-bold text-zinc-700">Description</TableHead>
              <TableHead className="text-right font-bold text-zinc-700 w-52">Amount (PKR)</TableHead>
              <TableHead className="text-right font-bold text-zinc-700 w-36">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-zinc-100/80 border-t border-b border-zinc-200">
              <TableCell colSpan={3} className="py-2 px-4">
                <div className="flex items-center justify-between w-full">
                  <span className="font-bold text-zinc-900 uppercase text-xs tracking-wider">
                    A. SALES REVENUE
                  </span>
                  {!data.revenue && (
                    <Button
                      size="sm"
                      onClick={openAddRevenue}
                      className="h-7 text-xs flex items-center gap-1 whitespace-nowrap shrink-0"
                      disabled={isPending}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Sales Revenue</span>
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
            {data.revenue ? (
              <TableRow className="hover:bg-zinc-50">
                <TableCell className="font-medium text-zinc-800 pl-6">
                  {data.revenue.description || "Net Sales Revenue"}
                </TableCell>
                <TableCell className="text-right font-semibold text-zinc-900 font-mono">
                  {fmt(data.revenue.amount)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={openAddRevenue}
                      className="h-7 px-2 text-xs text-zinc-600 hover:text-zinc-900"
                      disabled={isPending}
                    >
                      <Edit2 className="w-3.5 h-3.5 mr-1" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleDeleteRevenue}
                      className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                      disabled={isPending}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-xs text-zinc-400 py-3 italic">
                  No Sales Revenue recorded. Click &ldquo;Add Sales Revenue&rdquo; above.
                </TableCell>
              </TableRow>
            )}

            <TableRow className="bg-zinc-100/80 border-t border-b border-zinc-200">
              <TableCell colSpan={3} className="py-2 px-4">
                <div className="flex items-center justify-between w-full">
                  <span className="font-bold text-zinc-900 uppercase text-xs tracking-wider">
                    B. COST OF GOODS SOLD (COGS)
                  </span>
                  {!data.cogs && (
                    <Button
                      size="sm"
                      onClick={openAddCOGS}
                      className="h-7 text-xs flex items-center gap-1 whitespace-nowrap shrink-0"
                      disabled={isPending}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add COGS</span>
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
            {data.cogs ? (
              <>
                <TableRow className="hover:bg-zinc-50 font-medium">
                  <TableCell className="font-semibold text-zinc-900 pl-6">
                    TOTAL COGS
                  </TableCell>
                  <TableCell className="text-right font-bold text-zinc-900 font-mono">
                    {fmt(data.cogs.amount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={openAddCOGS}
                        className="h-7 px-2 text-xs text-zinc-600 hover:text-zinc-900"
                        disabled={isPending}
                      >
                        <Edit2 className="w-3.5 h-3.5 mr-1" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleDeleteCOGS}
                        className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                        disabled={isPending}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                <TableRow className="bg-blue-50/50 font-semibold border-b border-zinc-200">
                  <TableCell className="text-blue-900 pl-6">
                    GROSS PROFIT (Revenue − COGS)
                  </TableCell>
                  <TableCell
                    className={`text-right font-bold font-mono ${
                      grossProfit >= 0 ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    {fmt(grossProfit)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </>
            ) : (
              <>
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-xs text-zinc-400 py-3 italic">
                    No COGS recorded. Click &ldquo;Add COGS&rdquo; above.
                  </TableCell>
                </TableRow>
                <TableRow className="bg-blue-50/40 font-semibold border-b border-zinc-200">
                  <TableCell className="text-blue-900 pl-6">
                    GROSS PROFIT (Revenue − COGS)
                  </TableCell>
                  <TableCell
                    className={`text-right font-bold font-mono ${
                      grossProfit >= 0 ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    {fmt(grossProfit)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </>
            )}

            <TableRow className="bg-zinc-100/80 border-t border-b border-zinc-200">
              <TableCell colSpan={3} className="py-2 px-4">
                <div className="flex items-center justify-between w-full">
                  <span className="font-bold text-zinc-900 uppercase text-xs tracking-wider">
                    C. OTHER INCOME — CCBPL Schemes &amp; Incentives
                  </span>
                  <Button
                    size="sm"
                    onClick={openAddOtherIncome}
                    className="h-7 text-xs flex items-center gap-1 whitespace-nowrap shrink-0"
                    disabled={isPending}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Incentive / Other Income</span>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
            {data.otherIncome.length > 0 ? (
              data.otherIncome.map((item) => (
                <TableRow key={item.id} className="hover:bg-zinc-50">
                  <TableCell className="font-medium text-zinc-800 pl-6">{item.description}</TableCell>
                  <TableCell className="text-right font-semibold text-emerald-700 font-mono">
                    {fmt(item.amount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditOtherIncome(item)}
                        className="h-7 px-2 text-xs text-zinc-600 hover:text-zinc-900"
                        disabled={isPending}
                      >
                        <Edit2 className="w-3.5 h-3.5 mr-1" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteOtherIncome(item)}
                        className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                        disabled={isPending}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-xs text-zinc-400 py-3 italic">
                  No Other Income recorded. Click &ldquo;Add Incentive / Other Income&rdquo; above.
                </TableCell>
              </TableRow>
            )}
            <TableRow className="bg-zinc-50 font-medium border-t border-zinc-200">
              <TableCell className="font-semibold text-zinc-800 pl-6">TOTAL OTHER INCOME</TableCell>
              <TableCell className="text-right font-bold text-emerald-700 font-mono">
                {fmt(otherIncomeVal)}
              </TableCell>
              <TableCell />
            </TableRow>
            <TableRow className="bg-indigo-50/50 font-semibold border-b border-zinc-200">
              <TableCell className="text-indigo-900 pl-6">
                TOTAL INCOME (Gross Profit + Other Income)
              </TableCell>
              <TableCell className="text-right font-bold text-indigo-900 font-mono">
                {fmt(totalIncome)}
              </TableCell>
              <TableCell />
            </TableRow>

            <TableRow className="bg-zinc-100/80 border-t border-b border-zinc-200">
              <TableCell colSpan={3} className="py-2 px-4">
                <div className="flex items-center justify-between w-full">
                  <span className="font-bold text-zinc-900 uppercase text-xs tracking-wider">
                    D. OPERATING EXPENSES (OPEX)
                  </span>
                  <Button
                    size="sm"
                    onClick={openAddExpense}
                    className="h-7 text-xs flex items-center gap-1 whitespace-nowrap shrink-0"
                    disabled={isPending}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Expense</span>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
            {data.opex.length > 0 ? (
              data.opex.map((item) => (
                <TableRow key={item.id} className="hover:bg-zinc-50">
                  <TableCell className="font-medium text-zinc-800 pl-6">
                    <span>{item.description}</span>
                    {item.entry_date && (
                      <span className="text-xs text-zinc-400 ml-2 font-mono">
                        | {formatOpexDate(item.entry_date)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-red-700 font-mono">
                    {fmt(item.amount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditExpense(item)}
                        className="h-7 px-2 text-xs text-zinc-600 hover:text-zinc-900"
                        disabled={isPending}
                      >
                        <Edit2 className="w-3.5 h-3.5 mr-1" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteExpense(item)}
                        className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                        disabled={isPending}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-xs text-zinc-400 py-3 italic">
                  No Operating Expenses recorded. Click &ldquo;Add Expense&rdquo; above.
                </TableCell>
              </TableRow>
            )}
            <TableRow className="bg-zinc-50 font-medium border-t border-zinc-200">
              <TableCell className="font-semibold text-zinc-800 pl-6">TOTAL OPEX</TableCell>
              <TableCell className="text-right font-bold text-red-700 font-mono">
                {fmt(opexVal)}
              </TableCell>
              <TableCell />
            </TableRow>

            <TableRow className="bg-zinc-900 hover:bg-zinc-900 text-white font-bold">
              <TableCell className="py-3.5 pl-6 text-sm text-zinc-100" colSpan={1}>
                NET PROFIT (Pre-Tax) &nbsp;= Total Income − Total OPEX
              </TableCell>
              <TableCell
                className={`py-3.5 text-right font-bold text-lg font-mono ${
                  netProfit >= 0 ? "text-green-400" : "text-red-400"
                }`}
              >
                {fmt(netProfit)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {revenueModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 border border-zinc-200">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-zinc-900">
                {revenueEditId ? "Edit Sales Revenue" : "Add Sales Revenue"}
              </h3>
              <button
                onClick={() => setRevenueModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveRevenue} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Description
                </label>
                <Input
                  value={revenueDesc}
                  onChange={(e) => setRevenueDesc(e.target.value)}
                  placeholder="e.g. Net Sales Revenue"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Amount (PKR)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={revenueAmount}
                  onChange={(e) => setRevenueAmount(e.target.value)}
                  placeholder="e.g. 1343009.28"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRevenueModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Sales Revenue"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {cogsModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full p-6 space-y-4 border border-zinc-200 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-zinc-900">
                  {cogsEditId ? "Edit Cost of Goods Sold (COGS)" : "Add Cost of Goods Sold (COGS)"}
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Select products to build the COGS order line-item calculation table.
                </p>
              </div>
              <button
                onClick={() => setCogsModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative">
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                Select Product (Search by Code or Name)
              </label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-400" />
                <Input
                  value={productSearch}
                  onChange={(e) => {
                    setProductSearch(e.target.value);
                    setProductDropdownOpen(true);
                  }}
                  onFocus={() => setProductDropdownOpen(true)}
                  placeholder="Type product code or name to search..."
                  className="pl-9"
                />
              </div>
              {productDropdownOpen && filteredProducts.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-zinc-200 rounded-md shadow-lg max-h-56 overflow-y-auto z-50">
                  {filteredProducts.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => handleAddProductToCOGS(p)}
                      className="px-3 py-2 text-xs hover:bg-zinc-100 cursor-pointer flex items-center justify-between border-b border-zinc-50"
                    >
                      <div>
                        <span className="font-mono font-semibold text-blue-800 mr-2">
                          [{p.product_code || "—"}]
                        </span>
                        <span className="font-medium text-zinc-900">{p.product_name}</span>
                      </div>
                      <span className="text-zinc-500 font-mono">
                        Purchase: Rs. {Number(p.purchase_rate || 0).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto border border-zinc-200 rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="bg-zinc-50">
                    <TableHead className="w-24">Code</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="w-36">Purchase Rate</TableHead>
                    <TableHead className="w-28">Sold Qty</TableHead>
                    <TableHead className="w-36 text-right">Amount (PKR)</TableHead>
                    <TableHead className="w-12 text-center" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cogsLineItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-xs text-zinc-400 py-8">
                        No products added yet. Use the search bar above to select products.
                      </TableCell>
                    </TableRow>
                  ) : (
                    cogsLineItems.map((line, idx) => (
                      <TableRow key={line.id}>
                        <TableCell className="font-mono text-xs text-zinc-600 font-semibold">
                          {line.code || "—"}
                        </TableCell>
                        <TableCell className="font-medium text-zinc-800 text-xs">
                          {line.name}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={line.purchase_rate}
                            onChange={(e) =>
                              handleUpdateCOGSLine(
                                idx,
                                "purchase_rate",
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="h-8 text-xs font-mono"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="1"
                            value={line.sold_qty}
                            onChange={(e) =>
                              handleUpdateCOGSLine(
                                idx,
                                "sold_qty",
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="h-8 text-xs font-mono"
                          />
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold text-zinc-900 text-xs">
                          {fmt(line.amount)}
                        </TableCell>
                        <TableCell className="text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveCOGSLine(idx)}
                            className="text-zinc-400 hover:text-red-600 p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between border-t pt-3">
              <div className="text-sm font-semibold text-zinc-800">
                Total COGS:{" "}
                <span className="font-bold text-zinc-900 font-mono">
                  {fmt(
                    cogsLineItems.reduce((s, it) => s + (Number(it.amount) || 0), 0)
                  )}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCogsModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={isPending || cogsLineItems.length === 0}
                  onClick={handleSaveCOGS}
                >
                  {isPending ? "Saving..." : "Save COGS"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {otherIncomeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 border border-zinc-200">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-zinc-900">
                {otherIncomeEditId ? "Edit Other Income / Scheme" : "Add Incentive / Other Income"}
              </h3>
              <button
                onClick={() => setOtherIncomeModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveOtherIncome} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Description
                </label>
                <Input
                  value={otherIncomeDesc}
                  onChange={(e) => setOtherIncomeDesc(e.target.value)}
                  placeholder="e.g. Incentive of JULY or Promo 1st sep to 15 sep"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Amount (PKR)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={otherIncomeAmount}
                  onChange={(e) => setOtherIncomeAmount(e.target.value)}
                  placeholder="e.g. 105000"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOtherIncomeModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Other Income"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {expenseModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 border border-zinc-200">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-zinc-900">
                {expenseEditId ? "Edit Expense" : "Add Expense"}
              </h3>
              <button
                onClick={() => setExpenseModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveExpense} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Date
                </label>
                <Input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Description
                </label>
                <Input
                  value={expenseDesc}
                  onChange={(e) => setExpenseDesc(e.target.value)}
                  placeholder="e.g. Electricity | LESCO or Fleet Fuel — LES-18-1133"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Amount (PKR)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  placeholder="e.g. 69000"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setExpenseModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Expense"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
