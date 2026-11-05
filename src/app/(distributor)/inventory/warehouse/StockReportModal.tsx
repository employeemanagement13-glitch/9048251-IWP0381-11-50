"use client";

import { useState, useTransition, useRef, useEffect, useMemo } from "react";
import { Search, Loader2, Upload, FileText, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createStockReport } from "@/lib/actions/warehouse-catalogue";
import type { ProductForReport } from "./WarehouseHeaderActions";

export interface StockReportModalProps {
  products: ProductForReport[];
  onClose: () => void;
  onSaved: () => void;
  triggerImportOnMount?: boolean;
}

export function StockReportModal({
  products,
  onClose,
  onSaved,
  triggerImportOnMount = false,
}: StockReportModalProps) {
  const [isPending, startTransition] = useTransition();
  const [isImporting, setIsImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [reportDate, setReportDate] = useState(today);
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<{
    product: ProductForReport;
    ph_case: number;
    unit_case: number;
    amount: number;
  }[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // If opened via "+ Import Stock Report", automatically trigger file picker
  useEffect(() => {
    if (triggerImportOnMount) {
      const timer = setTimeout(() => {
        fileInputRef.current?.click();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [triggerImportOnMount]);

  const usedIds = lines.map((l) => l.product.id).filter(Boolean);
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return products
      .filter((p) => !usedIds.includes(p.id))
      .filter(
        (p) =>
          p.product_name.toLowerCase().includes(q) ||
          (p.product_code ?? "").toLowerCase().includes(q)
      )
      .slice(0, 25);
  }, [query, products, usedIds]);

  const addProduct = (p: ProductForReport) => {
    const setUnCase = (p.product_categories as any)?.set_un_case ?? 1;
    const rate = Number(p.purchase_rate) || 0;
    setLines((prev) => [
      ...prev,
      {
        product: p,
        ph_case: 0,
        unit_case: 0,
        amount: 0,
      },
    ]);
    setQuery("");
    setDropdownOpen(false);
  };

  const updatePhCase = (i: number, val: number) => {
    setLines((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l;
        const setUnCase = Number((l.product.product_categories as any)?.set_un_case) || 1;
        const uc = parseFloat((val * setUnCase).toFixed(2));
        const purchaseRate = Number(l.product.purchase_rate) || 0;
        const autoAmount = purchaseRate > 0 ? parseFloat((val * purchaseRate).toFixed(2)) : 0;
        return { ...l, ph_case: val, unit_case: uc, amount: autoAmount };
      })
    );
  };

  const updateUnitCase = (i: number, val: number) => {
    setLines((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l;
        return { ...l, unit_case: val };
      })
    );
  };

  const updateAmount = (i: number, val: number) => {
    setLines((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l;
        return { ...l, amount: val };
      })
    );
  };

  const removeLine = (i: number) =>
    setLines((prev) => prev.filter((_, idx) => idx !== i));

  const totPhCase = lines.reduce((s, l) => s + (l.ph_case || 0), 0);
  const totUnitCase = lines.reduce((s, l) => s + (l.unit_case || 0), 0);
  const totAmount = lines.reduce((s, l) => s + (l.amount || 0), 0);

  const missingRateLines = useMemo(() => {
    return lines.filter((l) => !(Number(l.product.purchase_rate) > 0));
  }, [lines]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      alert("Please upload a PDF file.");
      e.target.value = "";
      return;
    }

    setIsImporting(true);
    setImportNotice(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/parse-stock-report-pdf", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to parse PDF file.");
      }

      if (data.reportDate) {
        setReportDate(data.reportDate);
      }

      if (Array.isArray(data.lines) && data.lines.length > 0) {
        const formatted = data.lines.map((l: any) => {
          const setUnCase = Number((l.product?.product_categories as any)?.set_un_case) || 1;
          const purchaseRate = Number(l.product?.purchase_rate) || 0;
          const ph = Number(l.ph_case) || 0;
          const uc = parseFloat((ph * setUnCase).toFixed(2));
          const amt = purchaseRate > 0 ? parseFloat((ph * purchaseRate).toFixed(2)) : 0;
          return {
            product: l.product,
            ph_case: ph,
            unit_case: uc,
            amount: amt,
          };
        });
        setLines(formatted);
        setImportNotice(
          `Successfully imported ${formatted.length} products from ${file.name}${
            data.reportDate ? ` (Report Date: ${data.reportDate})` : ""
          }.`
        );
      } else {
        alert("No valid products were found in the uploaded PDF.");
      }
    } catch (err: any) {
      console.error("[handleFileUpload]", err);
      alert(err.message || "Failed to import stock report from PDF.");
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lines.length) {
      alert("Add at least one product.");
      return;
    }
    if (lines.some((l) => l.ph_case <= 0)) {
      alert("All Ph.Case values must be greater than 0.");
      return;
    }
    const missingProduct = lines.find((l) => !l.product.id);
    if (missingProduct) {
      alert(
        `Product "${missingProduct.product.product_name}" could not be matched to an inventory record. Please remove it or search and re-add.`
      );
      return;
    }

    startTransition(async () => {
      try {
        await createStockReport(
          reportDate,
          lines.map((l) => ({
            product_id: l.product.id,
            ph_case: l.ph_case,
            unit_case: l.unit_case,
            amount: l.amount || 0,
          }))
        );
        onSaved();
      } catch (err: any) {
        alert(err.message ?? "Failed to save stock report.");
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl sm:max-w-4xl max-h-[92vh] flex flex-col overflow-hidden border border-zinc-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-zinc-100 flex-shrink-0 bg-zinc-50/50">
          <div>
            <h3 className="text-[0.9375rem] font-bold text-zinc-900 flex items-center gap-2">
              <span>Add Stock Report</span>
              {lines.length > 0 && (
                <span className="text-[0.6875rem] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                  {lines.length} items
                </span>
              )}
            </h3>
            <p className="text-[0.6875rem] text-zinc-500">
              Record stock counts, import Past Stock Monitoring PDF, and record inventory valuation
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 text-lg transition-colors"
          >
            ×
          </button>
        </div>

        {/* Hidden File Input for Import */}
        <input
          type="file"
          ref={fileInputRef}
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={handleFileUpload}
        />

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-4 sm:px-6 pt-3 sm:pt-4 pb-3 flex-shrink-0 space-y-3">
            {/* Top row: Report Date + Import Button */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 bg-zinc-50/70 p-3 rounded-xl border border-zinc-200/80">
              <div>
                <label className="block text-[0.6875rem] font-semibold text-zinc-600 mb-1 uppercase tracking-wide">
                  Report Date
                </label>
                <input
                  type="date"
                  value={reportDate}
                  onChange={(e) => setReportDate(e.target.value)}
                  required
                  className="h-9 rounded-lg border border-zinc-200 px-3 text-[0.75rem] bg-white text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-400 font-medium shadow-sm"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImporting || isPending}
                  className="h-9 border-blue-300 text-blue-700 bg-white hover:bg-blue-50 font-semibold text-xs flex items-center gap-2 shadow-sm transition-all"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                      <span>Importing PDF...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-3.5 w-3.5 text-blue-600" />
                      <span>Import Stock Report</span>
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Import feedback banner */}
            {importNotice && (
              <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[0.6875rem] flex items-center justify-between animate-fadeIn">
                <div className="flex items-center gap-2">
                  <span className="font-bold">✓</span>
                  <span>{importNotice}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setImportNotice(null)}
                  className="text-emerald-700 hover:text-emerald-950 text-sm leading-none ml-2"
                >
                  ×
                </button>
              </div>
            )}

            {/* Missing Purchase Rate Warning Banner */}
            {missingRateLines.length > 0 && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[0.6875rem] space-y-1.5 animate-fadeIn">
                <div className="font-semibold flex items-center gap-1.5 text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>Purchase rate missing for {missingRateLines.length} product{missingRateLines.length > 1 ? "s" : ""}:</span>
                </div>
                <div className="max-h-24 overflow-y-auto space-y-1 text-amber-900 font-mono text-[0.6875rem] pl-5">
                  {missingRateLines.map((l, idx) => (
                    <div key={idx} className="flex items-center gap-1">
                      <span>•</span>
                      <span>Purchase rate missing of [{l.product.product_name} | {l.product.product_code || "—"}]</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add Product Search Input */}
            <div ref={dropRef} className="relative">
              <label className="block text-[0.6875rem] font-semibold text-zinc-600 mb-1 uppercase tracking-wide">
                Add Product
              </label>
              <div className="flex items-center border border-zinc-200 rounded-lg bg-white px-2.5 h-9 gap-2 focus-within:ring-2 focus-within:ring-red-500 shadow-sm transition-all">
                <Search className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                <input
                  type="text"
                  value={query}
                  placeholder="Search and add product by name or code..."
                  onFocus={() => setDropdownOpen(true)}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setDropdownOpen(true);
                  }}
                  className="flex-1 text-[0.75rem] bg-transparent outline-none text-zinc-800 placeholder:text-zinc-400"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="text-zinc-400 hover:text-zinc-600 text-xs px-1"
                  >
                    ×
                  </button>
                )}
              </div>
              {dropdownOpen && filtered.length > 0 && (
                <div className="absolute top-full mt-1 w-full bg-white border border-zinc-200 rounded-xl shadow-xl z-50 max-h-56 overflow-y-auto divide-y divide-zinc-100">
                  {filtered.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-[0.75rem] hover:bg-red-50/60 flex items-center justify-between transition-colors"
                      onClick={() => addProduct(p)}
                    >
                      <div>
                        {p.product_code && (
                          <span className="font-mono text-zinc-500 mr-2 text-[0.6875rem] bg-zinc-100 px-1.5 py-0.5 rounded">
                            {p.product_code}
                          </span>
                        )}
                        <span className="font-medium text-zinc-800">{p.product_name}</span>
                      </div>
                      <span className="text-zinc-400 text-[0.6875rem]">
                        {(p.product_categories as any)?.title ?? ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Products Table */}
          {lines.length > 0 && (
            <div className="px-4 sm:px-6 flex-1 overflow-y-auto pb-2">
              <div className="bg-white rounded-xl border border-zinc-200 overflow-x-auto shadow-sm">
                <table className="w-full text-[0.75rem]">
                  <thead>
                    <tr className="bg-zinc-100/90 border-b border-zinc-200 text-zinc-700">
                      <th className="text-left px-3 py-2.5 font-semibold text-zinc-600">Code</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-zinc-700">Product</th>
                      <th className="text-left px-3 py-2.5 font-semibold text-zinc-500">Category</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-emerald-700">Ph.Case</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-blue-700">Unit Case</th>
                      <th className="text-right px-3 py-2.5 font-semibold text-zinc-800">Amount (input)</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr
                        key={l.product.id || `${l.product.product_code}-${i}`}
                        className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/70 transition-colors"
                      >
                        <td className="px-3 py-2 font-mono text-[0.6875rem] text-zinc-600 font-semibold whitespace-nowrap">
                          {l.product.product_code || "—"}
                        </td>
                        <td className="px-3 py-2 font-medium text-zinc-800 min-w-[11.25rem]">
                          {l.product.product_name}
                        </td>
                        <td className="px-3 py-2 text-zinc-500 text-[0.6875rem] whitespace-nowrap">
                          {(l.product.product_categories as any)?.title ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={l.ph_case === 0 ? "" : l.ph_case}
                            placeholder="0"
                            onChange={(e) =>
                              updatePhCase(i, parseFloat(e.target.value) || 0)
                            }
                            className="w-20 h-7 text-right rounded border border-zinc-200 px-1.5 text-[0.75rem] font-mono font-semibold text-emerald-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={l.unit_case === 0 ? "" : l.unit_case}
                            placeholder="0"
                            onChange={(e) =>
                              updateUnitCase(i, parseFloat(e.target.value) || 0)
                            }
                            className="w-20 h-7 text-right rounded border border-zinc-200 px-1.5 text-[0.75rem] font-mono font-semibold text-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={l.amount === 0 ? "" : l.amount}
                            placeholder="0.00"
                            onChange={(e) =>
                              updateAmount(i, parseFloat(e.target.value) || 0)
                            }
                            className={`w-28 h-7 text-right font-mono font-bold rounded border px-1.5 text-[0.75rem] focus:outline-none focus:ring-1 ${
                              !(Number(l.product.purchase_rate) > 0)
                                ? "border-amber-300 bg-amber-50/50 text-amber-900 focus:ring-amber-400"
                                : "border-zinc-200 text-zinc-900 focus:ring-red-400"
                            }`}
                          />
                          {Number(l.product.purchase_rate) > 0 ? (
                            <div className="text-[0.625rem] text-zinc-400 font-mono mt-0.5 whitespace-nowrap">
                              @ Rs. {Number(l.product.purchase_rate).toFixed(2)}/case
                            </div>
                          ) : (
                            <div className="text-[0.625rem] text-amber-600 font-medium mt-0.5 whitespace-nowrap flex items-center justify-end gap-1">
                              <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
                              <span>Purchase rate missing of [{l.product.product_name} | {l.product.product_code || "—"}]</span>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeLine(i)}
                            title="Remove product"
                            className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <span className="text-base font-bold leading-none">×</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-zinc-100/90 font-bold border-t border-zinc-200 text-zinc-800">
                      <td colSpan={3} className="px-3 py-2 text-zinc-700 text-right">
                        Total ({lines.length} items):
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-800">
                        {totPhCase.toLocaleString("en-PK", {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-blue-800">
                        {totUnitCase.toLocaleString("en-PK", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-zinc-900 font-extrabold">
                        Rs.{" "}
                        {totAmount.toLocaleString("en-PK", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Empty state */}
          {lines.length === 0 && (
            <div className="px-6 py-10 text-center border-2 border-dashed border-zinc-200 rounded-xl m-4 sm:m-6 bg-zinc-50/50 flex flex-col items-center justify-center gap-3">
              <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 shadow-sm">
                <Upload className="h-6 w-6" />
              </div>
              <div className="max-w-md">
                <p className="text-[0.8125rem] font-bold text-zinc-800">No products added yet</p>
                <p className="text-[0.6875rem] text-zinc-500 mt-1 leading-relaxed">
                  Import a Past Stock Monitoring Report PDF to automatically fill all products, Ph.Case, Unit Case, and Amount, or use the searchbar above to add items manually.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                className="mt-1 border-blue-300 text-blue-700 bg-white hover:bg-blue-50 text-xs font-semibold gap-1.5 shadow-sm"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Importing PDF...</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-3.5 w-3.5" />
                    <span>Import Stock Report PDF</span>
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Footer buttons */}
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-zinc-100 flex gap-2 flex-shrink-0 bg-zinc-50/30">
            <Button
              type="submit"
              className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-900 hover:bg-black text-white"
              disabled={isPending || lines.length === 0}
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending
                ? "Saving..."
                : `Save Stock Report (Rs. ${totAmount.toLocaleString("en-PK", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })})`}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
