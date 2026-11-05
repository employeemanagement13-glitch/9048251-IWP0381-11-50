"use client";

import { useRef, useState, useCallback, useMemo, Fragment } from "react";
import { Upload, RotateCw, FileText, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  bulkImportPromoInvoices,
  getPromoInvoices,
  deletePromoInvoice,
  deletePromoInvoices,
} from "@/lib/actions/promo";
import { PromoExportButtons } from "@/components/export/PromoExportButtons";

interface PromoRow {
  id?: string;
  outlet_code: string;
  shop_name: string;
  invoice_no: string;
  invoice_date: string;
  col_01_trade_discount: number;
  col_58_cross_promotion: number;
  col_59_additional_trade: number;
  col_63_distributor: number;
  col_68_trade_promotions: number;
  col_utc_discount?: number;
  row_total: number;
}

interface ShopGroup {
  outletCode: string;
  shopName: string;
  invoices: PromoRow[];
  totals: {
    col_01: number;
    col_58: number;
    col_59: number;
    col_63: number;
    col_68: number;
    col_utc: number;
    grand: number;
  };
  shopTotal: number;
}

function groupByShop(rows: PromoRow[]): ShopGroup[] {
  const map = new Map<string, ShopGroup>();
  for (const r of rows) {
    const key = r.outlet_code;
    if (!map.has(key)) {
      map.set(key, {
        outletCode: r.outlet_code,
        shopName: r.shop_name,
        invoices: [],
        totals: { col_01: 0, col_58: 0, col_59: 0, col_63: 0, col_68: 0, col_utc: 0, grand: 0 },
        shopTotal: 0,
      });
    }
    const g = map.get(key)!;
    g.invoices.push(r);
    g.totals.col_01 += r.col_01_trade_discount || 0;
    g.totals.col_58 += r.col_58_cross_promotion || 0;
    g.totals.col_59 += r.col_59_additional_trade || 0;
    g.totals.col_63 += r.col_63_distributor || 0;
    g.totals.col_68 += r.col_68_trade_promotions || 0;
    g.totals.col_utc += r.col_utc_discount || 0;
    g.totals.grand += r.row_total || 0;
  }
  const groups = Array.from(map.values());
  for (const g of groups) {
    g.shopTotal =
      g.totals.col_01 +
      g.totals.col_58 +
      g.totals.col_59 +
      g.totals.col_63 +
      g.totals.col_68 +
      g.totals.col_utc;
  }
  return groups;
}

function fmt(v: number) {
  if (v === 0) return <span className="text-[var(--text-muted)]">—</span>;
  return <span className="text-[var(--text-primary)]">{v.toFixed(2)}</span>;
}

function fmtTotal(v: number) {
  return v.toFixed(2);
}

function formatDateDisplay(raw: string): string {
  if (!raw) return "";
  const parts = raw.split("T")[0];
  const [y, m, d] = parts.split("-");
  if (y && m && d) return `${d}/${m}/${y}`;
  return raw;
}

