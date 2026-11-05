"use client";

import { useState, useTransition, useMemo, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { IncomeStatementExportButtons } from "@/components/export/IncomeStatementExportButtons";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/Table";
import { getIncomeStatementData } from "@/lib/actions/financial-statements";
import { getEnabledManualMonthsForCurrentTenant } from "@/lib/actions/manual-income-statement";
import { ManualIncomeStatementView } from "./ManualIncomeStatementView";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

const TODAY          = new Date().toISOString().split("T")[0];
const FIRST_OF_MONTH = `${TODAY.slice(0, 8)}01`;

const fmt = (n: number) =>
  "Rs. " + n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtAbs = (n: number) => fmt(Math.abs(n));

/**
 * Inventory can also move without a sale or a purchase order: a stock report entered
 * mid-period, damaged cases, empties dispatched back to CCBPL or lent out to outlets, or
 * goods sold that were never recorded as received. The line only appears when one of those
 * happened, and it is what keeps Opening + Purchases + Adjustments − Closing = COGS
 * balanced on screen.
 */
const ADJUSTMENTS_LABEL = "Inventory Adjustments (Stock Reports, Damages, Empties Out)";

type LineType = "section-header" | "revenue" | "cogs-detail" | "cogs-total" | "gross-profit" | "scheme" | "total-income" | "opex" | "opex-total" | "net-profit";

type StatementLine = {
  label:   string;
  amount:  number | null; // null = header with no amount
  type:    LineType;
  indent?: boolean;
  negative?: boolean; // show with minus sign
};

/** Build OPEX total from raw data */
function sumOpex(data: NonNullable<Awaited<ReturnType<typeof getIncomeStatementData>>>) {
  const { bills, fuel, maintenance, laborers, payroll, entertainment, petty, penalties, discountInvoices, additionalDiscountTotal, unrecoverableLoans } = data;

  const totalBills      = bills.reduce((s: number, r: any)      => s + (Number(r.amount) || 0), 0);
  const totalFuel       = fuel.reduce((s: number, r: any)       => s + (Number(r.amount) || 0), 0);
  const totalMaint      = maintenance.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
  const totalLaborers   = laborers.reduce((s: number, r: any)   => s + (Number(r.amount) || 0), 0);
  const totalSalary     = payroll.reduce((s: number, r: any)    => s + (Number(r.net_payable) || 0), 0);
  const totalEnt        = entertainment.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
  const totalPetty      = petty.reduce((s: number, r: any)      => s + (Number(r.amount) || 0), 0);
  const totalPenalties  = penalties.reduce((s: number, r: any)  => s + (Number(r.amount) || 0), 0);
  const totalDiscounts  = typeof additionalDiscountTotal === "number"
    ? additionalDiscountTotal
    : discountInvoices.reduce((s: number, r: any) => s + (Number(r.discount_amount) || 0), 0);
  const totalUnrecLoans = (unrecoverableLoans || []).reduce(
    (s: number, r: any) => s + (Number(r.expense_amount ?? r.outstanding_balance ?? r.principal_amount) || 0),
    0
  );

  return {
    totalBills, totalFuel, totalMaint, totalLaborers, totalSalary,
    totalEnt, totalPetty, totalPenalties, totalDiscounts, totalUnrecLoans,
    grandOpex: totalBills + totalFuel + totalMaint + totalLaborers + totalSalary + totalEnt + totalPetty + totalPenalties + totalDiscounts + totalUnrecLoans,
  };
}

/** Build OPEX detail lines per vehicle / bill / etc. */
function buildOpexLines(data: NonNullable<Awaited<ReturnType<typeof getIncomeStatementData>>>): StatementLine[] {
  const { bills, fuel, maintenance, laborers, payroll, entertainment, petty, penalties, discountInvoices, additionalDiscountTotal, bankMap } = data;

  const lines: StatementLine[] = [];

  // Salaries
  const totalSalary = payroll.reduce((s: number, r: any) => s + (Number(r.net_payable) || 0), 0);
  if (totalSalary > 0) {
    lines.push({ label: `Salaries & Payroll (${payroll.length} employees)`, amount: totalSalary, type: "opex", indent: true });
  }

  // Bills — one line per bill
  for (const b of bills) {
    lines.push({ label: (b.bill_name || "Bill").trim(), amount: Number(b.amount) || 0, type: "opex", indent: true });
  }

  // Fuel — grouped by truck
  const fuelByVehicle = new Map<string, number>();
  for (const f of fuel) {
    const key = f.truck_no || "Truck";
    fuelByVehicle.set(key, (fuelByVehicle.get(key) || 0) + (Number(f.amount) || 0));
  }
  fuelByVehicle.forEach((total, vehicle) => {
    lines.push({ label: `Fleet Fuel — ${vehicle}`, amount: total, type: "opex", indent: true });
  });

  // Maintenance — grouped by vehicle
  const maintByVehicle = new Map<string, number>();
  for (const m of maintenance) {
    const key = m.vehicle_no || "Vehicle";
    maintByVehicle.set(key, (maintByVehicle.get(key) || 0) + (Number(m.amount) || 0));
  }
  maintByVehicle.forEach((total, vehicle) => {
    lines.push({ label: `Fleet Maintenance — ${vehicle}`, amount: total, type: "opex", indent: true });
  });

  // Laborers
  const totalLaborers = laborers.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
  if (totalLaborers > 0) {
    lines.push({ label: `Warehouse Laborers (${laborers.length} entries)`, amount: totalLaborers, type: "opex", indent: true });
  }

  // Additional Discounts — single aggregated line
  const totalDiscounts = typeof additionalDiscountTotal === "number"
    ? additionalDiscountTotal
    : discountInvoices.reduce((s: number, r: any) => s + (Number(r.discount_amount) || 0), 0);
  if (totalDiscounts > 0) {
    lines.push({ label: "Additional Discounts (Special Shop Trade Discount)", amount: totalDiscounts, type: "opex", indent: true });
  }

  // Entertainment
  const totalEnt = entertainment.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
  if (totalEnt > 0) {
    lines.push({ label: "Entertainment & Refreshments", amount: totalEnt, type: "opex", indent: true });
  }

  // Petty Cash
  const totalPetty = petty.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
  if (totalPetty > 0) {
    lines.push({ label: "Petty Cash Expenses", amount: totalPetty, type: "opex", indent: true });
  }

  // Penalties — one per entry
  for (const p of penalties) {
    lines.push({ label: (p.description || p.reason || "CCBPL Penalty").trim(), amount: Number(p.amount) || 0, type: "opex", indent: true });
  }

  // Unrecoverable Loans — (Employee Name) | (Description) | Unrecoverable Loan
  const unrecLoans = (data as any).unrecoverableLoans || [];
  for (const ul of unrecLoans) {
    const emp = Array.isArray(ul.employees) ? ul.employees[0] : ul.employees;
    const empName = emp?.full_name || ul.employee_name || "Employee";
    const desc = ul.reason ? `${empName} | ${ul.reason} | Unrecoverable Loan` : `${empName} | Unrecoverable Loan`;
    lines.push({
      label: desc,
      amount: Number(ul.expense_amount ?? ul.outstanding_balance ?? ul.principal_amount) || 0,
      type: "opex",
      indent: true,
    });
  }

  return lines;
}

export function IncomeStatementClient() {
  const [fromDate, setFromDate] = useState(FIRST_OF_MONTH);
  const [toDate,   setToDate]   = useState(TODAY);
  const [data, setData]         = useState<Awaited<ReturnType<typeof getIncomeStatementData>> | null>(null);
  const [loaded, setLoaded]     = useState(false);
  const [isPending, startTransition] = useTransition();

  const [manualMonths, setManualMonths] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>("automated");

  const loadManualMonths = () => {
    getEnabledManualMonthsForCurrentTenant().then((months) => {
      setManualMonths(months);
      setActiveTab((prev) => {
        if (prev !== "automated" && !months.includes(prev)) {
          return "automated";
        }
        return prev;
      });
    });
  };

  useEffect(() => {
    loadManualMonths();
  }, []);

  useRealtimeTable("global_feature_flags", () => loadManualMonths());
  useRealtimeTable("tenant_feature_flags", () => loadManualMonths());

  const loadData = (from: string, to: string) => {
    startTransition(async () => {
      const result = await getIncomeStatementData(from, to);
      setData(result);
      setLoaded(true);
    });
  };


  // ── Compute figures ────────────────────────────────────────────────────────
  // The server action (getIncomeStatementData) now pre-computes all summary totals.
  // We use those directly so the Income Statement page and Balance Sheet are guaranteed
  // to show identical numbers for the same date range.
  const statement = useMemo(() => {
    if (!data) return null;

    const {
      invoices, openingStockValue, totalPurchases, closingStockValue, cogs, schemes, purchaseLines,
      inventoryAdjustments,
      // Pre-computed summary fields from server action
      totalSale, totalAdvTax, totalWHTax, netRevenue, grossProfit,
      schemesTotal, totalIncome, totalOpex, netProfit,
    } = data;

    // OPEX detail breakdown (for per-line display only — grandOpex matches server totalOpex)
    const opex = sumOpex(data);

    return {
      totalSale,
      totalAdvTax,
      totalWHTax: totalWHTax ?? (Math.round((totalSale ?? 0) * 0.001 * 100) / 100),
      netRevenue,
      // Backward-compatibility aliases
      grossRevenue: totalSale,
      totalRevenue: totalSale,
      openingStockValue, totalPurchases, closingStockValue, cogs,
      inventoryAdjustments,
      grossProfit,
      schemes,
      totalScheme: schemesTotal,
      totalIncome,
      opex,
      netProfit,       // ← from server, matches Balance Sheet exactly
      purchaseLines,
      invoiceCount: invoices.length,
    };
  }, [data]);

  // ── Build statement lines for export ──────────────────────────────────────
  const exportData = useMemo(() => {
    if (!statement) return [];
    const { totalSale, totalAdvTax, totalWHTax, netRevenue, cogs, openingStockValue, totalPurchases, closingStockValue,
            inventoryAdjustments, grossProfit, schemes, totalScheme, totalIncome, opex, netProfit } = statement;
    return [
      { Section: "SALES REVENUE", Description: `Total Invoiced Sales (${statement.invoiceCount} invoices)`, Amount: totalSale },
      { Section: "SALES REVENUE", Description: "Less: Advance Tax Collected (1% WHT pass-through)", Amount: -totalAdvTax },
      { Section: "SALES REVENUE", Description: "Less: WH Tax (0.1% WH Tax deducted from sales)", Amount: -totalWHTax },
      { Section: "SALES REVENUE", Description: "Net Sales Revenue (Excl. Tax)", Amount: netRevenue },
      { Section: "COGS",    Description: `Opening Stock Value (as of ${fromDate})`, Amount: openingStockValue },
      { Section: "COGS",    Description: "Purchases (Sell In / Loads)", Amount: totalPurchases },
      ...(inventoryAdjustments ? [{ Section: "COGS", Description: ADJUSTMENTS_LABEL, Amount: inventoryAdjustments }] : []),
      { Section: "COGS",    Description: `Closing Stock Value (as of ${toDate})`, Amount: -closingStockValue },
      { Section: "COGS",    Description: "TOTAL COGS", Amount: cogs },
      { Section: "GROSS PROFIT", Description: "Gross Profit (Net Revenue − COGS)", Amount: grossProfit },
      ...schemes.map((s: any) => ({ Section: "SCHEME INCOME", Description: s.description, Amount: Number(s.amount) || 0 })),
      { Section: "TOTAL INCOME", Description: "Total Income (Gross Profit + Schemes)", Amount: totalIncome },
      { Section: "OPEX",    Description: "Salaries & Payroll", Amount: opex.totalSalary },
      { Section: "OPEX",    Description: "Utility Bills", Amount: opex.totalBills },
      { Section: "OPEX",    Description: "Vehicle Fuel", Amount: opex.totalFuel },
      { Section: "OPEX",    Description: "Vehicle Maintenance", Amount: opex.totalMaint },
      { Section: "OPEX",    Description: "Daily Laborers", Amount: opex.totalLaborers },
      { Section: "OPEX",    Description: "Additional Discounts", Amount: opex.totalDiscounts },
      { Section: "OPEX",    Description: "Entertainment", Amount: opex.totalEnt },
      { Section: "OPEX",    Description: "Petty Cash", Amount: opex.totalPetty },
      { Section: "OPEX",    Description: "CCBPL Penalties", Amount: opex.totalPenalties },
      ...(data?.unrecoverableLoans || []).map((ul: any) => {
        const emp = Array.isArray(ul.employees) ? ul.employees[0] : ul.employees;
        const empName = emp?.full_name || ul.employee_name || "Employee";
        return {
          Section: "OPEX",
          Description: ul.reason ? `${empName} | ${ul.reason} | Unrecoverable Loan` : `${empName} | Unrecoverable Loan`,
          Amount: Number(ul.expense_amount ?? ul.outstanding_balance ?? ul.principal_amount) || 0,
        };
      }),
      { Section: "OPEX",    Description: "TOTAL OPEX", Amount: opex.grandOpex },
      { Section: "NET PROFIT", Description: "Net Profit (Pre-Tax)", Amount: netProfit },
    ];
  }, [statement, fromDate, toDate]);

  const opexLines = useMemo(() => data ? buildOpexLines(data) : [], [data]);

  const handleFromChange = (v: string) => { setFromDate(v); };
  const handleToChange   = (v: string) => { setToDate(v); };

  const s = statement;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Income Statement (P&amp;L)</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          Profit &amp; Loss — Sales Revenue minus COGS gives Gross Profit. Add Scheme Income and subtract OPEX for Net Profit.
        </p>
      </div>

      {manualMonths.length > 0 && (
        <div className="flex border-b border-zinc-200 gap-2 pb-0 pt-1">
          <button
            type="button"
            onClick={() => setActiveTab("automated")}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === "automated"
                ? "border-zinc-900 text-zinc-900 font-bold"
                : "border-transparent text-zinc-500 hover:text-zinc-700"
            }`}
          >
            Automated Statement
          </button>
          {manualMonths.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setActiveTab(m)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
                activeTab === m
                  ? "border-blue-600 text-blue-700 font-bold"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}
            >
              <span>{m}</span>
              <span
                className={`text-[0.625rem] uppercase font-bold px-1.5 py-0.5 rounded ${
                  activeTab === m
                    ? "bg-blue-100 text-blue-700"
                    : "bg-zinc-100 text-zinc-500"
                }`}
              >
                Manual
              </span>
            </button>
          ))}
        </div>
      )}

      {activeTab !== "automated" ? (
        <ManualIncomeStatementView monthYear={activeTab} />
      ) : (
        <>
          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-zinc-500">From</span>
            <input
              type="date" value={fromDate}
              onChange={(e) => handleFromChange(e.target.value)}
              className="h-9 px-2.5 py-1 text-sm border border-zinc-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-zinc-500">To</span>
            <input
              type="date" value={toDate}
              onChange={(e) => handleToChange(e.target.value)}
              className="h-9 px-2.5 py-1 text-sm border border-zinc-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
          <Button
            size="sm"
            onClick={() => loadData(fromDate, toDate)}
            disabled={isPending}
            className="flex items-center gap-1 h-9 px-3"
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>Load</span>
          </Button>
          <IncomeStatementExportButtons
            statement={statement}
            opexLines={opexLines}
            fromDate={fromDate}
            toDate={toDate}
            filename="income_statement"
          />
        </div>
        {s && (
          <div className={`text-sm font-bold px-4 py-1.5 rounded-lg border ${s.netProfit >= 0 ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700"}`}>
            Net Profit: {fmt(s.netProfit)}
          </div>
        )}
      </div>

      {/* Formula bar */}
      {s && (
        <div className="text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-2 space-y-0.5">
          <div>
            <span className="font-semibold">Total Invoiced Sales:</span> {fmt(s.totalSale)} &nbsp;|&nbsp;
            <span className="font-semibold">Less Advance Tax (1% WHT):</span> −{fmt(s.totalAdvTax)} &nbsp;|&nbsp;
            <span className="font-semibold">Less WH Tax (0.1%):</span> −{fmt(s.totalWHTax)} &nbsp;|&nbsp;
            <span className="font-semibold text-blue-700">Net Sales Revenue:</span> {fmt(s.netRevenue)}
          </div>
          <div>
            <span className="font-semibold">COGS</span> = Opening {fmt(s.openingStockValue)} + Purchases {fmt(s.totalPurchases)}
            {s.inventoryAdjustments !== 0 && <> + Adjustments {fmt(s.inventoryAdjustments)}</>} − Closing {fmt(s.closingStockValue)} = <span className="font-bold text-zinc-700">{fmt(s.cogs)}</span>
          </div>
          <div>
            <span className="font-semibold">Gross Profit</span> = Net Sales Revenue − COGS = <span className="font-bold">{fmt(s.grossProfit)}</span> &nbsp;|&nbsp;
            <span className="font-semibold">Schemes:</span> {fmt(s.totalScheme)} &nbsp;|&nbsp;
            <span className="font-semibold">OPEX:</span> {fmt(s.opex.grandOpex)}
          </div>
          <div className={`font-bold ${s.netProfit >= 0 ? "text-green-700" : "text-red-700"}`}>
            Net Profit = Gross Profit + Scheme − OPEX = {fmt(s.netProfit)}
          </div>
        </div>
      )}

      {/* Statement table */}
      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50">
              <TableHead className="w-8" />
              <TableHead>Description</TableHead>
              <TableHead className="text-right w-44">Amount (PKR)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-zinc-400 py-10">Loading income statement…</TableCell>
              </TableRow>
            ) : !loaded ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-zinc-400 py-10">Select a date range and click Load to generate the Income Statement.</TableCell>
              </TableRow>
            ) : !s ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-zinc-400 py-10">No data for selected period.</TableCell>
              </TableRow>
            ) : (
              <>
                {/* ── A. SALES REVENUE ─────────────────────────────────────────── */}
                <SectionHeader label="A. SALES REVENUE" />
                <DetailRow label={`Total Invoiced Sales (${s.invoiceCount} invoices — includes Advance Tax)`} amount={s.totalSale} color="text-zinc-800" />
                <DetailRow label="Less: Advance Tax Collected (1% WHT — FBR pass-through, deducted from sales)" amount={-s.totalAdvTax} color="text-amber-700" indent negative />
                <DetailRow label="Less: WH Tax (0.1% WH Tax — deducted from sales)" amount={-s.totalWHTax} color="text-amber-700" indent negative />
                <DetailRow label="Net Sales Revenue (Sales separated from Advance & WH Tax)" amount={s.netRevenue} color="text-blue-900" bold />

                {/* ── B. COGS ──────────────────────────────────────────────────── */}
                <SectionHeader label="B. COST OF GOODS SOLD (COGS)" />
                <DetailRow label={`Opening Stock Value (as of ${fromDate})`} amount={s.openingStockValue} color="text-zinc-700" indent />
                <DetailRow label={`Purchases / Sell In Loads (${data?.purchaseLines?.length || 0} POs)`}  amount={s.totalPurchases}    color="text-zinc-700" indent />
                {s.inventoryAdjustments !== 0 && (
                  <DetailRow label={ADJUSTMENTS_LABEL} amount={s.inventoryAdjustments} color="text-amber-700" indent />
                )}
                <DetailRow label={`Closing Stock Value (as of ${toDate})`} amount={s.closingStockValue} color="text-zinc-700" indent negative />
                <TotalRow
                  label={s.inventoryAdjustments !== 0
                    ? "TOTAL COGS (Opening + Purchases + Adjustments − Closing)"
                    : "TOTAL COGS (Opening + Purchases − Closing)"}
                  amount={s.cogs}
                />

                {/* ── GROSS PROFIT ─────────────────────────────────────────────── */}
                <GrossProfitRow label="GROSS PROFIT  (Revenue − COGS)" amount={s.grossProfit} />

                {/* ── C. SCHEME INCOME ─────────────────────────────────────────── */}
                <SectionHeader label="C. OTHER INCOME — CCBPL Schemes & Incentives" />
                {s.schemes.length === 0 ? (
                  <DetailRow label="No scheme income in this period" amount={null} color="text-zinc-400" indent />
                ) : (
                  s.schemes.map((sc: any, i: number) => (
                    <DetailRow key={i} label={sc.description || "Unnamed Scheme"} amount={Number(sc.amount) || 0} color="text-green-700" indent />
                  ))
                )}
                <TotalRow label="TOTAL OTHER INCOME" amount={s.totalScheme} />
                <GrossProfitRow label="TOTAL INCOME  (Gross Profit + Other Income)" amount={s.totalIncome} />

                {/* ── D. OPEX ──────────────────────────────────────────────────── */}
                <SectionHeader label="D. OPERATING EXPENSES (OPEX)" />
                {opexLines.map((line, i) => (
                  <DetailRow key={i} label={line.label} amount={line.amount ?? 0} color="text-red-700" indent />
                ))}
                <TotalRow label="TOTAL OPEX" amount={s.opex.grandOpex} negative />

                {/* ── NET PROFIT ────────────────────────────────────────────────── */}
                <TableRow className="bg-zinc-900 hover:bg-zinc-900">
                  <TableCell colSpan={2} className="font-bold text-white text-base py-3">
                    NET PROFIT  (Pre-Tax) &nbsp;= Total Income − Total OPEX
                  </TableCell>
                  <TableCell className={`text-right text-xl font-bold font-mono py-3 ${s.netProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {fmt(s.netProfit)}
                  </TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
        </>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <TableRow className="bg-zinc-800 hover:bg-zinc-800">
      <TableCell colSpan={3} className="font-bold text-white text-xs tracking-widest uppercase py-2 px-4">
        {label}
      </TableCell>
    </TableRow>
  );
}

function DetailRow({
  label, amount, color = "text-zinc-800", indent = false, bold = false, negative = false,
}: {
  label: string; amount: number | null; color?: string; indent?: boolean; bold?: boolean; negative?: boolean;
}) {
  return (
    <TableRow className="hover:bg-zinc-50/60">
      <TableCell className="w-8" />
      <TableCell className={`text-sm ${indent ? "pl-8" : "pl-4"} ${bold ? "font-semibold" : ""} text-zinc-700`}>
        {label}
      </TableCell>
      <TableCell className={`text-right font-mono ${bold ? "font-bold" : "font-medium"} ${color}`}>
        {amount === null ? "—" : negative ? `(${fmtAbs(amount)})` : fmt(amount)}
      </TableCell>
    </TableRow>
  );
}

function TotalRow({ label, amount, negative = false }: { label: string; amount: number; negative?: boolean }) {
  return (
    <TableRow className="bg-zinc-100 hover:bg-zinc-100 border-t border-zinc-300">
      <TableCell className="w-8" />
      <TableCell className="font-bold text-zinc-900 text-sm">{label}</TableCell>
      <TableCell className="text-right font-bold font-mono text-zinc-900">
        {negative ? `(${fmtAbs(amount)})` : fmt(amount)}
      </TableCell>
    </TableRow>
  );
}

function GrossProfitRow({ label, amount }: { label: string; amount: number }) {
  return (
    <TableRow className={`border-t-2 border-zinc-400 ${amount >= 0 ? "bg-green-50 hover:bg-green-50" : "bg-red-50 hover:bg-red-50"}`}>
      <TableCell className="w-8" />
      <TableCell className="font-bold text-zinc-900">{label}</TableCell>
      <TableCell className={`text-right font-bold text-lg font-mono ${amount >= 0 ? "text-green-700" : "text-red-700"}`}>
        {fmt(amount)}
      </TableCell>
    </TableRow>
  );
}
