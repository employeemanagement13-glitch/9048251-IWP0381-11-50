"use client";

import { useState, useTransition, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, Pencil } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { ExportButtons } from "@/components/export/ExportButtons";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  createWaybill,
} from "@/lib/actions/warehouse-waybills";
import { createStockReport } from "@/lib/actions/warehouse-catalogue";
import { StockReportModal } from "./StockReportModal";

interface PendingReturnInvoice {
  invoice_id: string;
  invoice_no: string;
  invoice_date: string;
  shop_name: string;
  outlet_code: string;
  pending_products: { product_name: string; invoiced_qty: number; returned_qty: number }[];
}

interface WarehouseRow {
  id: string;
  code: string;
  product_name: string;
  product_id?: string;
  total_qty: number;
  ph_case?: number;
  unit_case?: number;
  set_un_case?: number;
  flappy?: number;
  returned?: number;
  unreturned?: number;
  available?: number;
}

interface ProductForReport {
  id: string;
  product_name: string;
  product_code?: string | null;
  category_id?: string | null;
  purchase_rate?: number | null;
  product_categories?: { id: string; title: string; set_un_case: number; is_returnable?: boolean; is_rgb?: boolean } | null;
}

interface WarehouseCategory {
  id?: string;
  title: string;
}

interface Props {
  category: WarehouseCategory;
  type: "standard" | "rgb" | "empties" | "implied";
  data: WarehouseRow[];
  pendingReturns: PendingReturnInvoice[];
  allProducts?: ProductForReport[];
}

function getDummyStandardRows(categoryTitle: string): WarehouseRow[] {
  return [];
}

