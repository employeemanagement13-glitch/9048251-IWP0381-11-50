"use client";

import { Document, Page, pdf, StyleSheet, Text, View } from "@react-pdf/renderer";
import { FileSpreadsheet, Printer, Loader2 } from "lucide-react";
import { useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/Button";
import { ensurePoppinsRegistered, formatExportDateTime } from "@/lib/pdf/registerFonts";

export interface BalanceSheetExportData {
  totalAssets: number;
  liquidAccounts: Array<{
    name: string;
    title?: string | null;
    balance: number;
    isCash?: boolean;
  }>;
  totalLiquidAssets: number;
  ccbplDepositAsset: number;
  ccbplSurplusAsset: number;
  tradeReceivables: number;
  debtorShopsCount: number;
  staffLoansReceivable: number;
  activeLoansCount: number;
  deadAssets?: number;
  deadLoansCount?: number;
  closingStockValue: number;
  emptiesStockValue: number;      // Recoverable Empties Stock (separate from beverage stock)
  totalLiabilities: number;
  ccbplTradePayable: number;
  totalEquity: number;
  capitalAndRetainedEarnings: number;
  currentPeriodNetProfit: number;
}

export interface BalanceSheetExportButtonsProps {
  data: BalanceSheetExportData | null;
  asOfDate: string;
  fromDate?: string;
  filename?: string;
}

const styles = StyleSheet.create({
  page: {
    padding: 20,
    fontFamily: "Poppins",
    backgroundColor: "#ffffff",
    fontSize: 7,
    color: "#18181b",
  },
  headerContainer: {
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
    paddingBottom: 5,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 3,
  },
  title: {
    fontSize: 11,
    fontWeight: "bold",
    fontFamily: "Poppins",
    color: "#09090b",
  },
  statusBadge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 3,
    fontSize: 6.5,
    fontWeight: "bold",
    fontFamily: "Poppins",
  },
  badgeBalanced: {
    backgroundColor: "#ecfdf5",
    color: "#047857",
    borderWidth: 0.5,
    borderColor: "#a7f3d0",
  },
  badgeUnbalanced: {
    backgroundColor: "#fffbeb",
    color: "#b45309",
    borderWidth: 0.5,
    borderColor: "#fde68a",
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 7,
    fontFamily: "Poppins",
    color: "#71717a",
  },
  summaryGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 5,
    marginBottom: 6,
  },
  summaryCard: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: "#e4e4e7",
    borderRadius: 3,
    padding: 4,
    backgroundColor: "#fafafa",
  },
  cardLabel: {
    fontSize: 6,
    fontWeight: "bold",
    fontFamily: "Poppins",
    color: "#71717a",
    textTransform: "uppercase",
  },
  cardValue: {
    fontSize: 8.5,
    fontWeight: "bold",
    fontFamily: "Poppins",
    marginTop: 1.5,
  },
  table: {
    borderWidth: 0.5,
    borderColor: "#e4e4e7",
    borderRadius: 3,
    overflow: "hidden",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f4f4f5",
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
    paddingVertical: 3.5,
    paddingHorizontal: 6,
  },
  colItem: {
    width: "48%",
    fontSize: 6.5,
    fontWeight: "bold",
    fontFamily: "Poppins",
    color: "#52525b",
    textTransform: "uppercase",
  },
  colRule: {
    width: "32%",
    fontSize: 6.5,
    fontWeight: "bold",
    fontFamily: "Poppins",
    color: "#52525b",
    textTransform: "uppercase",
  },
  colAmount: {
    width: "20%",
    textAlign: "right",
    fontSize: 6.5,
    fontWeight: "bold",
    fontFamily: "Poppins",
    color: "#52525b",
    textTransform: "uppercase",
    paddingRight: 4,
  },
  sectionHeader: {
    flexDirection: "row",
    backgroundColor: "#18181b",
    paddingVertical: 3.5,
    paddingHorizontal: 6,
    marginTop: 0,
  },
  sectionHeaderText: {
    color: "#ffffff",
    fontSize: 6.5,
    fontWeight: "bold",
    fontFamily: "Poppins",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  subSectionHeader: {
    flexDirection: "row",
    backgroundColor: "#f4f4f5",
    paddingVertical: 2.5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e4e4e7",
  },
  subSectionHeaderText: {
    color: "#27272a",
    fontSize: 6.5,
    fontWeight: "bold",
    fontFamily: "Poppins",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  detailRow: {
    flexDirection: "row",
    paddingVertical: 2.5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#f4f4f5",
    alignItems: "center",
  },
  itemText: {
    width: "48%",
    fontSize: 6.5,
    fontFamily: "Poppins",
    color: "#3f3f46",
    paddingLeft: 8,
  },
  ruleText: {
    width: "32%",
    fontSize: 6,
    color: "#71717a",
    fontFamily: "Poppins",
  },
  amountText: {
    width: "20%",
    textAlign: "right",
    fontFamily: "Poppins",
    fontSize: 6.5,
    color: "#18181b",
    paddingRight: 4,
  },
  subtotalRow: {
    flexDirection: "row",
    backgroundColor: "#fafafa",
    borderTopWidth: 0.5,
    borderTopColor: "#e4e4e7",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e4e4e7",
    paddingVertical: 3,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  subtotalItem: {
    width: "48%",
    fontSize: 7,
    fontWeight: "bold",
    fontFamily: "Poppins",
    color: "#3f3f46",
    paddingLeft: 8,
  },
  subtotalRule: {
    width: "32%",
  },
  subtotalAmount: {
    width: "20%",
    textAlign: "right",
    fontFamily: "Poppins",
    fontSize: 7,
    fontWeight: "bold",
    color: "#18181b",
    paddingRight: 4,
  },
  totalAssetsRow: {
    flexDirection: "row",
    backgroundColor: "#eff6ff",
    borderTopWidth: 1.5,
    borderTopColor: "#93c5fd",
    borderBottomWidth: 1,
    borderBottomColor: "#93c5fd",
    paddingVertical: 3.5,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  totalAssetsLabel: {
    width: "48%",
    fontSize: 7.5,
    fontWeight: "bold",
    fontFamily: "Poppins",
    color: "#1e3a8a",
  },
  totalAssetsRule: {
    width: "32%",
    fontSize: 6,
    color: "#2563eb",
    fontFamily: "Poppins",
  },
  totalAssetsAmount: {
    width: "20%",
    textAlign: "right",
    fontFamily: "Poppins",
    fontSize: 7.5,
    fontWeight: "bold",
    color: "#1e3a8a",
    paddingRight: 4,
  },
  totalLiabilitiesRow: {
    flexDirection: "row",
    backgroundColor: "#fef2f2",
    borderTopWidth: 1.5,
    borderTopColor: "#fca5a5",
    borderBottomWidth: 1,
    borderBottomColor: "#fca5a5",
    paddingVertical: 3.5,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  totalLiabilitiesLabel: {
    width: "48%",
    fontSize: 7.5,
    fontWeight: "bold",
    fontFamily: "Poppins",
    color: "#991b1b",
  },
  totalLiabilitiesRule: {
    width: "32%",
    fontSize: 6,
    color: "#dc2626",
    fontFamily: "Poppins",
  },
  totalLiabilitiesAmount: {
    width: "20%",
    textAlign: "right",
    fontFamily: "Poppins",
    fontSize: 7.5,
    fontWeight: "bold",
    color: "#991b1b",
    paddingRight: 4,
  },
  totalEquityRow: {
    flexDirection: "row",
    backgroundColor: "#064e3b",
    borderTopWidth: 1.5,
    borderTopColor: "#047857",
    paddingVertical: 4.5,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  totalEquityLabel: {
    width: "48%",
    fontSize: 7.5,
    fontWeight: "bold",
    fontFamily: "Poppins",
    color: "#ffffff",
    letterSpacing: 0.5,
  },
  totalEquityRule: {
    width: "32%",
    fontSize: 6.5,
    color: "#6ee7b7",
    fontFamily: "Poppins",
  },
  totalEquityAmount: {
    width: "20%",
    textAlign: "right",
    fontFamily: "Poppins",
    fontSize: 7.5,
    fontWeight: "bold",
    color: "#6ee7b7",
    paddingRight: 4,
  },
  grandTotalRow: {
    flexDirection: "row",
    backgroundColor: "#18181b",
    borderTopWidth: 1.5,
    borderTopColor: "#09090b",
    paddingVertical: 5,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  grandTotalLabel: {
    width: "48%",
    fontSize: 7.5,
    fontWeight: "bold",
    fontFamily: "Poppins",
    color: "#ffffff",
  },
  grandTotalRule: {
    width: "32%",
    fontSize: 6,
    color: "#a1a1aa",
    fontFamily: "Poppins",
  },
  grandTotalAmount: {
    width: "20%",
    textAlign: "right",
    fontFamily: "Poppins",
    fontSize: 8.5,
    fontWeight: "bold",
    color: "#4ade80",
    paddingRight: 4,
  },
});

function fmt(n: number) {
  return "Rs. " + Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function BalanceSheetPdfDocument({
  data,
  asOfDate,
  fromDate,
}: {
  data: BalanceSheetExportData;
  asOfDate: string;
  fromDate?: string;
}) {
  ensurePoppinsRegistered();
  const d = data;
  const isBalanced = Math.abs(d.totalAssets - (d.totalLiabilities + d.totalEquity)) < 0.01;
  const exportTimeStr = formatExportDateTime();

  return (
    <Document>
      <Page size="A4" orientation="portrait" style={styles.page}>
        {/* Header Banner */}
        <View style={styles.headerContainer}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Balance Sheet</Text>
            <View style={[styles.statusBadge, isBalanced ? styles.badgeBalanced : styles.badgeUnbalanced]}>
              <Text>{isBalanced ? "✓ Balanced (Assets = Liabilities + Equity)" : "⚠ Out of Balance"}</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <Text>Statement of Financial Position | {fromDate ? `P&L Period: ${fromDate} to ${asOfDate} • ` : ""}As of Date: {asOfDate} • Exported: {exportTimeStr}</Text>
            <Text>Distroline DMS</Text>
          </View>
        </View>

        {/* 3 Summary Cards */}
        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}>
            <Text style={styles.cardLabel}>Total Assets</Text>
            <Text style={[styles.cardValue, { color: "#09090b" }]}>{fmt(d.totalAssets)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.cardLabel}>Total Liabilities</Text>
            <Text style={[styles.cardValue, { color: "#dc2626" }]}>{fmt(d.totalLiabilities)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.cardLabel}>Owner&apos;s Equity (Net Worth)</Text>
            <Text style={[styles.cardValue, { color: d.totalEquity >= 0 ? "#059669" : "#dc2626" }]}>{fmt(d.totalEquity)}</Text>
          </View>
        </View>

        {/* Balance Sheet Table */}
        <View style={styles.table}>
          {/* Table Header */}
          <View style={styles.tableHeader}>
            <Text style={styles.colItem}>Balance Sheet Item</Text>
            <Text style={styles.colRule}>Extraction Rule / Source</Text>
            <Text style={styles.colAmount}>Amount (PKR)</Text>
          </View>

          {/* ── 1. ASSETS ── */}
          <View style={styles.sectionHeader} wrap={false}>
            <Text style={styles.sectionHeaderText}>1. ASSETS (WHAT MDOS OWNS)</Text>
          </View>

          {/* A. Liquid Assets */}
          <View style={styles.subSectionHeader} wrap={false}>
            <Text style={styles.subSectionHeaderText}>A. LIQUID ASSETS — CASH & BANK</Text>
          </View>
          {d.liquidAccounts.map((a, i) => (
            <View key={i} style={styles.detailRow} wrap={false}>
              <Text style={styles.itemText}>
                {a.name} {a.title && a.title !== a.name ? `(${a.title})` : ""}
              </Text>
              <Text style={styles.ruleText}>{a.isCash ? "bank_accounts (cash)" : "bank_accounts (active)"}</Text>
              <Text style={styles.amountText}>{fmt(a.balance)}</Text>
            </View>
          ))}
          <View style={styles.subtotalRow} wrap={false}>
            <Text style={styles.subtotalItem}>Total Cash & Bank</Text>
            <Text style={styles.subtotalRule} />
            <Text style={styles.subtotalAmount}>{fmt(d.totalLiquidAssets)}</Text>
          </View>

          {/* B. Trade Receivables */}
          <View style={styles.subSectionHeader} wrap={false}>
            <Text style={styles.subSectionHeaderText}>B. TRADE RECEIVABLES</Text>
          </View>
          <View style={styles.detailRow} wrap={false}>
            <Text style={styles.itemText}>Market Credit Due from Retail Outlets ({d.debtorShopsCount} shops)</Text>
            <Text style={styles.ruleText}>SUM(credit invoices: grand_total - amount_received)</Text>
            <Text style={styles.amountText}>{fmt(d.tradeReceivables)}</Text>
          </View>

          {/* C. Staff Loans */}
          <View style={styles.subSectionHeader} wrap={false}>
            <Text style={styles.subSectionHeaderText}>C. STAFF LOANS RECEIVABLE</Text>
          </View>
          <View style={styles.detailRow} wrap={false}>
            <Text style={styles.itemText}>Employee Loans Outstanding ({d.activeLoansCount} active loans)</Text>
            <Text style={styles.ruleText}>SUM(employee_loans.outstanding_balance)</Text>
            <Text style={styles.amountText}>{fmt(d.staffLoansReceivable)}</Text>
          </View>

          {/* D. Warehouse Inventory */}
          <View style={styles.subSectionHeader} wrap={false}>
            <Text style={styles.subSectionHeaderText}>D. WAREHOUSE INVENTORY (CLOSING STOCK)</Text>
          </View>
          <View style={styles.detailRow} wrap={false}>
            <Text style={styles.itemText}>Beverage Stock Valuation at Cost</Text>
            <Text style={styles.ruleText}>Acquisition cost (std + RGB products)</Text>
            <Text style={styles.amountText}>{fmt(d.closingStockValue)}</Text>
          </View>
          <View style={styles.detailRow} wrap={false}>
            <Text style={styles.itemText}>Empties / Recoverable Stock Valuation at Cost</Text>
            <Text style={styles.ruleText}>empties_levels × purchase_rate (is_returnable/implied)</Text>
            <Text style={[styles.amountText, { color: "#4f46e5" }]}>{fmt(d.emptiesStockValue)}</Text>
          </View>

          {/* E. Dead Assets */}
          <View style={styles.subSectionHeader} wrap={false}>
            <Text style={styles.subSectionHeaderText}>E. DEAD ASSETS</Text>
          </View>
          <View style={styles.detailRow} wrap={false}>
            <Text style={styles.itemText}>Unrecoverable Staff Loans ({d.deadLoansCount || 0} loans)</Text>
            <Text style={styles.ruleText}>SUM(unrecoverable employee_loans)</Text>
            <Text style={styles.amountText}>{fmt(d.deadAssets || 0)}</Text>
          </View>

          {/* TOTAL ASSETS */}
          <View style={styles.totalAssetsRow} wrap={false}>
            <Text style={styles.totalAssetsLabel}>TOTAL ASSETS</Text>
            <Text style={styles.totalAssetsRule}>Liquid + Receivables + Loans + Beverage Stock + Empties + Dead Assets</Text>
            <Text style={styles.totalAssetsAmount}>{fmt(d.totalAssets)}</Text>
          </View>

          {/* ── 2. LIABILITIES ── */}
          <View style={styles.sectionHeader} wrap={false}>
            <Text style={styles.sectionHeaderText}>2. LIABILITIES (WHAT YOU OWES)</Text>
          </View>
          <View style={styles.subSectionHeader} wrap={false}>
            <Text style={styles.subSectionHeaderText}>F. CURRENT LIABILITIES</Text>
          </View>
          <View style={styles.detailRow} wrap={false}>
            <Text style={styles.itemText}>CCBPL Trade Payable</Text>
            <Text style={styles.ruleText}>Used ({fmt((d as any).ccbplUsed || 0)}) − Guarantee ({fmt((d as any).guaranteeAmount || 0)})</Text>
            <Text style={[styles.amountText, { color: "#dc2626" }]}>{fmt(d.ccbplTradePayable)}</Text>
          </View>
          <View style={styles.totalLiabilitiesRow} wrap={false}>
            <Text style={styles.totalLiabilitiesLabel}>TOTAL LIABILITIES</Text>
            <Text style={styles.totalLiabilitiesRule}>CCBPL Trade Payables</Text>
            <Text style={styles.totalLiabilitiesAmount}>{fmt(d.totalLiabilities)}</Text>
          </View>

          {/* ── 3. OWNER'S EQUITY (NET WORTH) ── */}
          <View style={styles.sectionHeader} wrap={false}>
            <Text style={styles.sectionHeaderText}>3. OWNER&apos;S EQUITY (NET WORTH)</Text>
          </View>
          <View style={styles.detailRow} wrap={false}>
            <Text style={styles.itemText}>Capital &amp; Prior Retained Earnings</Text>
            <Text style={styles.ruleText}>Total Equity − Current Period Net Profit</Text>
            <Text style={styles.amountText}>{fmt(d.capitalAndRetainedEarnings)}</Text>
          </View>
          <View style={styles.detailRow} wrap={false}>
            <Text style={styles.itemText}>Current Period Net Profit ({fromDate ? `${fromDate} to ${asOfDate}` : "Current Period"})</Text>
            <Text style={styles.ruleText}>From Income Statement (P&amp;L)</Text>
            <Text style={[styles.amountText, { color: d.currentPeriodNetProfit >= 0 ? "#059669" : "#dc2626" }]}>{fmt(d.currentPeriodNetProfit)}</Text>
          </View>
          <View style={styles.totalEquityRow} wrap={false}>
            <Text style={styles.totalEquityLabel}>TOTAL OWNER&apos;S EQUITY</Text>
            <Text style={styles.totalEquityRule}>Assets − Liabilities</Text>
            <Text style={[styles.totalEquityAmount, { color: d.totalEquity >= 0 ? "#6ee7b7" : "#fca5a5" }]}>{fmt(d.totalEquity)}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export function BalanceSheetExportButtons({
  data,
  asOfDate,
  fromDate,
  filename = "balance_sheet",
}: BalanceSheetExportButtonsProps) {
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [isExcelLoading, setIsExcelLoading] = useState(false);

  const fileNameSuffix = fromDate ? `${fromDate}_to_${asOfDate}` : `as_of_${asOfDate}`;

  const handleExportPdf = async () => {
    if (!data) return;
    try {
      setIsPdfLoading(true);
      await ensurePoppinsRegistered();
      const doc = (
        <BalanceSheetPdfDocument
          data={data}
          asOfDate={asOfDate}
          fromDate={fromDate}
        />
      );
      const blob = await pdf(doc).toBlob();
      downloadBlob(blob, `${sanitizeFileName(filename)}_${fileNameSuffix}.pdf`);
    } catch (err) {
      console.error("Balance sheet PDF export failed:", err);
    } finally {
      setIsPdfLoading(false);
    }
  };

  const handleExportExcel = () => {
    if (!data) return;
    try {
      setIsExcelLoading(true);
      const rows: Array<Record<string, unknown>> = [
        ...data.liquidAccounts.map((a) => ({
          Classification: "1. ASSET",
          Section: "Liquid Assets",
          Item: a.name + (a.title && a.title !== a.name ? ` (${a.title})` : ""),
          Source: a.isCash ? "bank_accounts (cash)" : "bank_accounts (active)",
          Amount: a.balance,
        })),
        {
          Classification: "1. ASSET",
          Section: "Liquid Assets",
          Item: "Total Cash & Bank",
          Source: "SUM(liquid_accounts)",
          Amount: data.totalLiquidAssets,
        },
        {
          Classification: "1. ASSET",
          Section: "Trade Receivables",
          Item: `Due from Retail Outlets (${data.debtorShopsCount} shops)`,
          Source: "SUM(credit invoices: grand_total - amount_received)",
          Amount: data.tradeReceivables,
        },
        {
          Classification: "1. ASSET",
          Section: "Staff Loans",
          Item: `Employee Loans Receivable (${data.activeLoansCount} active loans)`,
          Source: "SUM(employee_loans.outstanding_balance)",
          Amount: data.staffLoansReceivable,
        },
        {
          Classification: "1. ASSET",
          Section: "Inventory",
          Item: "Beverage Stock Valuation at Cost",
          Source: "Acquisition cost (std + RGB products)",
          Amount: data.closingStockValue,
        },
        {
          Classification: "1. ASSET",
          Section: "Inventory",
          Item: "Empties / Recoverable Stock Valuation at Cost",
          Source: "empties_levels × purchase_rate (is_returnable/implied)",
          Amount: data.emptiesStockValue,
        },
        {
          Classification: "1. ASSET",
          Section: "E. Dead Assets",
          Item: `Unrecoverable Staff Loans (${data.deadLoansCount || 0} loans)`,
          Source: "SUM(unrecoverable employee_loans)",
          Amount: data.deadAssets || 0,
        },
        {
          Classification: "1. ASSET",
          Section: "TOTAL ASSETS",
          Item: "Total Assets",
          Source: "Liquid + Receivables + Loans + Beverage Stock + Empties + Dead Assets",
          Amount: data.totalAssets,
        },
        {
          Classification: "2. LIABILITY",
          Section: "F. Current Liabilities",
          Item: "CCBPL Trade Payable",
          Source: `Used (${Number((data as any).ccbplUsed || 0).toLocaleString()}) − Guarantee (${Number((data as any).guaranteeAmount || 0).toLocaleString()})`,
          Amount: data.ccbplTradePayable,
        },
        {
          Classification: "2. LIABILITY",
          Section: "TOTAL LIABILITIES",
          Item: "Total Liabilities",
          Source: "CCBPL Trade Payables",
          Amount: data.totalLiabilities,
        },
        {
          Classification: "3. EQUITY",
          Section: "Owner's Equity Breakdown",
          Item: "Capital & Prior Retained Earnings",
          Source: "Total Equity − Current Period Net Profit",
          Amount: data.capitalAndRetainedEarnings,
        },
        {
          Classification: "3. EQUITY",
          Section: "Owner's Equity Breakdown",
          Item: `Current Period Net Profit (${fromDate ? `${fromDate} to ${asOfDate}` : "Current Period"})`,
          Source: "Income Statement Net Profit",
          Amount: data.currentPeriodNetProfit,
        },
        {
          Classification: "3. EQUITY",
          Section: "TOTAL OWNER'S EQUITY",
          Item: "Total Owner's Equity (Net Worth)",
          Source: "Assets − Liabilities",
          Amount: data.totalEquity,
        }
      ];

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Balance Sheet");
      XLSX.writeFile(wb, `${sanitizeFileName(filename)}_${fileNameSuffix}.xlsx`);
    } catch (err) {
      console.error("Balance sheet Excel export failed:", err);
    } finally {
      setIsExcelLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={handleExportPdf}
        disabled={!data || isPdfLoading || isExcelLoading}
        className="h-9 px-3 gap-1.5 text-xs font-semibold text-zinc-700 hover:text-zinc-900 border-zinc-200 hover:bg-zinc-50"
      >
        {isPdfLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-600" />
        ) : (
          <Printer className="h-3.5 w-3.5 text-zinc-600" />
        )}
        <span>Print PDF</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={handleExportExcel}
        disabled={!data || isPdfLoading || isExcelLoading}
        className="h-9 px-3 gap-1.5 text-xs font-semibold text-zinc-700 hover:text-zinc-900 border-zinc-200 hover:bg-zinc-50"
      >
        {isExcelLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
        ) : (
          <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
        )}
        <span>Export Excel</span>
      </Button>
    </div>
  );
}
