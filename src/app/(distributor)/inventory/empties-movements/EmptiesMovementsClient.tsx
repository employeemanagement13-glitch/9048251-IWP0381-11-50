"use client";

import { useState, useTransition, useRef, useEffect, useMemo, useCallback } from "react";
import { Loader2, Search, PackageOpen, Truck, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ExportButtons } from "@/components/export/ExportButtons";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/Table";
import {
  createWaybill, getWaybillsSummary, deleteWaybill, updateWaybill,
  type WaybillSummaryRow,
} from "@/lib/actions/warehouse-waybills";
import {
  createLeaseEmpties, getLeaseEmpties, deleteLeaseEmpties, updateLeaseEmpties,
  type LeasedEmptyRecord,
} from "@/lib/actions/leased-empties";
import { ReturnedLeaseModal } from "@/components/empties/ReturnedLeaseModal";
import {
  createSoldEmpties, getSoldEmpties, deleteSoldEmpties, updateSoldEmpties,
  type SoldEmptyRecord, type SoldEmptyItem,
} from "@/lib/actions/sold-empties";

export interface OutletOption { id: string; outlet_code: string; shop_name: string; }
export interface ProductOption { id: string; product_name: string; product_code?: string | null; }

const fmt = (n: unknown) =>
  n != null ? Number(n as number).toLocaleString() : "—";

