"use client";

import { useState, useEffect, useTransition, useCallback, useMemo, Fragment } from "react";
import { ExportButtons } from "@/components/export/ExportButtons";
import { AdditionalDiscountDateWiseExport } from "@/components/export/AdditionalDiscountDateWiseExport";
import { CreditSummaryExportButtons } from "@/components/export/CreditSummaryExportButtons";
import { Button } from "@/components/ui/Button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/Table";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Loader2 } from "lucide-react";
import { getDiscountReportData, getAdditionalDiscountSummary, getAdditionalDiscountShopSummary } from "@/lib/actions/discounts";
import { getDateWiseSalesSummary, getShopWiseSalesSummary, getCreditSummaryReport, getWHTaxSummary, getAdvanceTaxReport } from "@/lib/actions/reports";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

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

type ReportTab = "wh_tax" | "advance_tax" | "additional_discount" | "sales_summary" | "credit_summary";

const fmt = (n: any) =>
  n != null ? "Rs. " + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

const TABS: { key: ReportTab; label: string }[] = [
  { key: "wh_tax", label: "WH Tax Summary" },
  { key: "advance_tax", label: "Advance Tax" },
  { key: "additional_discount", label: "Additional Discounts" },
  { key: "sales_summary", label: "Sales Summary" },
  { key: "credit_summary", label: "Credit Summary" },
];

const REPORT_FLAGS: Record<ReportTab, string> = {
  wh_tax: "tab_wh_tax_summary",
  advance_tax: "tab_advance_tax_report",
  additional_discount: "tab_discount_report",
  sales_summary: "tab_sales_summary",
  credit_summary: "tab_credit_summary",
};

interface Props {
  whTax: any[];
  advanceTax: any[];
  discountReport?: any[];
  discountConfigs?: any[];
  presellers?: any[];
  shops?: any[];
}