function CreateWaybillModal({
  products,
  onClose,
  onSaved,
}: {
  products: ProductForReport[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [sapWaybill, setSapWaybill] = useState("");
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<{ product: ProductForReport; quantity: number }[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const usedIds = lines.map((l) => l.product.id);
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return products
      .filter((p) => !usedIds.includes(p.id))
      .filter((p) => p.product_name.toLowerCase().includes(q) || (p.product_code ?? "").toLowerCase().includes(q))
      .slice(0, 20);
  }, [query, products, usedIds]);

  const addProduct = (p: ProductForReport) => {
    setLines((prev) => [...prev, { product: p, quantity: 0 }]);
    setQuery("");
    setDropdownOpen(false);
  };

  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sapWaybill.trim()) { alert("SAP Waybill number is required."); return; }
    if (!lines.length) { alert("Add at least one product."); return; }
    if (lines.some((l) => l.quantity <= 0)) { alert("All quantities must be greater than 0."); return; }
    startTransition(async () => {
      try {
        await createWaybill({
          date,
          sap_waybill: sapWaybill.trim(),
          items: lines.map((l) => ({
            product_id: l.product.id,
            product_code: l.product.product_code ?? "",
            product_name: l.product.product_name,
            quantity: l.quantity,
          })),
        });
        onSaved();
      } catch (ex: any) {
        alert(ex.message);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-zinc-100 flex-shrink-0">
          <h2 className="text-[0.9375rem] font-bold text-zinc-800">Create Waybill</h2>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-xl font-bold leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-4 sm:px-6 py-3 sm:py-4 space-y-3 sm:space-y-4 flex-shrink-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
              </div>
              <div>
                <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">SAP Waybill No.</label>
                <input type="text" value={sapWaybill} onChange={(e) => setSapWaybill(e.target.value)} placeholder="e.g. 4900123456" className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" required />
              </div>
            </div>
            <div ref={dropRef} className="relative">
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Products</label>
              <div className="flex items-center gap-2 border border-zinc-200 rounded-lg px-3 py-1.5 bg-white">
                <Search className="text-zinc-400 shrink-0 h-[0.8125rem] w-[0.8125rem]" />
                <input
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true); }}
                  onFocus={() => setDropdownOpen(true)}
                  placeholder="Search and select product..."
                  className="flex-1 text-[0.75rem] outline-none bg-transparent"
                />
              </div>
              {dropdownOpen && filtered.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg z-50 max-h-52 overflow-y-auto">
                  {filtered.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="w-full flex items-start gap-2 px-3 py-2 hover:bg-zinc-50 text-left text-[0.75rem]"
                      onClick={() => addProduct(p)}
                    >
                      <span className="font-medium text-zinc-800">{p.product_name}</span>
                      {p.product_code && <span className="ml-auto font-mono text-zinc-400 text-[0.625rem]">{p.product_code}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {lines.length > 0 && (
            <div className="px-4 sm:px-6 flex-1 overflow-y-auto pb-2">
              <div className="bg-zinc-50 rounded-xl border border-zinc-200 overflow-x-auto">
                <table className="w-full text-[0.75rem]">
                  <thead>
                    <tr className="bg-zinc-100 border-b border-zinc-200">
                      <th className="text-left px-3 py-2 font-semibold text-zinc-600">Code</th>
                      <th className="text-left px-3 py-2 font-semibold text-zinc-600">Product</th>
                      <th className="text-right px-3 py-2 font-semibold text-emerald-700">Quantity</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.product.id} className="border-b border-zinc-100">
                        <td className="px-3 py-2 font-mono text-zinc-500">{l.product.product_code || "—"}</td>
                        <td className="px-3 py-2 font-medium text-zinc-800">{l.product.product_name}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={l.quantity || ""}
                            placeholder="0"
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((x, idx) => idx === i ? { ...x, quantity: parseInt(e.target.value) || 0 } : x)
                              )
                            }
                            className="w-24 text-right text-[0.75rem] border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-red-400 bg-white ml-auto block"
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button type="button" onClick={() => removeLine(i)} className="text-zinc-400 hover:text-red-500 transition-colors">
                            <span className="text-base leading-none">×</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {lines.length === 0 && (
            <div className="px-6 py-6 text-center text-zinc-400 text-[0.75rem]">Search and add implied products above.</div>
          )}
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-zinc-100 flex gap-2 flex-shrink-0">
            <Button type="submit" className="flex-1" disabled={isPending || lines.length === 0}>
              {isPending ? "Saving..." : "Save"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Inline Edit Stock Row Modal ────────────────────────────────────────────
function EditStockRowModal({
  row,
  product,
  onClose,
  onSaved,
}: {
  row: WarehouseRow;
  product: ProductForReport | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [reportDate, setReportDate] = useState(today);
  const setUnCase = Number((product?.product_categories as any)?.set_un_case) || 1;
  const [phCase, setPhCase] = useState(String(row.ph_case ?? row.total_qty ?? 0));
  const [unitCase, setUnitCase] = useState(String(row.unit_case ?? 0));
  const [amount, setAmount] = useState("0");

  const handlePhChange = (val: string) => {
    setPhCase(val);
    const ph = parseFloat(val) || 0;
    setUnitCase(String(parseFloat((ph * setUnCase).toFixed(2))));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ph = parseFloat(phCase);
    if (isNaN(ph) || ph < 0) { alert("Ph.Case must be a valid non-negative number."); return; }
    if (!product?.id && !row.product_id) { alert("Cannot identify product. Please use Add Stock Report instead."); return; }
    const currentPh = Number(row.ph_case ?? row.total_qty ?? 0);
    const deltaPh = parseFloat((ph - currentPh).toFixed(4));
    const currentUnit = Number(row.unit_case ?? 0);
    const nextUnit = parseFloat(unitCase) || 0;
    const deltaUnit = parseFloat((nextUnit - currentUnit).toFixed(4));
    startTransition(async () => {
      try {
        if (Math.abs(deltaPh) < 0.0001 && Math.abs(deltaUnit) < 0.0001) {
          onSaved();
          return;
        }
        await createStockReport(reportDate, [{
          product_id: (product?.id || row.product_id)!,
          ph_case: deltaPh,
          unit_case: deltaUnit,
          amount: parseFloat(amount) || 0,
        }]);
        onSaved();
      } catch (err: any) {
        alert(err.message ?? "Failed to save.");
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div>
            <h3 className="text-[0.875rem] font-bold text-zinc-900">Edit Stock Level</h3>
            <p className="text-[0.6875rem] text-zinc-500 mt-0.5">Sets Ph.Case to the value you enter (does not add on top of the current level)</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 text-lg">×</button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div className="bg-zinc-50 rounded-lg px-3 py-2.5 border border-zinc-200">
            <p className="text-[0.625rem] font-semibold text-zinc-500 uppercase tracking-wide mb-0.5">Product</p>
            <p className="text-sm font-bold text-zinc-800">{row.product_name}</p>
            {row.code && <p className="text-[0.6875rem] font-mono text-zinc-400">{row.code}</p>}
          </div>
          <div>
            <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Report Date</label>
            <input
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Ph.Case *</label>
              <input
                type="number"
                step="any"
                min="0"
                value={phCase}
                onChange={(e) => handlePhChange(e.target.value)}
                className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                required
              />
            </div>
            <div>
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Unit Case</label>
              <input
                type="number"
                step="any"
                min="0"
                value={unitCase}
                onChange={(e) => setUnitCase(e.target.value)}
                className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Amount (Rs.) — optional</label>
            <input
              type="number"
              step="any"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="submit" className="flex-1 flex items-center justify-center gap-1.5" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? "Saving..." : "Save Stock Level"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main WarehouseCatalogueClient ────────────────────────────────────────────
export function WarehouseCatalogueClient({ category, type, data, pendingReturns, allProducts = [] }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(null);
  const [showPending, setShowPending] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [showStockReportModal, setShowStockReportModal] = useState(false);
  const [showCreateWaybillModal, setShowCreateWaybillModal] = useState(false);
  const [editingRow, setEditingRow] = useState<WarehouseRow | null>(null);

  const standardDummyRows = type === "standard" ? getDummyStandardRows(category.title) : [];
  const mergedData = [...data, ...standardDummyRows].filter((row, index, array) => {
    const key = `${row.code.trim().toLowerCase()}|${row.product_name.trim().toLowerCase()}`;
    return array.findIndex((item) => `${item.code.trim().toLowerCase()}|${item.product_name.trim().toLowerCase()}` === key) === index;
  });

  const filteredData = mergedData.filter((row) =>
    row.product_name.toLowerCase().includes(search.toLowerCase()) ||
    row.code.toLowerCase().includes(search.toLowerCase())
  );

  const formatNum = (num: number | string | null | undefined) =>
    num != null
      ? Number(num).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })
      : "—";

  const exportData = filteredData.map((r) => ({
    Code: r.code,
    Product: r.product_name,
    "Ph.Case": r.ph_case ?? r.total_qty ?? 0,
    "Unit Case": r.unit_case ?? 0,
    Flappy: r.flappy ?? 0,
  }));

  const pendingLabel = type === "standard"
    ? "Invoices with Unreturned Non-Returnable Stock"
    : type === "rgb"
      ? "Invoices with Unreturned RGB Bottles"
      : "Invoices with Unreturned Empties";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <h2 className="text-lg font-bold text-zinc-800">
          {category.title} Levels
        </h2>
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <ExportButtons
            data={exportData}
            filename={`${category.title.toLowerCase().replace(/\s+/g, "_")}_stock`}
          />
        </div>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Product Name</TableHead>
              <TableHead className="text-right text-emerald-700 font-semibold">Ph.Case</TableHead>
              <TableHead className="text-right text-blue-700 font-semibold">Unit Case</TableHead>
              <TableHead className="text-right">Flappy</TableHead>
              {pendingReturns.length > 0 && (
                <TableHead className="text-right">Pending Returns</TableHead>
              )}
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={pendingReturns.length > 0 ? 7 : 6}
                  className="text-center py-8 text-zinc-400"
                >
                  No stock records found for this category.
                </TableCell>
              </TableRow>
            ) : (
              filteredData.map((row, idx) => {
                const hasPending = pendingReturns.some((inv) =>
                  inv.pending_products.some(
                    (p) => p.product_name.toLowerCase().trim() === row.product_name.toLowerCase().trim()
                  )
                );

                return (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-xs text-zinc-500">
                      {row.code}
                    </TableCell>
                    <TableCell className="font-medium text-[0.8125rem]">
                      {row.product_name}
                    </TableCell>
                    <TableCell className="text-right font-bold text-[0.8125rem] text-emerald-700">
                      {formatNum(row.ph_case ?? row.total_qty ?? 0)}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-[0.8125rem] text-blue-700">
                      {formatNum(row.unit_case ?? 0)}
                    </TableCell>
                    <TableCell className="text-right text-red-600 text-[0.8125rem]">
                      {formatNum(row.flappy ?? 0)}
                    </TableCell>
                    {pendingReturns.length > 0 && (
                      <TableCell className="text-right">
                        {hasPending ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedProduct(row.product_name);
                              setInvoiceSearch("");
                              setExpandedInvoice(null);
                              setShowPending(true);
                            }}
                          >
                            View
                          </Button>
                        ) : (
                          <span className="text-zinc-300 text-xs">—</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-zinc-600 border-zinc-200 hover:border-amber-400 hover:text-amber-700 hover:bg-amber-50"
                        onClick={() => setEditingRow(row)}
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {showPending && (() => {
        const productFiltered = selectedProduct
          ? pendingReturns.filter((inv) =>
              inv.pending_products.some(
                (p) => p.product_name.toLowerCase().trim() === selectedProduct.toLowerCase().trim()
              )
            )
          : pendingReturns;

        const q = invoiceSearch.toLowerCase().trim();
        const visibleInvoices = q
          ? productFiltered.filter(
              (inv) =>
                inv.invoice_no.toLowerCase().includes(q) ||
                inv.shop_name.toLowerCase().includes(q) ||
                (inv.outlet_code || "").toLowerCase().includes(q)
            )
          : productFiltered;

        const exportRows = visibleInvoices.flatMap((inv) =>
          inv.pending_products.map((p) => ({
            "Invoice No": inv.invoice_no,
            "Shop": inv.shop_name,
            "Outlet Code": inv.outlet_code || "",
            "Date": inv.invoice_date,
            "Product": p.product_name,
            "Invoiced": p.invoiced_qty,
            "Returned": p.returned_qty,
            "Outstanding": p.invoiced_qty - p.returned_qty,
          }))
        );

        if (productFiltered.length === 0) {
          return (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-100">
              <span className="text-[0.75rem] text-emerald-700 font-medium">
                ✓ All invoices fully returned for {selectedProduct || "this category"}.
              </span>
            </div>
          );
        }

        return (
          <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-amber-50 border-b border-amber-100">
              <div className="w-1.5 h-5 rounded-full bg-amber-400 shrink-0" />
              <span className="text-[0.8125rem] font-bold text-amber-800 shrink-0">{pendingLabel}</span>
              {selectedProduct && (
                <span className="text-[0.6875rem] text-amber-700 font-mono bg-amber-100 px-2 py-0.5 rounded-full shrink-0">
                  {selectedProduct}
                </span>
              )}
              <span className="text-[0.6875rem] text-amber-600 font-medium shrink-0">
                {visibleInvoices.length} invoice{visibleInvoices.length !== 1 ? "s" : ""}
              </span>
              <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
                <input
                  type="text"
                  placeholder="Search shop, outlet code, invoice no…"
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  className="h-7 px-2.5 text-[0.6875rem] rounded border border-amber-200 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 w-52"
                />
                <ExportButtons
                  data={exportRows}
                  filename={`${selectedProduct ? selectedProduct.replace(/\s+/g, "_") : "rgb"}_pending_invoices`}
                />
                <button
                  type="button"
                  onClick={() => { setShowPending(false); setInvoiceSearch(""); }}
                  className="h-7 px-3 text-[0.6875rem] font-semibold rounded border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors"
                >
                  Hide
                </button>
              </div>
            </div>

            {visibleInvoices.length === 0 ? (
              <div className="px-4 py-6 text-center text-[0.75rem] text-zinc-400">
                No invoices match your search.
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {visibleInvoices.map((inv) => (
                  <div key={inv.invoice_id}>
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 transition-colors text-left"
                      onClick={() => setExpandedInvoice(expandedInvoice === inv.invoice_id ? null : inv.invoice_id)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[0.75rem] font-bold text-zinc-700">{inv.invoice_no}</span>
                        <span className="text-[0.6875rem] text-zinc-500">{inv.shop_name}</span>
                        {inv.outlet_code && (
                          <span className="text-[0.625rem] text-zinc-400 font-mono">{inv.outlet_code}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[0.625rem] text-zinc-400">{inv.invoice_date}</span>
                        <span className="px-2 py-0.5 rounded-full text-[0.625rem] font-bold bg-amber-100 text-amber-700">
                          {inv.pending_products.length} product{inv.pending_products.length !== 1 ? "s" : ""} pending
                        </span>
                        <span className="text-zinc-400 text-[0.625rem]">
                          {expandedInvoice === inv.invoice_id ? "▲" : "▼"}
                        </span>
                      </div>
                    </button>

                    {expandedInvoice === inv.invoice_id && (
                      <div className="px-4 pb-3 bg-zinc-50">
                        <div className="rounded-lg border border-zinc-200 overflow-hidden">
                          <table className="w-full text-[0.6875rem]">
                            <thead>
                              <tr className="bg-zinc-100 text-zinc-500 uppercase tracking-wide">
                                <th className="text-left px-3 py-2 font-semibold">Product</th>
                                <th className="text-right px-3 py-2 font-semibold">Invoiced</th>
                                <th className="text-right px-3 py-2 font-semibold">Returned</th>
                                <th className="text-right px-3 py-2 font-semibold text-amber-700">Outstanding</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 bg-white">
                              {inv.pending_products.map((p) => (
                                <tr key={p.product_name}>
                                  <td className="px-3 py-2 font-medium text-zinc-700">{p.product_name}</td>
                                  <td className="px-3 py-2 text-right text-zinc-500">{p.invoiced_qty}</td>
                                  <td className="px-3 py-2 text-right text-emerald-600">{p.returned_qty}</td>
                                  <td className="px-3 py-2 text-right font-bold text-amber-700">
                                    {p.invoiced_qty - p.returned_qty}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {showStockReportModal && (
        <StockReportModal
          products={allProducts}
          onClose={() => setShowStockReportModal(false)}
          onSaved={() => {
            setShowStockReportModal(false);
            startTransition(() => router.refresh());
          }}
        />
      )}

      {showCreateWaybillModal && (
        <CreateWaybillModal
          products={allProducts}
          onClose={() => setShowCreateWaybillModal(false)}
          onSaved={() => {
            setShowCreateWaybillModal(false);
            startTransition(() => router.refresh());
          }}
        />
      )}

      {editingRow && (
        <EditStockRowModal
          row={editingRow}
          product={
            allProducts.find(
              (p) =>
                p.id === editingRow.product_id ||
                p.product_code === editingRow.code ||
                p.product_name.toLowerCase().trim() === editingRow.product_name.toLowerCase().trim()
            ) ?? null
          }
          onClose={() => setEditingRow(null)}
          onSaved={() => {
            setEditingRow(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}