export function PromoManagementClient() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; updated: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<ShopGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const allLoadedIds = useMemo(() => {
    if (!groups) return [];
    const ids: string[] = [];
    for (const g of groups) {
      for (const inv of g.invoices) {
        if (inv.id) ids.push(inv.id);
      }
    }
    return ids;
  }, [groups]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const isAllSelected = allLoadedIds.length > 0 && selectedSet.size >= allLoadedIds.length && allLoadedIds.every((id) => selectedSet.has(id));

  const handleToggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds([...allLoadedIds]);
    }
  }, [isAllSelected, allLoadedIds]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);

  const handleToggleShopGroup = useCallback((shopInvoices: PromoRow[]) => {
    const shopIds = shopInvoices.map((inv) => inv.id).filter(Boolean) as string[];
    const allShopSelected = shopIds.length > 0 && shopIds.every((id) => selectedIds.includes(id));
    if (allShopSelected) {
      setSelectedIds((prev) => prev.filter((id) => !shopIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...shopIds])));
    }
  }, [selectedIds]);

  const handleBulkDelete = useCallback(async () => {
    if (!selectedIds.length) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected promo invoice(s)?`)) return;
    setIsBulkDeleting(true);
    try {
      await deletePromoInvoices(selectedIds);
      setGroups((prev) => {
        if (!prev) return prev;
        const set = new Set(selectedIds);
        return prev
          .map((g) => {
            const invoices = g.invoices.filter((inv) => !inv.id || !set.has(inv.id));
            const totals = { col_01: 0, col_58: 0, col_59: 0, col_63: 0, col_68: 0, col_utc: 0, grand: 0 };
            for (const inv of invoices) {
              totals.col_01 += inv.col_01_trade_discount || 0;
              totals.col_58 += inv.col_58_cross_promotion || 0;
              totals.col_59 += inv.col_59_additional_trade || 0;
              totals.col_63 += inv.col_63_distributor || 0;
              totals.col_68 += inv.col_68_trade_promotions || 0;
              totals.col_utc += inv.col_utc_discount || 0;
              totals.grand += inv.row_total || 0;
            }
            const shopTotal =
              totals.col_01 +
              totals.col_58 +
              totals.col_59 +
              totals.col_63 +
              totals.col_68 +
              totals.col_utc;
            return { ...g, invoices, totals, shopTotal };
          })
          .filter((g) => g.invoices.length > 0);
      });
      setSelectedIds([]);
    } catch (err: any) {
      alert(err.message || "Failed to delete invoices");
    } finally {
      setIsBulkDeleting(false);
    }
  }, [selectedIds]);

  const handleDeleteAllLoaded = useCallback(async () => {
    if (!allLoadedIds.length) return;
    if (!confirm(`Are you sure you want to delete all ${allLoadedIds.length} loaded promo invoice(s) at once? This will clear the loaded table.`)) return;
    setIsBulkDeleting(true);
    try {
      await deletePromoInvoices(allLoadedIds);
      setGroups([]);
      setSelectedIds([]);
    } catch (err: any) {
      alert(err.message || "Failed to delete invoices");
    } finally {
      setIsBulkDeleting(false);
    }
  }, [allLoadedIds]);

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/parse-promo-pdf", { method: "POST", body: fd });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Parse failed");
      if (!json.data || json.data.length === 0) throw new Error("No promo records found in PDF");

      const result = await bulkImportPromoInvoices(json.data);
      setImportResult(result);

      const isoDates = (json.data as PromoRow[])
        .map((r) => {
          const parts = (r.invoice_date || "").split("/");
          if (parts.length === 3) {
            return `${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
          }
          return r.invoice_date;
        })
        .filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort();

      if (isoDates.length > 0) {
        const minD = isoDates[0];
        const maxD = isoDates[isoDates.length - 1];
        setFromDate(minD);
        setToDate(maxD);
        const rows = (await getPromoInvoices(minD, maxD)) as PromoRow[];
        setGroups(groupByShop(rows));
      }
    } catch (err: any) {
      setImportError(err.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, []);

  const handleLoad = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setGroups(null);
    setSelectedIds([]);
    try {
      const rows = await getPromoInvoices(fromDate || undefined, toDate || undefined) as PromoRow[];
      setGroups(groupByShop(rows));
    } catch (err: any) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Delete this promo invoice?")) return;
    setDeletingId(id);
    try {
      await deletePromoInvoice(id);
      setSelectedIds((prev) => prev.filter((item) => item !== id));
      setGroups((prev) => {
        if (!prev) return prev;
        const updated = prev
          .map((g) => {
            const invoices = g.invoices.filter((inv) => inv.id !== id);
            const totals = { col_01: 0, col_58: 0, col_59: 0, col_63: 0, col_68: 0, col_utc: 0, grand: 0 };
            for (const inv of invoices) {
              totals.col_01 += inv.col_01_trade_discount || 0;
              totals.col_58 += inv.col_58_cross_promotion || 0;
              totals.col_59 += inv.col_59_additional_trade || 0;
              totals.col_63 += inv.col_63_distributor || 0;
              totals.col_68 += inv.col_68_trade_promotions || 0;
              totals.col_utc += inv.col_utc_discount || 0;
              totals.grand += inv.row_total || 0;
            }
            const shopTotal =
              totals.col_01 +
              totals.col_58 +
              totals.col_59 +
              totals.col_63 +
              totals.col_68 +
              totals.col_utc;
            return { ...g, invoices, totals, shopTotal };
          })
          .filter((g) => g.invoices.length > 0);
        return updated;
      });
    } catch (err: any) {
      alert(err.message);
    } finally {
      setDeletingId(null);
    }
  }, []);

  const hasUtc = groups ? groups.some((g) => g.totals.col_utc > 0) : false;

  const COL_NAMES = [
    { key: "col_01", label: "01 HTH-Trade Discount" },
    { key: "col_58", label: "58 Cross Promotion" },
    { key: "col_59", label: "59 Additional Trade Promotions" },
    { key: "col_63", label: "63 Distributor Promotion" },
    { key: "col_68", label: "68 Trade Promotions" },
    ...(hasUtc ? [{ key: "col_utc", label: "UTC Discount" }] : []),
  ];

  const grandTotals = groups
    ? groups.reduce(
        (acc, g) => ({
          col_01: acc.col_01 + g.totals.col_01,
          col_58: acc.col_58 + g.totals.col_58,
          col_59: acc.col_59 + g.totals.col_59,
          col_63: acc.col_63 + g.totals.col_63,
          col_68: acc.col_68 + g.totals.col_68,
          col_utc: acc.col_utc + g.totals.col_utc,
          grand: acc.grand + g.totals.grand,
          shopTotal: acc.shopTotal + g.shopTotal,
        }),
        { col_01: 0, col_58: 0, col_59: 0, col_63: 0, col_68: 0, col_utc: 0, grand: 0, shopTotal: 0 }
      )
    : null;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[var(--border)] rounded-[var(--radius)] p-4 flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf"
          className="hidden"
          id="promo-pdf-input"
          onChange={handleImport}
        />
        <label
          htmlFor="promo-pdf-input"
          className={[
            "inline-flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] text-[0.71875rem] font-semibold cursor-pointer transition-all",
            importing
              ? "bg-red-50 text-red-600 border border-red-200 pointer-events-none"
              : "bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)]",
          ].join(" ")}
        >
          {importing ? (
            <Loader2 className="w-4 h-4 animate-spin text-red-600" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          {importing ? "Importing Promo PDF…" : "Import Daily Promo | PDF"}
        </label>

        {importResult && !importing && (
          <span className="text-[0.6875rem] text-emerald-600 font-medium">
            ✓ Imported: {importResult.inserted} new, {importResult.updated} updated
          </span>
        )}
        {importError && (
          <span className="text-[0.6875rem] text-red-600 font-medium">✗ {importError}</span>
        )}

        {allLoadedIds.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={isAllSelected ? "ghost" : "outline"}
              size="sm"
              onClick={handleToggleSelectAll}
              className="whitespace-nowrap text-[0.6875rem]"
            >
              {isAllSelected ? "Deselect All" : "Select All"}
            </Button>

            {selectedIds.length > 0 && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={handleBulkDelete}
                disabled={isBulkDeleting}
                className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 whitespace-nowrap text-[0.6875rem]"
              >
                {isBulkDeleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Delete ({selectedIds.length})
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDeleteAllLoaded}
              disabled={isBulkDeleting}
              className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300 flex items-center gap-1.5 whitespace-nowrap text-[0.6875rem]"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-500" />
              Delete All Loaded
            </Button>
          </div>
        )}

        {groups && groups.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-zinc-700 bg-zinc-100 border border-zinc-200 px-2.5 py-1.5 rounded-[var(--radius-sm)]">
              Loaded: <strong className="text-zinc-900">{allLoadedIds.length.toLocaleString()}</strong> invoices ({groups.length} shops)
            </span>
            <PromoExportButtons
              groups={groups}
              hasUtc={hasUtc}
              fromDate={fromDate}
              toDate={toDate}
            />
          </div>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[0.6875rem] text-[var(--text-secondary)] font-medium">From</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLoad();
            }}
            className="border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[0.71875rem] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-ring)]"
          />
          <span className="text-[0.6875rem] text-[var(--text-secondary)] font-medium">To</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLoad();
            }}
            className="border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[0.71875rem] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary-ring)]"
          />
          <button
            id="promo-load-btn"
            onClick={handleLoad}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[var(--radius-sm)] text-[0.71875rem] font-semibold bg-[var(--primary)] text-white hover:bg-[var(--primary-dark)] disabled:opacity-60 transition-all cursor-pointer shadow-sm"
          >
            <RotateCw className={["w-[0.8125rem] h-[0.8125rem]", loading ? "animate-spin" : ""].join(" ")} />
            {loading ? "Loading…" : "Load"}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-[var(--radius-sm)] px-4 py-3 text-[0.71875rem] text-red-700">
          {loadError}
        </div>
      )}

      {importing && (
        <div className="bg-white border border-[var(--border)] rounded-[var(--radius)] p-12 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-10 h-10 animate-spin text-red-600" />
          <p className="text-sm font-semibold text-zinc-700">Importing and processing promo PDF...</p>
          <p className="text-xs text-zinc-400">Extracting promo invoices, calculating discount amounts, and saving to database.</p>
        </div>
      )}

      {groups === null && !loading && !importing && (
        <div className="bg-white border border-[var(--border)] rounded-[var(--radius)] p-12 flex flex-col items-center gap-3 text-[var(--text-muted)]">
          <FileText className="w-10 h-10 opacity-30" />
          <p className="text-[0.75rem]">Import a promo PDF, then select a date range and click Load to view the table.</p>
        </div>
      )}

      {groups !== null && groups.length === 0 && (
        <div className="bg-white border border-[var(--border)] rounded-[var(--radius)] p-12 flex items-center justify-center text-[0.75rem] text-[var(--text-muted)]">
          No promo records found for the selected date range.
        </div>
      )}

      {groups !== null && groups.length > 0 && (
        <div className="space-y-0 bg-white border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[59.375rem] border-collapse text-[0.6875rem]">
              <thead>
                <tr className="bg-[var(--primary)] text-white">
                  <th className="w-10 px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={handleToggleSelectAll}
                      className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                      title={isAllSelected ? "Deselect All" : "Select All"}
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-semibold w-[8.125rem]">Invoice No</th>
                  <th className="px-3 py-2 text-left font-semibold w-[5.625rem]">Date</th>
                  {COL_NAMES.map((c) => (
                    <th key={c.key} className="px-3 py-2 text-right font-semibold">
                      {c.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold w-[5.625rem]">Total</th>
                  <th className="px-3 py-2 w-[2.25rem]" />
                </tr>
              </thead>
              <tbody>
                {groups.map((g, gi) => {
                  const shopValidIds = g.invoices.map((inv) => inv.id).filter(Boolean) as string[];
                  const isShopSelected =
                    shopValidIds.length > 0 && shopValidIds.every((id) => selectedSet.has(id));
                  return (
                    <Fragment key={`shop-group-${gi}`}>
                      <tr
                        key={`shop-hdr-${gi}`}
                        className="bg-[var(--primary-light)] border-t-2 border-[var(--primary)]"
                      >
                        <td className="w-10 px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={isShopSelected}
                            onChange={() => handleToggleShopGroup(g.invoices)}
                            className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                            title="Select/Deselect all in shop"
                          />
                        </td>
                        <td
                          colSpan={hasUtc ? 9 : 8}
                          className="px-3 py-2 font-bold text-[var(--primary)] text-[0.71875rem]"
                        >
                          {g.outletCode} — {g.shopName}
                        </td>
                        <td className="px-3 py-2" />
                      </tr>
                      {g.invoices.map((inv, ii) => {
                        const isRowSelected = inv.id ? selectedSet.has(inv.id) : false;
                        return (
                          <tr
                            key={`inv-${gi}-${ii}`}
                            className={[
                              "border-b transition-colors",
                              isRowSelected
                                ? "bg-red-50/50 border-red-200"
                                : "border-[var(--border-light)] hover:bg-[var(--surface-hover)]",
                            ].join(" ")}
                          >
                            <td className="w-10 px-3 py-1.5 text-center">
                              <input
                                type="checkbox"
                                checked={isRowSelected}
                                disabled={!inv.id}
                                onChange={() => inv.id && handleToggleSelect(inv.id)}
                                className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                              />
                            </td>
                            <td className="px-3 py-1.5 font-mono text-[0.65625rem] text-[var(--text-secondary)]">
                              {inv.invoice_no}
                            </td>
                            <td className="px-3 py-1.5 text-[var(--text-secondary)]">
                              {formatDateDisplay(inv.invoice_date)}
                            </td>
                            <td className="px-3 py-1.5 text-right">{fmt(inv.col_01_trade_discount)}</td>
                            <td className="px-3 py-1.5 text-right">{fmt(inv.col_58_cross_promotion)}</td>
                            <td className="px-3 py-1.5 text-right">{fmt(inv.col_59_additional_trade)}</td>
                            <td className="px-3 py-1.5 text-right">{fmt(inv.col_63_distributor)}</td>
                            <td className="px-3 py-1.5 text-right">{fmt(inv.col_68_trade_promotions)}</td>
                            {hasUtc && (
                              <td className="px-3 py-1.5 text-right">{fmt(inv.col_utc_discount || 0)}</td>
                            )}
                            <td className="px-3 py-1.5 text-right font-semibold">{inv.row_total.toFixed(2)}</td>
                            <td className="px-2 py-1.5 text-center">
                              {inv.id && (
                                <button
                                  onClick={() => handleDelete(inv.id!)}
                                  disabled={deletingId === inv.id || isBulkDeleting}
                                  className="text-[var(--text-muted)] hover:text-red-500 transition-colors"
                                  title="Delete"
                                >
                                  {deletingId === inv.id ? (
                                    <Loader2 className="w-[0.75rem] h-[0.75rem] animate-spin text-red-600" />
                                  ) : (
                                    <Trash2 className="w-[0.75rem] h-[0.75rem]" />
                                  )}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      <tr
                        key={`total-${gi}`}
                        className="bg-[#FFF7ED] border-t border-[#FED7AA]"
                      >
                        <td />
                        <td
                          colSpan={2}
                          className="px-3 py-2 text-right text-[0.65625rem] font-bold text-orange-700"
                        >
                          Total
                        </td>
                        <td className="px-3 py-2 text-right text-[0.65625rem] font-bold text-orange-700">
                          {g.totals.col_01 > 0 ? fmtTotal(g.totals.col_01) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-[0.65625rem] font-bold text-orange-700">
                          {g.totals.col_58 > 0 ? fmtTotal(g.totals.col_58) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-[0.65625rem] font-bold text-orange-700">
                          {g.totals.col_59 > 0 ? fmtTotal(g.totals.col_59) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-[0.65625rem] font-bold text-orange-700">
                          {g.totals.col_63 > 0 ? fmtTotal(g.totals.col_63) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-[0.65625rem] font-bold text-orange-700">
                          {g.totals.col_68 > 0 ? fmtTotal(g.totals.col_68) : "—"}
                        </td>
                        {hasUtc && (
                          <td className="px-3 py-2 text-right text-[0.65625rem] font-bold text-orange-700">
                            {g.totals.col_utc > 0 ? fmtTotal(g.totals.col_utc) : "—"}
                          </td>
                        )}
                        <td className="px-3 py-2 text-right text-[0.65625rem] font-bold text-orange-700">
                          {fmtTotal(g.totals.grand)}
                        </td>
                        <td />
                      </tr>
                      <tr
                        key={`shop-total-${gi}`}
                        className="bg-[#FFF0F0] border-t border-[var(--primary-light)]"
                      >
                        <td />
                        <td
                          colSpan={hasUtc ? 8 : 7}
                          className="px-3 py-1.5 text-right text-[0.65625rem] font-semibold text-[var(--primary)]"
                        >
                          Shop Total ({g.outletCode} — {g.shopName}):
                        </td>
                        <td className="px-3 py-1.5 text-right text-[0.6875rem] font-bold text-[var(--primary)]">
                          {fmtTotal(g.shopTotal)}
                        </td>
                        <td />
                      </tr>
                    </Fragment>
                  );
                })}

                {grandTotals && (
                  <tr className="bg-[var(--primary)] text-white border-t-2 border-[var(--primary-dark)]">
                    <td />
                    <td
                      colSpan={2}
                      className="px-3 py-2.5 text-right text-[0.6875rem] font-bold"
                    >
                      Grand Total
                    </td>
                    <td className="px-3 py-2.5 text-right text-[0.6875rem] font-bold">
                      {grandTotals.col_01 > 0 ? fmtTotal(grandTotals.col_01) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[0.6875rem] font-bold">
                      {grandTotals.col_58 > 0 ? fmtTotal(grandTotals.col_58) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[0.6875rem] font-bold">
                      {grandTotals.col_59 > 0 ? fmtTotal(grandTotals.col_59) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[0.6875rem] font-bold">
                      {grandTotals.col_63 > 0 ? fmtTotal(grandTotals.col_63) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[0.6875rem] font-bold">
                      {grandTotals.col_68 > 0 ? fmtTotal(grandTotals.col_68) : "—"}
                    </td>
                    {hasUtc && (
                      <td className="px-3 py-2.5 text-right text-[0.6875rem] font-bold">
                        {grandTotals.col_utc > 0 ? fmtTotal(grandTotals.col_utc) : "—"}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-right text-[0.6875rem] font-bold">
                      {fmtTotal(grandTotals.grand)}
                    </td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
