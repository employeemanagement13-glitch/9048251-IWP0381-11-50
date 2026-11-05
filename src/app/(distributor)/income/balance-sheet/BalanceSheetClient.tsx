"use client";

import { useState, useTransition, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { BalanceSheetExportButtons } from "@/components/export/BalanceSheetExportButtons";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/Table";
import { getBalanceSheetData } from "@/lib/actions/financial-statements";

const TODAY = new Date().toISOString().split("T")[0];
const FIRST_OF_MONTH = `${TODAY.slice(0, 8)}01`;

const fmt = (n: number) =>
  "Rs. " + n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });


export function BalanceSheetClient() {
  const [fromDate, setFromDate] = useState(FIRST_OF_MONTH);
  const [asOfDate, setAsOfDate] = useState(TODAY);
  const [data, setData] = useState<Awaited<ReturnType<typeof getBalanceSheetData>> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();

  const loadData = (to: string, from: string) => {
    startTransition(async () => {
      const res = await getBalanceSheetData(to, from);
      setData(res);
      setLoaded(true);
    });
  };

  const d = data;
  const isBalanced = d ? Math.abs(d.totalAssets - (d.totalLiabilities + d.totalEquity)) < 0.01 : false;


  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Balance Sheet</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          Statement of Financial Position — Assets, Liabilities, and Owner&apos;s Equity.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-zinc-500">Period From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-9 px-2.5 py-1 text-sm border border-zinc-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-zinc-500">As of Date</span>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="h-9 px-2.5 py-1 text-sm border border-zinc-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-zinc-400"
            />
          </div>
          <Button
            size="sm"
            onClick={() => loadData(asOfDate, fromDate)}
            disabled={isPending}
            className="flex items-center gap-1 h-9 px-3"
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>Load</span>
          </Button>
          <BalanceSheetExportButtons
            data={d}
            asOfDate={asOfDate}
            fromDate={fromDate}
            filename="balance_sheet"
          />
        </div>

        {d && (
          <div className="flex items-center gap-2">
            <div
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
                isBalanced
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-amber-50 text-amber-700 border-amber-200"
              }`}
            >
              {isBalanced ? "✓ Balanced (Assets = Liabilities + Equity)" : "⚠ Out of Balance"}
            </div>
          </div>
        )}
      </div>

      {d && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-white rounded-lg border border-zinc-200 shadow-sm">
            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Total Assets</div>
            <div className="text-xl font-bold font-mono text-zinc-900 mt-1">{fmt(d.totalAssets)}</div>
            <div className="text-xs text-zinc-400 mt-1">Liquid + CCBPL + Credit + Stock + Dead Assets</div>
          </div>
          <div className="p-4 bg-white rounded-lg border border-zinc-200 shadow-sm">
            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Total Liabilities</div>
            <div className="text-xl font-bold font-mono text-red-600 mt-1">{fmt(d.totalLiabilities)}</div>
            <div className="text-xs text-zinc-400 mt-1">CCBPL Trade Payables</div>
          </div>
          <div className="p-4 bg-white rounded-lg border border-zinc-200 shadow-sm">
            <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider"> OWNER&apos;S EQUITY (NET WORTH)</div>
            <div className={`text-xl font-bold font-mono mt-1 ${d.totalEquity >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt(d.totalEquity)}</div>
            <div className="text-xs text-zinc-400 mt-1">
              Capital + P&amp;L Net Profit ({fmt(d.currentPeriodNetProfit)})
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50">
              <TableHead className="w-8" />
              <TableHead>Balance Sheet Item</TableHead>
              <TableHead className="w-64 text-zinc-500 text-xs">Extraction Rule / Source</TableHead>
              <TableHead className="text-right w-48">Amount (PKR)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-zinc-400 py-10">
                  Loading balance sheet…
                </TableCell>
              </TableRow>
            ) : !loaded ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-zinc-400 py-10">
                  Select Period From &amp; As of Date, then click Load to generate the Balance Sheet.
                </TableCell>
              </TableRow>
            ) : !d ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-zinc-400 py-10">
                  No balance sheet data available.
                </TableCell>
              </TableRow>
            ) : (
              <>
                <TableRow className="bg-zinc-800 hover:bg-zinc-800">
                  <TableCell colSpan={4} className="font-bold text-white text-xs tracking-widest uppercase py-2 px-4">
                    1. ASSETS (What MDOS Owns)
                  </TableCell>
                </TableRow>

                <TableRow className="bg-zinc-100 hover:bg-zinc-100">
                  <TableCell className="w-8" />
                  <TableCell colSpan={3} className="font-semibold text-zinc-800 text-xs uppercase tracking-wider">
                    A. Liquid Assets — Cash &amp; Bank
                  </TableCell>
                </TableRow>
                {d.liquidAccounts.map((a, i) => (
                  <TableRow key={i} className="hover:bg-zinc-50/60">
                    <TableCell className="w-8" />
                    <TableCell className="text-sm pl-8 text-zinc-700">
                      {a.name} {a.title && a.title !== a.name ? <span className="text-zinc-400">({a.title})</span> : null}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-400 font-mono">
                      {a.isCash ? "bank_accounts (cash)" : "bank_accounts (active)"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-medium text-zinc-800">
                      {fmt(a.balance)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-zinc-50 border-t border-zinc-200">
                  <TableCell className="w-8" />
                  <TableCell className="font-semibold text-xs text-zinc-700 pl-8">Total Cash &amp; Bank</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-mono font-bold text-sm text-zinc-900">
                    {fmt(d.totalLiquidAssets)}
                  </TableCell>
                </TableRow>

                <TableRow className="bg-zinc-100 hover:bg-zinc-100">
                  <TableCell className="w-8" />
                  <TableCell colSpan={3} className="font-semibold text-zinc-800 text-xs uppercase tracking-wider">
                    B. Trade Receivables
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-zinc-50/60">
                  <TableCell className="w-8" />
                  <TableCell className="text-sm pl-8 text-zinc-700">
                    Market Credit Due from Retail Outlets ({d.debtorShopsCount} shops)
                  </TableCell>
                  <TableCell className="text-xs text-zinc-400 font-mono">
                    SUM(credit invoices: grand_total - amount_received)
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium text-zinc-800">
                    {fmt(d.tradeReceivables)}
                  </TableCell>
                </TableRow>

                <TableRow className="bg-zinc-100 hover:bg-zinc-100">
                  <TableCell className="w-8" />
                  <TableCell colSpan={3} className="font-semibold text-zinc-800 text-xs uppercase tracking-wider">
                    C. Staff Loans Receivable
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-zinc-50/60">
                  <TableCell className="w-8" />
                  <TableCell className="text-sm pl-8 text-zinc-700">
                    Employee Loans Outstanding ({d.activeLoansCount} active loans)
                  </TableCell>
                  <TableCell className="text-xs text-zinc-400 font-mono">
                    SUM(employee_loans.outstanding_balance)
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium text-zinc-800">
                    {fmt(d.staffLoansReceivable)}
                  </TableCell>
                </TableRow>

                <TableRow className="bg-zinc-100 hover:bg-zinc-100">
                  <TableCell className="w-8" />
                  <TableCell colSpan={3} className="font-semibold text-zinc-800 text-xs uppercase tracking-wider">
                    D. Warehouse Inventory (Closing Stock)
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-zinc-50/60">
                  <TableCell className="w-8" />
                  <TableCell className="text-sm pl-8 text-zinc-700">
                    Beverage Stock Valuation at Cost ({d.periodFromDate || fromDate} to {d.asOfDate || asOfDate})
                  </TableCell>
                  <TableCell className="text-xs text-zinc-400 font-mono">
                    FIFO Valuation matching Income Statement Closing Stock
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium text-zinc-800">
                    {fmt(d.closingStockValue)}
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-zinc-50/60">
                  <TableCell className="w-8" />
                  <TableCell className="text-sm pl-8 text-zinc-700">
                    Empties / Recoverable Stock Valuation at Cost
                  </TableCell>
                  <TableCell className="text-xs text-zinc-400 font-mono">
                    warehouse_empties_levels × purchase_rate (is_rgb=false, is_returnable/implied=true)
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium text-indigo-700">
                    {fmt(d.emptiesStockValue)}
                  </TableCell>
                </TableRow>

                <TableRow className="bg-zinc-100 hover:bg-zinc-100">
                  <TableCell className="w-8" />
                  <TableCell colSpan={3} className="font-semibold text-zinc-800 text-xs uppercase tracking-wider">
                    E. Dead Assets
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-zinc-50/60">
                  <TableCell className="w-8" />
                  <TableCell className="text-sm pl-8 text-zinc-700">
                    Unrecoverable Staff Loans ({d.deadLoansCount || 0} loans)
                  </TableCell>
                  <TableCell className="text-xs text-zinc-400 font-mono">
                    SUM(unrecoverable employee_loans)
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium text-zinc-800">
                    {fmt(d.deadAssets || 0)}
                  </TableCell>
                </TableRow>

                <TableRow className="bg-blue-50/80 hover:bg-blue-50 border-t-2 border-blue-200">
                  <TableCell className="w-8" />
                  <TableCell className="font-bold text-blue-950 text-sm">TOTAL ASSETS</TableCell>
                  <TableCell className="text-xs text-blue-700 font-mono">Liquid + Receivables + Loans + Beverage Stock + Empties + Dead Assets</TableCell>
                  <TableCell className="text-right font-mono font-bold text-base text-blue-950">
                    {fmt(d.totalAssets)}
                  </TableCell>
                </TableRow>

                <TableRow className="bg-zinc-800 hover:bg-zinc-800">
                  <TableCell colSpan={4} className="font-bold text-white text-xs tracking-widest uppercase py-2 px-4">
                    2. LIABILITIES (What YOU Owes)
                  </TableCell>
                </TableRow>

                <TableRow className="bg-zinc-100 hover:bg-zinc-100">
                  <TableCell className="w-8" />
                  <TableCell colSpan={3} className="font-semibold text-zinc-800 text-xs uppercase tracking-wider">
                    F. Current Liabilities
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-zinc-50/60">
                  <TableCell className="w-8" />
                  <TableCell className="text-sm pl-8 text-zinc-700">
                    CCBPL Trade Payable
                  </TableCell>
                  <TableCell className="text-xs text-zinc-400 font-mono">
                    Used ({fmt(d.ccbplUsed || 0)}) − Guarantee ({fmt(d.guaranteeAmount || 0)})
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium text-red-600">
                    {fmt(d.ccbplTradePayable)}
                  </TableCell>
                </TableRow>
                <TableRow className="bg-red-50/80 hover:bg-red-50 border-t border-red-200">
                  <TableCell className="w-8" />
                  <TableCell className="font-bold text-red-950 text-sm">TOTAL LIABILITIES</TableCell>
                  <TableCell className="text-xs text-red-700 font-mono">CCBPL Trade Payables</TableCell>
                  <TableCell className="text-right font-mono font-bold text-base text-red-950">
                    {fmt(d.totalLiabilities)}
                  </TableCell>
                </TableRow>

                <TableRow className="bg-zinc-800 hover:bg-zinc-800">
                  <TableCell colSpan={4} className="font-bold text-white text-xs tracking-widest uppercase py-2 px-4">
                    3. OWNER&apos;S EQUITY (NET WORTH)
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-zinc-50/60">
                  <TableCell className="w-8" />
                  <TableCell className="text-sm pl-8 text-zinc-700">
                    Capital &amp; Prior Retained Earnings
                  </TableCell>
                  <TableCell className="text-xs text-zinc-400 font-mono">
                    Total Equity − Current Period Net Profit
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium text-zinc-800">
                    {fmt(d.capitalAndRetainedEarnings)}
                  </TableCell>
                </TableRow>
                <TableRow className="hover:bg-zinc-50/60">
                  <TableCell className="w-8" />
                  <TableCell className="text-sm pl-8 text-zinc-700">
                    Current Period Net Profit ({d.periodFromDate || fromDate} to {d.asOfDate || asOfDate})
                  </TableCell>
                  <TableCell className="text-xs text-zinc-400 font-mono">
                    From Income Statement (P&amp;L)
                  </TableCell>
                  <TableCell className={`text-right font-mono text-sm font-medium ${d.currentPeriodNetProfit >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                    {fmt(d.currentPeriodNetProfit)}
                  </TableCell>
                </TableRow>
                <TableRow className="bg-emerald-900 hover:bg-emerald-900 border-t-2 border-emerald-700">
                  <TableCell colSpan={2} className="font-bold text-white text-xs sm:text-sm tracking-wide uppercase py-3 px-4">
                    TOTAL OWNER&apos;S EQUITY (NET WORTH)
                  </TableCell>
                  <TableCell className="text-xs text-emerald-300 font-mono py-3">
                    Assets − Liabilities
                  </TableCell>
                  <TableCell className={`text-right font-mono font-bold text-lg py-3 pr-4 ${d.totalEquity >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                    {fmt(d.totalEquity)}
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
