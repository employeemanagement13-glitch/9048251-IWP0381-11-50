"use client";

import { Document, Page, pdf, StyleSheet, Text, View } from "@react-pdf/renderer";
import { FileSpreadsheet, Printer, Loader2 } from "lucide-react";
import { useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/Button";
import { ensurePoppinsRegistered, formatExportDateTime } from "@/lib/pdf/registerFonts";
import { ManualStatementData } from "@/lib/actions/manual-income-statement";

export interface ManualIncomeStatementExportButtonsProps {
  data: ManualStatementData;
  monthYear: string;
  filename?: string;
}

const fmt = (n: number) =>
  "Rs. " +
  Number(n || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtAbs = (n: number) => fmt(Math.abs(n || 0));

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

function formatOpexDate(d?: string | null) {
  if (!d) return "";
  const parts = d.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return d;
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
  amountText: {
    width: "26%",
    textAlign: "right",
    fontFamily: "Poppins",
    fontSize: 6.5,
    color: "#18181b",
    paddingRight: 4,
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
  totalIncomeRow: {
    flexDirection: "row",
    backgroundColor: "#e0e7ff",
    borderTopWidth: 1,
    borderTopColor: "#c7d2fe",
    borderBottomWidth: 0.5,
    borderBottomColor: "#c7d2fe",
    paddingVertical: 3.5,
    paddingHorizontal: 6,
    alignItems: "center",
  },
  totalIncomeLabel: {
    width: "74%",
    fontSize: 7,
    fontWeight: "bold",
    fontFamily: "Poppins",
    color: "#312e81",
  },
  totalIncomeAmount: {
    width: "26%",
    textAlign: "right",
    fontFamily: "Poppins",
    fontSize: 7.5,
    fontWeight: "bold",
    color: "#312e81",
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

function ManualIncomeStatementPdfDocument({
  data,
  monthYear,
}: {
  data: ManualStatementData;
  monthYear: string;
}) {
  const revVal = data.revenue?.amount ?? 0;
  const cogsVal = data.cogs?.amount ?? 0;
  const grossProfit = revVal - cogsVal;
  const otherIncomeVal = data.otherIncome.reduce((s, it) => s + (it.amount || 0), 0);
  const totalIncome = grossProfit + otherIncomeVal;
  const opexVal = data.opex.reduce((s, it) => s + (it.amount || 0), 0);
  const netProfit = totalIncome - opexVal;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerContainer}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>INCOME STATEMENT (P&amp;L) — MANUAL</Text>
            <Text
              style={[
                styles.netProfitBadge,
                netProfit >= 0 ? styles.badgeGreen : styles.badgeRed,
              ]}
            >
              Net Profit: {fmt(netProfit)}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text>Period: {monthYear}</Text>
            <Text>Generated: {formatExportDateTime()}</Text>
          </View>
        </View>

        <View style={styles.formulaBox}>
          <Text style={styles.formulaLine}>
            Revenue: {fmt(revVal)} | COGS: {fmt(cogsVal)} | Gross Profit: {fmt(grossProfit)}
          </Text>
          <Text style={styles.formulaLine}>
            Other Income: {fmt(otherIncomeVal)} | Total Income: {fmt(totalIncome)} | OPEX: {fmt(opexVal)}
          </Text>
          <Text style={{ fontWeight: "bold", color: netProfit >= 0 ? "#15803d" : "#b91c1c" }}>
            Net Profit (Pre-Tax) = Total Income − Total OPEX = {fmt(netProfit)}
          </Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colDesc}>DESCRIPTION</Text>
            <Text style={styles.colAmount}>AMOUNT (PKR)</Text>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>A. SALES REVENUE</Text>
          </View>
          {data.revenue ? (
            <View style={styles.detailRow}>
              <Text style={styles.descTextIndent}>{data.revenue.description || "Net Sales Revenue"}</Text>
              <Text style={styles.amountText}>{fmt(data.revenue.amount)}</Text>
            </View>
          ) : (
            <View style={styles.detailRow}>
              <Text style={styles.descTextIndent}>No Sales Revenue Recorded</Text>
              <Text style={styles.amountText}>—</Text>
            </View>
          )}

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>B. COST OF GOODS SOLD (COGS)</Text>
          </View>
          {data.cogs?.line_items && data.cogs.line_items.length > 0 && (
            data.cogs.line_items.map((line, idx) => (
              <View key={idx} style={styles.detailRow}>
                <Text style={styles.descTextIndent}>
                  [{line.code || "—"}] {line.name} (Rate: {line.purchase_rate} × Qty: {line.sold_qty})
                </Text>
                <Text style={styles.amountText}>{fmt(line.amount)}</Text>
              </View>
            ))
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TOTAL COGS</Text>
            <Text style={styles.totalAmount}>{fmt(cogsVal)}</Text>
          </View>
          <View style={styles.grossProfitRow}>
            <Text style={styles.grossProfitLabel}>GROSS PROFIT (Revenue − COGS)</Text>
            <Text style={styles.grossProfitAmount}>{fmt(grossProfit)}</Text>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>C. OTHER INCOME — CCBPL Schemes &amp; Incentives</Text>
          </View>
          {data.otherIncome.length > 0 ? (
            data.otherIncome.map((item, idx) => (
              <View key={idx} style={styles.detailRow}>
                <Text style={styles.descTextIndent}>{item.description}</Text>
                <Text style={[styles.amountText, { color: "#15803d" }]}>{fmt(item.amount)}</Text>
              </View>
            ))
          ) : (
            <View style={styles.detailRow}>
              <Text style={styles.descTextIndent}>No Other Income Recorded</Text>
              <Text style={styles.amountText}>—</Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TOTAL OTHER INCOME</Text>
            <Text style={styles.totalAmount}>{fmt(otherIncomeVal)}</Text>
          </View>
          <View style={styles.totalIncomeRow}>
            <Text style={styles.totalIncomeLabel}>TOTAL INCOME (Gross Profit + Other Income)</Text>
            <Text style={styles.totalIncomeAmount}>{fmt(totalIncome)}</Text>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>D. OPERATING EXPENSES (OPEX)</Text>
          </View>
          {data.opex.length > 0 ? (
            data.opex.map((item, idx) => (
              <View key={idx} style={styles.detailRow}>
                <Text style={styles.descTextIndent}>
                  {item.description} {item.entry_date ? `| ${formatOpexDate(item.entry_date)}` : ""}
                </Text>
                <Text style={[styles.amountText, { color: "#b91c1c" }]}>{fmt(item.amount)}</Text>
              </View>
            ))
          ) : (
            <View style={styles.detailRow}>
              <Text style={styles.descTextIndent}>No Operating Expenses Recorded</Text>
              <Text style={styles.amountText}>—</Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TOTAL OPEX</Text>
            <Text style={[styles.totalAmount, { color: "#b91c1c" }]}>{fmt(opexVal)}</Text>
          </View>

          <View style={styles.netProfitRow}>
            <Text style={styles.netProfitLabel}>
              NET PROFIT (Pre-Tax) = Total Income − Total OPEX
            </Text>
            <Text
              style={[
                styles.netProfitAmount,
                { color: netProfit >= 0 ? "#4ade80" : "#f87171" },
              ]}
            >
              {fmt(netProfit)}
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export function ManualIncomeStatementExportButtons({
  data,
  monthYear,
  filename = "manual_income_statement",
}: ManualIncomeStatementExportButtonsProps) {
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [isExcelLoading, setIsExcelLoading] = useState(false);

  const handleExportPdf = async () => {
    try {
      setIsPdfLoading(true);
      await ensurePoppinsRegistered();
      const doc = (
        <ManualIncomeStatementPdfDocument
          data={data}
          monthYear={monthYear}
        />
      );
      const blob = await pdf(doc).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFileName(filename)}_${sanitizeFileName(monthYear)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (_) {
    } finally {
      setIsPdfLoading(false);
    }
  };

  const handleExportExcel = () => {
    try {
      setIsExcelLoading(true);
      const revVal = data.revenue?.amount ?? 0;
      const cogsVal = data.cogs?.amount ?? 0;
      const grossProfit = revVal - cogsVal;
      const otherIncomeVal = data.otherIncome.reduce((s, it) => s + (it.amount || 0), 0);
      const totalIncome = grossProfit + otherIncomeVal;
      const opexVal = data.opex.reduce((s, it) => s + (it.amount || 0), 0);
      const netProfit = totalIncome - opexVal;

      const rows: Array<Record<string, unknown>> = [
        { Section: "A. SALES REVENUE", Description: data.revenue?.description || "Net Sales Revenue", Amount: revVal },
        ...(data.cogs?.line_items || []).map((line) => ({
          Section: "B. COST OF GOODS SOLD",
          Description: `[${line.code || "—"}] ${line.name} (Rate: ${line.purchase_rate} × Qty: ${line.sold_qty})`,
          Amount: line.amount,
        })),
        { Section: "B. COST OF GOODS SOLD", Description: "TOTAL COGS", Amount: cogsVal },
        { Section: "GROSS PROFIT", Description: "Gross Profit (Revenue − COGS)", Amount: grossProfit },
        ...data.otherIncome.map((sc) => ({
          Section: "C. OTHER INCOME",
          Description: sc.description,
          Amount: sc.amount,
        })),
        { Section: "C. OTHER INCOME", Description: "TOTAL OTHER INCOME", Amount: otherIncomeVal },
        { Section: "TOTAL INCOME", Description: "Total Income (Gross Profit + Other Income)", Amount: totalIncome },
        ...data.opex.map((line) => ({
          Section: "D. OPERATING EXPENSES",
          Description: `${line.description} ${line.entry_date ? `| ${formatOpexDate(line.entry_date)}` : ""}`,
          Amount: line.amount,
        })),
        { Section: "D. OPERATING EXPENSES", Description: "TOTAL OPEX", Amount: -opexVal },
        { Section: "NET PROFIT", Description: "Net Profit (Pre-Tax)", Amount: netProfit },
      ];

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Manual Statement");
      XLSX.writeFile(wb, `${sanitizeFileName(filename)}_${sanitizeFileName(monthYear)}.xlsx`);
    } catch (_) {
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
        disabled={isPdfLoading || isExcelLoading}
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
        disabled={isPdfLoading || isExcelLoading}
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
