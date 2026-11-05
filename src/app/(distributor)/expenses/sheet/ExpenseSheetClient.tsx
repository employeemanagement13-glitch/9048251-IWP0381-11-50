"use client";

import { useState, useTransition, useMemo, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ExpenseSheetExportButtons } from "@/components/export/ExpenseSheetExportButtons";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/Table";
import { getExpenseSheetData } from "@/lib/actions/financial-statements";

const TODAY           = new Date().toISOString().split("T")[0];
const FIRST_OF_MONTH  = `${TODAY.slice(0, 8)}01`;

const fmt = (n: number) =>
  "Rs. " + n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type SheetRow = {
  date:        string;
  sortDate?:   string;
  category:    string;
  description: string;
  paidVia:     string;
  amount:      number;
  isSubRow?:   boolean;
};

/** Build Paid Via label from bank map */
function paidVia(bankAccountId: string | null | undefined, bankMap: Map<string, string>): string {
  if (!bankAccountId) return "—";
  return bankMap.get(bankAccountId) || "—";
}

/** Build expense rows from raw data per the financial architecture spec */
function buildRows(data: Awaited<ReturnType<typeof getExpenseSheetData>>, from: string, to: string): SheetRow[] {
  if (!data) return [];
  const { bills, fuel, maintenance, laborers, payroll, entertainment, petty, penalties, additionalDiscountTotal, unrecoverableLoans, bankMap, vendorMap } = data;

  const rows: SheetRow[] = [];

  // ── Utility Bills ─────────────────────────────────────────────────────────
  // Category: Utility Bills | Description: {bill_name} | Paid Via: bank_account
  for (const b of bills) {
    const d = (b.expense_date || "").slice(0, 10);
    if (d < from || d > to) continue;
    rows.push({
      date:        d,
      category:    "Utility Bills",
      description: b.bill_name?.trim() || "Bill",
      paidVia:     paidVia(b.bank_account_id, bankMap),
      amount:      Number(b.amount) || 0,
    });
  }

  // ── Vehicle Fuel ──────────────────────────────────────────────────────────
  // Description: [truck_no] | [driver_name] | Fuel
  for (const f of fuel) {
    const d = (f.entry_date || "").slice(0, 10);
    if (d < from || d > to) continue;
    const driverPart = f.driver_name ? ` | ${f.driver_name}` : "";
    rows.push({
      date:        d,
      category:    "Vehicle Fuel",
      description: `${f.truck_no || "Truck"}${driverPart} | Fuel`,
      paidVia:     paidVia(f.bank_account_id, bankMap),
      amount:      Number(f.amount) || 0,
    });
  }

  // ── Vehicle Maintenance ───────────────────────────────────────────────────
  // Description: [vehicle_no] | [driver_name] | description
  for (const m of maintenance) {
    const d = (m.entry_date || "").slice(0, 10);
    if (d < from || d > to) continue;
    const driverPart = m.driver_name ? ` | ${m.driver_name}` : "";
    rows.push({
      date:        d,
      category:    "Vehicle Maintenance",
      description: `${m.vehicle_no || "Vehicle"}${driverPart} | Maintenance`,
      paidVia:     paidVia(m.bank_account_id, bankMap),
      amount:      Number(m.amount) || 0,
    });
  }

  // ── Daily Laborers ────────────────────────────────────────────────────────
  // Description: {work description} | Date: from_date (or from_date – to_date)
  for (const l of laborers) {
    const d = (l.from_date || "").slice(0, 10);
    if (d < from || d > to) continue;
    const toD = (l.to_date || "").slice(0, 10);
    const dateLabel = toD && toD !== d ? `${d} – ${toD}` : d;
    rows.push({
      date:        dateLabel,
      sortDate:    d,
      category:    "Daily Laborers",
      description: (l.work || "Laborer Work").trim(),
      paidVia:     paidVia(l.bank_account_id, bankMap),
      amount:      Number(l.amount) || 0,
    });
  }

  // ── Salaries & Payroll (Two-Level Display) ─────────────────────────────────
  // Group by expense_date (batch run date).
  // Summary Row: "Monthly Staff Salaries (N employees)", Paid Via: "—", SUM(net_payable)
  // Detail Rows (↳): each employee with their role, account, and net_payable.
  const payrollByDate = new Map<string, any[]>();
  for (const p of payroll) {
    const d = (p.expense_date || "").slice(0, 10);
    if (d < from || d > to) continue;
    if (!payrollByDate.has(d)) payrollByDate.set(d, []);
    payrollByDate.get(d)!.push(p);
  }

  payrollByDate.forEach((entries, d) => {
    const batchTotal = entries.reduce((s, p) => s + (Number(p.net_payable) || 0), 0);
    // Summary Row
    rows.push({
      date:        d,
      category:    "Salaries & Payroll",
      description: `Monthly Staff Salaries (${entries.length} ${entries.length === 1 ? "employee" : "employees"})`,
      paidVia:     "—",
      amount:      batchTotal,
      isSubRow:    false,
    });

    // Detail Sub-Rows
    for (const p of entries) {
      const emp = Array.isArray(p.employees) ? p.employees[0] : p.employees;
      const empName = emp?.full_name || "Employee";
      const empRole = emp?.role || "";
      const rolePart = empRole ? ` | ${empRole}` : "";
      rows.push({
        date:        d,
        category:    "Salaries & Payroll",
        description: `↳ ${empName}${rolePart}`,
        paidVia:     paidVia(p.bank_account_id, bankMap),
        amount:      Number(p.net_payable) || 0,
        isSubRow:    true,
      });
    }
  });

  // ── Entertainment & Refreshments ──────────────────────────────────────────
  for (const e of entertainment) {
    const d = (e.expense_date || "").slice(0, 10);
    if (d < from || d > to) continue;
    rows.push({
      date:        d,
      category:    "Entertainment & Refreshments",
      description: (e.description || "Entertainment").trim(),
      paidVia:     paidVia(e.bank_account_id, bankMap),
      amount:      Number(e.amount) || 0,
    });
  }

  // ── Petty Cash ────────────────────────────────────────────────────────────
  for (const p of petty) {
    const d = (p.expense_date || "").slice(0, 10);
    if (d < from || d > to) continue;
    rows.push({
      date:        d,
      category:    "Petty Cash",
      description: (p.description || "Petty Cash").trim(),
      paidVia:     paidVia(p.bank_account_id, bankMap),
      amount:      Number(p.amount) || 0,
    });
  }

  // ── Penalties (CCBPL & Agency) ───────────────────────────────────────────
  for (const p of penalties) {
    const d = (p.expense_date || p.penalty_date || "").slice(0, 10);
    const paidVia = p.bank_account_id
      ? bankMap.get(p.bank_account_id) || "Bank"
      : p.source === "agency"
      ? (p.vendor_account_id ? (vendorMap?.get(p.vendor_account_id) || "CCBPL") : "Paid")
      : "Deducted by Co.";
    rows.push({
      date:        d,
      category:    p.source === "agency" ? "Penalties" : "CCBPL Penalties",
      description: (p.description || p.reason || "Penalty").trim(),
      paidVia:     paidVia,
      amount:      Number(p.amount) || 0,
    });
  }

  if ((additionalDiscountTotal ?? 0) > 0) {
    rows.push({
      date:        `${from} \u2013 ${to}`,
      sortDate:    from,
      category:    "Additional Discounts",
      description: "Additional Discount given by Distributor",
      paidVia:     "\u2014",
      amount:      additionalDiscountTotal,
    });
  }

  // ── Unrecoverable Loans ───────────────────────────────────────────────────
  for (const ul of unrecoverableLoans || []) {
    const d = (ul.issued_date || "").slice(0, 10);
    if (d < from || d > to) continue;
    const emp = Array.isArray(ul.employees) ? ul.employees[0] : ul.employees;
    const empName = emp?.full_name || ul.employee_name || "Employee";
    const desc = ul.reason ? `${empName} | ${ul.reason}` : empName;
    const bankId = ul.bank_account_id || ul.override_reason?.match(/\[bank:([a-f0-9\-]+)\]/i)?.[1];
    const pv = paidVia(bankId, bankMap);
    rows.push({
      date:        d,
      category:    "Unrecoverable Loan",
      description: desc,
      paidVia:     pv !== "—" ? pv : "Cash in Hand",
      amount:      Number(ul.expense_amount ?? ul.outstanding_balance ?? ul.principal_amount) || 0,
    });
  }

  // Sort all rows by date ascending, keeping sub-rows right after their summary
  rows.sort((a, b) => {
    const dateA = a.sortDate || a.date;
    const dateB = b.sortDate || b.date;
    const cmp = dateA.localeCompare(dateB);
    if (cmp !== 0) return cmp;
    if (a.isSubRow && !b.isSubRow) return 1;
    if (!a.isSubRow && b.isSubRow) return -1;
    return 0;
  });

  return rows;
}