function getLocalDateString(d: Date = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function getFirstOfMonthString(d: Date = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}
const TODAY = getLocalDateString();
const FIRST_OF_MONTH = getFirstOfMonthString();

function CreateWaybillModal({
  products, onClose, onSaved,
}: { products: ProductOption[]; onClose: () => void; onSaved: () => void }) {
  const [isPending, startTransition] = useTransition();
  const today = TODAY;
  const [date, setDate] = useState(today);
  const [sapWaybill, setSapWaybill] = useState("");
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<{ product: ProductOption; quantity: number }[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropdownOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const filtered = useMemo(() => {
    const used = lines.map(l => l.product.id);
    const available = products.filter(p => !used.includes(p.id));
    if (!query.trim()) return available.slice(0, 50);
    const q = query.toLowerCase();
    return available.filter(p =>
      p.product_name.toLowerCase().includes(q) || (p.product_code || "").toLowerCase().includes(q)
    ).slice(0, 50);
  }, [query, products, lines]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sapWaybill.trim() || lines.length === 0) { alert("Enter SAP Waybill No. and add at least one product."); return; }
    startTransition(async () => {
      try {
        await createWaybill({ date, sap_waybill: sapWaybill.trim(), items: lines.map(l => ({ product_id: l.product.id, product_code: l.product.product_code ?? "", product_name: l.product.product_name, quantity: l.quantity })) });
        onSaved();
      } catch (err: any) { alert(err.message ?? "Failed."); }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 bg-zinc-50">
          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2"><Truck className="h-4 w-4 text-amber-600" /> Create Waybill</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200 text-lg">×</button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-6 py-4 space-y-3 overflow-y-auto flex-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div>
                <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">SAP Waybill No.</label>
                <input type="text" value={sapWaybill} onChange={e => setSapWaybill(e.target.value)} placeholder="e.g. 4900123456" className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" required />
              </div>
            </div>
            <div ref={dropRef} className="relative">
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Add Products</label>
              <input type="text" value={query} onChange={e => { setQuery(e.target.value); setDropdownOpen(true); }} onFocus={() => setDropdownOpen(true)} placeholder="Search implied / empty products..." className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              {dropdownOpen && (
                <div className="absolute z-20 top-full mt-1 left-0 right-0 max-h-48 overflow-y-auto bg-white border border-zinc-200 rounded-lg shadow-xl divide-y divide-zinc-100">
                  {filtered.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-zinc-400">No matching products</div>
                  ) : filtered.map(p => (
                    <button key={p.id} type="button" onClick={() => { setLines(prev => [...prev, { product: p, quantity: 1 }]); setQuery(""); setDropdownOpen(false); }} className="w-full text-left px-3 py-2 text-xs hover:bg-amber-50 text-zinc-800">
                      <span className="font-mono text-zinc-400 mr-1">[{p.product_code}]</span> {p.product_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {lines.length > 0 && (
              <div className="rounded-lg border border-zinc-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 text-zinc-500 uppercase text-[0.625rem]"><tr><th className="text-left px-3 py-2">Product</th><th className="text-right px-3 py-2 w-28">Quantity</th><th className="w-8"></th></tr></thead>
                  <tbody className="divide-y divide-zinc-100">
                    {lines.map((l, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 font-medium">{l.product.product_name}</td>
                        <td className="px-3 py-2"><input type="number" min="1" value={l.quantity || ""} onChange={e => setLines(prev => prev.map((x, idx) => idx === i ? { ...x, quantity: parseInt(e.target.value) || 0 } : x))} className="w-24 text-right text-xs border border-zinc-200 rounded px-2 py-1 ml-auto block" /></td>
                        <td className="px-2 py-2 text-center"><button type="button" onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))} className="text-zinc-400 hover:text-red-500">×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="px-6 py-3 border-t border-zinc-100 flex gap-2">
            <Button type="submit" className="flex-1 bg-amber-600 hover:bg-amber-700 text-white flex items-center justify-center gap-1.5" disabled={isPending || lines.length === 0}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? "Saving..." : "Save Waybill"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SoldLeaseEmptiesModal({
  products, outlets, onClose, onSaved,
}: { products: ProductOption[]; outlets: OutletOption[]; onClose: () => void; onSaved: () => void; }) {
  const [isPending, startTransition] = useTransition();
  const today = TODAY;
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState<"leased" | "sold">("leased");
  const [outletQuery, setOutletQuery] = useState("");
  const [outletDropdownOpen, setOutletDropdownOpen] = useState(false);
  const [selectedOutlet, setSelectedOutlet] = useState<OutletOption | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const [lines, setLines] = useState<{ product: ProductOption; quantity: number }[]>([]);
  const [amount, setAmount] = useState("0");
  const outletRef = useRef<HTMLDivElement>(null);
  const productRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (outletRef.current && !outletRef.current.contains(e.target as Node)) setOutletDropdownOpen(false);
      if (productRef.current && !productRef.current.contains(e.target as Node)) setProductDropdownOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const filteredOutlets = useMemo(() => {
    const q = outletQuery.toLowerCase();
    return outlets.filter(o => o.outlet_code.toLowerCase().includes(q) || o.shop_name.toLowerCase().includes(q)).slice(0, 20);
  }, [outlets, outletQuery]);

  const filteredProducts = useMemo(() => {
    const used = lines.map(l => l.product.id);
    const available = products.filter(p => !used.includes(p.id));
    if (!productQuery.trim()) return available.slice(0, 50);
    const q = productQuery.toLowerCase();
    return available.filter(p =>
      p.product_name.toLowerCase().includes(q) || (p.product_code || "").toLowerCase().includes(q)
    ).slice(0, 50);
  }, [products, productQuery, lines]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOutlet || lines.length === 0) { alert("Select an outlet and add at least one product."); return; }
    startTransition(async () => {
      try {
        if (mode === "leased") {
          await createLeaseEmpties({ date, shop_id: selectedOutlet.id, outlet_code: selectedOutlet.outlet_code, outlet_name: selectedOutlet.shop_name, items: lines.map(l => ({ product_id: l.product.id, product_code: l.product.product_code ?? "", product_name: l.product.product_name, quantity: l.quantity })) });
        } else {
          await createSoldEmpties({ date, shop_id: selectedOutlet.id, outlet_code: selectedOutlet.outlet_code, outlet_name: selectedOutlet.shop_name, amount: parseFloat(amount) || 0, items: lines.map(l => ({ product_id: l.product.id, product_code: l.product.product_code ?? "", product_name: l.product.product_name, quantity: l.quantity })) });
        }
        onSaved();
      } catch (err: any) { alert(err.message ?? "Failed."); }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 bg-zinc-50">
          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2"><PackageOpen className="h-4 w-4 text-indigo-600" /> Sold / Lease Empties</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200 text-lg">×</button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-6 py-4 space-y-3 overflow-y-auto flex-1">
            <div>
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div ref={outletRef} className="relative">
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Outlet *</label>
              <input type="text" value={outletQuery} onChange={e => { setOutletQuery(e.target.value); setOutletDropdownOpen(true); if (selectedOutlet) setSelectedOutlet(null); }} onFocus={() => setOutletDropdownOpen(true)} placeholder="Search outlet..." className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              {outletDropdownOpen && filteredOutlets.length > 0 && (
                <div className="absolute z-20 top-full mt-1 left-0 right-0 max-h-44 overflow-y-auto bg-white border border-zinc-200 rounded-lg shadow-xl divide-y divide-zinc-100">
                  {filteredOutlets.map(o => (
                    <button key={o.id} type="button" onClick={() => { setSelectedOutlet(o); setOutletQuery(`[${o.outlet_code}] ${o.shop_name}`); setOutletDropdownOpen(false); }} className={`w-full text-left px-3 py-2 text-xs hover:bg-indigo-50 ${selectedOutlet?.id === o.id ? "bg-indigo-50 text-indigo-700 font-semibold" : "text-zinc-800"}`}>
                      <span className="font-mono text-zinc-400 mr-1">[{o.outlet_code}]</span> {o.shop_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div ref={productRef} className="relative">
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Returnable Products</label>
              <input type="text" value={productQuery} onChange={e => { setProductQuery(e.target.value); setProductDropdownOpen(true); }} onFocus={() => setProductDropdownOpen(true)} placeholder="Search product..." className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              {productDropdownOpen && filteredProducts.length > 0 && (
                <div className="absolute z-20 top-full mt-1 left-0 right-0 max-h-44 overflow-y-auto bg-white border border-zinc-200 rounded-lg shadow-xl divide-y divide-zinc-100">
                  {filteredProducts.map(p => (
                    <button key={p.id} type="button" onClick={() => { setLines(prev => [...prev, { product: p, quantity: 1 }]); setProductQuery(""); setProductDropdownOpen(false); }} className="w-full text-left px-3 py-2 text-xs hover:bg-indigo-50 text-zinc-800">
                      <span className="font-mono text-zinc-400 mr-1">[{p.product_code}]</span> {p.product_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {lines.length > 0 && (
              <div className="rounded-lg border border-zinc-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 text-zinc-500 uppercase text-[0.625rem]"><tr><th className="text-left px-3 py-2">Product</th><th className="text-right px-3 py-2 w-28">Qty</th><th className="w-8"></th></tr></thead>
                  <tbody className="divide-y divide-zinc-100">
                    {lines.map((l, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 font-medium">{l.product.product_name}</td>
                        <td className="px-3 py-2"><input type="number" min="1" value={l.quantity || ""} onChange={e => setLines(prev => prev.map((x, idx) => idx === i ? { ...x, quantity: parseInt(e.target.value) || 0 } : x))} className="w-24 text-right text-xs border border-zinc-200 rounded px-2 py-1 ml-auto block" /></td>
                        <td className="px-2 py-2 text-center"><button type="button" onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))} className="text-zinc-400 hover:text-red-500">×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="pt-2 border-t border-zinc-100">
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-2 uppercase tracking-wide">Transaction Type</label>
              <div className="grid grid-cols-2 gap-3">
                <label className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${mode === "leased" ? "border-indigo-600 bg-indigo-50/50 text-indigo-900 font-bold" : "border-zinc-200 bg-white text-zinc-700"}`}>
                  <input type="radio" name="emptyMode" checked={mode === "leased"} onChange={() => setMode("leased")} className="accent-indigo-600" />
                  <div className="text-xs"><div className="font-semibold">Leased</div><div className="text-[0.625rem] text-zinc-500 font-normal">Temporarily given to outlet</div></div>
                </label>
                <label className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${mode === "sold" ? "border-emerald-600 bg-emerald-50/50 text-emerald-900 font-bold" : "border-zinc-200 bg-white text-zinc-700"}`}>
                  <input type="radio" name="emptyMode" checked={mode === "sold"} onChange={() => setMode("sold")} className="accent-emerald-600" />
                  <div className="text-xs"><div className="font-semibold">Sold</div><div className="text-[0.625rem] text-zinc-500 font-normal">Permanently sold to outlet</div></div>
                </label>
              </div>
            </div>

            {mode === "sold" && (
              <div>
                <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Amount (Rs.)</label>
                <input
                  type="number" step="any" min="0" value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="w-full border border-emerald-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-emerald-50/30 font-bold text-emerald-800"
                />
              </div>
            )}
          </div>
          <div className="px-6 py-3 border-t border-zinc-100 flex gap-2">
            <Button type="submit" className={`flex-1 text-white flex items-center justify-center gap-1.5 ${mode === "sold" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-indigo-600 hover:bg-indigo-700"}`} disabled={isPending || lines.length === 0 || !selectedOutlet}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? "Saving..." : mode === "sold" ? "Save Sale" : "Save Lease"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function EmptiesMovementsClient({
  returnableNonRgbProducts, outlets, impliedProducts,
}: {
  returnableNonRgbProducts: ProductOption[];
  outlets: OutletOption[];
  impliedProducts: ProductOption[];
}) {
  const [showWaybillModal, setShowWaybillModal] = useState(false);
  const [showLeaseModal, setShowLeaseModal] = useState(false);
  const [activeSection, setActiveSection] = useState<"waybills" | "leased" | "sold">("waybills");

  const [waybills, setWaybills] = useState<WaybillSummaryRow[]>([]);
  const [loadingWaybills, setLoadingWaybills] = useState(true);
  const [waybillFrom, setWaybillFrom] = useState(FIRST_OF_MONTH);
  const [waybillTo, setWaybillTo] = useState(TODAY);
  const [waybillSearch, setWaybillSearch] = useState("");
  const [deletingWaybillId, setDeletingWaybillId] = useState<string | null>(null);
  const [editingWaybill, setEditingWaybill] = useState<WaybillSummaryRow | null>(null);
  const [isPendingW, startTransitionW] = useTransition();

  const [leased, setLeased] = useState<LeasedEmptyRecord[]>([]);
  const [loadingLeased, setLoadingLeased] = useState(true);
  const [leasedFrom, setLeasedFrom] = useState(FIRST_OF_MONTH);
  const [leasedTo, setLeasedTo] = useState(TODAY);
  const [leasedSearch, setLeasedSearch] = useState("");
  const [deletingLeaseId, setDeletingLeaseId] = useState<string | null>(null);
  const [editingLease, setEditingLease] = useState<LeasedEmptyRecord | null>(null);
  const [returningLease, setReturningLease] = useState<LeasedEmptyRecord | null>(null);
  const [isPendingL, startTransitionL] = useTransition();

  const [sold, setSold] = useState<SoldEmptyRecord[]>([]);
  const [loadingSold, setLoadingSold] = useState(true);
  const [soldFrom, setSoldFrom] = useState(FIRST_OF_MONTH);
  const [soldTo, setSoldTo] = useState(TODAY);
  const [soldSearch, setSoldSearch] = useState("");
  const [deletingSoldId, setDeletingSoldId] = useState<string | null>(null);
  const [editingSold, setEditingSold] = useState<SoldEmptyRecord | null>(null);
  const [isPendingS, startTransitionS] = useTransition();

  const loadWaybills = useCallback(async (from?: string, to?: string) => {
    setLoadingWaybills(true);
    try {
      setWaybills(await getWaybillsSummary({ from: from || undefined, to: to || undefined }));
    } finally {
      setLoadingWaybills(false);
    }
  }, []);

  const loadLeased = useCallback(async (from?: string, to?: string) => {
    setLoadingLeased(true);
    try {
      setLeased(await getLeaseEmpties({ from: from || undefined, to: to || undefined }));
    } finally {
      setLoadingLeased(false);
    }
  }, []);

  const loadSold = useCallback(async (from?: string, to?: string) => {
    setLoadingSold(true);
    try {
      setSold(await getSoldEmpties({ from: from || undefined, to: to || undefined }));
    } finally {
      setLoadingSold(false);
    }
  }, []);

  const waybillProducts = useMemo(() => {
    const seen = new Set<string>();
    const merged: ProductOption[] = [];
    for (const p of [...impliedProducts, ...returnableNonRgbProducts]) {
      if (!p?.id || seen.has(p.id)) continue;
      seen.add(p.id);
      merged.push(p);
    }
    return merged;
  }, [impliedProducts, returnableNonRgbProducts]);

  useEffect(() => {
    void loadWaybills(FIRST_OF_MONTH, TODAY);
    void loadLeased(FIRST_OF_MONTH, TODAY);
    void loadSold(FIRST_OF_MONTH, TODAY);
  }, [loadWaybills, loadLeased, loadSold]);

  const filteredWaybills = useMemo(() => {
    if (!waybillSearch.trim()) return waybills;
    const q = waybillSearch.toLowerCase();
    return waybills.filter(w => (w.sap_waybill || "").toLowerCase().includes(q) || (w.date || "").includes(q));
  }, [waybills, waybillSearch]);

  const filteredLeased = useMemo(() => {
    if (!leasedSearch.trim()) return leased;
    const q = leasedSearch.toLowerCase();
    return leased.filter(l => (l.outlet_name || "").toLowerCase().includes(q) || (l.outlet_code || "").toLowerCase().includes(q) || l.items.some(it => it.product_name.toLowerCase().includes(q)));
  }, [leased, leasedSearch]);

  const filteredSold = useMemo(() => {
    if (!soldSearch.trim()) return sold;
    const q = soldSearch.toLowerCase();
    return sold.filter(s => (s.outlet_name || "").toLowerCase().includes(q) || (s.outlet_code || "").toLowerCase().includes(q) || s.items.some(it => it.product_name.toLowerCase().includes(q)));
  }, [sold, soldSearch]);

  const handleDeleteWaybill = (id: string) => {
    if (!confirm("Delete this waybill?")) return;
    setDeletingWaybillId(id);
    startTransitionW(async () => { try { await deleteWaybill(id); setWaybills(prev => prev.filter(w => w.id !== id)); } catch (err: any) { alert(err.message ?? "Failed."); } finally { setDeletingWaybillId(null); } });
  };

  const handleDeleteLease = (id: string) => {
    if (!confirm("Delete this lease record?")) return;
    setDeletingLeaseId(id);
    startTransitionL(async () => { try { await deleteLeaseEmpties(id); setLeased(prev => prev.filter(l => l.id !== id)); } catch (err: any) { alert(err.message ?? "Failed."); } finally { setDeletingLeaseId(null); } });
  };

  const handleDeleteSold = (id: string) => {
    if (!confirm("Delete this sold empties record?")) return;
    setDeletingSoldId(id);
    startTransitionS(async () => { try { await deleteSoldEmpties(id); setSold(prev => prev.filter(s => s.id !== id)); } catch (err: any) { alert(err.message ?? "Failed."); } finally { setDeletingSoldId(null); } });
  };

  const waybillExport = filteredWaybills.map(w => ({ Date: w.date || "—", "SAP Waybill": w.sap_waybill || "—", Products: (w.items || []).map(i => `${i.product_name} ×${i.quantity}`).join(", "), "Total Qty": (w.items || []).reduce((s, i) => s + Number(i.quantity || 0), 0) }));
  const leasedExport = filteredLeased.flatMap((l) => {
    const rows: Record<string, string | number>[] = [];
    for (const it of l.items) {
      const returns = it.returns || [];
      if (returns.length > 0) {
        for (const r of returns) {
          rows.push({
            Date: l.date || "—",
            Outlet: l.outlet_name || "—",
            "Outlet Code": l.outlet_code || "—",
            Product: it.product_name,
            "Qty Leased": it.quantity,
            "Qty Returned": r.quantity,
            "Returned Date": r.date,
            Legacy: r.is_legacy ? "yes" : "",
          });
        }
      } else {
        rows.push({
          Date: l.date || "—",
          Outlet: l.outlet_name || "—",
          "Outlet Code": l.outlet_code || "—",
          Product: it.product_name,
          "Qty Leased": it.quantity,
          "Qty Returned": it.returned_qty || 0,
          "Returned Date": it.returned_date || l.returned_date || "—",
          Legacy: "",
        });
      }
    }
    return rows;
  });
  const soldExport = filteredSold.map(s => ({ Date: s.date || "—", "Outlet Code": s.outlet_code || "—", Outlet: s.outlet_name || "—", Products: s.formatted_products, Amount: s.amount }));

  const TABS = [
    { key: "waybills" as const, label: "Waybills" },
    { key: "leased" as const, label: "Leased Empties" },
    { key: "sold" as const, label: "Sold Empties" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 bg-white p-4 rounded-xl border border-zinc-200 shadow-sm">
        <Button variant="outline" size="sm" onClick={() => setShowWaybillModal(true)} className="whitespace-nowrap border-amber-300 text-amber-700 hover:bg-amber-50 text-xs font-semibold gap-1.5">
          <Truck className="h-3.5 w-3.5" /> + Create Waybill
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowLeaseModal(true)} className="whitespace-nowrap border-indigo-300 text-indigo-700 hover:bg-indigo-50 text-xs font-semibold gap-1.5">
          <PackageOpen className="h-3.5 w-3.5" /> + Sold / Lease Empties
        </Button>
      </div>

      <div className="flex border-b border-zinc-200 gap-6 px-1">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveSection(tab.key)} className={`pb-3 text-sm font-bold transition-colors border-b-2 ${activeSection === tab.key ? "border-[var(--primary)] text-[var(--primary)]" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeSection === "waybills" && (
        <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-52">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-400" />
                <Input
                  placeholder="Search SAP No. or date..."
                  value={waybillSearch}
                  onChange={e => setWaybillSearch(e.target.value)}
                  className="pl-8 text-xs h-8"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium text-zinc-600">From</label>
                <Input
                  type="date"
                  value={waybillFrom}
                  onChange={e => setWaybillFrom(e.target.value)}
                  className="w-36 h-8 text-xs"
                />
                <label className="text-xs font-medium text-zinc-600">To</label>
                <Input
                  type="date"
                  value={waybillTo}
                  onChange={e => setWaybillTo(e.target.value)}
                  className="w-36 h-8 text-xs"
                />
                <Button
                  size="sm"
                  onClick={() => void loadWaybills(waybillFrom, waybillTo)}
                  disabled={loadingWaybills}
                  className="h-8 px-3 text-xs bg-[#e51e2a] hover:bg-[#c91823] text-white font-semibold flex items-center gap-1.5"
                >
                  {loadingWaybills && <Loader2 className="h-3 w-3 animate-spin" />}
                  Load
                </Button>
                {(waybillFrom || waybillTo) && (
                  <button
                    type="button"
                    onClick={() => { setWaybillFrom(""); setWaybillTo(""); void loadWaybills("", ""); }}
                    className="text-[0.6875rem] text-zinc-400 hover:text-zinc-700 underline ml-1"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <ExportButtons data={waybillExport} filename="waybills" />
          </div>
          {loadingWaybills ? <div className="py-12 text-center text-zinc-400 text-sm flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div> : (
            <Table>
              <TableHeader><TableRow className="bg-zinc-50"><TableHead>Date</TableHead><TableHead>SAP Waybill No.</TableHead><TableHead>Products</TableHead><TableHead className="text-right">Total Qty</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {filteredWaybills.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-10 text-zinc-400">No waybills found.</TableCell></TableRow>
                  : filteredWaybills.map(w => (
                    <TableRow key={w.id}>
                      <TableCell className="font-mono text-xs">{w.date || "—"}</TableCell>
                      <TableCell className="font-mono font-semibold text-amber-700">{w.sap_waybill || "—"}</TableCell>
                      <TableCell className="text-xs"><div className="flex flex-wrap gap-1">{(w.items || []).map((item, i) => <span key={i} className="bg-zinc-100 rounded px-1.5 py-0.5 text-[0.6875rem]">{item.product_name} <span className="font-bold text-zinc-600">×{item.quantity}</span></span>)}</div></TableCell>
                      <TableCell className="text-right font-bold">{fmt((w.items || []).reduce((s, i) => s + Number(i.quantity || 0), 0))}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" className="text-blue-600 hover:text-blue-800 gap-1" onClick={() => setEditingWaybill(w)}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                          <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700 gap-1" onClick={() => handleDeleteWaybill(w.id)} disabled={deletingWaybillId === w.id || isPendingW}>{deletingWaybillId === w.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Delete</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {activeSection === "leased" && (
        <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-52">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-400" />
                <Input
                  placeholder="Search outlet or product..."
                  value={leasedSearch}
                  onChange={e => setLeasedSearch(e.target.value)}
                  className="pl-8 text-xs h-8"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium text-zinc-600">From</label>
                <Input
                  type="date"
                  value={leasedFrom}
                  onChange={e => setLeasedFrom(e.target.value)}
                  className="w-36 h-8 text-xs"
                />
                <label className="text-xs font-medium text-zinc-600">To</label>
                <Input
                  type="date"
                  value={leasedTo}
                  onChange={e => setLeasedTo(e.target.value)}
                  className="w-36 h-8 text-xs"
                />
                <Button
                  size="sm"
                  onClick={() => void loadLeased(leasedFrom, leasedTo)}
                  disabled={loadingLeased}
                  className="h-8 px-3 text-xs bg-[#e51e2a] hover:bg-[#c91823] text-white font-semibold flex items-center gap-1.5"
                >
                  {loadingLeased && <Loader2 className="h-3 w-3 animate-spin" />}
                  Load
                </Button>
                {(leasedFrom || leasedTo) && (
                  <button
                    type="button"
                    onClick={() => { setLeasedFrom(""); setLeasedTo(""); void loadLeased("", ""); }}
                    className="text-[0.6875rem] text-zinc-400 hover:text-zinc-700 underline ml-1"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <ExportButtons data={leasedExport} filename="leased_empties" />
          </div>
          {loadingLeased ? <div className="py-12 text-center text-zinc-400 text-sm flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div> : (
            <Table>
              <TableHeader><TableRow className="bg-zinc-50"><TableHead>Date</TableHead><TableHead>Outlet</TableHead><TableHead>Products</TableHead><TableHead className="text-right">Total Leased</TableHead><TableHead>Returns</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {filteredLeased.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center py-10 text-zinc-400">No leased empty records found.</TableCell></TableRow>
                  : filteredLeased.map(l => {
                    const tl = l.items.reduce((s, it) => s + (it.quantity || 0), 0);
                    const tr = l.items.reduce((s, it) => s + (it.returned_qty || 0), 0);
                    const out = tl - tr;
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="font-mono text-xs">{l.date || "—"}</TableCell>
                        <TableCell><div className="font-medium text-xs">{l.outlet_name || "—"}</div>{l.outlet_code && <div className="font-mono text-[0.625rem] text-zinc-400">{l.outlet_code}</div>}</TableCell>
                        <TableCell className="text-xs"><div className="flex flex-wrap gap-1">{l.items.map((it, i) => <span key={i} className="bg-indigo-50 rounded px-1.5 py-0.5 text-[0.6875rem] text-indigo-800">{it.product_name} <span className="font-bold">×{it.quantity}</span></span>)}</div></TableCell>
                        <TableCell className="text-right font-bold text-indigo-700">{fmt(tl)}</TableCell>
                        <TableCell className="text-xs whitespace-pre-line text-emerald-800">{l.formatted_returned || "—"}</TableCell>
                        <TableCell className="text-right font-bold" style={{ color: out > 0 ? "#b45309" : out < 0 ? "#dc2626" : "#16a34a" }}>{fmt(out)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="outline" className="h-7 px-2 text-[0.6875rem] font-semibold border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => setReturningLease(l)}>Returns</Button>
                            <Button size="sm" variant="ghost" className="text-blue-600 hover:text-blue-800 gap-1" onClick={() => setEditingLease(l)}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                            <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700 gap-1" onClick={() => handleDeleteLease(l.id)} disabled={deletingLeaseId === l.id || isPendingL}>{deletingLeaseId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Delete</Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {activeSection === "sold" && (
        <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-52">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-400" />
                <Input
                  placeholder="Search outlet or product..."
                  value={soldSearch}
                  onChange={e => setSoldSearch(e.target.value)}
                  className="pl-8 text-xs h-8"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium text-zinc-600">From</label>
                <Input
                  type="date"
                  value={soldFrom}
                  onChange={e => setSoldFrom(e.target.value)}
                  className="w-36 h-8 text-xs"
                />
                <label className="text-xs font-medium text-zinc-600">To</label>
                <Input
                  type="date"
                  value={soldTo}
                  onChange={e => setSoldTo(e.target.value)}
                  className="w-36 h-8 text-xs"
                />
                <Button
                  size="sm"
                  onClick={() => void loadSold(soldFrom, soldTo)}
                  disabled={loadingSold}
                  className="h-8 px-3 text-xs bg-[#e51e2a] hover:bg-[#c91823] text-white font-semibold flex items-center gap-1.5"
                >
                  {loadingSold && <Loader2 className="h-3 w-3 animate-spin" />}
                  Load
                </Button>
                {(soldFrom || soldTo) && (
                  <button
                    type="button"
                    onClick={() => { setSoldFrom(""); setSoldTo(""); void loadSold("", ""); }}
                    className="text-[0.6875rem] text-zinc-400 hover:text-zinc-700 underline ml-1"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <ExportButtons data={soldExport} filename="sold_empties" />
          </div>
          {loadingSold ? <div className="py-12 text-center text-zinc-400 text-sm flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div> : (
            <Table>
              <TableHeader><TableRow className="bg-zinc-50"><TableHead>Date</TableHead><TableHead>Outlet Code</TableHead><TableHead>Outlet</TableHead><TableHead>Products</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {filteredSold.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-10 text-zinc-400">No sold empties records found.</TableCell></TableRow>
                  : filteredSold.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.date || "—"}</TableCell>
                      <TableCell className="font-mono text-xs text-zinc-600">{s.outlet_code || "—"}</TableCell>
                      <TableCell className="text-xs font-medium">{s.outlet_name || "—"}</TableCell>
                      <TableCell className="text-xs text-zinc-700 max-w-xs truncate">{s.formatted_products || "—"}</TableCell>
                      <TableCell className="text-right font-bold text-emerald-700">Rs. {fmt(s.amount)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" className="text-blue-600 hover:text-blue-800 gap-1" onClick={() => setEditingSold(s)}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                          <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700 gap-1" onClick={() => handleDeleteSold(s.id)} disabled={deletingSoldId === s.id || isPendingS}>{deletingSoldId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Delete</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {editingSold && (
        <EditSoldModal record={editingSold} outlets={outlets} products={returnableNonRgbProducts} onClose={() => setEditingSold(null)} onSaved={() => { setEditingSold(null); void loadSold(soldFrom, soldTo); }} />
      )}
      {editingWaybill && (
        <EditWaybillModal
          waybill={editingWaybill}
          onClose={() => setEditingWaybill(null)}
          onSaved={() => { setEditingWaybill(null); void loadWaybills(waybillFrom, waybillTo); }}
        />
      )}
      {editingLease && (
        <EditLeaseModal
          lease={editingLease}
          onClose={() => setEditingLease(null)}
          onSaved={() => { setEditingLease(null); void loadLeased(leasedFrom, leasedTo); }}
        />
      )}
      {returningLease && (
        <ReturnedLeaseModal
          lease={returningLease}
          onClose={() => setReturningLease(null)}
          onSaved={() => { setReturningLease(null); void loadLeased(leasedFrom, leasedTo); }}
        />
      )}

      {showWaybillModal && <CreateWaybillModal products={waybillProducts} onClose={() => setShowWaybillModal(false)} onSaved={() => { setShowWaybillModal(false); void loadWaybills(waybillFrom, waybillTo); }} />}
      {showLeaseModal && <SoldLeaseEmptiesModal products={returnableNonRgbProducts} outlets={outlets} onClose={() => setShowLeaseModal(false)} onSaved={() => { setShowLeaseModal(false); void loadLeased(leasedFrom, leasedTo); void loadSold(soldFrom, soldTo); }} />}
    </div>
  );
}

function EditSoldModal({ record, outlets, products, onClose, onSaved }: { record: SoldEmptyRecord; outlets: OutletOption[]; products: ProductOption[]; onClose: () => void; onSaved: () => void; }) {
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState(record.date);
  const [amount, setAmount] = useState(String(record.amount));
  const [outletQuery, setOutletQuery] = useState(`[${record.outlet_code}] ${record.outlet_name}`);
  const [outletDropdownOpen, setOutletDropdownOpen] = useState(false);
  const [selectedOutlet, setSelectedOutlet] = useState<OutletOption | null>(outlets.find(o => o.id === record.shop_id) || null);
  const [lines, setLines] = useState<{ product: ProductOption; quantity: number }[]>(record.items.map(it => ({ product: { id: it.product_id, product_name: it.product_name, product_code: it.product_code }, quantity: it.quantity })));
  const [productQuery, setProductQuery] = useState("");
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const outletRef = useRef<HTMLDivElement>(null);
  const productRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (outletRef.current && !outletRef.current.contains(e.target as Node)) setOutletDropdownOpen(false);
      if (productRef.current && !productRef.current.contains(e.target as Node)) setProductDropdownOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const filteredOutlets = useMemo(() => { const q = outletQuery.toLowerCase(); return outlets.filter(o => o.outlet_code.toLowerCase().includes(q) || o.shop_name.toLowerCase().includes(q)).slice(0, 20); }, [outlets, outletQuery]);
  const filteredProducts = useMemo(() => { const used = lines.map(l => l.product.id); const available = products.filter(p => !used.includes(p.id)); if (!productQuery.trim()) return available.slice(0, 50); const q = productQuery.toLowerCase(); return available.filter(p => p.product_name.toLowerCase().includes(q) || (p.product_code || "").toLowerCase().includes(q)).slice(0, 50); }, [products, productQuery, lines]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOutlet || lines.length === 0) { alert("Select outlet and add at least one product."); return; }
    startTransition(async () => {
      try {
        await updateSoldEmpties(record.id, { date, shop_id: selectedOutlet.id, outlet_code: selectedOutlet.outlet_code, outlet_name: selectedOutlet.shop_name, amount: parseFloat(amount) || 0, items: lines.map(l => ({ product_id: l.product.id, product_code: l.product.product_code ?? "", product_name: l.product.product_name, quantity: l.quantity })) });
        onSaved();
      } catch (err: any) { alert(err.message ?? "Failed."); }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 bg-zinc-50">
          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2"><Pencil className="h-4 w-4 text-blue-600" /> Edit Sold Empties</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200 text-lg">×</button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-6 py-4 space-y-3 overflow-y-auto flex-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase">Date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase">Amount (Rs.)</label>
                <input type="number" step="any" min="0" value={amount} onChange={e => setAmount(e.target.value)} className="w-full border border-emerald-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-emerald-50/30 font-bold text-emerald-800" />
              </div>
            </div>
            <div ref={outletRef} className="relative">
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase">Outlet</label>
              <input type="text" value={outletQuery} onChange={e => { setOutletQuery(e.target.value); setOutletDropdownOpen(true); if (selectedOutlet) setSelectedOutlet(null); }} onFocus={() => setOutletDropdownOpen(true)} placeholder="Search outlet..." className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              {outletDropdownOpen && filteredOutlets.length > 0 && (
                <div className="absolute z-20 top-full mt-1 left-0 right-0 max-h-44 overflow-y-auto bg-white border border-zinc-200 rounded-lg shadow-xl divide-y divide-zinc-100">
                  {filteredOutlets.map(o => <button key={o.id} type="button" onClick={() => { setSelectedOutlet(o); setOutletQuery(`[${o.outlet_code}] ${o.shop_name}`); setOutletDropdownOpen(false); }} className={`w-full text-left px-3 py-2 text-xs hover:bg-blue-50 ${selectedOutlet?.id === o.id ? "bg-blue-50 text-blue-700 font-semibold" : "text-zinc-800"}`}><span className="font-mono text-zinc-400 mr-1">[{o.outlet_code}]</span> {o.shop_name}</button>)}
                </div>
              )}
            </div>
            <div ref={productRef} className="relative">
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase">Products</label>
              <input type="text" value={productQuery} onChange={e => { setProductQuery(e.target.value); setProductDropdownOpen(true); }} onFocus={() => setProductDropdownOpen(true)} placeholder="Add product..." className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              {productDropdownOpen && filteredProducts.length > 0 && (
                <div className="absolute z-20 top-full mt-1 left-0 right-0 max-h-44 overflow-y-auto bg-white border border-zinc-200 rounded-lg shadow-xl divide-y divide-zinc-100">
                  {filteredProducts.map(p => <button key={p.id} type="button" onClick={() => { setLines(prev => [...prev, { product: p, quantity: 1 }]); setProductQuery(""); setProductDropdownOpen(false); }} className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 text-zinc-800"><span className="font-mono text-zinc-400 mr-1">[{p.product_code}]</span> {p.product_name}</button>)}
                </div>
              )}
            </div>
            {lines.length > 0 && (
              <div className="rounded-lg border border-zinc-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 text-zinc-500 uppercase text-[0.625rem]"><tr><th className="text-left px-3 py-2">Product</th><th className="text-right px-3 py-2 w-28">Qty</th><th className="w-8"></th></tr></thead>
                  <tbody className="divide-y divide-zinc-100">
                    {lines.map((l, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 font-medium">{l.product.product_name}</td>
                        <td className="px-3 py-2"><input type="number" min="1" value={l.quantity || ""} onChange={e => setLines(prev => prev.map((x, idx) => idx === i ? { ...x, quantity: parseInt(e.target.value) || 0 } : x))} className="w-24 text-right text-xs border border-zinc-200 rounded px-2 py-1 ml-auto block" /></td>
                        <td className="px-2 py-2 text-center"><button type="button" onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))} className="text-zinc-400 hover:text-red-500">×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="px-6 py-3 border-t border-zinc-100 flex gap-2">
            <Button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-1.5" disabled={isPending || lines.length === 0 || !selectedOutlet}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? "Saving..." : "Update Record"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditWaybillModal({
  waybill,
  onClose,
  onSaved,
}: {
  waybill: WaybillSummaryRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(waybill.date);
  const [sapWaybill, setSapWaybill] = useState(waybill.sap_waybill);
  const [items, setItems] = useState<{ product_id: string; product_code: string; product_name: string; quantity: number }[]>(
    waybill.items.map((it) => ({
      product_id: it.product_id || "",
      product_code: it.product_code || "",
      product_name: it.product_name,
      quantity: it.quantity,
    }))
  );
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    if (!sapWaybill.trim()) {
      alert("SAP Waybill number is required");
      return;
    }
    if (items.length === 0 || items.some((it) => it.quantity <= 0)) {
      alert("At least one product with quantity > 0 is required");
      return;
    }
    startTransition(async () => {
      try {
        await updateWaybill(waybill.id, {
          date,
          sap_waybill: sapWaybill.trim(),
          items,
        });
        onSaved();
      } catch (err: any) {
        alert(`Failed to update waybill: ${err.message}`);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-zinc-200 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b border-zinc-100 bg-zinc-50 flex-shrink-0">
          <h3 className="text-sm font-bold text-zinc-800">Edit Waybill #{waybill.sap_waybill}</h3>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-600 font-bold text-lg leading-none">×</button>
        </div>
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border border-zinc-300 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-red-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">SAP Waybill #</label>
              <input type="text" value={sapWaybill} onChange={(e) => setSapWaybill(e.target.value)} className="w-full border border-zinc-300 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-red-500 focus:outline-none font-mono font-bold" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-2">Waybill Products</label>
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {items.map((it, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-zinc-50 border border-zinc-200 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-zinc-800 truncate">{it.product_name}</p>
                    {it.product_code && <p className="font-mono text-[0.625rem] text-zinc-400">{it.product_code}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <input type="number" min={1} value={it.quantity} onChange={(e) => setItems((prev) => prev.map((row, i) => i === idx ? { ...row, quantity: parseFloat(e.target.value) || 0 } : row))} className="w-20 border border-zinc-300 rounded px-2 py-1 text-xs text-right font-mono font-bold focus:outline-none focus:ring-1 focus:ring-red-400" />
                    <button type="button" onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))} disabled={items.length <= 1} className="text-zinc-400 hover:text-red-600 disabled:opacity-30 p-1">
                      <Trash2 className="h-[0.875rem] w-[0.875rem]" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="px-4 sm:px-5 py-3 border-t border-zinc-100 flex gap-2">
          <Button type="button" className="flex-1" onClick={handleSave} disabled={isPending}>{isPending ? "Saving..." : "Save"}</Button>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

function EditLeaseModal({
  lease,
  onClose,
  onSaved,
}: {
  lease: LeasedEmptyRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState(lease.date);
  const [lines, setLines] = useState<{ id?: string; product_id: string; product_code: string; product_name: string; quantity: number }[]>(() =>
    lease.items.map((it) => ({
      id: it.id,
      product_id: it.product_id,
      product_code: it.product_code,
      product_name: it.product_name,
      quantity: it.quantity,
    }))
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lines.length || lines.some((l) => l.quantity <= 0)) {
      alert("At least one product with quantity > 0 is required.");
      return;
    }
    startTransition(async () => {
      try {
        await updateLeaseEmpties(lease.id, {
          date,
          shop_id: lease.shop_id,
          outlet_code: lease.outlet_code,
          outlet_name: lease.outlet_name,
          items: lines,
        });
        onSaved();
      } catch (err: any) {
        alert(err.message ?? "Failed to update lease.");
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[90vh]">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-zinc-100 flex-shrink-0">
          <div>
            <h3 className="text-[0.875rem] font-bold text-zinc-900">Edit Lease Record</h3>
            <p className="text-[0.6875rem] text-zinc-500 mt-0.5">{lease.outlet_code} — {lease.outlet_name}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 text-lg">×</button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-3 sm:px-6 py-3 sm:py-4 space-y-3 sm:space-y-4 flex-1 overflow-y-auto">
            <div>
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="w-full h-9 rounded-lg border border-zinc-200 px-3 text-[0.75rem] bg-white focus:outline-none focus:ring-2 focus:ring-red-400" />
            </div>
            <div>
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Products & Quantities</label>
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={l.id || i} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-zinc-800 truncate">{l.product_name}</p>
                      {l.product_code && <p className="font-mono text-[0.625rem] text-zinc-400">{l.product_code}</p>}
                    </div>
                    <input type="number" min="1" value={l.quantity} onChange={(e) => setLines((prev) => prev.map((row, idx) => idx === i ? { ...row, quantity: parseFloat(e.target.value) || 0 } : row))} className="w-24 border border-zinc-200 rounded px-2 py-1 text-xs text-right font-mono" />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="px-4 sm:px-6 py-3 border-t border-zinc-100 flex gap-2">
            <Button type="submit" className="flex-1" disabled={isPending}>{isPending ? "Saving..." : "Save"}</Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

