"use client";

import { Document, Page, pdf, StyleSheet, Text, View } from "@react-pdf/renderer";
import { FileSpreadsheet, Printer, Loader2 } from "lucide-react";
import { useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/Button";
import { ensurePoppinsRegistered, formatExportDateTime } from "@/lib/pdf/registerFonts";

export interface ExpenseSheetExportRow {
  date: string;
  category: string;
  description: string;
  paidVia: string;
  amount: number;
  isSubRow?: boolean;
}

export interface ExpenseSheetExportButtonsProps {
  rows: ExpenseSheetExportRow[];
  fromDate: string;
  toDate: string;
  filename?: string;
}

const styles = StyleSheet.create({
  page: { padding: 20, fontFamily: "Poppins", backgroundColor: "#ffffff", fontSize: 7, color: "#18181b" },
  headerContainer: { marginBottom: 6, borderBottomWidth: 1, borderBottomColor: "#e4e4e7", paddingBottom: 5 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 3 },
  title: { fontSize: 11, fontWeight: "bold", fontFamily: "Poppins", color: "#09090b" },
  badge: {
    paddingVertical: 2, paddingHorizontal: 6, borderRadius: 3, fontSize: 7, fontWeight: "bold",
    fontFamily: "Poppins", backgroundColor: "#fef2f2", color: "#b91c1c", borderWidth: 0.5, borderColor: "#fecaca",
  },
  meta: { fontSize: 7, fontFamily: "Poppins", color: "#71717a" },
  table: { borderWidth: 0.5, borderColor: "#e4e4e7", borderRadius: 3, overflow: "hidden" },
  tableHeader: {
    flexDirection: "row", backgroundColor: "#f4f4f5", borderBottomWidth: 1, borderBottomColor: "#e4e4e7",
    paddingVertical: 3.5, paddingHorizontal: 6,
  },
  th: { fontSize: 6.5, fontWeight: "bold", fontFamily: "Poppins", color: "#52525b", textTransform: "uppercase" },
  sectionHeader: { flexDirection: "row", backgroundColor: "#18181b", paddingVertical: 3.5, paddingHorizontal: 6 },
  sectionHeaderText: { color: "#ffffff", fontSize: 6.5, fontWeight: "bold", fontFamily: "Poppins", textTransform: "uppercase" },
  row: {
    flexDirection: "row", paddingVertical: 2.5, paddingHorizontal: 6, borderBottomWidth: 0.5,
    borderBottomColor: "#f4f4f5", alignItems: "center",
  },
  cell: { fontSize: 6.5, fontFamily: "Poppins", color: "#3f3f46" },
  cellMuted: { fontSize: 6.5, fontFamily: "Poppins", color: "#71717a" },
  colDate: { width: "15%" },
  colDesc: { width: "49%" },
  colPaid: { width: "18%" },
  colAmt: { width: "18%", textAlign: "right", paddingRight: 4 },
  totalRow: {
    flexDirection: "row", backgroundColor: "#f4f4f5", borderTopWidth: 1, borderTopColor: "#d4d4d8",
    paddingVertical: 3, paddingHorizontal: 6, alignItems: "center",
  },
  totalLabel: { width: "82%", fontSize: 7, fontWeight: "bold", fontFamily: "Poppins", color: "#18181b" },
  totalAmount: { width: "18%", textAlign: "right", fontSize: 7, fontWeight: "bold", fontFamily: "Poppins", color: "#b91c1c", paddingRight: 4 },
  grandRow: {
    flexDirection: "row", backgroundColor: "#18181b", paddingVertical: 5, paddingHorizontal: 6, alignItems: "center",
  },
  grandLabel: { width: "70%", fontSize: 7.5, fontWeight: "bold", fontFamily: "Poppins", color: "#ffffff" },
  grandAmount: { width: "30%", textAlign: "right", fontSize: 8.5, fontWeight: "bold", fontFamily: "Poppins", color: "#f87171", paddingRight: 4 },
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

function groupByCategory(rows: ExpenseSheetExportRow[]) {
  const map = new Map<string, ExpenseSheetExportRow[]>();
  for (const r of rows) {
    if (!map.has(r.category)) map.set(r.category, []);
    map.get(r.category)!.push(r);
  }
  return Array.from(map.entries()).map(([category, items]) => ({
    category,
    items,
    total: items.reduce((s, r) => (r.isSubRow ? s : s + (Number(r.amount) || 0)), 0),
  }));
}

function ExpenseSheetPdfDocument({ rows, fromDate, toDate }: { rows: ExpenseSheetExportRow[]; fromDate: string; toDate: string }) {
  ensurePoppinsRegistered();
  const groups = groupByCategory(rows);
  const grand = groups.reduce((s, g) => s + g.total, 0);

  return (
    <Document>
      <Page size="A4" orientation="portrait" style={styles.page}>
        <View style={styles.headerContainer}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Expense Sheet</Text>
            <View style={styles.badge}>
              <Text>Total OPEX: {fmt(grand)}</Text>
            </View>
          </View>
          <Text style={styles.meta}>Period: {fromDate} to {toDate}  •  Exported: {formatExportDateTime()}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.th, styles.colDate]}>Date</Text>
            <Text style={[styles.th, styles.colDesc]}>Description</Text>
            <Text style={[styles.th, styles.colPaid]}>Paid Via</Text>
            <Text style={[styles.th, styles.colAmt]}>Amount (PKR)</Text>
          </View>

          {groups.length === 0 && (
            <View style={styles.row}>
              <Text style={styles.cellMuted}>No expenses recorded for this period</Text>
            </View>
          )}

          {groups.map((g) => (
            <View key={g.category}>
              <View style={styles.sectionHeader} wrap={false}>
                <Text style={styles.sectionHeaderText}>{g.category}</Text>
              </View>
              {g.items.map((r, i) => (
                <View key={i} style={styles.row} wrap={false}>
                  <Text style={[r.isSubRow ? styles.cellMuted : styles.cell, styles.colDate]}>{r.isSubRow ? "" : r.date}</Text>
                  <Text style={[r.isSubRow ? styles.cellMuted : styles.cell, styles.colDesc, r.isSubRow ? { paddingLeft: 10 } : {}]}>{r.description}</Text>
                  <Text style={[styles.cellMuted, styles.colPaid]}>{r.paidVia}</Text>
                  <Text style={[r.isSubRow ? styles.cellMuted : styles.cell, styles.colAmt]}>{fmt(r.amount)}</Text>
                </View>
              ))}
              <View style={styles.totalRow} wrap={false}>
                <Text style={styles.totalLabel}>TOTAL {g.category.toUpperCase()}</Text>
                <Text style={styles.totalAmount}>{fmt(g.total)}</Text>
              </View>
            </View>
          ))}

          <View style={styles.grandRow} wrap={false}>
            <Text style={styles.grandLabel}>TOTAL OPEX (All Categories)</Text>
            <Text style={styles.grandAmount}>{fmt(grand)}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export function ExpenseSheetExportButtons({ rows, fromDate, toDate, filename = "expense_sheet" }: ExpenseSheetExportButtonsProps) {
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [isExcelLoading, setIsExcelLoading] = useState(false);
  const empty = rows.length === 0;

  const handleExportPdf = async () => {
    if (empty) return;
    try {
      setIsPdfLoading(true);
      await ensurePoppinsRegistered();
      const blob = await pdf(<ExpenseSheetPdfDocument rows={rows} fromDate={fromDate} toDate={toDate} />).toBlob();
      downloadBlob(blob, `${sanitizeFileName(filename)}_${fromDate}_to_${toDate}.pdf`);
    } catch (err) {
      console.error("Expense sheet PDF export failed:", err);
    } finally {
      setIsPdfLoading(false);
    }
  };

  const handleExportExcel = () => {
    if (empty) return;
    try {
      setIsExcelLoading(true);
      const groups = groupByCategory(rows);
      const out: Array<Record<string, unknown>> = [];
      for (const g of groups) {
        for (const r of g.items) {
          out.push({ Category: g.category, Date: r.date, Description: r.description, "Paid Via": r.paidVia, "Amount (PKR)": r.amount });
        }
        out.push({ Category: g.category, Date: "", Description: `TOTAL ${g.category.toUpperCase()}`, "Paid Via": "", "Amount (PKR)": g.total });
      }
      out.push({ Category: "TOTAL OPEX", Date: "", Description: "TOTAL OPEX (All Categories)", "Paid Via": "", "Amount (PKR)": groups.reduce((s, g) => s + g.total, 0) });
      const ws = XLSX.utils.json_to_sheet(out);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Expense Sheet");
      XLSX.writeFile(wb, `${sanitizeFileName(filename)}_${fromDate}_to_${toDate}.xlsx`);
    } catch (err) {
      console.error("Expense sheet Excel export failed:", err);
    } finally {
      setIsExcelLoading(false);
    }
  };

  const btn = "h-9 px-3 gap-1.5 text-xs font-semibold text-zinc-700 hover:text-zinc-900 border-zinc-200 hover:bg-zinc-50";
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={handleExportPdf} disabled={empty || isPdfLoading || isExcelLoading} className={btn}>
        {isPdfLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-600" /> : <Printer className="h-3.5 w-3.5 text-zinc-600" />}
        <span>Print PDF</span>
      </Button>
      <Button size="sm" variant="outline" onClick={handleExportExcel} disabled={empty || isPdfLoading || isExcelLoading} className={btn}>
        {isExcelLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" /> : <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />}
        <span>Export Excel</span>
      </Button>
    </div>
  );
}