function PillSwitcher({
  tab,
  onChange,
  tabs = TABS,
}: {
  tab: ReportTab;
  onChange: (t: ReportTab) => void;
  tabs?: { key: ReportTab; label: string }[];
}) {
  return (
    <div
      className="inline-flex rounded-full p-[0.1875rem] gap-[0.125rem]"
      style={{ background: "var(--surface-hover, #f4f4f5)" }}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className="px-4 py-1 text-[0.6875rem] font-semibold rounded-full transition-all duration-200"
          style={
            tab === t.key
              ? { background: "var(--primary)", color: "#fff", boxShadow: "0 1px 0.25rem rgba(229,30,42,0.25)" }
              : { color: "var(--text-secondary, #6b7280)", background: "transparent" }
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Date filter row ───────────────────────────────────────────────────────────
function DateFilter({
  dateFrom, dateTo, onChange, total, totalLabel, exportData, exportFilename,
  onLoad, loading,
}: {
  dateFrom: string; dateTo: string;
  onChange: (from: string, to: string) => void;
  total?: number; totalLabel?: string;
  exportData: any[]; exportFilename: string;
  onLoad?: () => void; loading?: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-between items-end gap-3">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => onChange(e.target.value, dateTo)} className="w-36" />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">To</label>
          <Input type="date" value={dateTo} onChange={(e) => onChange(dateFrom, e.target.value)} className="w-36" />
        </div>
        {onLoad && (
          <Button onClick={onLoad} disabled={loading} className="flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-[#e51e2a] hover:bg-[#c91823] text-white">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading ? "Loading..." : "Load"}
          </Button>
        )}
        {dateFrom || dateTo ? (
          <button
            onClick={() => onChange("", "")}
            className="text-[0.625rem] text-zinc-400 hover:text-zinc-700 underline mt-4"
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        {total !== undefined && totalLabel && (
          <div className="bg-white border border-zinc-200 rounded-lg px-4 py-2 text-sm">
            <span className="text-zinc-500">{totalLabel}: </span>
            <span className="font-bold" style={{ color: "var(--primary)" }}>
              Rs. {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
        )}
        <ExportButtons data={exportData} filename={exportFilename} />
      </div>
    </div>
  );
}

// ─── MAIN CLIENT ──────────────────────────────────────────────────────────────

export function FinancialReportsClient({ whTax, advanceTax, presellers = [], shops = [] }: Props) {
  const [tab, setTab] = useState<ReportTab>("wh_tax");
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

  const visibleTabs = useMemo(() => {
    if (!flagsLoaded) return TABS;
    return TABS.filter((t) => enabledFlags.includes(REPORT_FLAGS[t.key]));
  }, [flagsLoaded, enabledFlags]);

  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.some((t) => t.key === tab)) {
      setTab(visibleTabs[0].key);
    }
  }, [visibleTabs, tab]);

  return (
    <div className="space-y-4">
      {visibleTabs.length === 0 && flagsLoaded ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center text-amber-800 text-sm">
          All financial reports have been globally disabled by the administrator.
        </div>
      ) : (
        <>
          <PillSwitcher tab={tab} onChange={setTab} tabs={visibleTabs} />
          {tab === "wh_tax" && visibleTabs.some(t => t.key === "wh_tax") && <WHtaxReport rows={whTax} />}
          {tab === "advance_tax" && visibleTabs.some(t => t.key === "advance_tax") && <AdvanceTaxReport rows={advanceTax} />}
          {tab === "additional_discount" && visibleTabs.some(t => t.key === "additional_discount") && <AdditionalDiscountsReport presellers={presellers} shops={shops} />}
          {tab === "sales_summary" && visibleTabs.some(t => t.key === "sales_summary") && <SalesSummaryReport shops={shops} />}
          {tab === "credit_summary" && visibleTabs.some(t => t.key === "credit_summary") && <CreditSummaryReport />}
        </>
      )}
    </div>
  );
}

// ─── WH Tax Summary ───────────────────────────────────────────────────────────

function WHtaxReport({ rows: initialRows }: { rows: any[] }) {
  const [dateFrom, setDateFrom] = useState(FIRST_OF_MONTH);
  const [dateTo, setDateTo] = useState(TODAY);
  const [rows, setRows] = useState<any[]>(initialRows?.length ? initialRows : []);
  const [loaded, setLoaded] = useState(Boolean(initialRows?.length));
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  const handleLoad = () => {
    setLoading(true);
    startTransition(async () => {
      try {
        const data = await getWHTaxSummary({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined });
        setRows(data || []);
        setLoaded(true);
      } finally {
        setLoading(false);
      }
    });
  };

  const filtered = rows.filter((r) => {
    if (dateFrom && r.date < dateFrom) return false;
    if (dateTo && r.date > dateTo) return false;
    return true;
  });

  const totSale       = loaded ? filtered.reduce((s, r) => s + Number(r.sale            || 0), 0) : 0;
  const totCollection = loaded ? filtered.reduce((s, r) => s + Number(r.cash_collection || 0), 0) : 0;
  const totWHTax      = loaded ? filtered.reduce((s, r) => s + Number(r.wh_tax          || 0), 0) : 0;

  const exportData = filtered.map((r) => ({
    Date: r.date,
    "Sale (Rs.)": r.sale,
    "Cash Collection (Rs.)": r.cash_collection,
    "WH Tax (Rs.)": r.wh_tax,
  }));

  return (
    <div className="space-y-3">
      <DateFilter
        dateFrom={dateFrom} dateTo={dateTo}
        onChange={(f, t) => { setDateFrom(f); setDateTo(t); }}
        total={loaded ? totWHTax : undefined} totalLabel="Total WH Tax"
        exportData={exportData} exportFilename="wh_tax_summary"
        onLoad={handleLoad} loading={loading}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Sale",        value: totSale,       color: "#0369a1" },
          { label: "Cash Collection",   value: totCollection, color: "#059669" },
          { label: "WH Tax (0.1%)",     value: totWHTax,      color: "#e51e2a" },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-zinc-200 rounded-lg px-4 py-3">
            <p className="text-[0.625rem] font-medium text-zinc-500 uppercase tracking-wide mb-1">{s.label}</p>
            <p className="text-[1.125rem] font-bold" style={{ color: s.color }}>
              {loaded ? `Rs. ${s.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Sale (Rs.)</TableHead>
              <TableHead className="text-right">Cash Collection (Rs.)</TableHead>
              <TableHead className="text-right font-semibold" style={{ color: "var(--primary)" }}>WH Tax (Rs.)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loaded ? (
              <TableRow><TableCell colSpan={4} className="text-center text-zinc-400 py-10 text-xs">Set date range and click Load to view WH Tax summary.</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center text-zinc-400 py-8 text-xs">No WH tax records found for selected criteria.</TableCell></TableRow>
            ) : (
              <>
                {filtered.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{r.date}</TableCell>
                    <TableCell className="text-right">{fmt(r.sale)}</TableCell>
                    <TableCell className="text-right text-emerald-700">{fmt(r.cash_collection)}</TableCell>
                    <TableCell className="text-right font-bold" style={{ color: "var(--primary)" }}>{fmt(r.wh_tax)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-zinc-50 font-semibold text-[0.71875rem]">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{fmt(totSale)}</TableCell>
                  <TableCell className="text-right text-emerald-700">{fmt(totCollection)}</TableCell>
                  <TableCell className="text-right" style={{ color: "var(--primary)" }}>{fmt(totWHTax)}</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Trial Balance ────────────────────────────────────────────────────────────

function TrialBalanceReport({ rows }: { rows: any[] }) {
  const totalDebits = rows.reduce((s, r) => s + Number(r.total_debit || 0), 0);
  const totalCredits = rows.reduce((s, r) => s + Number(r.total_credit || 0), 0);
  const difference = totalDebits - totalCredits;
  const exportData = rows.map((r) => ({
    Code: r.code, Account: r.label, Category: r.category,
    "Debit (Rs.)": r.total_debit, "Credit (Rs.)": r.total_credit,
    "Net (Rs.)": r.net_balance,
  }));
  const categories = [...new Set(rows.map((r) => r.category))];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Debits", value: totalDebits, color: "#059669" },
          { label: "Total Credits", value: totalCredits, color: "#059669" },
          { label: "Difference", value: Math.abs(difference), color: difference === 0 ? "#059669" : "#dc2626" },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-zinc-200 rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-1">{s.label}</p>
            <p className="text-xl font-bold" style={{ color: s.color }}>
              Rs. {s.value.toLocaleString(undefined, { minimumFractionDigits: 0 })}
              {s.label === "Difference" && difference !== 0 && (
                <span className="text-xs font-normal text-zinc-400 ml-2">{difference > 0 ? "(Dr)" : "(Cr)"}</span>
              )}
            </p>
          </div>
        ))}
      </div>
      <div className="flex justify-end"><ExportButtons data={exportData} filename="trial_balance" /></div>
      {categories.map((cat) => {
        const catRows = rows.filter((r) => r.category === cat);
        const catDr = catRows.reduce((s, r) => s + Number(r.debit || 0), 0);
        const catCr = catRows.reduce((s, r) => s + Number(r.credit || 0), 0);
        return (
          <div key={cat as string} className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
            <div className="flex justify-between items-center px-5 py-3 border-b border-zinc-100 bg-zinc-50">
              <span className="font-semibold text-zinc-700 text-sm">{cat as string}</span>
              <div className="flex gap-4 text-xs text-zinc-500">
                <span>Dr: <span className="font-semibold" style={{ color: "var(--primary)" }}>Rs. {catDr.toLocaleString()}</span></span>
                <span>Cr: <span className="font-semibold text-green-700">Rs. {catCr.toLocaleString()}</span></span>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead><TableHead>Account</TableHead>
                  <TableHead className="text-right">Debit (Rs.)</TableHead>
                  <TableHead className="text-right">Credit (Rs.)</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {catRows.map((r, i) => {
                  const net = Number(r.net_balance || 0);
                  return (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs text-zinc-400">{r.code}</TableCell>
                      <TableCell className="font-medium">{r.label}</TableCell>
                      <TableCell className="text-right" style={{ color: "var(--primary)" }}>{r.total_debit ? fmt(r.total_debit) : "—"}</TableCell>
                      <TableCell className="text-right text-green-700">{r.total_credit ? fmt(r.total_credit) : "—"}</TableCell>
                      <TableCell className={`text-right font-semibold ${net >= 0 ? "" : "text-green-700"}`}>
                        {fmt(Math.abs(net))}{net < 0 ? " Cr" : ""}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        );
      })}
      {rows.length === 0 && (
        <div className="text-center text-zinc-400 py-12 bg-white rounded-lg border border-zinc-200">No trial balance data available</div>
      )}
    </div>
  );
}

// ─── Advance Tax Report ────────────────────────────────────────────────────────

function AdvanceTaxReport({ rows: initialRows }: { rows: any[] }) {
  const [dateFrom, setDateFrom] = useState(FIRST_OF_MONTH);
  const [dateTo, setDateTo] = useState(TODAY);
  const [rows, setRows] = useState<any[]>(initialRows?.length ? initialRows : []);
  const [loaded, setLoaded] = useState(Boolean(initialRows?.length));
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  const handleLoad = () => {
    setLoading(true);
    startTransition(async () => {
      try {
        const data = await getAdvanceTaxReport({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined });
        setRows(data || []);
        setLoaded(true);
      } finally {
        setLoading(false);
      }
    });
  };

  const filtered = rows.filter((r) => {
    if (dateFrom && r.date < dateFrom) return false;
    if (dateTo && r.date > dateTo) return false;
    return true;
  });

  const totSale = loaded ? filtered.reduce((s, r) => s + Number(r.sale || 0), 0) : 0;
  const totCollection = loaded ? filtered.reduce((s, r) => s + Number(r.cash_collection || 0), 0) : 0;
  const totTax = loaded ? filtered.reduce((s, r) => s + Number(r.tax_collected || 0), 0) : 0;

  const exportData = filtered.map((r) => ({
    Date: r.date,
    "Sale (Rs.)": r.sale,
    "Cash Collection (Rs.)": r.cash_collection,
    "Tax Collected (Rs.)": r.tax_collected,
  }));

  return (
    <div className="space-y-3">
      <DateFilter
        dateFrom={dateFrom} dateTo={dateTo}
        onChange={(f, t) => { setDateFrom(f); setDateTo(t); }}
        total={loaded ? totTax : undefined} totalLabel="Total Tax Collected"
        exportData={exportData} exportFilename="advance_tax_report"
        onLoad={handleLoad} loading={loading}
      />
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Sale", value: totSale, color: "#0369a1" },
          { label: "Cash Collection", value: totCollection, color: "#059669" },
          { label: "Tax Collected", value: totTax, color: "#e51e2a" },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-zinc-200 rounded-lg px-4 py-3">
            <p className="text-[0.625rem] font-medium text-zinc-500 uppercase tracking-wide mb-1">{s.label}</p>
            <p className="text-[1.125rem] font-bold" style={{ color: s.color }}>
              {loaded ? `Rs. ${s.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
            </p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Sale (Rs.)</TableHead>
              <TableHead className="text-right">Cash Collection (Rs.)</TableHead>
              <TableHead className="text-right font-semibold" style={{ color: "var(--primary)" }}>Tax Collected (Rs.)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loaded ? (
              <TableRow><TableCell colSpan={4} className="text-center text-zinc-400 py-10 text-xs">Set date range and click Load to view advance tax report.</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center text-zinc-400 py-8 text-xs">No advance tax records found for selected criteria.</TableCell></TableRow>
            ) : (
              <>
                {filtered.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{r.date}</TableCell>
                    <TableCell className="text-right">{fmt(r.sale)}</TableCell>
                    <TableCell className="text-right text-emerald-700">{fmt(r.cash_collection)}</TableCell>
                    <TableCell className="text-right font-bold" style={{ color: "var(--primary)" }}>{fmt(r.tax_collected)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-zinc-50 font-semibold text-[0.71875rem]">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{fmt(totSale)}</TableCell>
                  <TableCell className="text-right text-emerald-700">{fmt(totCollection)}</TableCell>
                  <TableCell className="text-right" style={{ color: "var(--primary)" }}>{fmt(totTax)}</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}



// ─── Additional Discounts Report ─────────────────────────────────────────────

type ADiscountMainTab = "date_wise" | "whole_summary" | "shop_summary";

interface AdditionalDiscountShopItem {
  shopName: string;
  invoiceNo?: string;
  products: string;
  discount: number;
}

interface AdditionalDiscountRow {
  date: string;
  shops: AdditionalDiscountShopItem[];
  totalDiscount: number;
}

function SubTabBar({ active, tabs, onChange }: { active: string; tabs: { key: string; label: string }[]; onChange: (k: string) => void }) {
  return (
    <div className="inline-flex rounded-lg p-1 bg-zinc-100 border border-zinc-200">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
            active === t.key ? "bg-white text-zinc-900 shadow-sm border border-zinc-200" : "text-zinc-500 hover:text-zinc-800"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function AdditionalDiscountsReport({ presellers = [], shops = [] }: { presellers: any[]; shops: any[] }) {
  const [mainTab, setMainTab] = useState<ADiscountMainTab>("date_wise");

  return (
    <div className="space-y-4">
      <div className="border-b border-zinc-200 pb-3">
        <SubTabBar
          active={mainTab}
          tabs={[
            { key: "date_wise", label: "Date Wise" },
            { key: "whole_summary", label: "Whole Summary" },
            { key: "shop_summary", label: "Shop Summary" },
          ]}
          onChange={(k) => setMainTab(k as ADiscountMainTab)}
        />
      </div>
      {mainTab === "date_wise" && <DateWiseTab presellers={presellers} />}
      {mainTab === "whole_summary" && <WholeSummaryTab presellers={presellers} />}
      {mainTab === "shop_summary" && <ShopSummaryTab shops={shops} />}
    </div>
  );
}

function DateWiseTab({ presellers }: { presellers: any[] }) {
  const [subTab, setSubTab] = useState<"owner" | "preseller">("owner");
  const [dateFrom, setDateFrom] = useState(FIRST_OF_MONTH);
  const [dateTo, setDateTo] = useState(TODAY);
  const [selectedPresellerId, setSelectedPresellerId] = useState("");
  const [drilldownRow, setDrilldownRow] = useState<{ date: string; shops: AdditionalDiscountShopItem[] } | null>(null);
  const [reportRows, setReportRows] = useState<AdditionalDiscountRow[]>([]);
  const [isPending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  const handleLoad = useCallback(() => {
    startTransition(async () => {
      try {
        const data = await getDiscountReportData({
          from: dateFrom || undefined,
          to: dateTo || undefined,
          givenByType: subTab,
          presellerId: subTab === "preseller" && selectedPresellerId ? selectedPresellerId : undefined,
        });
        const mapped: AdditionalDiscountRow[] = (data || []).map((row: any) => ({
          date: row.date,
          totalDiscount: row.totalDiscount,
          shops: (row.shops || []).map((sh: any) => ({
            shopName: sh.shopName,
            invoiceNo: sh.invoiceNo,
            products: sh.products,
            discount: sh.discount,
          })),
        }));
        setReportRows(mapped);
      } catch (err) {
        console.error("[DateWiseTab] load failed:", err);
        setReportRows([]);
      } finally {
        setLoaded(true);
      }
    });
  }, [dateFrom, dateTo, subTab, selectedPresellerId]);

  const totDiscount = reportRows.reduce((s, r) => s + r.totalDiscount, 0);
  const exportData = reportRows.map((r) => ({ Date: r.date, "Discount (Rs.)": r.totalDiscount, "Shops Count": r.shops.length }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SubTabBar
          active={subTab}
          tabs={[{ key: "owner", label: "Owner" }, { key: "preseller", label: "Preseller" }]}
          onChange={(k) => { setSubTab(k as "owner" | "preseller"); setDrilldownRow(null); setReportRows([]); setLoaded(false); }}
        />
        <span className="text-xs text-zinc-500">Discounts by: <strong className="text-zinc-800 capitalize">{subTab}</strong></span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 bg-white p-3.5 rounded-xl border border-zinc-200 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          {subTab === "preseller" && (
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Preseller</label>
              <select
                value={selectedPresellerId}
                onChange={(e) => setSelectedPresellerId(e.target.value)}
                className="w-48 h-9 rounded-md border border-zinc-200 px-3 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">— All Presellers —</option>
                {presellers.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.full_name} {p.employee_code ? `(${p.employee_code})` : ""}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">From Date</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36 h-9 text-xs" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">To Date</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36 h-9 text-xs" />
          </div>
          <Button type="button" onClick={handleLoad} disabled={isPending} className="h-9 px-4 text-xs font-semibold bg-[#e51e2a] hover:bg-[#c91823] text-white flex items-center gap-1.5">
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isPending ? "Loading..." : "Load"}
          </Button>
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-[0.6875rem] text-zinc-400 hover:text-zinc-700 underline mb-2">Clear Filter</button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-1.5 text-xs">
            <span className="text-zinc-500">Total {subTab === "owner" ? "Owner" : "Preseller"} Discount: </span>
            <span className="font-bold text-red-600">Rs. {totDiscount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
                        <AdditionalDiscountDateWiseExport rows={reportRows} filename={`additional_discount_${subTab}_report`} period={`Period: ${dateFrom} to ${dateTo}  •  Given by: ${subTab}`} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50 border-b border-zinc-200">
              <TableHead className="text-xs font-bold text-zinc-800">Date</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800">Reference</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800 text-right">Discount (Rs.)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reportRows.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="text-center text-zinc-400 py-10 text-xs">{!loaded ? "Set filters and click Load to view discount report." : "No discount records found for selected criteria."}</TableCell></TableRow>
            ) : (
              <>
                {reportRows.map((row, idx) => (
                  <TableRow key={idx} className="hover:bg-zinc-50/70">
                    <TableCell className="font-mono text-xs font-semibold text-zinc-700">{row.date}</TableCell>
                    <TableCell>
                      <button type="button" onClick={() => setDrilldownRow(row)}
                        className="inline-flex items-center px-3 py-1 rounded-md text-xs font-semibold text-white transition-opacity hover:opacity-90 shadow-sm"
                        style={{ background: "var(--primary, #e51e2a)" }}>Shops (View)</button>
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-xs" style={{ color: "var(--primary)" }}>{fmt(row.totalDiscount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-zinc-50 font-bold text-xs border-t-2 border-zinc-200">
                  <TableCell>Total</TableCell><TableCell>—</TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold text-red-600">{fmt(totDiscount)}</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>

      {drilldownRow && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden border border-zinc-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 bg-zinc-50">
              <div>
                <h3 className="text-sm font-bold text-zinc-900">Discount Breakdown by Shops — {drilldownRow.date} ({subTab === "owner" ? "Owner Given" : "Preseller Given"})</h3>
                <p className="text-[0.6875rem] text-zinc-500 mt-0.5">Total Discount: <strong className="text-red-600">{fmt(drilldownRow.shops.reduce((s, sh) => s + sh.discount, 0))}</strong> across {drilldownRow.shops.length} shop(s)</p>
              </div>
              <button onClick={() => setDrilldownRow(null)} className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 transition-colors text-lg leading-none">×</button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <Table>
                <TableHeader>
                  <TableRow className="bg-zinc-50 border-b border-zinc-200">
                    <TableHead className="text-xs font-bold text-zinc-800">Shop</TableHead>
                    <TableHead className="text-xs font-bold text-zinc-800">Invoice No</TableHead>
                    <TableHead className="text-xs font-bold text-zinc-800">Products</TableHead>
                    <TableHead className="text-xs font-bold text-zinc-800 text-right">Discount (Rs.)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drilldownRow.shops.map((sh, sIdx) => (
                    <TableRow key={sIdx} className="hover:bg-zinc-50/70">
                      <TableCell className="text-xs font-semibold text-zinc-900">{sh.shopName}</TableCell>
                      <TableCell className="font-mono text-xs text-zinc-700">{sh.invoiceNo || "—"}</TableCell>
                      <TableCell className="text-xs font-mono text-zinc-800">
                        <div className="flex flex-wrap gap-1">
                          {sh.products.split(",").map((p, pIdx) => (
                            <span key={pIdx} className="inline-flex items-center px-2 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-[0.6875rem]">{p.trim()}</span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-xs" style={{ color: "var(--primary)" }}>{fmt(sh.discount)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-zinc-50 font-bold text-xs border-t-2 border-zinc-200">
                    <TableCell>Total</TableCell><TableCell>—</TableCell><TableCell>—</TableCell>
                    <TableCell className="text-right font-mono font-bold text-xs text-red-600">{fmt(drilldownRow.shops.reduce((s, sh) => s + sh.discount, 0))}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div className="px-6 py-3 border-t border-zinc-100 bg-zinc-50 flex justify-end">
              <Button type="button" variant="outline" onClick={() => setDrilldownRow(null)} className="text-xs">Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WholeSummaryTab({ presellers = [] }: { presellers: any[] }) {
  const [dateFrom, setDateFrom] = useState(FIRST_OF_MONTH);
  const [dateTo, setDateTo] = useState(TODAY);
  const [givenByFilter, setGivenByFilter] = useState("");
  const [appliedGivenByFilter, setAppliedGivenByFilter] = useState("");
  const [appliedDateFrom, setAppliedDateFrom] = useState(FIRST_OF_MONTH);
  const [appliedDateTo, setAppliedDateTo] = useState(TODAY);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleLoad = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAdditionalDiscountSummary({ from: dateFrom || undefined, to: dateTo || undefined });
      setRows(data || []);
      setAppliedGivenByFilter(givenByFilter);
      setAppliedDateFrom(dateFrom);
      setAppliedDateTo(dateTo);
      setLoaded(true);
      setLoading(false);
    } catch (err) {
      console.error("[WholeSummaryTab] load failed:", err);
      setRows([]);
      setLoaded(true);
      setLoading(false);
    }
  }, [dateFrom, dateTo, givenByFilter]);

  const filteredRows = rows.filter((r) => {
    if (!appliedGivenByFilter) return true;
    return r.givenBy === appliedGivenByFilter;
  });

  const totInvoices = filteredRows.reduce((s, r) => s + r.invoiceCount, 0);
  const totSales = filteredRows.reduce((s, r) => s + r.salesTotal, 0);
  const totDiscount = filteredRows.reduce((s, r) => s + r.discountTotal, 0);

  const exportData = filteredRows.map((r) => ({
    Shop: r.shopName,
    "From": appliedDateFrom || "All",
    "To": appliedDateTo || "All",
    Invoices: r.invoiceCount,
    "Sales (Rs.)": r.salesTotal,
    "Given By": r.givenBy,
    "A.Discount (Rs.)": r.discountTotal,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 bg-white p-3.5 rounded-xl border border-zinc-200 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Given By</label>
            <select
              value={givenByFilter}
              onChange={(e) => setGivenByFilter(e.target.value)}
              className="w-48 h-9 rounded-md border border-zinc-200 px-3 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="">— All Given By —</option>
              <option value="Owner">Owner</option>
              {presellers.map((p: any) => (
                <option key={p.id} value={`Preseller (${p.full_name})`}>
                  Preseller ({p.full_name})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">From</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36 h-9 text-xs" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">To</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36 h-9 text-xs" />
          </div>
          <Button type="button" onClick={handleLoad} disabled={loading} className="h-9 px-4 text-xs font-semibold bg-[#e51e2a] hover:bg-[#c91823] text-white flex items-center gap-1.5">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading ? "Loading..." : "Load"}
          </Button>
          {(dateFrom || dateTo || givenByFilter || appliedGivenByFilter) && (
            <button
              onClick={() => {
                setDateFrom("");
                setDateTo("");
                setGivenByFilter("");
                setAppliedGivenByFilter("");
                setAppliedDateFrom("");
                setAppliedDateTo("");
                setRows([]);
                setLoaded(false);
              }}
              className="text-[0.6875rem] text-zinc-400 hover:text-zinc-700 underline mb-2"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-1.5 text-xs">
            <span className="text-zinc-500">Total A.Discount: </span>
            <span className="font-bold text-red-600">Rs. {totDiscount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
          <ExportButtons data={exportData} filename="additional_discount_whole_summary" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50 border-b border-zinc-200">
              <TableHead className="text-xs font-bold text-zinc-800">From – To</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800">Shop</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800 text-right">Invoices</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800 text-right">Sales</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800">Given By</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800 text-right">A.Discount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-zinc-400 py-10 text-xs">{!loaded ? "Set date range and click Load." : "No discounted shops found for selected criteria."}</TableCell></TableRow>
            ) : (
              <>
                {filteredRows.map((r, i) => (
                  <TableRow key={i} className="hover:bg-zinc-50/70">
                    <TableCell className="text-xs text-zinc-500 font-mono">{appliedDateFrom || "All"} – {appliedDateTo || "All"}</TableCell>
                    <TableCell className="text-xs font-semibold text-zinc-900">{r.shopName}</TableCell>
                    <TableCell className="text-right text-xs font-mono text-zinc-700">{r.invoiceCount}</TableCell>
                    <TableCell className="text-right text-xs font-mono text-zinc-700">{fmt(r.salesTotal)}</TableCell>
                    <TableCell className="text-xs text-zinc-600">{r.givenBy}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-xs text-red-600">{fmt(r.discountTotal)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-zinc-50 font-bold text-xs border-t-2 border-zinc-200">
                  <TableCell>Total</TableCell><TableCell>—</TableCell>
                  <TableCell className="text-right font-mono">{totInvoices}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(totSales)}</TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="text-right font-mono text-red-600">{fmt(totDiscount)}</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ShopSummaryTab({ shops }: { shops: any[] }) {
  const [dateFrom, setDateFrom] = useState(FIRST_OF_MONTH);
  const [dateTo, setDateTo] = useState(TODAY);
  const [shopId, setShopId] = useState("");
  const [shopSearch, setShopSearch] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [isPending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  const filteredShops = shops.filter((s) => {
    if (!shopSearch) return true;
    const q = shopSearch.toLowerCase();
    return (
      (s.shop_name && s.shop_name.toLowerCase().includes(q)) ||
      (s.outlet_code && s.outlet_code.toLowerCase().includes(q))
    );
  });

  const handleLoad = useCallback(() => {
    if (!shopId) return;
    startTransition(async () => {
      try {
        const data = await getAdditionalDiscountShopSummary(shopId, { from: dateFrom || undefined, to: dateTo || undefined });
        setRows(data || []);
      } catch (err) {
        console.error("[ShopSummaryTab] load failed:", err);
        setRows([]);
      } finally {
        setLoaded(true);
      }
    });
  }, [shopId, dateFrom, dateTo]);

  const totGrandTotal = rows.reduce((s, r) => s + r.grandTotal, 0);
  const totDiscount = rows.reduce((s, r) => s + r.discount, 0);
  const selectedShop = shops.find((s) => s.id === shopId);

  const exportData = rows.map((r) => ({
    Date: r.date,
    "Invoice No": r.invoiceNo,
    Products: r.products,
    "Grand Total (Rs.)": r.grandTotal,
    "Given By": r.givenBy || "",
    "A.Discount (Rs.)": r.discount,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 bg-white p-3.5 rounded-xl border border-zinc-200 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Shop</label>
            <div className="relative">
              <Input
                placeholder="Search shop name or outlet code..."
                value={shopSearch}
                onChange={(e) => { setShopSearch(e.target.value); if (!e.target.value) setShopId(""); }}
                className="w-64 h-9 text-xs pr-2"
              />
              {shopSearch && filteredShops.length > 0 && !shopId && (
                <div className="absolute top-full left-0 z-20 bg-white border border-zinc-200 rounded-lg shadow-lg w-full max-h-48 overflow-y-auto mt-1">
                  {filteredShops.slice(0, 20).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 text-zinc-800 flex items-center justify-between"
                      onClick={() => {
                        setShopId(s.id);
                        setShopSearch(s.shop_name + (s.outlet_code ? ` (${s.outlet_code})` : ""));
                      }}
                    >
                      <span className="font-semibold text-zinc-900">{s.shop_name}</span>
                      {s.outlet_code && (
                        <span className="font-mono text-[0.625rem] bg-zinc-100 px-1.5 py-0.5 rounded text-zinc-600">
                          {s.outlet_code}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedShop && (
              <p className="text-[0.625rem] text-zinc-400 mt-0.5">
                {selectedShop.shop_name} {selectedShop.outlet_code ? `(${selectedShop.outlet_code})` : ""}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">From</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36 h-9 text-xs" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">To</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36 h-9 text-xs" />
          </div>
          <Button type="button" onClick={handleLoad} disabled={isPending || !shopId} className="h-9 px-4 text-xs font-semibold bg-[#e51e2a] hover:bg-[#c91823] text-white disabled:opacity-50 flex items-center gap-1.5">
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isPending ? "Loading..." : "Load"}
          </Button>
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-[0.6875rem] text-zinc-400 hover:text-zinc-700 underline mb-2">Clear Dates</button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-1.5 text-xs">
            <span className="text-zinc-500">Total A.Discount: </span>
            <span className="font-bold text-red-600">Rs. {totDiscount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
          <ExportButtons data={exportData} filename={`additional_discount_shop_${selectedShop?.shop_name || "summary"}`} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50 border-b border-zinc-200">
              <TableHead className="text-xs font-bold text-zinc-800">Date</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800">Invoice No</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800">Products</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800 text-right">Grand Total</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800">Given By</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800 text-right">A.Discount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-zinc-400 py-10 text-xs">{!loaded ? (!shopId ? "Select a shop and click Load." : "Set filters and click Load.") : "No invoices found for this shop in the selected range."}</TableCell></TableRow>
            ) : (
              <>
                {rows.map((r, i) => (
                  <TableRow key={i} className="hover:bg-zinc-50/70">
                    <TableCell className="font-mono text-xs font-semibold text-zinc-700">{r.date}</TableCell>
                    <TableCell className="font-mono text-xs text-zinc-700">{r.invoiceNo}</TableCell>
                    <TableCell className="text-xs font-mono text-zinc-800">
                      <div className="flex flex-wrap gap-1">
                        {r.products.split(",").map((p: string, pIdx: number) => (
                          <span key={pIdx} className="inline-flex items-center px-2 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-[0.6875rem]">{p.trim()}</span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-zinc-700">{fmt(r.grandTotal)}</TableCell>
                    <TableCell className="text-xs text-zinc-600">{r.givenBy || "—"}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-xs text-red-600">{fmt(r.discount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-zinc-50 font-bold text-xs border-t-2 border-zinc-200">
                  <TableCell>Total</TableCell><TableCell>—</TableCell><TableCell>—</TableCell>
                  <TableCell className="text-right font-mono">{fmt(totGrandTotal)}</TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="text-right font-mono text-red-600">{fmt(totDiscount)}</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

type SalesSummaryTab = "date_wise" | "shop_wise";

interface DateWiseSalesRow {
  date: string;
  sales: number;
  cash: number;
  credit: number;
}

interface ShopWiseSalesRow {
  id: string;
  invoice_no: string;
  date: string;
  sale: number;
  type: "Cash" | "Credit" | string;
  status: "Paid" | "Partial" | "Unpaid";
}

function SalesSummaryReport({ shops = [] }: { shops: any[] }) {
  const [subTab, setSubTab] = useState<SalesSummaryTab>("date_wise");

  return (
    <div className="space-y-4">
      <div className="border-b border-zinc-200 pb-3">
        <SubTabBar
          active={subTab}
          tabs={[
            { key: "date_wise", label: "Date Wise" },
            { key: "shop_wise", label: "Shop Wise" },
          ]}
          onChange={(k) => setSubTab(k as SalesSummaryTab)}
        />
      </div>
      {subTab === "date_wise" && <DateWiseSalesTab />}
      {subTab === "shop_wise" && <ShopWiseSalesTab shops={shops} />}
    </div>
  );
}

function DateWiseSalesTab() {
  const [dateFrom, setDateFrom] = useState(FIRST_OF_MONTH);
  const [dateTo, setDateTo] = useState(TODAY);
  const [rows, setRows] = useState<DateWiseSalesRow[]>([]);
  const [isPending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  const handleLoad = useCallback(() => {
    startTransition(async () => {
      const data = await getDateWiseSalesSummary({
        from: dateFrom || undefined,
        to: dateTo || undefined,
      });
      setRows(data || []);
      setLoaded(true);
    });
  }, [dateFrom, dateTo]);

  const totSales = rows.reduce((s, r) => s + Number(r.sales || 0), 0);
  const totCash = rows.reduce((s, r) => s + Number(r.cash || 0), 0);
  const totCredit = rows.reduce((s, r) => s + Number(r.credit || 0), 0);

  const exportData = rows.map((r) => ({
    Date: r.date,
    "Sales (Rs.)": r.sales,
    "Cash (Rs.)": r.cash,
    "Credit (Rs.)": r.credit,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 bg-white p-3.5 rounded-xl border border-zinc-200 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">From</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36 h-9 text-xs" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">To</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36 h-9 text-xs" />
          </div>
          <Button
            type="button"
            onClick={handleLoad}
            disabled={isPending}
            className="h-9 px-4 text-xs font-semibold bg-[#e51e2a] hover:bg-[#c91823] text-white flex items-center gap-1.5"
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isPending ? "Loading..." : "Load"}
          </Button>
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => { setDateFrom(""); setDateTo(""); }}
              className="text-[0.6875rem] text-zinc-400 hover:text-zinc-700 underline mb-2"
            >
              Clear Dates
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5 text-xs">
            <span className="text-zinc-500">Sales:</span>
            <span className="font-bold text-red-600">{fmt(totSales)}</span>
            <span className="text-zinc-300">|</span>
            <span className="text-zinc-500">Cash:</span>
            <span className="font-semibold text-emerald-700">{fmt(totCash)}</span>
            <span className="text-zinc-300">|</span>
            <span className="text-zinc-500">Credit:</span>
            <span className="font-semibold text-blue-700">{fmt(totCredit)}</span>
          </div>
          <ExportButtons data={exportData} filename="sales_summary_date_wise" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50 border-b border-zinc-200">
              <TableHead className="text-xs font-bold text-zinc-800">Date</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800 text-right">Sales</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800 text-right">Cash</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800 text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-zinc-400 py-10 text-xs">
                  {!loaded ? "Set date filter and click Load to view sales summary." : "No sales records found for selected date filter."}
                </TableCell>
              </TableRow>
            ) : (
              <>
                {rows.map((row, idx) => (
                  <TableRow key={idx} className="hover:bg-zinc-50/70">
                    <TableCell className="font-mono text-xs font-semibold text-zinc-700">{row.date}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-xs" style={{ color: "var(--primary)" }}>
                      {fmt(row.sales)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-emerald-700">
                      {fmt(row.cash)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-blue-700">
                      {fmt(row.credit)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-zinc-50 font-bold text-xs border-t-2 border-zinc-200">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold text-red-600">{fmt(totSales)}</TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold text-emerald-700">{fmt(totCash)}</TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold text-blue-700">{fmt(totCredit)}</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ShopWiseSalesTab({ shops }: { shops: any[] }) {
  const [dateFrom, setDateFrom] = useState(FIRST_OF_MONTH);
  const [dateTo, setDateTo] = useState(TODAY);
  const [shopId, setShopId] = useState("");
  const [shopSearch, setShopSearch] = useState("");
  const [rows, setRows] = useState<ShopWiseSalesRow[]>([]);
  const [isPending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  const filteredShops = shops.filter((s) => {
    if (!shopSearch) return true;
    const q = shopSearch.toLowerCase();
    return (
      (s.shop_name && s.shop_name.toLowerCase().includes(q)) ||
      (s.outlet_code && s.outlet_code.toLowerCase().includes(q))
    );
  });

  const selectedShop = shops.find((s) => s.id === shopId);

  const handleLoad = useCallback(() => {
    if (!shopId) return;
    startTransition(async () => {
      const data = await getShopWiseSalesSummary({
        shopId,
        from: dateFrom || undefined,
        to: dateTo || undefined,
      });
      setRows(data || []);
      setLoaded(true);
    });
  }, [shopId, dateFrom, dateTo]);

  const totSale = rows.reduce((s, r) => s + Number(r.sale || 0), 0);

  const exportData = rows.map((r) => ({
    "Invoice No": r.invoice_no,
    Date: r.date,
    "Sale (Rs.)": r.sale,
    Type: r.type,
    Status: r.status,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 bg-white p-3.5 rounded-xl border border-zinc-200 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Shop</label>
            <div className="relative">
              <Input
                placeholder="Search shop name or outlet code..."
                value={shopSearch}
                onChange={(e) => {
                  setShopSearch(e.target.value);
                  if (!e.target.value) setShopId("");
                }}
                className="w-64 h-9 text-xs pr-2"
              />
              {shopSearch && filteredShops.length > 0 && !shopId && (
                <div className="absolute top-full left-0 z-20 bg-white border border-zinc-200 rounded-lg shadow-lg w-full max-h-48 overflow-y-auto mt-1">
                  {filteredShops.slice(0, 20).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 text-zinc-800 flex items-center justify-between"
                      onClick={() => {
                        setShopId(s.id);
                        setShopSearch(s.shop_name + (s.outlet_code ? ` (${s.outlet_code})` : ""));
                      }}
                    >
                      <span className="font-semibold text-zinc-900">{s.shop_name}</span>
                      {s.outlet_code && (
                        <span className="font-mono text-[0.625rem] bg-zinc-100 px-1.5 py-0.5 rounded text-zinc-600">
                          {s.outlet_code}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedShop && (
              <p className="text-[0.625rem] text-zinc-400 mt-0.5">
                {selectedShop.shop_name} {selectedShop.outlet_code ? `(${selectedShop.outlet_code})` : ""}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">From</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36 h-9 text-xs" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">To</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36 h-9 text-xs" />
          </div>
          <Button
            type="button"
            onClick={handleLoad}
            disabled={isPending || !shopId}
            className="h-9 px-4 text-xs font-semibold bg-[#e51e2a] hover:bg-[#c91823] text-white disabled:opacity-50 flex items-center gap-1.5"
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isPending ? "Loading..." : "Load"}
          </Button>
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => { setDateFrom(""); setDateTo(""); }}
              className="text-[0.6875rem] text-zinc-400 hover:text-zinc-700 underline mb-2"
            >
              Clear Dates
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-1.5 text-xs">
            <span className="text-zinc-500">Total Sale: </span>
            <span className="font-bold text-red-600">{fmt(totSale)}</span>
          </div>
          <ExportButtons data={exportData} filename={`sales_summary_${selectedShop?.shop_name || "shop"}`} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50 border-b border-zinc-200">
              <TableHead className="text-xs font-bold text-zinc-800">Invoice No</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800">Date</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800 text-right">Sale</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800">Type</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-zinc-400 py-10 text-xs">
                  {!loaded ? "Select a shop, set date filter, and click Load." : "No invoices found for this shop in selected date filter."}
                </TableCell>
              </TableRow>
            ) : (
              <>
                {rows.map((row, idx) => (
                  <TableRow key={idx} className="hover:bg-zinc-50/70">
                    <TableCell className="font-mono text-xs font-semibold text-zinc-800">{row.invoice_no}</TableCell>
                    <TableCell className="font-mono text-xs text-zinc-600">{row.date}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-zinc-800">
                      {fmt(row.sale)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.type === "Cash" ? "default" : "secondary"}>
                        {row.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.status === "Paid"
                            ? "success"
                            : row.status === "Partial"
                            ? "warning"
                            : "destructive"
                        }
                      >
                        {row.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-zinc-50 font-bold text-xs border-t-2 border-zinc-200">
                  <TableCell>Total</TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="text-right font-mono font-bold text-red-600">{fmt(totSale)}</TableCell>
                  <TableCell>—</TableCell>
                  <TableCell>—</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

interface CreditSummaryInvoice {
  id: string;
  invoice_no: string;
  date: string;
  sale: number;
  paid: number;
  remaining: number;
  status: "Paid" | "Partial" | "Unpaid";
}

interface CreditSummaryShop {
  shop_id: string;
  shop_name: string;
  outlet_code: string;
  balance: number;
  invoices: CreditSummaryInvoice[];
}

function CreditSummaryReport() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rows, setRows] = useState<CreditSummaryShop[]>([]);
  const [isPending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  const fetchCreditSummary = useCallback((from?: string, to?: string) => {
    startTransition(async () => {
      const data = await getCreditSummaryReport({
        from: from || undefined,
        to: to || undefined,
      });
      setRows(data || []);
      setLoaded(true);
    });
  }, []);

  const handleLoad = useCallback(() => {
    fetchCreditSummary(dateFrom, dateTo);
  }, [fetchCreditSummary, dateFrom, dateTo]);

  useEffect(() => {
    fetchCreditSummary();
  }, [fetchCreditSummary]);

  const handleClearDates = useCallback(() => {
    setDateFrom("");
    setDateTo("");
    fetchCreditSummary("", "");
  }, [fetchCreditSummary]);

  const totShops = rows.length;
  const totBalance = rows.reduce((s, r) => s + Number(r.balance || 0), 0);
  const totSale = rows.reduce(
    (s, r) => s + r.invoices.reduce((acc, inv) => acc + Number(inv.sale || 0), 0),
    0
  );
  const totPaid = rows.reduce(
    (s, r) => s + r.invoices.reduce((acc, inv) => acc + Number(inv.paid || 0), 0),
    0
  );
  const totRemaining = rows.reduce(
    (s, r) => s + r.invoices.reduce((acc, inv) => acc + Number(inv.remaining || 0), 0),
    0
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 bg-white p-3.5 rounded-xl border border-zinc-200 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">From</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36 h-9 text-xs" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">To</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36 h-9 text-xs" />
          </div>
          <Button
            type="button"
            onClick={handleLoad}
            disabled={isPending}
            className="h-9 px-4 text-xs font-semibold bg-[#e51e2a] hover:bg-[#c91823] text-white flex items-center gap-1.5"
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isPending ? "Loading..." : "Load"}
          </Button>
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={handleClearDates}
              className="text-[0.6875rem] text-zinc-400 hover:text-zinc-700 underline mb-2"
            >
              Clear Dates
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5 text-xs">
            <span className="text-zinc-500">Shops:</span>
            <span className="font-bold text-zinc-900">{totShops}</span>
            <span className="text-zinc-300">|</span>
            <span className="text-zinc-500">Total Balance:</span>
            <span className="font-bold text-red-600">{fmt(totBalance)}</span>
            <span className="text-zinc-300">|</span>
            <span className="text-zinc-500">Remaining:</span>
            <span className="font-bold text-red-600">{fmt(totRemaining)}</span>
          </div>
          <CreditSummaryExportButtons
            shops={rows}
            dateFrom={dateFrom}
            dateTo={dateTo}
            filename="credit_summary_report"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50 border-b border-zinc-200">
              <TableHead className="text-xs font-bold text-zinc-800 w-12 text-center">#</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800">Invoice No</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800">Date</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800 text-right">Sale</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800 text-right">Paid</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800 text-right">Remaining</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-zinc-400 py-10 text-xs">
                  {!loaded ? "Loading credit summary..." : "No unpaid credit invoices found."}
                </TableCell>
              </TableRow>
            ) : (
              <>
                {rows.map((shop) => {
                  const shopSale = shop.invoices.reduce((sum, inv) => sum + Number(inv.sale || 0), 0);
                  const shopPaid = shop.invoices.reduce((sum, inv) => sum + Number(inv.paid || 0), 0);
                  const shopRemaining = shop.invoices.reduce((sum, inv) => sum + Number(inv.remaining || 0), 0);

                  return (
                    <Fragment key={shop.shop_id}>
                      <TableRow className="bg-zinc-100/90 border-t-2 border-b border-zinc-300">
                        <TableCell colSpan={7} className="py-2 px-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-zinc-900 tracking-wide">
                                {shop.shop_name}
                              </span>
                              {shop.outlet_code && (
                                <span className="font-mono text-[0.625rem] bg-white border border-zinc-200 px-1.5 py-0.5 rounded text-zinc-600 font-semibold">
                                  {shop.outlet_code}
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-semibold text-zinc-700">
                              Balance: <span className="font-mono font-bold text-red-600 ml-1">{fmt(shop.balance)}</span>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                      {shop.invoices.map((inv, idx) => (
                        <TableRow key={inv.id} className="hover:bg-zinc-50/70">
                          <TableCell className="font-mono text-xs text-zinc-500 text-center">{idx + 1}.</TableCell>
                          <TableCell className="font-mono text-xs font-semibold text-zinc-800">{inv.invoice_no}</TableCell>
                          <TableCell className="font-mono text-xs text-zinc-600">{inv.date}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-semibold text-zinc-800">
                            {fmt(inv.sale)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-semibold text-emerald-700">
                            {fmt(inv.paid)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold text-red-600">
                            {fmt(inv.remaining)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                inv.status === "Paid"
                                  ? "success"
                                  : inv.status === "Partial"
                                  ? "warning"
                                  : "destructive"
                              }
                            >
                              {inv.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-zinc-50/40 text-xs font-medium border-b border-zinc-200">
                        <TableCell colSpan={3} className="text-right text-zinc-500 pr-4">
                          Shop Total ({shop.invoices.length} invoices):
                        </TableCell>
                        <TableCell className="text-right font-mono text-zinc-700">{fmt(shopSale)}</TableCell>
                        <TableCell className="text-right font-mono text-emerald-700">{fmt(shopPaid)}</TableCell>
                        <TableCell className="text-right font-mono text-red-600 font-semibold">{fmt(shopRemaining)}</TableCell>
                        <TableCell>—</TableCell>
                      </TableRow>
                    </Fragment>
                  );
                })}
                <TableRow className="bg-zinc-100 font-bold text-xs border-t-2 border-zinc-300">
                  <TableCell colSpan={3} className="text-right pr-4">
                    Grand Total ({totShops} Shops):
                  </TableCell>
                  <TableCell className="text-right font-mono text-zinc-900">{fmt(totSale)}</TableCell>
                  <TableCell className="text-right font-mono text-emerald-700">{fmt(totPaid)}</TableCell>
                  <TableCell className="text-right font-mono text-red-600 font-bold">{fmt(totRemaining)}</TableCell>
                  <TableCell>—</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}



