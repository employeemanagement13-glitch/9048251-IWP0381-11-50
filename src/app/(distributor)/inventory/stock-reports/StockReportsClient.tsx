"use client";

import Link from "next/link";
import { Trash2, Pencil, Loader2 } from "lucide-react";
import { useMemo, useState, useTransition, useEffect, useCallback } from "react";
import { ExportButtons } from "@/components/export/ExportButtons";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/Table";
import {
  getStockBalanceReport,
  getStockLedger,
  getEmptyLedger,
  deleteEmptyLedgerEntry,
  getStockBalanceByLevel,
  getSalePurchaseSummary,
  getInvoicesForLedger,
  getReturnsForLedger,
  getSaleEntriesForLedger,
} from "@/lib/actions/reports";
import {
  getWaybillsSummary,
  deleteWaybill,
  updateWaybill,
  getEmptyBalanceReport,
  type WaybillSummaryRow,
  type EmptyBalanceRow,
  type Waybill,
} from "@/lib/actions/warehouse-waybills";
import {
  getLeaseEmpties,
  getOutletEmptyBalance,
  updateLeaseEmpties,
  deleteLeaseEmpties,
  type LeasedEmptyRecord,
  type OutletEmptyBalanceData,
} from "@/lib/actions/leased-empties";
import { ReturnedLeaseModal } from "@/components/empties/ReturnedLeaseModal";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

type View =
  | "stock_balance"
  | "balance_by_level"
  | "empty_balance"
  | "outlet_empty_balance";

const VIEWS: { key: View; label: string }[] = [
  { key: "stock_balance", label: "Stock Balance" },
  { key: "balance_by_level", label: "Balance by Level" },
  { key: "empty_balance", label: "Empty Balance" },
  { key: "outlet_empty_balance", label: "Outlet's Empty Balance" },
];

const REPORT_FLAGS: Record<View, string> = {
  stock_balance: "tab_stock_balance",
  balance_by_level: "tab_stock_balance_level",
  empty_balance: "tab_empty_balance",
  outlet_empty_balance: "tab_outlet_empty_balance",
};

const TODAY = new Date().toISOString().slice(0, 10);
const FIRST_OF_MONTH = TODAY.slice(0, 8) + "01";

type DataRow = Record<string, any>;

const fmt = (n: unknown) =>
  n != null
    ? Number(n as number).toLocaleString(undefined, { minimumFractionDigits: 0 })
    : "—";

const fmtA = (n: unknown) =>
  n != null
    ? "Rs. " +
      Number(n as number).toLocaleString(undefined, { minimumFractionDigits: 2 })
    : "—";

interface Props {
  products: { id: string; product_name: string }[];
  returnableProducts: { id: string; product_name: string }[];
}

