"use client";

import { useState, useTransition, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createWaybill } from "@/lib/actions/warehouse-waybills";
import { createStockReport } from "@/lib/actions/warehouse-catalogue";
import { createLeaseEmpties } from "@/lib/actions/leased-empties";
import { StockReportModal } from "./StockReportModal";

export interface ProductForReport {
  id: string;
  product_name: string;
  product_code?: string | null;
  category_id?: string | null;
  purchase_rate?: number | null;
  sale_rate?: number | null;
  is_returnable?: boolean;
  product_categories?: any;
}

export interface OutletOption {
  id: string;
  outlet_code: string;
  shop_name: string;
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
    if (!sapWaybill.trim()) {
      alert("SAP Waybill number is required.");
      return;
    }
    if (!lines.length) {
      alert("Add at least one product.");
      return;
    }
    if (lines.some((l) => l.quantity <= 0)) {
      alert("All quantities must be greater than 0.");
      return;
    }
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
                        <td className="px-2 py-2 text-center">
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
            <div className="px-6 py-6 text-center text-zinc-400 text-[0.75rem]">No products added yet.</div>
          )}
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-zinc-100 flex gap-2 flex-shrink-0">
            <Button type="submit" className="flex-1 flex items-center justify-center gap-1.5" disabled={isPending || lines.length === 0}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? "Creating..." : "Create Waybill"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LeaseEmptiesModal({
  products,
  outlets,
  onClose,
  onSaved,
}: {
  products: { id: string; product_name: string; product_code?: string }[];
  outlets: OutletOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);

  const [outletQuery, setOutletQuery] = useState("");
  const [outletDropdownOpen, setOutletDropdownOpen] = useState(false);
  const [selectedOutlet, setSelectedOutlet] = useState<OutletOption | null>(null);
  const outletDropRef = useRef<HTMLDivElement>(null);

  const [prodQuery, setProdQuery] = useState("");
  const [prodDropdownOpen, setProdDropdownOpen] = useState(false);
  const [lines, setLines] = useState<{ product: { id: string; product_name: string; product_code?: string }; quantity: number }[]>([]);
  const prodDropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (outletDropRef.current && !outletDropRef.current.contains(e.target as Node)) {
        setOutletDropdownOpen(false);
      }
      if (prodDropRef.current && !prodDropRef.current.contains(e.target as Node)) {
        setProdDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filteredOutlets = useMemo(() => {
    const q = outletQuery.toLowerCase();
    if (!q) return outlets.slice(0, 25);
    return outlets
      .filter((o) => o.shop_name.toLowerCase().includes(q) || o.outlet_code.toLowerCase().includes(q))
      .slice(0, 25);
  }, [outlets, outletQuery]);

  const usedProductIds = lines.map((l) => l.product.id);
  const filteredProducts = useMemo(() => {
    const q = prodQuery.toLowerCase();
    return products
      .filter((p) => !usedProductIds.includes(p.id))
      .filter((p) => p.product_name.toLowerCase().includes(q) || (p.product_code ?? "").toLowerCase().includes(q))
      .slice(0, 20);
  }, [products, prodQuery, usedProductIds]);

  const addProduct = (p: { id: string; product_name: string; product_code?: string }) => {
    setLines((prev) => [...prev, { product: p, quantity: 1 }]);
    setProdQuery("");
    setProdDropdownOpen(false);
  };

  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOutlet) {
      alert("Please select an outlet.");
      return;
    }
    if (!lines.length) {
      alert("Please add at least one product.");
      return;
    }
    if (lines.some((l) => l.quantity <= 0)) {
      alert("All quantities must be greater than 0.");
      return;
    }

    startTransition(async () => {
      try {
        await createLeaseEmpties({
          date,
          shop_id: selectedOutlet.id,
          outlet_code: selectedOutlet.outlet_code,
          outlet_name: selectedOutlet.shop_name,
          items: lines.map((l) => ({
            product_id: l.product.id,
            product_code: l.product.product_code || "",
            product_name: l.product.product_name,
            quantity: l.quantity,
          })),
        });
        onSaved();
      } catch (err: any) {
        alert(err.message ?? "Failed to save lease record.");
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-zinc-100 flex-shrink-0">
          <h3 className="text-[0.9375rem] font-bold text-zinc-900">Lease Empties</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 text-lg">×</button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-4 sm:px-6 py-3 sm:py-4 space-y-3 sm:space-y-4 flex-shrink-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="w-full h-9 rounded-lg border border-zinc-200 px-3 text-[0.75rem] bg-white focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </div>
              <div ref={outletDropRef} className="relative">
                <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Outlet</label>
                <div className="flex items-center border border-zinc-200 rounded-lg bg-white px-2.5 h-9 gap-2 focus-within:ring-2 focus-within:ring-red-500 transition-all">
                  <Search className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                  <input
                    type="text"
                    value={selectedOutlet ? `${selectedOutlet.outlet_code} - ${selectedOutlet.shop_name}` : outletQuery}
                    placeholder="Search outlet..."
                    onFocus={() => {
                      if (selectedOutlet) setSelectedOutlet(null);
                      setOutletDropdownOpen(true);
                    }}
                    onChange={(e) => {
                      setSelectedOutlet(null);
                      setOutletQuery(e.target.value);
                      setOutletDropdownOpen(true);
                    }}
                    className="flex-1 text-[0.75rem] bg-transparent outline-none text-zinc-800 placeholder:text-zinc-400"
                  />
                </div>
                {outletDropdownOpen && filteredOutlets.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto">
                    {filteredOutlets.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-[0.75rem] hover:bg-zinc-50 flex items-center justify-between border-b border-zinc-50 last:border-0"
                        onClick={() => {
                          setSelectedOutlet(o);
                          setOutletQuery("");
                          setOutletDropdownOpen(false);
                        }}
                      >
                        <span className="font-medium text-zinc-800">{o.shop_name}</span>
                        <span className="font-mono text-zinc-400 text-[0.6875rem]">{o.outlet_code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div ref={prodDropRef} className="relative">
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                Products (Returnable Empties)
              </label>
              <div className="flex items-center border border-zinc-200 rounded-lg bg-white px-2.5 h-9 gap-2 focus-within:ring-2 focus-within:ring-red-500 transition-all">
                <Search className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                <input
                  type="text"
                  value={prodQuery}
                  placeholder="Search and select product (Pallet, Sheet, etc.)..."
                  onFocus={() => setProdDropdownOpen(true)}
                  onChange={(e) => {
                    setProdQuery(e.target.value);
                    setProdDropdownOpen(true);
                  }}
                  className="flex-1 text-[0.75rem] bg-transparent outline-none text-zinc-800 placeholder:text-zinc-400"
                />
              </div>
              {prodDropdownOpen && filteredProducts.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto">
                  {filteredProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-[0.75rem] hover:bg-zinc-50 flex items-center justify-between border-b border-zinc-50 last:border-0"
                      onClick={() => addProduct(p)}
                    >
                      <span className="font-medium text-zinc-800">{p.product_name}</span>
                      {p.product_code && <span className="font-mono text-zinc-400 text-[0.6875rem]">{p.product_code}</span>}
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
                      <th className="text-right px-3 py-2 font-semibold text-indigo-700">Quantity</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.product.id} className="border-b border-zinc-100 last:border-0">
                        <td className="px-3 py-2 font-mono text-zinc-500">{l.product.product_code || "—"}</td>
                        <td className="px-3 py-2 font-medium text-zinc-800">{l.product.product_name}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={l.quantity || ""}
                            placeholder="1"
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((x, idx) => (idx === i ? { ...x, quantity: parseInt(e.target.value) || 0 } : x))
                              )
                            }
                            className="w-24 text-right text-[0.75rem] border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white ml-auto block"
                          />
                        </td>
                        <td className="px-2 py-2 text-center">
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
            <div className="px-6 py-6 text-center text-zinc-400 text-[0.75rem]">
              Select multiple returnable products to lease to outlet.
            </div>
          )}

          <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-zinc-100 flex gap-2 flex-shrink-0">
            <Button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center gap-1.5" disabled={isPending || lines.length === 0 || !selectedOutlet}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? "Saving..." : "Save Record"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function WarehouseHeaderActions({
  allProducts,
  impliedProducts,
  returnableNonRgbProducts,
  outlets,
}: {
  allProducts: ProductForReport[];
  impliedProducts: ProductForReport[];
  returnableNonRgbProducts: { id: string; product_name: string; product_code?: string }[];
  outlets: OutletOption[];
}) {
  const router = useRouter();
  const [showStockReportModal, setShowStockReportModal] = useState(false);
  const [triggerImportOnOpen, setTriggerImportOnOpen] = useState(false);

  const handleSaved = () => {
    setShowStockReportModal(false);
    setTriggerImportOnOpen(false);
    router.refresh();
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setTriggerImportOnOpen(false);
          setShowStockReportModal(true);
        }}
        className="whitespace-nowrap border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-xs font-semibold"
      >
        + Add Stock Report
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setTriggerImportOnOpen(true);
          setShowStockReportModal(true);
        }}
        className="whitespace-nowrap border-blue-300 text-blue-700 hover:bg-blue-50 text-xs font-semibold flex items-center gap-1.5"
      >
        <Upload className="h-3.5 w-3.5 text-blue-600" />
        Import Stock Report
      </Button>

      {showStockReportModal && (
        <StockReportModal
          products={allProducts}
          triggerImportOnMount={triggerImportOnOpen}
          onClose={() => {
            setShowStockReportModal(false);
            setTriggerImportOnOpen(false);
          }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
