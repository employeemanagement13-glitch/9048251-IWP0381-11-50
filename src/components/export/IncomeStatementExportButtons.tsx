"use client";

import { Document, Page, pdf, StyleSheet, Text, View } from "@react-pdf/renderer";
import { FileSpreadsheet, Printer, Loader2 } from "lucide-react";
import { useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/Button";
import { ensurePoppinsRegistered, formatExportDateTime } from "@/lib/pdf/registerFonts";

export interface IncomeStatementExportData {
  totalSale?: number;
  grossRevenue: number;
  totalAdvTax: number;
  totalWHTax?: number;
  netRevenue?: number;
  totalRevenue: number;
  openingStockValue: number;
  totalPurchases: number;
  closingStockValue: number;
  /**
   * Stock movements that are neither a sale nor a purchase order — a stock report entered
   * mid-period, a write-off, or goods sold that were never recorded as received. Omitted
   * from the statement when zero.
   */
  inventoryAdjustments?: number;
  cogs: number;
  grossProfit: number;
  schemes: Array<{ description?: string; amount: number }>;
  totalScheme: number;
  totalIncome: number;
  opex: {
    totalBills: number;
    totalFuel: number;
    totalMaint: number;
    totalLaborers: number;
    totalSalary: number;
    totalEnt: number;
    totalPetty: number;
    totalPenalties: number;
    totalDiscounts: number;
    grandOpex: number;
  };
  netProfit: number;
  invoiceCount: number;
  purchaseLinesCount?: number;
}

export interface StatementDetailLine {
  label: string;
  amount: number | null;
  indent?: boolean;
  color?: string;
  negative?: boolean;
}

export interface IncomeStatementExportButtonsProps {
  statement: IncomeStatementExportData | null;
  opexLines: StatementDetailLine[];
  fromDate: string;
  toDate: string;
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
  netProfitBadge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 3,
    fontSize: 7,
    fontWeight: "bold",
    fontFamily: "Poppins",
  },
  badgeGreen: {
    backgroundColor: "#f0fdf4",
    color: "#15803d",
    borderWidth: 0.5,
    borderColor: "#bbf7d0",
  },
  badgeRed: {
    backgroundColor: "#fef2f2",
    color: "#b91c1c",
    borderWidth: 0.5,
    borderColor: "#fecaca",
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 7,
    fontFamily: "Poppins",
    color: "#71717a",
  },
  formulaBox: {
    backgroundColor: "#f8fafc",
    borderWidth: 0.5,
    borderColor: "#e2e8f0",
    borderRadius: 3,
    padding: 4,
    marginBottom: 6,
    fontSize: 6.5,
    fontFamily: "Poppins",
    color: "#475569",
  },
  formulaLine: {
    marginBottom: 1,
    fontFamily: "Poppins",
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
  colDesc: {
    width: "74%",
    fontSize: 6.5,
    fontWeight: "bold",
    fontFamily: "Poppins",
    color: "#52525b",
    textTransform: "uppercase",
  },
  colAmount: {
    width: "26%",
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
  detailRow: {
    flexDirection: "row",
    paddingVertical: 2.5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#f4f4f5",
    alignItems: "center",
  },
  descText: {
    width: "74%",
    fontSize: 6.5,
    fontFamily: "Poppins",
    color: "#3f3f46",
  },
  descTextIndent: {
    width: "74%",
    fontSize: 6.5,
    fontFamily: "Poppins",
    color: "#3f3f46",
    paddingLeft: 12,
  },
  descTextBold: {
    fontWeight: "bold",
    fontFamily: "Poppins",
    color: "#18181b",
  },
  amountText: {
    width: "26%",
    textAlign: "right",
    fontFamily: "Poppins",
    fontSize: 6.5,
    color: "#18181b",
    paddingRight: 4,
  },
  amountTextBold: {
    fontFamily: "Poppins",
    fontWeight: "bold",
    color: "#18181b",
  },
  amountTextBlue: {
    color: "#1d4ed8",
  },
  amountTextMuted: {
    color: "#71717a",
  },
  amountTextRed: {
    color: "#b91c1c",
  },
  amountTextGreen: {
    color: "#15803d",
  },
  totalRow: {
    flexDirection: "row",
    backgroundColor: "#f4f4f5",
    borderTopWidth: 1,
    borderTopColor: "#d4d4d8",
    borderBottomWidth: 0.5,
    borderBottomColor: "#d4d4d8",
    paddingVertical: 3,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  totalLabel: {
    width: "74%",
    fontSize: 7,
    fontWeight: "bold",
    fontFamily: "Poppins",
    color: "#18181b",
  },
  totalAmount: {
    width: "26%",
    textAlign: "right",
    fontFamily: "Poppins",
    fontSize: 7,
    fontWeight: "bold",
    color: "#18181b",
    paddingRight: 4,
  },
  grossProfitRow: {
    flexDirection: "row",
    borderTopWidth: 1.5,
    borderTopColor: "#86efac",
    borderBottomWidth: 1,
    borderBottomColor: "#86efac",
    paddingVertical: 3.5,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  grossProfitRowPositive: {
    backgroundColor: "#f0fdf4",
  },
  grossProfitRowNegative: {
    backgroundColor: "#fef2f2",
  },
  grossProfitLabel: {
    width: "74%",
    fontSize: 7,
    fontWeight: "bold",
    fontFamily: "Poppins",
    color: "#14532d",
  },
  grossProfitAmount: {
    width: "26%",
    textAlign: "right",
    fontFamily: "Poppins",
    fontSize: 7.5,
    fontWeight: "bold",
    color: "#15803d",
    paddingRight: 4,
  },
  netProfitRow: {
    flexDirection: "row",
    backgroundColor: "#18181b",
    borderTopWidth: 1.5,
    borderTopColor: "#09090b",
    paddingVertical: 5,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  netProfitLabel: {
    width: "70%",
    fontSize: 7.5,
    fontWeight: "bold",
    fontFamily: "Poppins",
    color: "#ffffff",
  },
  netProfitAmount: {
    width: "30%",
    textAlign: "right",
    fontFamily: "Poppins",
    fontSize: 8.5,
    fontWeight: "bold",
    paddingRight: 4,
  },
});

const ADJUSTMENTS_LABEL = "Inventory Adjustments (Stock Reports, Damages, Empties Out)";

function fmt(n: number) {
  return "Rs. " + Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAbs(n: number) {
  return fmt(Math.abs(n || 0));
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

function IncomeStatementPdfDocument({
  statement,
  opexLines,
  fromDate,
  toDate,
}: {
  statement: IncomeStatementExportData;
  opexLines: StatementDetailLine[];
  fromDate: string;
  toDate: string;
}) {
  ensurePoppinsRegistered();
  const s = statement;
  const exportTimeStr = formatExportDateTime();

  return (
    <Document>
      <Page size="A4" orientation="portrait" style={styles.page}>
        {/* Header Banner */}
        <View style={styles.headerContainer}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Income Statement (Profit & Loss)</Text>
            <View style={[styles.netProfitBadge, s.netProfit >= 0 ? styles.badgeGreen : styles.badgeRed]}>
              <Text>Net Profit: {fmt(s.netProfit)}</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <Text>Period: {fromDate} to {toDate}  •  Exported: {exportTimeStr}</Text>
            <Text>Total Invoices: {s.invoiceCount}  •  Generated Report</Text>
          </View>
        </View>

        {/* Formula Summary Box */}
        <View style={styles.formulaBox}>
          <Text style={styles.formulaLine}>
            Total Sales: {fmt(s.totalSale ?? s.grossRevenue)}  |  Less Adv. Tax: −{fmt(s.totalAdvTax)}  |  Less WH Tax: −{fmt(s.totalWHTax ?? 0)}  |  Net Sales Revenue: {fmt(s.netRevenue ?? (s.grossRevenue - s.totalAdvTax - (s.totalWHTax ?? 0)))}
          </Text>
          <Text style={styles.formulaLine}>
            Gross Profit = Net Sales Revenue - COGS = {fmt(s.grossProfit)}  |  Schemes: {fmt(s.totalScheme)}  |  OPEX: {fmt(s.opex.grandOpex)}
          </Text>
          <Text style={{ fontWeight: "bold", color: s.netProfit >= 0 ? "#15803d" : "#b91c1c" }}>
            Net Profit = Total Income ({fmt(s.totalIncome)}) - Total OPEX ({fmt(s.opex.grandOpex)}) = {fmt(s.netProfit)}
          </Text>
        </View>

        {/* Statement Table */}
        <View style={styles.table}>
          {/* Column Header */}
          <View style={styles.tableHeader}>
            <Text style={styles.colDesc}>Description</Text>
            <Text style={styles.colAmount}>Amount (PKR)</Text>
          </View>

          {/* ── A. SALES REVENUE ── */}
          <View style={styles.sectionHeader} wrap={false}>
            <Text style={styles.sectionHeaderText}>A. SALES REVENUE</Text>
          </View>
          <View style={styles.detailRow} wrap={false}>
            <Text style={styles.descText}>Total Invoiced Sales ({s.invoiceCount} invoices — includes Advance Tax)</Text>
            <Text style={[styles.amountText, styles.amountTextBold]}>{fmt(s.totalSale ?? s.grossRevenue)}</Text>
          </View>
          <View style={styles.detailRow} wrap={false}>
            <Text style={styles.descTextIndent}>Less: Advance Tax Collected (1% WHT — FBR pass-through, deducted from sales)</Text>
            <Text style={[styles.amountText, styles.amountTextRed]}>({fmt(s.totalAdvTax)})</Text>
          </View>
          <View style={styles.detailRow} wrap={false}>
            <Text style={styles.descTextIndent}>Less: WH Tax (0.1% WH Tax — deducted from sales)</Text>
            <Text style={[styles.amountText, styles.amountTextRed]}>({fmt(s.totalWHTax ?? 0)})</Text>
          </View>
          <View style={styles.detailRow} wrap={false}>
            <Text style={[styles.descText, styles.descTextBold]}>Net Sales Revenue (Sales separated from Advance & WH Tax)</Text>
            <Text style={[styles.amountText, styles.amountTextBold, styles.amountTextBlue]}>{fmt(s.netRevenue ?? (s.grossRevenue - s.totalAdvTax - (s.totalWHTax ?? 0)))}</Text>
          </View>

          {/* ── B. COST OF GOODS SOLD (COGS) ── */}
          <View style={styles.sectionHeader} wrap={false}>
            <Text style={styles.sectionHeaderText}>B. COST OF GOODS SOLD (COGS)</Text>
          </View>
          <View style={styles.detailRow} wrap={false}>
            <Text style={styles.descTextIndent}>Opening Stock Value (as of {fromDate})</Text>
            <Text style={styles.amountText}>{fmt(s.openingStockValue)}</Text>
          </View>
          <View style={styles.detailRow} wrap={false}>
            <Text style={styles.descTextIndent}>Purchases / Sell In Loads ({s.purchaseLinesCount ?? 0} POs)</Text>
            <Text style={styles.amountText}>{fmt(s.totalPurchases)}</Text>
          </View>
          {!!s.inventoryAdjustments && (
            <View style={styles.detailRow} wrap={false}>
              <Text style={styles.descTextIndent}>{ADJUSTMENTS_LABEL}</Text>
              <Text style={styles.amountText}>{fmt(s.inventoryAdjustments)}</Text>
            </View>
          )}
          <View style={styles.detailRow} wrap={false}>
            <Text style={styles.descTextIndent}>Closing Stock Value (as of {toDate})</Text>
            <Text style={styles.amountText}>({fmtAbs(s.closingStockValue)})</Text>
          </View>
          <View style={styles.totalRow} wrap={false}>
            <Text style={styles.totalLabel}>
              {s.inventoryAdjustments
                ? "TOTAL COGS (Opening + Purchases + Adjustments − Closing)"
                : "TOTAL COGS (Opening + Purchases − Closing)"}
            </Text>
            <Text style={styles.totalAmount}>{fmt(s.cogs)}</Text>
          </View>

          {/* ── GROSS PROFIT ── */}
          <View style={[styles.grossProfitRow, s.grossProfit >= 0 ? styles.grossProfitRowPositive : styles.grossProfitRowNegative]} wrap={false}>
            <Text style={styles.grossProfitLabel}>GROSS PROFIT  (Revenue − COGS)</Text>
            <Text style={styles.grossProfitAmount}>{fmt(s.grossProfit)}</Text>
          </View>

          {/* ── C. OTHER INCOME ── */}
          <View style={styles.sectionHeader} wrap={false}>
            <Text style={styles.sectionHeaderText}>C. OTHER INCOME — CCBPL Schemes & Incentives</Text>
          </View>
          {s.schemes.length === 0 ? (
            <View style={styles.detailRow} wrap={false}>
              <Text style={[styles.descTextIndent, { color: "#9ca3af" }]}>No scheme income in this period</Text>
              <Text style={[styles.amountText, styles.amountTextMuted]}>—</Text>
            </View>
          ) : (
            s.schemes.map((sc, i) => (
              <View key={i} style={styles.detailRow} wrap={false}>
                <Text style={styles.descTextIndent}>{sc.description || "Unnamed Scheme"}</Text>
                <Text style={[styles.amountText, styles.amountTextGreen]}>{fmt(Number(sc.amount) || 0)}</Text>
              </View>
            ))
          )}
          <View style={styles.totalRow} wrap={false}>
            <Text style={styles.totalLabel}>TOTAL OTHER INCOME</Text>
            <Text style={styles.totalAmount}>{fmt(s.totalScheme)}</Text>
          </View>
          <View style={[styles.grossProfitRow, s.totalIncome >= 0 ? styles.grossProfitRowPositive : styles.grossProfitRowNegative]} wrap={false}>
            <Text style={styles.grossProfitLabel}>TOTAL INCOME  (Gross Profit + Other Income)</Text>
            <Text style={styles.grossProfitAmount}>{fmt(s.totalIncome)}</Text>
          </View>

          {/* ── D. OPERATING EXPENSES (OPEX) ── */}
          <View style={styles.sectionHeader} wrap={false}>
            <Text style={styles.sectionHeaderText}>D. OPERATING EXPENSES (OPEX)</Text>
          </View>
          {opexLines.length === 0 ? (
            <View style={styles.detailRow} wrap={false}>
              <Text style={[styles.descTextIndent, { color: "#9ca3af" }]}>No operating expenses recorded for this period</Text>
              <Text style={[styles.amountText, styles.amountTextMuted]}>—</Text>
            </View>
          ) : (
            opexLines.map((line, i) => (
              <View key={i} style={styles.detailRow} wrap={false}>
                <Text style={line.indent ? styles.descTextIndent : styles.descText}>{line.label}</Text>
                <Text style={[styles.amountText, styles.amountTextRed]}>{fmt(line.amount ?? 0)}</Text>
              </View>
            ))
          )}
          <View style={styles.totalRow} wrap={false}>
            <Text style={styles.totalLabel}>TOTAL OPEX</Text>
            <Text style={[styles.totalAmount, { color: "#b91c1c" }]}>({fmtAbs(s.opex.grandOpex)})</Text>
          </View>

          {/* ── NET PROFIT BOTTOM BAR ── */}
          <View style={styles.netProfitRow} wrap={false}>
            <Text style={styles.netProfitLabel}>NET PROFIT  (Pre-Tax) = Total Income − Total OPEX</Text>
            <Text style={[styles.netProfitAmount, { color: s.netProfit >= 0 ? "#4ade80" : "#f87171" }]}>
              {fmt(s.netProfit)}
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export function IncomeStatementExportButtons({
  statement,
  opexLines,
  fromDate,
  toDate,
  filename = "income_statement",
}: IncomeStatementExportButtonsProps) {
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [isExcelLoading, setIsExcelLoading] = useState(false);

  const handleExportPdf = async () => {
    if (!statement) return;
    try {
      setIsPdfLoading(true);
      await ensurePoppinsRegistered();
      const doc = (
        <IncomeStatementPdfDocument
          statement={statement}
          opexLines={opexLines}
          fromDate={fromDate}
          toDate={toDate}
        />
      );
      const blob = await pdf(doc).toBlob();
      downloadBlob(blob, `${sanitizeFileName(filename)}_${fromDate}_to_${toDate}.pdf`);
    } catch (err) {
      console.error("Income statement PDF export failed:", err);
    } finally {
      setIsPdfLoading(false);
    }
  };

  const handleExportExcel = () => {
    if (!statement) return;
    try {
      setIsExcelLoading(true);
      const rows: Array<Record<string, unknown>> = [
        { Section: "A. SALES REVENUE", Description: `Total Invoiced Sales (${statement.invoiceCount} invoices — includes Advance Tax)`, Amount: statement.totalSale ?? statement.grossRevenue },
        { Section: "A. SALES REVENUE", Description: "Less: Advance Tax Collected (1% WHT pass-through)", Amount: -statement.totalAdvTax },
        { Section: "A. SALES REVENUE", Description: "Less: WH Tax (0.1% WH Tax)", Amount: -(statement.totalWHTax ?? 0) },
        { Section: "A. SALES REVENUE", Description: "Net Sales Revenue (Sales separated from Advance & WH Tax)", Amount: statement.netRevenue ?? (statement.grossRevenue - statement.totalAdvTax - (statement.totalWHTax ?? 0)) },
        { Section: "B. COST OF GOODS SOLD", Description: `Opening Stock Value (as of ${fromDate})`, Amount: statement.openingStockValue },
        { Section: "B. COST OF GOODS SOLD", Description: "Purchases / Sell In Loads", Amount: statement.totalPurchases },
        ...(statement.inventoryAdjustments
          ? [{ Section: "B. COST OF GOODS SOLD", Description: ADJUSTMENTS_LABEL, Amount: statement.inventoryAdjustments }]
          : []),
        { Section: "B. COST OF GOODS SOLD", Description: `Closing Stock Value (as of ${toDate})`, Amount: -statement.closingStockValue },
        { Section: "B. COST OF GOODS SOLD", Description: "TOTAL COGS", Amount: statement.cogs },
        { Section: "GROSS PROFIT", Description: "Gross Profit (Revenue − COGS)", Amount: statement.grossProfit },
        ...statement.schemes.map((sc) => ({
          Section: "C. OTHER INCOME",
          Description: sc.description || "Scheme Income",
          Amount: Number(sc.amount) || 0,
        })),
        { Section: "C. OTHER INCOME", Description: "TOTAL OTHER INCOME", Amount: statement.totalScheme },
        { Section: "TOTAL INCOME", Description: "Total Income (Gross Profit + Other Income)", Amount: statement.totalIncome },
        ...opexLines.map((line) => ({
          Section: "D. OPERATING EXPENSES",
          Description: line.label,
          Amount: line.amount ?? 0,
        })),
        { Section: "D. OPERATING EXPENSES", Description: "TOTAL OPEX", Amount: -statement.opex.grandOpex },
        { Section: "NET PROFIT", Description: "Net Profit (Pre-Tax)", Amount: statement.netProfit },
      ];

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Income Statement");
      XLSX.writeFile(wb, `${sanitizeFileName(filename)}_${fromDate}_to_${toDate}.xlsx`);
    } catch (err) {
      console.error("Income statement Excel export failed:", err);
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
        disabled={!statement || isPdfLoading || isExcelLoading}
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
        disabled={!statement || isPdfLoading || isExcelLoading}
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