export function StockReportsClient({ products, returnableProducts }: Props) {
  const [view, setView] = useState<View>("stock_balance");
  const [enabledFlags, setEnabledFlags] = useState<string[]>([]);
  const [flagsLoaded, setFlagsLoaded] = useState(false);

  const refreshFlags = useCallback(async () => {
    try {
      const res = await fetch(`/api/flags?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setEnabledFlags(data.enabledFlags ?? []);
      setFlagsLoaded(true);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    refreshFlags();
  }, [refreshFlags]);

  useRealtimeTable("global_feature_flags", refreshFlags);
  useRealtimeTable("tenant_feature_flags", refreshFlags);

  const visibleViews = useMemo(() => {
    if (!flagsLoaded) return VIEWS;
    return VIEWS.filter((v) => enabledFlags.includes(REPORT_FLAGS[v.key]) || v.key === "stock_balance");
  }, [flagsLoaded, enabledFlags]);

  useEffect(() => {
    if (visibleViews.length > 0 && !visibleViews.some((v) => v.key === view)) {
      setView(visibleViews[0].key);
    }
  }, [visibleViews, view]);

  return (
    <div className="space-y-4">
      {visibleViews.length === 0 && flagsLoaded ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center text-amber-800 text-sm">
          All reports on this page have been globally disabled by the administrator.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 sm:gap-2 pb-1">
            {visibleViews.map((v) => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={[
                  "px-3 py-1.5 text-xs font-semibold rounded-full border transition-all",
                  view === v.key
                    ? "border-transparent shadow-sm"
                    : "bg-white border-zinc-200 text-zinc-600 hover:border-zinc-400",
                ].join(" ")}
                style={view === v.key ? { background: "var(--primary)", color: "#fff" } : {}}
              >
                {v.label}
              </button>
            ))}
          </div>

          {view === "stock_balance" && <StockBalanceReport />}
          {view === "balance_by_level" && visibleViews.some(v => v.key === "balance_by_level") && <StockBalanceByLevel />}
          {view === "empty_balance" && visibleViews.some(v => v.key === "empty_balance") && <EmptyBalance />}
          {view === "outlet_empty_balance" && visibleViews.some(v => v.key === "outlet_empty_balance") && <OutletEmptyBalance />}
        </>
      )}
    </div>
  );
}

function StockBalanceReport() {
  const [date, setDate] = useState(TODAY);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  const loadData = useCallback((targetDate: string) => {
    setLoading(true);
    startTransition(async () => {
      try {
        const data = await getStockBalanceReport({ asOfDate: targetDate });
        setRows(data);
      } catch (err) {
        console.error("Failed to load stock balance:", err);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    loadData(date);
  }, [date, loadData]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase().trim();
    return rows.filter((r) =>
      (r.code || "").toLowerCase().includes(q) ||
      (r.product_name || "").toLowerCase().includes(q) ||
      (r.category || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totalNetBalance = useMemo(() => {
    return filtered.reduce((s, r) => s + Number(r.net_balance || 0), 0);
  }, [filtered]);

  const exportData = useMemo(() => {
    return filtered.map((r) => ({
      Code: r.code || "",
      Product: r.product_name || "",
      Category: r.category || "",
      "Packing Qty": r.packing_qty ?? 1,
      "Net Balance (Net Balance in Warehouse)": r.net_balance,
    }));
  }, [filtered]);

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-end justify-between gap-3 bg-zinc-50 p-3.5 rounded-xl border border-zinc-200">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Date</label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40 h-9 text-xs bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Search Product</label>
            <Input
              type="text"
              placeholder="Search code, product..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 h-9 text-xs bg-white"
            />
          </div>
          <Button
            type="button"
            onClick={() => loadData(date)}
            disabled={loading}
            className="h-9 px-4 text-xs font-semibold bg-[#e51e2a] hover:bg-[#c91823] text-white flex items-center gap-1.5"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading ? "Loading..." : "Load"}
          </Button>
          {(date !== TODAY || search) && (
            <button
              onClick={() => { setDate(TODAY); setSearch(""); }}
              className="text-[0.6875rem] text-zinc-400 hover:text-zinc-700 underline mb-2"
            >
              Reset
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-white border border-zinc-200 rounded-lg px-4 py-1.5 text-xs shadow-sm">
            <span className="text-zinc-500 font-medium">Total Net Balance: </span>
            <span className="font-bold text-zinc-900 font-mono">
              {totalNetBalance.toLocaleString(undefined, { minimumFractionDigits: 0 })}
            </span>
          </div>
          <ExportButtons data={exportData} filename={`stock_balance_${date}`} />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50">
              <TableHead className="w-32">Code</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="w-44">Category</TableHead>
              <TableHead className="w-32 text-right">Packing Qty</TableHead>
              <TableHead className="w-52 text-right font-semibold" style={{ color: "var(--primary)" }}>
                Net Balance (Net Balance in Warehouse)
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-zinc-400 py-12 text-xs">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                    <span>Loading stock balance...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-zinc-400 py-12 text-xs">
                  No stock records found for {date}.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {filtered.map((row, idx) => (
                  <TableRow key={row.product_id || idx} className="hover:bg-zinc-50/70">
                    <TableCell className="font-mono text-xs font-semibold text-zinc-700">
                      {row.code || "—"}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-zinc-900">
                      {row.product_name}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-600">
                      {row.category || "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-zinc-700">
                      {row.packing_qty ?? 1}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-xs" style={{ color: "var(--primary)" }}>
                      {fmt(row.net_balance)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-zinc-50 font-bold text-xs border-t-2 border-zinc-200">
                  <TableCell colSpan={3}>Total</TableCell>
                  <TableCell className="text-right font-mono">—</TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold text-red-600">
                    {fmt(totalNetBalance)}
                  </TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function StockLedger({ products }: { products: { id: string; product_name: string }[] }) {
  const [, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState(products[0]?.id ?? "");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<DataRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const [modalState, setModalState] = useState<{
    open: boolean;
    title: string;
    type: "invoice" | "returns" | "sale_entry";
    date: string;
    productName: string;
    items: any[];
    loading: boolean;
  }>({
    open: false,
    title: "",
    type: "invoice",
    date: "",
    productName: "",
    items: [],
    loading: false,
  });

  const load = () => {
    if (!selectedId) return;
    setLoading(true);
    startTransition(async () => {
      try {
        const data = await getStockLedger({
          productId: selectedId,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        });
        setRows(data);
        setLoaded(true);
      } finally {
        setLoading(false);
      }
    });
  };

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedId)?.product_name ?? "",
    [products, selectedId]
  );

  const openInvoicesModal = (date: string) => {
    setModalState({
      open: true,
      title: `Invoices containing ${selectedProduct} on ${date}`,
      type: "invoice",
      date,
      productName: selectedProduct,
      items: [],
      loading: true,
    });
    startTransition(async () => {
      try {
        const data = await getInvoicesForLedger(selectedProduct, date);
        setModalState((prev) => ({ ...prev, items: data, loading: false }));
      } catch {
        setModalState((prev) => ({ ...prev, loading: false }));
      }
    });
  };

  const openReturnsModal = (date: string) => {
    setModalState({
      open: true,
      title: `Invoice Returns for ${selectedProduct} on ${date}`,
      type: "returns",
      date,
      productName: selectedProduct,
      items: [],
      loading: true,
    });
    startTransition(async () => {
      try {
        const data = await getReturnsForLedger(selectedProduct, date);
        setModalState((prev) => ({ ...prev, items: data, loading: false }));
      } catch {
        setModalState((prev) => ({ ...prev, loading: false }));
      }
    });
  };

  const openSaleEntriesModal = (date: string, sourceRef: string) => {
    setModalState({
      open: true,
      title: `Sale Entry — ${sourceRef || date}`,
      type: "sale_entry",
      date,
      productName: selectedProduct,
      items: [],
      loading: true,
    });
    startTransition(async () => {
      try {
        const data = await getSaleEntriesForLedger(sourceRef);
        setModalState((prev) => ({ ...prev, items: data, loading: false }));
      } catch {
        setModalState((prev) => ({ ...prev, loading: false }));
      }
    });
  };

  const exportData = rows.map((r) => ({
    Date: r.date,
    Product: r.product_name,
    Direction: r.direction,
    Source: r.source,
    Quantity: r.direction === "IN" ? `+${r.qty}` : `-${r.qty}`,
    "Running Balance": r.running_balance,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">Product</label>
          <SearchableSelect
            options={products.map((p) => ({
              value: p.id,
              label: p.product_name,
              sub: (p as any).product_code || undefined,
            }))}
            value={selectedId}
            onChange={(v) => setSelectedId(v)}
            placeholder="— Select product —"
            searchPlaceholder="Search by code or name..."
            className="w-64"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36" />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36" />
        </div>
        <Button onClick={load} disabled={loading || !selectedId}>
          {loading ? "Loading..." : "Load Ledger"}
        </Button>
        {loaded && <ExportButtons data={exportData} filename={`stock_ledger_${selectedProduct}`} />}
      </div>

      {!loaded ? (
        <div className="text-center text-zinc-400 py-12 bg-white rounded-lg border border-zinc-200 text-sm">
          Select a product and click <strong>Load Ledger</strong> to view continuous transactions.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right font-semibold">Qty</TableHead>
                <TableHead className="text-right font-semibold" style={{ color: "var(--primary)" }}>
                  Running Balance
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-zinc-400 py-8">
                    No ledger transactions for selected product/period
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((item, i) => {
                  const isIn = item.direction === "IN";
                  return (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs text-zinc-600">{item.date}</TableCell>
                      <TableCell className="font-medium text-xs text-zinc-900">{item.product_name}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[0.6875rem] font-semibold ${
                            isIn ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                          }`}
                        >
                          {item.direction}
                        </span>
                      </TableCell>
                      <TableCell>
                        {item.source_type === "invoice" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openInvoicesModal(item.date)}
                            className="h-7 text-xs border-blue-200 text-blue-700 hover:bg-blue-50"
                          >
                            Invoice — View
                          </Button>
                        ) : item.source_type === "returns" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openReturnsModal(item.date)}
                            className="h-7 text-xs border-purple-200 text-purple-700 hover:bg-purple-50"
                          >
                            Returns & Wayback — View
                          </Button>
                        ) : item.source_type === "sale_entry" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openSaleEntriesModal(item.date, item.source_ref)}
                            className="h-7 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                          >
                            Sales — View
                          </Button>
                        ) : (
                          <span className="font-mono text-xs text-zinc-700">{item.source}</span>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono font-semibold text-xs ${
                          isIn ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {isIn ? `+${fmt(item.qty)}` : `—${fmt(item.qty)}`}
                      </TableCell>
                      <TableCell
                        className="text-right font-mono font-bold text-xs"
                        style={{ color: "var(--primary)" }}
                      >
                        {fmt(item.running_balance)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {modalState.open && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-zinc-100">
              <h3 className="text-xs sm:text-sm font-bold text-zinc-900 truncate mr-2">{modalState.title}</h3>
              <button
                onClick={() => setModalState((prev) => ({ ...prev, open: false }))}
                className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 text-lg flex-shrink-0"
              >
                ×
              </button>
            </div>
            <div className="p-3 sm:p-6 max-h-[75vh] overflow-y-auto overflow-x-auto">
              {modalState.loading ? (
                <div className="py-12 text-center text-zinc-400 text-sm">Loading details...</div>
              ) : modalState.items.length === 0 ? (
                <div className="py-12 text-center text-zinc-400 text-sm">No records found.</div>
              ) : modalState.type === "invoice" ? (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-zinc-100">
                      <TableHead>Invoice No</TableHead>
                      <TableHead>Shop</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modalState.items.map((item: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{item.invoice_no}</TableCell>
                        <TableCell>{item.shop_name}</TableCell>
                        <TableCell className="text-right font-medium">{fmt(item.quantity)}</TableCell>
                        <TableCell className="text-right font-mono">{fmtA(item.amount)}</TableCell>
                        <TableCell className="capitalize text-xs text-zinc-600">{item.payment_status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : modalState.type === "sale_entry" ? (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-zinc-100">
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Sale Rate</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modalState.items.map((item: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium text-xs">{item.product_name}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(item.sale_rate)}</TableCell>
                        <TableCell className="text-right font-medium">{fmt(item.qty)}</TableCell>
                        <TableCell className="text-right font-mono font-semibold" style={{ color: "var(--primary)" }}>{fmtA(item.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-zinc-100">
                      <TableHead>Invoice No</TableHead>
                      <TableHead>Shop</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Returned Qty</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modalState.items.map((item: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{item.invoice_no}</TableCell>
                        <TableCell>{item.shop_name}</TableCell>
                        <TableCell>{item.product_name}</TableCell>
                        <TableCell className="text-right font-medium text-red-600">{fmt(item.returned_qty)}</TableCell>
                        <TableCell className="text-zinc-500">{item.note}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

            </div>
            <div className="px-6 py-3 border-t border-zinc-200 flex justify-end bg-zinc-50">
              <Button onClick={() => setModalState((prev) => ({ ...prev, open: false }))}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyLedger({ returnableProducts }: { returnableProducts: { id: string; product_name: string }[] }) {
  const [, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState(returnableProducts[0]?.id ?? "");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<DataRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const [modalState, setModalState] = useState<{
    open: boolean;
    title: string;
    type: "invoice" | "returns";
    date: string;
    productName: string;
    items: any[];
    loading: boolean;
  }>({
    open: false,
    title: "",
    type: "invoice",
    date: "",
    productName: "",
    items: [],
    loading: false,
  });

  const load = () => {
    if (!selectedId) return;
    setLoading(true);
    startTransition(async () => {
      try {
        const data = await getEmptyLedger({
          productId: selectedId,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        });
        setRows(data);
        setLoaded(true);
      } finally {
        setLoading(false);
      }
    });
  };

  const selectedProduct = useMemo(
    () => returnableProducts.find((p) => p.id === selectedId)?.product_name ?? "",
    [returnableProducts, selectedId]
  );

  const openInvoicesModal = (date: string, sourceType: string) => {
    // Use source_type ("invoice" | "returns") ÃƒÆ’Ã†'Ãƒ"š¯ÃƒÆ’Ã¢â‚¬Å¡Ãƒ"š¿ÃƒÆ’Ã¢â‚¬Å¡Ãƒ"š½ reliable, not the display direction string
    const isInvoice = sourceType === "invoice";
    setModalState({
      open: true,
      type: isInvoice ? "invoice" : "returns",
      title: isInvoice
        ? `Invoices containing ${selectedProduct} on ${date}`
        : `Invoice Returns for ${selectedProduct} on ${date}`,
      date,
      productName: selectedProduct,
      items: [],
      loading: true,
    });
    startTransition(async () => {
      try {
        const data = isInvoice
          ? await getInvoicesForLedger(selectedProduct, date)
          : await getReturnsForLedger(selectedProduct, date);
        setModalState((prev) => ({ ...prev, items: data, loading: false }));
      } catch {
        setModalState((prev) => ({ ...prev, loading: false }));
      }
    });
  };


    const deletableRows = rows.filter((r) => !!r.event_id);
  const isAllSelected = deletableRows.length > 0 && deletableRows.every((r) => selectedIds.includes(r.event_id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(deletableRows.map((r) => r.event_id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected ledger entries?`)) return;
    startTransition(async () => {
      try {
        for (const eventId of selectedIds) {
          const item = rows.find((r) => r.event_id === eventId);
          if (item) {
            await deleteEmptyLedgerEntry(eventId, item.source_type);
          }
        }
        setSelectedIds([]);
        load();
      } catch (err: any) {
        alert("Failed to delete entries: " + (err?.message ?? err));
      }
    });
  };

  const handleDeleteEntry = (eventId: string, sourceType: string) => {
    if (!confirm("Are you sure you want to delete this empty ledger entry?")) return;
    startTransition(async () => {
      try {
        await deleteEmptyLedgerEntry(eventId, sourceType);
        load();
      } catch (err: any) {
        alert("Failed to delete entry: " + (err?.message ?? err));
      }
    });
  };

  const exportData = rows.map((r) => ({
    Date: r.date,
    Product: r.product_name,
    Direction: r.direction,
    Reference: r.reference,
    Quantity: (r.direction === "CCBPL → Distribution" || r.direction === "Shop → Distribution") ? `+${r.qty}` : `-${r.qty}`,
    "Running Balance": r.running_balance,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">Product</label>
          <SearchableSelect
            options={returnableProducts.map((p) => ({
              value: p.id,
              label: p.product_name,
              sub: (p as any).product_code || undefined,
            }))}
            value={selectedId}
            onChange={(v) => setSelectedId(v)}
            placeholder="— Select product —"
            searchPlaceholder="Search by code or name..."
            className="w-64"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36" />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36" />
        </div>
        <Button onClick={load} disabled={loading || !selectedId}>
          {loading ? "Loading..." : "Load Ledger"}
        </Button>
        {loaded && (
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
                disabled={loading}
                className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 whitespace-nowrap"
              >
                <Trash2 className="h-4 w-4" />
                Delete ({selectedIds.length})
              </Button>
            )}
            <ExportButtons data={exportData} filename={`empty_ledger_${selectedProduct}`} />
          </div>
        )}
      </div>

      {!loaded ? (
        <div className="text-center text-zinc-400 py-12 bg-white rounded-lg border border-zinc-200 text-sm">
          Select an empties/returnable product and click <strong>Load Ledger</strong>.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right font-semibold">Quantity</TableHead>
                <TableHead className="text-right font-semibold" style={{ color: "var(--primary)" }}>
                  Running Balance
                </TableHead>
                <TableHead className="text-right font-semibold">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-zinc-400 py-8">
                    No empty movements for selected product/period
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((item, i) => {
                  const isSelected = item.event_id ? selectedIds.includes(item.event_id) : false;
                  const isPositive = item.direction === "CCBPL → Distribution" || item.direction === "Shop → Distribution";
                  return (
                    <TableRow key={i} className={isSelected ? "bg-red-50/50" : ""}>
                      <TableCell className="w-10 text-center">{item.event_id ? <input type="checkbox" checked={isSelected} onChange={() => setSelectedIds(prev => prev.includes(item.event_id) ? prev.filter(id => id !== item.event_id) : [...prev, item.event_id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /> : null}</TableCell>
                      <TableCell className="font-mono text-xs text-zinc-600">{item.date}</TableCell>
                      <TableCell className="font-medium text-xs text-zinc-900">{item.product_name}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[0.6875rem] font-semibold ${
                            isPositive ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {item.direction}
                        </span>
                      </TableCell>
                      <TableCell>
                        {item.reference === "Invoices — View" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openInvoicesModal(item.date, item.source_type)}
                            className="h-7 text-xs border-blue-200 text-blue-700 hover:bg-blue-50"
                          >
                            Invoices — View
                          </Button>
                        ) : (
                          <span className="font-mono text-xs font-semibold text-zinc-800">
                            {item.reference}
                          </span>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono font-semibold text-xs ${
                          isPositive ? "text-emerald-600" : "text-amber-600"
                        }`}
                      >
                        {isPositive ? `+${fmt(item.qty)}` : `—${fmt(item.qty)}`}
                      </TableCell>
                      <TableCell
                        className="text-right font-mono font-bold text-xs"
                        style={{ color: "var(--primary)" }}
                      >
                        {fmt(item.running_balance)}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.event_id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteEntry(item.event_id, item.source_type)}
                            className="h-7 px-2 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                          >
                            Delete
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {modalState.open && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-zinc-100">
              <h3 className="text-xs sm:text-sm font-bold text-zinc-900 truncate mr-2">{modalState.title}</h3>
              <button
                onClick={() => setModalState((prev) => ({ ...prev, open: false }))}
                className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 text-lg flex-shrink-0"
              >
                ×
              </button>
            </div>
            <div className="p-3 sm:p-6 max-h-[75vh] overflow-y-auto overflow-x-auto">
              {modalState.loading ? (
                <div className="py-12 text-center text-zinc-400 text-sm">Loading returns...</div>
              ) : modalState.items.length === 0 ? (
                <div className="py-12 text-center text-zinc-400 text-sm">No return records found.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-zinc-100">
                      <TableHead>Invoice No</TableHead>
                      <TableHead>Shop</TableHead>
                      <TableHead>Product</TableHead>
                      {modalState.type === "invoice" ? (
                        <>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                        </>
                      ) : (
                        <TableHead className="text-right">Returned Qty</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modalState.items.map((item: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{item.invoice_no}</TableCell>
                        <TableCell>{item.shop_name}</TableCell>
                        <TableCell className="text-xs">{item.product_name ?? selectedProduct}</TableCell>
                        {modalState.type === "invoice" ? (
                          <>
                            <TableCell className="text-right font-medium">{fmt(item.quantity)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{fmtA(item.amount)}</TableCell>
                            <TableCell className="capitalize text-xs text-zinc-600">{item.payment_status}</TableCell>
                          </>
                        ) : (
                          <TableCell className="text-right font-medium text-emerald-600">
                            {fmt(item.returned_qty)}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            <div className="px-6 py-3 border-t border-zinc-200 flex justify-end bg-zinc-50">
              <Button onClick={() => setModalState((prev) => ({ ...prev, open: false }))}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StockBalanceByLevel() {
  const [, startTransition] = useTransition();
  const [dateFrom, setDateFrom] = useState(FIRST_OF_MONTH);
  const [dateTo, setDateTo] = useState(TODAY);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<DataRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback((from?: string, to?: string) => {
    setLoading(true);
    startTransition(async () => {
      try {
        const f = from !== undefined ? from : dateFrom;
        const t = to !== undefined ? to : dateTo;
        const data = await getStockBalanceByLevel({ dateFrom: f || undefined, dateTo: t || undefined });
        setRows(data);
        setLoaded(true);
      } finally { setLoading(false); }
    });
  }, [dateFrom, dateTo]);

  // Removed auto-load useEffect: records only load when user clicks button

  const displayRows = useMemo(() => {
    if (!loaded) return [];
    let list = rows || [];
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (r) =>
          String(r.product_name || "").toLowerCase().includes(q) ||
          String(r.code || "").toLowerCase().includes(q) ||
          String(r.category_title || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, loaded, search]);

  const totals = useMemo(() => {
    return displayRows.reduce(
      (acc, r) => ({
        in: acc.in + (Number(r.total_qty_in) || 0),
        out: acc.out + (Number(r.total_qty_out) || 0),
        net: acc.net + (Number(r.net_balance) || 0),
      }),
      { in: 0, out: 0, net: 0 }
    );
  }, [displayRows]);

  const exportData = displayRows.map((r) => ({
    Code: r.code || "",
    Product: r.product_name,
    Category: r.category_title || "",
    "Packing Qty": r.packing_qty,
    "Total IN": r.total_qty_in,
    "Total OUT": r.total_qty_out,
    "Net Balance (Ph. Case)": r.net_balance,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36" />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36" />
        </div>
        <Button onClick={() => load()} disabled={loading} className="flex items-center gap-1.5">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? "Loading..." : "Load Balance"}
        </Button>
        {loaded && (
          <>
            <Input
              placeholder="Search code or product..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
            />
            <ExportButtons data={exportData} filename="stock_balance_by_level" />
          </>
        )}
      </div>
      {!loaded ? (
        <div className="text-center text-zinc-400 py-12 bg-white rounded-lg border border-zinc-200 text-sm">
          Set a date range (optional) and click <strong>Load Balance</strong>.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Code</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Packing Qty</TableHead>
                <TableHead className="text-right text-green-700">Total IN</TableHead>
                <TableHead className="text-right text-red-600">Total OUT</TableHead>
                <TableHead className="text-right font-semibold" style={{ color: "var(--primary)" }}>Net Balance (Ph. Case)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-zinc-400 py-8">No products found for selected period</TableCell></TableRow>
              ) : displayRows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs text-zinc-600 font-semibold">{r.code || "—"}</TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span>{String(r.product_name)}</span>
                      {r.is_implied && (
                        <span className="px-1.5 py-0.5 rounded text-[0.625rem] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          Implied
                        </span>
                      )}
                      {r.is_returnable && !r.is_rgb && !r.is_implied && (
                        <span className="px-1.5 py-0.5 rounded text-[0.625rem] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                          Empties
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-zinc-500">{r.category_title || "—"}</TableCell>
                  <TableCell className="text-right text-zinc-500">{fmt(r.packing_qty)}</TableCell>
                  <TableCell className="text-right text-green-700 font-medium">{fmt(r.total_qty_in)}</TableCell>
                  <TableCell className="text-right text-red-600 font-medium">{fmt(r.total_qty_out)}</TableCell>
                  <TableCell className="text-right font-bold" style={{ color: "var(--primary)" }}>{fmt(r.net_balance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            {displayRows.length > 0 && (
              <tfoot>
                <TableRow className="bg-zinc-100 font-bold border-t-2 border-zinc-300">
                  <TableCell colSpan={4} className="text-xs font-bold text-zinc-800">Total</TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold text-green-700">{fmt(totals.in)}</TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold text-red-600">{fmt(totals.out)}</TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold" style={{ color: "var(--primary)" }}>{fmt(totals.net)}</TableCell>
                </TableRow>
              </tfoot>
            )}
          </Table>
        </div>
      )}
    </div>
  );
}

function SalePurchaseSummary() {
  const [, startTransition] = useTransition();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<DataRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    startTransition(async () => {
      try {
        const data = await getSalePurchaseSummary({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined });
        setRows(data);
        setLoaded(true);
      } finally { setLoading(false); }
    });
  };

  const displayRows = useMemo(() => {
    if (!loaded) return [];
    return rows || [];
  }, [rows, loaded]);

  const exportData = displayRows.map((r) => ({
    Product: r.product_name, "Purchase Qty": r.purchase_qty, "Purchase Amt": r.purchase_amt,
    "Ret Qty": r.pur_return_qty, "Ret Amt": r.pur_return_amt, "Net Pur Qty": r.net_pur_qty, "Net Pur Amt": r.net_pur_amt,
    "Sale Qty": r.sale_qty, "Sale Amt": r.sale_amt, "S.Ret Qty": r.sale_return_qty, "S.Ret Amt": r.sale_return_amt,
    "Net Sale Qty": r.net_sale_qty, "Net Sale Amt": r.net_sale_amt,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36" />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36" />
        </div>
        <Button onClick={load} disabled={loading}>{loading ? "Loading..." : "Load Summary"}</Button>
        {loaded && <ExportButtons data={exportData} filename="sale_purchase_summary" />}
      </div>
      {!loaded ? (
        <div className="text-center text-zinc-400 py-12 bg-white rounded-lg border border-zinc-200 text-sm">
          Set a date range (optional) and click <strong>Load Summary</strong>.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-x-auto">
          <Table className="min-w-[68.75rem]">
            <TableHeader>
              <TableRow className="bg-zinc-100 text-xs">
                <TableHead rowSpan={2} className="align-bottom">Product</TableHead>
                <TableHead colSpan={2} className="text-center border-b border-zinc-200 bg-blue-50 text-blue-900 font-semibold">Purchase</TableHead>
                <TableHead colSpan={2} className="text-center border-b border-zinc-200 bg-rose-50 text-rose-900 font-semibold">Purchase Return</TableHead>
                <TableHead colSpan={2} className="text-center border-b border-zinc-200 bg-sky-50 text-sky-900 font-semibold">Net Purchase</TableHead>
                <TableHead colSpan={2} className="text-center border-b border-zinc-200 bg-emerald-50 text-emerald-900 font-semibold">Sale</TableHead>
                <TableHead colSpan={2} className="text-center border-b border-zinc-200 bg-amber-50 text-amber-900 font-semibold">Sale Return</TableHead>
                <TableHead colSpan={2} className="text-center border-b border-zinc-200 bg-teal-50 text-teal-900 font-semibold">Net Sale</TableHead>
              </TableRow>
              <TableRow className="bg-zinc-50 text-[0.6875rem]">
                <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Amt</TableHead>
                <TableHead className="text-right">Ret Qty</TableHead><TableHead className="text-right">Ret Amt</TableHead>
                <TableHead className="text-right">Net Qty</TableHead><TableHead className="text-right">Net Amt</TableHead>
                <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Amt</TableHead>
                <TableHead className="text-right">S.Ret Qty</TableHead><TableHead className="text-right">S.Ret Amt</TableHead>
                <TableHead className="text-right">Net Qty</TableHead><TableHead className="text-right">Net Amt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs">
              {displayRows.length === 0 ? (
                <TableRow><TableCell colSpan={13} className="text-center text-zinc-400 py-8">No records found for selected period</TableCell></TableRow>
              ) : displayRows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium whitespace-nowrap">{r.product_name}</TableCell>
                  <TableCell className="text-right text-blue-700">{fmt(r.purchase_qty)}</TableCell>
                  <TableCell className="text-right text-blue-700">{fmtA(r.purchase_amt)}</TableCell>
                  <TableCell className="text-right text-rose-600">{fmt(r.pur_return_qty)}</TableCell>
                  <TableCell className="text-right text-rose-600">{fmtA(r.pur_return_amt)}</TableCell>
                  <TableCell className="text-right font-semibold text-sky-800">{fmt(r.net_pur_qty)}</TableCell>
                  <TableCell className="text-right font-semibold text-sky-800">{fmtA(r.net_pur_amt)}</TableCell>
                  <TableCell className="text-right text-emerald-700">{fmt(r.sale_qty)}</TableCell>
                  <TableCell className="text-right text-emerald-700">{fmtA(r.sale_amt)}</TableCell>
                  <TableCell className="text-right text-amber-600">{fmt(r.sale_return_qty)}</TableCell>
                  <TableCell className="text-right text-amber-600">{fmtA(r.sale_return_amt)}</TableCell>
                  <TableCell className="text-right font-bold" style={{ color: "var(--primary)" }}>{fmt(r.net_sale_qty)}</TableCell>
                  <TableCell className="text-right font-bold" style={{ color: "var(--primary)" }}>{fmtA(r.net_sale_amt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function EmptyBalance() {
  const [, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + "01";
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<EmptyBalanceRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    startTransition(async () => {
      try {
        const data = await getEmptyBalanceReport({ from: from || undefined, to: to || undefined });
        setRows(data);
        setLoaded(true);
      } finally {
        setLoading(false);
      }
    });
  };

  // Removed auto-load useEffect: records only load when user clicks button

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.wayback += Number(r.wayback_qty || 0);
        const lQty = r.leased_qty ?? r.in_outlets_qty;
        acc.leased += typeof lQty === "number" ? lQty : 0;
        acc.sold += typeof r.sold_qty === "number" ? r.sold_qty : 0;
        acc.remains += Number(r.remains_qty || 0);
        return acc;
      },
      { wayback: 0, leased: 0, sold: 0, remains: 0 }
    );
  }, [rows]);

  const exportData = rows.map((r) => {
    const lQty = r.leased_qty ?? r.in_outlets_qty;
    return {
      "Code": r.product_code,
      "Product": r.product_name,
      "Wayback": r.wayback_qty,
      "Leased": lQty === "-" ? "-" : lQty,
      "Sold": r.sold_qty === "-" ? "-" : r.sold_qty,
      "Net Balance": r.remains_qty,
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-zinc-700">Empty Balance</span>
        <div className="flex items-center gap-2">
          <label className="text-[0.6875rem] text-zinc-500">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-zinc-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-red-400"
          />
          <label className="text-[0.6875rem] text-zinc-500">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border border-zinc-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-red-400"
          />
        </div>
        <Button size="sm" onClick={load} disabled={loading}>{loading ? "Loading..." : "Load"}</Button>
        {loaded && <ExportButtons data={exportData} filename="empty_balance" />}
      </div>

      {!loaded && !loading && (
        <div className="text-center text-zinc-400 py-12 bg-white rounded-lg border border-zinc-200 text-sm">
          Select date range and click <strong>Load</strong> to view Empty Balance records.
        </div>
      )}

      {loaded && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-[0.6875rem] font-semibold text-amber-700 uppercase tracking-wide">Wayback (To Coke)</p>
            <p className="text-xl font-bold font-mono text-amber-900 mt-1">{fmt(totals.wayback)}</p>
            <p className="text-[0.625rem] text-amber-600 mt-0.5">Returned to Coke via Waybills in filter range</p>
          </div>
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
            <p className="text-[0.6875rem] font-semibold text-indigo-700 uppercase tracking-wide">Leased</p>
            <p className="text-xl font-bold font-mono text-indigo-900 mt-1">{fmt(totals.leased)}</p>
            <p className="text-[0.625rem] text-indigo-600 mt-0.5">Empties outstanding at outlets as of end date</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
            <p className="text-[0.6875rem] font-semibold text-emerald-700 uppercase tracking-wide">Sold</p>
            <p className="text-xl font-bold font-mono text-emerald-900 mt-1">{fmt(totals.sold)}</p>
            <p className="text-[0.625rem] text-emerald-600 mt-0.5">Empties sold in filter range</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
            <p className="text-[0.6875rem] font-semibold text-blue-700 uppercase tracking-wide">Net Balance</p>
            <p className="text-xl font-bold font-mono text-blue-900 mt-1">{fmt(totals.remains)}</p>
            <p className="text-[0.625rem] text-blue-600 mt-0.5">Same as Balance by Level Net Balance (Ph. Case)</p>
          </div>
        </div>
      )}


      {loaded && rows.length === 0 && (
        <div className="text-center py-8 text-zinc-400 text-sm">No returnable or implied products found.</div>
      )}

      {loaded && rows.length > 0 && (
        <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50">
                <TableHead className="w-32 font-semibold text-zinc-700">Code</TableHead>
                <TableHead className="font-semibold text-zinc-700">Product</TableHead>
                <TableHead className="text-right font-semibold text-amber-700">Wayback</TableHead>
                <TableHead className="text-right font-semibold text-indigo-700">Leased</TableHead>
                <TableHead className="text-right font-semibold text-emerald-700">Sold</TableHead>
                <TableHead className="text-right font-semibold text-blue-700">Net Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const leasedVal = r.leased_qty ?? r.in_outlets_qty;
                const leasedDisplay = leasedVal === "-" ? "—" : fmt(leasedVal);
                const soldDisplay = r.sold_qty === "-" ? "—" : fmt(r.sold_qty);
                return (
                  <TableRow key={`${r.product_id}-${i}`} className="hover:bg-zinc-50/70 transition-colors">
                    <TableCell className="font-mono text-xs font-bold text-zinc-600">{r.product_code}</TableCell>
                    <TableCell className="text-xs font-medium text-zinc-900">{r.product_name}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold text-amber-700">{fmt(r.wayback_qty)}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold text-indigo-700">
                      {leasedDisplay}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold text-emerald-700">
                      {soldDisplay}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold text-blue-700">{fmt(r.remains_qty)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <tfoot>
              <TableRow className="bg-zinc-100 font-bold border-t-2 border-zinc-300">
                <TableCell colSpan={2} className="text-xs font-bold text-zinc-800">Total</TableCell>
                <TableCell className="text-right font-mono text-xs font-bold text-amber-700">{fmt(totals.wayback)}</TableCell>
                <TableCell className="text-right font-mono text-xs font-bold text-indigo-700">{fmt(totals.leased)}</TableCell>
                <TableCell className="text-right font-mono text-xs font-bold text-emerald-700">{fmt(totals.sold)}</TableCell>
                <TableCell className="text-right font-mono text-xs font-bold text-blue-700">{fmt(totals.remains)}</TableCell>
              </TableRow>
            </tfoot>
          </Table>
        </div>
      )}
    </div>
  );
}

function OutletEmptyBalance() {
  const [asOfDate, setAsOfDate] = useState(TODAY);
  const [data, setData] = useState<OutletEmptyBalanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  const load = useCallback(() => {
    setLoading(true);
    startTransition(async () => {
      try {
        const res = await getOutletEmptyBalance({ asOfDate: asOfDate || undefined });
        setData(res);
      } finally {
        setLoading(false);
      }
    });
  }, [asOfDate]);

  // Removed auto-load useEffect: records only load when user clicks button

  const exportData = useMemo(() => {
    if (!data) return [];
    return data.rows.map((r) => {
      const rowObj: Record<string, any> = {
        "Outlet Code": r.outlet_code,
        "Outlet Name": r.outlet_name,
        "Returned": r.formatted_returned,
      };
      for (const p of data.products) {
        rowObj[p.product_name] = r.quantities[p.product_name] ?? 0;
      }
      rowObj["Total Qty"] = r.total_qty;
      return rowObj;
    });
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-zinc-700">Outlet&apos;s Empty Balance</span>
          <div className="flex items-center gap-2">
            <label className="text-[0.6875rem] text-zinc-500">Up to</label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="border border-zinc-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-red-400"
            />
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? "Loading..." : data ? "Refresh" : "Load Records"}
          </Button>
        </div>
        {data && <ExportButtons data={exportData} filename="outlets_empty_balance" />}
      </div>

      {!data && !loading && (
        <div className="text-center text-zinc-400 py-12 bg-white rounded-lg border border-zinc-200 text-sm">
          Click <strong>Load Records</strong> to view outlet empty balances.
        </div>
      )}

      {loading && !data && (
        <div className="text-center py-8 text-zinc-400 text-sm">Loading outlet balances...</div>
      )}

      {data && data.rows.length === 0 && (
        <div className="text-center py-8 text-zinc-400 text-sm">
          No outlets currently holding leased returnable empties.
        </div>
      )}

      {data && data.rows.length > 0 && (
        <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50">
                <TableHead className="w-32 font-semibold text-zinc-700">Outlet Code</TableHead>
                <TableHead className="font-semibold text-zinc-700">Outlet Name</TableHead>
                <TableHead className="font-semibold text-zinc-700">Returned</TableHead>
                {data.products.map((p) => (
                  <TableHead key={p.id} className="text-right font-semibold text-zinc-700 whitespace-nowrap">
                    {p.product_name}
                  </TableHead>
                ))}
                <TableHead className="text-right font-semibold text-emerald-700 whitespace-nowrap">
                  Total Qty
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.outlet_code} className="hover:bg-zinc-50/70 transition-colors">
                  <TableCell className="font-mono text-xs font-bold text-zinc-600">{r.outlet_code}</TableCell>
                  <TableCell className="text-xs font-medium text-zinc-900">{r.outlet_name}</TableCell>
                  <TableCell className="text-xs text-zinc-600 font-mono whitespace-nowrap">{r.formatted_returned}</TableCell>
                  {data.products.map((p) => (
                    <TableCell key={p.id} className="text-right font-mono text-xs text-zinc-800">
                      {fmt(r.quantities[p.product_name] || 0)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono text-xs font-bold text-emerald-700">
                    {fmt(r.total_qty)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <tfoot>
              <TableRow className="bg-zinc-100 font-bold border-t-2 border-zinc-300">
                <TableCell colSpan={3} className="text-xs font-bold text-zinc-800">
                  Total
                </TableCell>
                {data.products.map((p) => (
                  <TableCell key={p.id} className="text-right font-mono text-xs font-bold text-zinc-800">
                    {fmt(data.totals[p.product_name] || 0)}
                  </TableCell>
                ))}
                <TableCell className="text-right font-mono text-xs font-bold text-emerald-700">
                  {fmt(data.grand_total)}
                </TableCell>
              </TableRow>
            </tfoot>
          </Table>
        </div>
      )}
    </div>
  );
}

function LeasedEmpties() {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + "01";
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [records, setRecords] = useState<LeasedEmptyRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  const [returningRecord, setReturningRecord] = useState<LeasedEmptyRecord | null>(null);
  const [editingRecord, setEditingRecord] = useState<LeasedEmptyRecord | null>(null);

  const load = () => {
    setLoading(true);
    startTransition(async () => {
      try {
        const list = await getLeaseEmpties({ from: from || undefined, to: to || undefined });
        setRecords(list);
        setLoaded(true);
      } finally {
        setLoading(false);
      }
    });
  };

  // Removed auto-load useEffect: records only load when user clicks button

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this lease record?")) return;
    try {
      await deleteLeaseEmpties(id);
      load();
    } catch (err: any) {
      alert(err.message ?? "Failed to delete lease record.");
    }
  };

  const exportData = useMemo(() => {
    return records.map((r) => ({
      Date: r.date,
      "Outlet Code": r.outlet_code,
      Outlet: r.outlet_name,
      Products: r.formatted_products,
      Returns: r.formatted_returned,
    }));
  }, [records]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-zinc-700">Leased Empties</span>
        <div className="flex items-center gap-2">
          <label className="text-[0.6875rem] text-zinc-500">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-zinc-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-red-400"
          />
          <label className="text-[0.6875rem] text-zinc-500">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border border-zinc-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-red-400"
          />
        </div>
        <Button size="sm" onClick={load} disabled={loading}>
          {loading ? "Loading..." : "Load"}
        </Button>
        {loaded && <ExportButtons data={exportData} filename="leased_empties" />}
      </div>

      {!loaded && !loading && (
        <div className="text-center text-zinc-400 py-12 bg-white rounded-lg border border-zinc-200 text-sm">
          Select date range and click <strong>Load</strong> to view Leased Empties records.
        </div>
      )}

      {loaded && records.length === 0 && (
        <div className="text-center py-8 text-zinc-400 text-sm">No leased empties found for selected dates.</div>
      )}

      {loaded && records.length > 0 && (
        <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50">
                <TableHead className="w-28 font-semibold text-zinc-700">Date</TableHead>
                <TableHead className="w-32 font-semibold text-zinc-700">Outlet Code</TableHead>
                <TableHead className="w-48 font-semibold text-zinc-700">Outlet</TableHead>
                <TableHead className="font-semibold text-zinc-700">Products</TableHead>
                <TableHead className="font-semibold text-zinc-700">Returns</TableHead>
                <TableHead className="w-36 text-right font-semibold text-zinc-700">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r) => (
                <TableRow key={r.id} className="hover:bg-zinc-50/70 transition-colors">
                  <TableCell className="text-xs text-zinc-600 font-mono">{r.date}</TableCell>
                  <TableCell className="font-mono text-xs font-bold text-zinc-600">{r.outlet_code}</TableCell>
                  <TableCell className="text-xs font-medium text-zinc-900">{r.outlet_name}</TableCell>
                  <TableCell className="text-xs text-zinc-700 font-mono leading-relaxed">{r.formatted_products}</TableCell>
                  <TableCell className="text-xs text-emerald-800 font-mono whitespace-pre-line leading-relaxed">{r.formatted_returned}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setReturningRecord(r)}
                        className="h-7 px-2 text-[0.6875rem] font-semibold border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                      >
                        Returns
                      </Button>
                      <button
                        type="button"
                        onClick={() => setEditingRecord(r)}
                        className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
                        title="Edit Lease"
                      >
                        <Pencil className="h-[0.875rem] w-[0.875rem]" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(r.id)}
                        className="p-1 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50"
                        title="Delete Lease"
                      >
                        <Trash2 className="h-[0.875rem] w-[0.875rem]" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {returningRecord && (
        <ReturnedLeaseModal
          lease={returningRecord}
          onClose={() => setReturningRecord(null)}
          onSaved={() => {
            setReturningRecord(null);
            load();
          }}
        />
      )}

      {editingRecord && (
        <EditLeaseModal
          lease={editingRecord}
          onClose={() => setEditingRecord(null)}
          onSaved={() => {
            setEditingRecord(null);
            load();
          }}
        />
      )}
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
    if (!lines.length) {
      alert("At least one product is required.");
      return;
    }
    if (lines.some((l) => l.quantity <= 0)) {
      alert("All quantities must be greater than 0.");
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
          <div className="px-3 sm:px-6 py-3 sm:py-4 space-y-3 sm:space-y-4 flex-1 overflow-y-auto overflow-x-auto">
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
            <div>
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Products & Quantities</label>
              <table className="w-full text-[0.75rem]">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200">
                    <th className="text-left px-3 py-2 font-semibold text-zinc-600">Product</th>
                    <th className="text-right px-3 py-2 font-semibold text-indigo-700">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.product_id} className="border-b border-zinc-100 last:border-0">
                      <td className="px-3 py-2">
                        <div className="font-medium text-zinc-900">{l.product_name}</div>
                        {l.product_code && <div className="font-mono text-zinc-400 text-[0.625rem]">{l.product_code}</div>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={l.quantity || ""}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            setLines((prev) => prev.map((x, idx) => (idx === i ? { ...x, quantity: val } : x)));
                          }}
                          className="w-24 text-right text-[0.75rem] border border-zinc-200 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white ml-auto block"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="px-6 py-4 border-t border-zinc-100 flex gap-2 flex-shrink-0">
            <Button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center gap-1.5" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? "Saving..." : "Save Changes"}
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

  const handleUpdateQty = (index: number, val: number) => {
    setItems((prev) => prev.map((it, idx) => (idx === index ? { ...it, quantity: val } : it)));
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSave = () => {
    if (!sapWaybill.trim()) {
      alert("SAP Waybill number is required");
      return;
    }
    if (items.length === 0) {
      alert("At least one product item is required");
      return;
    }
    startTransition(async () => {
      try {
        await updateWaybill(waybill.id, {
          date,
          sap_waybill: sapWaybill.trim(),
          items: items.map((it) => ({
            product_id: it.product_id,
            product_code: it.product_code,
            product_name: it.product_name,
            quantity: it.quantity,
          })),
        });
        onSaved();
      } catch (err: any) {
        alert(`Failed to update waybill: ${err.message}`);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-zinc-200 animate-in fade-in zoom-in-95 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b border-zinc-100 bg-zinc-50 flex-shrink-0">
          <h3 className="text-sm font-bold text-zinc-800">Edit Waybill #{waybill.sap_waybill}</h3>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-600 font-bold text-lg leading-none">×</button>
        </div>
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border border-zinc-300 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-red-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">SAP Waybill #</label>
              <input
                type="text"
                value={sapWaybill}
                onChange={(e) => setSapWaybill(e.target.value)}
                className="w-full border border-zinc-300 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-red-500 focus:outline-none font-mono font-bold"
              />
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
                    <input
                      type="number"
                      min={1}
                      value={it.quantity}
                      onChange={(e) => handleUpdateQty(idx, parseFloat(e.target.value) || 0)}
                      className="w-20 border border-zinc-300 rounded px-2 py-1 text-xs text-right font-mono font-bold focus:outline-none focus:ring-1 focus:ring-red-400"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(idx)}
                      disabled={items.length <= 1}
                      className="text-zinc-400 hover:text-red-600 disabled:opacity-30 p-1"
                    >
                      <Trash2 className="h-[0.875rem] w-[0.875rem]" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zinc-100 bg-zinc-50">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={isPending} className="bg-red-600 hover:bg-red-700 text-white flex items-center justify-center gap-1.5">
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function WaybillsSummary({ allProducts }: { allProducts?: { id: string; product_name: string }[] }) {
  const [, startTransition] = useTransition();
  const [isPending, startMutationTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + "01";
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<WaybillSummaryRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingWaybill, setEditingWaybill] = useState<WaybillSummaryRow | null>(null);

  const load = () => {
    setLoading(true);
    startTransition(async () => {
      try {
        const data = await getWaybillsSummary({ from, to });
        setRows(data);
        setLoaded(true);
      } finally {
        setLoading(false);
      }
    });
  };

  // Removed auto-load useEffect: records only load when user clicks button

  const handleDelete = (id: string) => {
    if (!confirm("Delete this waybill? Dispatched stock will be restored in warehouse.")) return;
    startMutationTransition(async () => {
      try {
        await deleteWaybill(id);
        setRows((prev) => prev.filter((r) => r.id !== id));
      } catch (ex: any) {
        alert(ex.message);
      }
    });
  };

  const exportData = rows.flatMap((r) =>
    r.items.map((item) => ({
      "Date": r.date,
      "SAP Waybill": r.sap_waybill,
      "Code": item.product_code || "",
      "Product": item.product_name,
      "Quantity": item.quantity,
    }))
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-zinc-700">Waybills Summary</span>
        <div className="flex items-center gap-2">
          <label className="text-[0.6875rem] text-zinc-500">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-zinc-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-red-400" />
          <label className="text-[0.6875rem] text-zinc-500">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-zinc-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-red-400" />
        </div>
        <Button size="sm" onClick={load} disabled={loading}>{loading ? "Loading..." : "Load"}</Button>
        {loaded && <ExportButtons data={exportData} filename="waybills_summary" />}
      </div>

      {!loaded && !loading && (
        <div className="text-center text-zinc-400 py-12 bg-white rounded-lg border border-zinc-200 text-sm">
          Select date range and click <strong>Load</strong> to view Waybills Summary records.
        </div>
      )}
      {loaded && rows.length === 0 && (
        <div className="text-center py-8 text-zinc-400 text-sm">No waybills found in this date range.</div>
      )}
      {loaded && rows.length > 0 && (
        <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50">
                <TableHead className="w-28 font-semibold text-zinc-700">Date</TableHead>
                <TableHead className="w-36 font-semibold text-zinc-700">SAP Waybill #</TableHead>
                <TableHead className="font-semibold text-zinc-700">Products</TableHead>
                <TableHead className="text-right font-semibold text-zinc-700 w-28">Total Qty</TableHead>
                <TableHead className="text-right font-semibold text-zinc-700 w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="hover:bg-zinc-50/70 transition-colors">
                  <TableCell className="text-xs text-zinc-500 whitespace-nowrap font-mono">{r.date}</TableCell>
                  <TableCell className="font-mono text-xs font-bold text-zinc-800">{r.sap_waybill}</TableCell>
                  <TableCell className="text-xs text-zinc-700">
                    <div className="flex flex-wrap gap-1.5">
                      {r.items.map((item, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 bg-zinc-100 text-zinc-800 px-2 py-0.5 rounded-md text-[0.6875rem] font-medium border border-zinc-200"
                        >
                          {item.product_code && (
                            <span className="font-mono text-[0.625rem] text-zinc-500">{item.product_code}</span>
                          )}
                          <span>{item.product_name}</span>
                          <span className="font-mono font-bold text-amber-700">× {item.quantity}</span>
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold text-emerald-700">{fmt(r.total_qty)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-zinc-600 hover:text-blue-600 h-7 w-7 p-0"
                        onClick={() => setEditingWaybill(r)}
                        title="Edit Waybill"
                      >
                        <Pencil className="h-[0.8125rem] w-[0.8125rem]" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-700 h-7 w-7 p-0"
                        onClick={() => handleDelete(r.id)}
                        disabled={isPending}
                        title="Delete Waybill"
                      >
                        <Trash2 className="h-[0.8125rem] w-[0.8125rem]" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editingWaybill && (
        <EditWaybillModal
          waybill={editingWaybill}
          onClose={() => setEditingWaybill(null)}
          onSaved={() => {
            setEditingWaybill(null);
            load();
          }}
        />
      )}
    </div>
  );
}