/** Category badge colours */
const CATEGORY_COLORS: Record<string, string> = {
  "Utility Bills":              "bg-blue-100 text-blue-700",
  "Vehicle Fuel":               "bg-amber-100 text-amber-700",
  "Vehicle Maintenance":        "bg-orange-100 text-orange-700",
  "Daily Laborers":             "bg-purple-100 text-purple-700",
  "Salaries & Payroll":         "bg-red-100 text-red-700",
  "Entertainment & Refreshments": "bg-teal-100 text-teal-700",
  "Petty Cash":                 "bg-zinc-100 text-zinc-700",
  "CCBPL Penalties":            "bg-rose-100 text-rose-700",
  "Penalties":                  "bg-rose-100 text-rose-700",
  "Additional Discounts":       "bg-cyan-100 text-cyan-700",
  "Unrecoverable Loan":         "bg-rose-100 text-rose-800",
};

export function ExpenseSheetClient() {
  const [fromDate, setFromDate] = useState(FIRST_OF_MONTH);
  const [toDate,   setToDate]   = useState(TODAY);
  const [data, setData]         = useState<Awaited<ReturnType<typeof getExpenseSheetData>> | null>(null);
  const [loaded, setLoaded]     = useState(false);
  const [isPending, startTransition] = useTransition();

  // Fetch on mount and when dates change
  const loadData = (from: string, to: string) => {
    startTransition(async () => {
      const result = await getExpenseSheetData(from, to);
      setData(result);
      setLoaded(true);
    });
  };


  const rows = useMemo(() => buildRows(data, fromDate, toDate), [data, fromDate, toDate]);

  // Total OPEX sums ONLY top-level rows (never sub-rows to prevent double counting)
  const grandTotal = useMemo(
    () => rows.reduce((s, r) => (r.isSubRow ? s : s + r.amount), 0),
    [rows]
  );

  // Category subtotals (top-level only)
  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.isSubRow) continue;
      map.set(r.category, (map.get(r.category) || 0) + r.amount);
    }
    return map;
  }, [rows]);


  const handleFromChange = (v: string) => { setFromDate(v); };
  const handleToChange   = (v: string) => { setToDate(v); };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Expense Sheet</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          Operational expense breakdown by category. All entries sourced directly from their respective forms.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-zinc-500">From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => handleFromChange(e.target.value)}
              className="h-9 px-2.5 py-1 text-sm border border-zinc-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-zinc-500">To</span>
            <input
              type="date"
              value={toDate}
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
          <ExpenseSheetExportButtons rows={rows} fromDate={fromDate} toDate={toDate} filename="expense_sheet" />
        </div>

        {rows.length > 0 && (
          <div className="text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-1.5">
            Total OPEX: {fmt(grandTotal)}
          </div>
        )}
      </div>

      {/* Category summary pills */}
      {categoryTotals.size > 0 && (
        <div className="flex flex-wrap gap-2">
          {Array.from(categoryTotals.entries()).map(([cat, total]) => (
            <span
              key={cat}
              className={`text-xs font-semibold px-2.5 py-1 rounded-full ${CATEGORY_COLORS[cat] || "bg-zinc-100 text-zinc-700"}`}
            >
              {cat}: {fmt(total)}
            </span>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50">
              <TableHead className="w-28">Date</TableHead>
              <TableHead className="w-44">Category</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-40">Paid Via</TableHead>
              <TableHead className="text-right w-36">Amount (PKR)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-zinc-400 py-10">
                  Loading expense data…
                </TableCell>
              </TableRow>
            ) : !loaded ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-zinc-400 py-10">
                  Select a date range and click Load to view the Expense Sheet.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-zinc-400 py-10">
                  No expense entries for {fromDate} → {toDate}
                </TableCell>
              </TableRow>
            ) : (
              <>
                {rows.map((r, i) => (
                  <TableRow
                    key={i}
                    className={
                      r.isSubRow
                        ? "bg-zinc-50/50 hover:bg-zinc-100/50"
                        : "hover:bg-zinc-50/60"
                    }
                  >
                    <TableCell className="font-mono text-xs text-zinc-600">
                      {r.isSubRow ? "" : r.date}
                    </TableCell>
                    <TableCell>
                      {r.isSubRow ? (
                        <span className="text-[0.6875rem] text-zinc-400 italic pl-2">
                          ↳ Salary Detail
                        </span>
                      ) : (
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                            CATEGORY_COLORS[r.category] || "bg-zinc-100 text-zinc-700"
                          }`}
                        >
                          {r.category}
                        </span>
                      )}
                    </TableCell>
                    <TableCell
                      className={
                        r.isSubRow
                          ? "text-xs text-zinc-600 pl-6"
                          : "text-sm text-zinc-800"
                      }
                    >
                      {r.description}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500">
                      {r.paidVia}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono ${
                        r.isSubRow
                          ? "text-xs text-zinc-500"
                          : "font-semibold text-red-700"
                      }`}
                    >
                      {fmt(r.amount)}
                    </TableCell>
                  </TableRow>
                ))}
                {/* Grand Total Row */}
                <TableRow className="bg-zinc-900 hover:bg-zinc-900">
                  <TableCell colSpan={4} className="font-bold text-white text-sm">
                    TOTAL OPERATIONAL EXPENSES (OPEX)
                  </TableCell>
                  <TableCell className="text-right font-bold text-lg text-green-400 font-mono">
                    {fmt(grandTotal)}
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
