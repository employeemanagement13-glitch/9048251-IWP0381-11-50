"use client";

import { Document, Page, pdf, StyleSheet, Text, View } from "@react-pdf/renderer";
import { FileSpreadsheet, Printer, Loader2 } from "lucide-react";
import { useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/Button";
import { ensureArialRegistered, formatExportDateTime } from "@/lib/pdf/registerFonts";

export interface PayrollExportRow {
  code: string;
  name: string;
  date: string;
  basic: number;
  bonus: number;
  absentDeduction: number;
  netSalary: number;
  loanDue: number;
  loanApplied: number;
  netPayable: number;
  ledgerBalance: number;
}

export interface PayrollRunsExportButtonsProps {
  rows: PayrollExportRow[];
  month: string;
  distributorName?: string;
  filename?: string;
}

const styles = StyleSheet.create({
  page: { padding: 16, fontFamily: "Arial", backgroundColor: "#ffffff", fontSize: 7, color: "#18181b" },
  headerContainer: { marginBottom: 8, borderBottomWidth: 1, borderBottomColor: "#e4e4e7", paddingBottom: 6 },
  title: { fontSize: 12, fontWeight: "bold", fontFamily: "Arial", color: "#09090b", marginBottom: 2 },
  meta: { fontSize: 7, fontFamily: "Arial", color: "#71717a", marginBottom: 1 },
  table: { borderWidth: 0.5, borderColor: "#e4e4e7", borderRadius: 3, overflow: "hidden" },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f4f4f5",
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
    paddingVertical: 3.5,
    paddingHorizontal: 3,
  },
  th: { fontSize: 6, fontWeight: "bold", fontFamily: "Arial", color: "#52525b", textTransform: "uppercase" },
  row: {
    flexDirection: "row",
    paddingVertical: 2.5,
    paddingHorizontal: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#f4f4f5",
    alignItems: "center",
  },
  cell: { fontSize: 6.5, fontFamily: "Arial", color: "#3f3f46" },
  right: { textAlign: "right" as const },
  totalRow: {
    flexDirection: "row",
    backgroundColor: "#18181b",
    paddingVertical: 4,
    paddingHorizontal: 3,
    alignItems: "center",
  },
  totalCell: { fontSize: 6.5, fontWeight: "bold", fontFamily: "Arial", color: "#ffffff" },
  colCode: { width: "8%" },
  colName: { width: "16%" },
  colDate: { width: "9%" },
  colNum: { width: "9.5%" },
});

function fmt(n: number) {
  return Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function monthLabel(month: string) {
  if (!month || month.length < 7) return month || "—";
  const [y, m] = month.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = Number(m) - 1;
  return `${names[mi] || m} ${y}`;
}

function totals(rows: PayrollExportRow[]) {
  return {
    basic: rows.reduce((s, r) => s + (Number(r.basic) || 0), 0),
    bonus: rows.reduce((s, r) => s + (Number(r.bonus) || 0), 0),
    absentDeduction: rows.reduce((s, r) => s + (Number(r.absentDeduction) || 0), 0),
    netSalary: rows.reduce((s, r) => s + (Number(r.netSalary) || 0), 0),
    loanDue: rows.reduce((s, r) => s + (Number(r.loanDue) || 0), 0),
    loanApplied: rows.reduce((s, r) => s + (Number(r.loanApplied) || 0), 0),
    netPayable: rows.reduce((s, r) => s + (Number(r.netPayable) || 0), 0),
  };
}

function PayrollPdfDocument({
  rows,
  month,
  distributorName,
}: {
  rows: PayrollExportRow[];
  month: string;
  distributorName?: string;
}) {
  ensureArialRegistered();
  const t = totals(rows);

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.headerContainer}>
          <Text style={styles.title}>Payroll Runs</Text>
          {distributorName ? <Text style={styles.meta}>{distributorName}</Text> : null}
          <Text style={styles.meta}>
            Month: {monthLabel(month)}  •  Exported: {formatExportDateTime()}
          </Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.th, styles.colCode]}>Code</Text>
            <Text style={[styles.th, styles.colName]}>Name</Text>
            <Text style={[styles.th, styles.colDate]}>Date</Text>
            <Text style={[styles.th, styles.colNum, styles.right]}>Basic</Text>
            <Text style={[styles.th, styles.colNum, styles.right]}>Bonus</Text>
            <Text style={[styles.th, styles.colNum, styles.right]}>Absent Ded.</Text>
            <Text style={[styles.th, styles.colNum, styles.right]}>Net Salary</Text>
            <Text style={[styles.th, styles.colNum, styles.right]}>Loan Due</Text>
            <Text style={[styles.th, styles.colNum, styles.right]}>Loan Applied</Text>
            <Text style={[styles.th, styles.colNum, styles.right]}>Net Payable</Text>
            <Text style={[styles.th, styles.colNum, styles.right]}>Ledger Bal.</Text>
          </View>

          {rows.length === 0 && (
            <View style={styles.row}>
              <Text style={styles.cell}>No payroll runs for this month</Text>
            </View>
          )}

          {rows.map((r, i) => (
            <View key={i} style={styles.row} wrap={false}>
              <Text style={[styles.cell, styles.colCode]}>{r.code || "—"}</Text>
              <Text style={[styles.cell, styles.colName]}>{r.name || "—"}</Text>
              <Text style={[styles.cell, styles.colDate]}>{r.date || "—"}</Text>
              <Text style={[styles.cell, styles.colNum, styles.right]}>{fmt(r.basic)}</Text>
              <Text style={[styles.cell, styles.colNum, styles.right]}>{fmt(r.bonus)}</Text>
              <Text style={[styles.cell, styles.colNum, styles.right]}>{fmt(r.absentDeduction)}</Text>
              <Text style={[styles.cell, styles.colNum, styles.right]}>{fmt(r.netSalary)}</Text>
              <Text style={[styles.cell, styles.colNum, styles.right]}>{fmt(r.loanDue)}</Text>
              <Text style={[styles.cell, styles.colNum, styles.right]}>{fmt(r.loanApplied)}</Text>
              <Text style={[styles.cell, styles.colNum, styles.right]}>{fmt(r.netPayable)}</Text>
              <Text style={[styles.cell, styles.colNum, styles.right]}>{fmt(r.ledgerBalance)}</Text>
            </View>
          ))}

          {rows.length > 0 && (
            <View style={styles.totalRow} wrap={false}>
              <Text style={[styles.totalCell, styles.colCode]} />
              <Text style={[styles.totalCell, styles.colName]}>TOTAL</Text>
              <Text style={[styles.totalCell, styles.colDate]} />
              <Text style={[styles.totalCell, styles.colNum, styles.right]}>{fmt(t.basic)}</Text>
              <Text style={[styles.totalCell, styles.colNum, styles.right]}>{fmt(t.bonus)}</Text>
              <Text style={[styles.totalCell, styles.colNum, styles.right]}>{fmt(t.absentDeduction)}</Text>
              <Text style={[styles.totalCell, styles.colNum, styles.right]}>{fmt(t.netSalary)}</Text>
              <Text style={[styles.totalCell, styles.colNum, styles.right]}>{fmt(t.loanDue)}</Text>
              <Text style={[styles.totalCell, styles.colNum, styles.right]}>{fmt(t.loanApplied)}</Text>
              <Text style={[styles.totalCell, styles.colNum, styles.right]}>{fmt(t.netPayable)}</Text>
              <Text style={[styles.totalCell, styles.colNum, styles.right]} />
            </View>
          )}
        </View>
      </Page>
    </Document>
  );
}

export function PayrollRunsExportButtons({
  rows,
  month,
  distributorName,
  filename = "payroll_runs",
}: PayrollRunsExportButtonsProps) {
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [isExcelLoading, setIsExcelLoading] = useState(false);
  const empty = rows.length === 0;

  const handleExportPdf = async () => {
    if (empty) return;
    try {
      setIsPdfLoading(true);
      await ensureArialRegistered();
      const blob = await pdf(
        <PayrollPdfDocument rows={rows} month={month} distributorName={distributorName} />
      ).toBlob();
      downloadBlob(blob, `${sanitizeFileName(filename)}_${month || "all"}.pdf`);
    } catch (err) {
      console.error("Payroll PDF export failed:", err);
    } finally {
      setIsPdfLoading(false);
    }
  };

  const handleExportExcel = () => {
    if (empty) return;
    try {
      setIsExcelLoading(true);
      const t = totals(rows);
      const out = rows.map((r) => ({
        Code: r.code,
        Name: r.name,
        Date: r.date,
        Basic: r.basic,
        Bonus: r.bonus,
        "Absent Ded.": r.absentDeduction,
        "Net Salary": r.netSalary,
        "Loan Due": r.loanDue,
        "Loan Applied": r.loanApplied,
        "Net Payable": r.netPayable,
        "Ledger Balance": r.ledgerBalance,
      }));
      out.push({
        Code: "",
        Name: "TOTAL",
        Date: "",
        Basic: t.basic,
        Bonus: t.bonus,
        "Absent Ded.": t.absentDeduction,
        "Net Salary": t.netSalary,
        "Loan Due": t.loanDue,
        "Loan Applied": t.loanApplied,
        "Net Payable": t.netPayable,
        "Ledger Balance": "" as any,
      });
      const ws = XLSX.utils.json_to_sheet(out);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Payroll");
      XLSX.writeFile(wb, `${sanitizeFileName(filename)}_${month || "all"}.xlsx`);
    } catch (err) {
      console.error("Payroll Excel export failed:", err);
    } finally {
      setIsExcelLoading(false);
    }
  };

  return (
    <div className="inline-flex items-center gap-2 shrink-0">
      <Button
        size="sm"
        variant="default"
        onClick={handleExportPdf}
        disabled={empty || isPdfLoading || isExcelLoading}
        className="whitespace-nowrap"
        icon={
          isPdfLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Printer className="h-3.5 w-3.5" />
          )
        }
        iconClassName="text-white"
      >
        {isPdfLoading ? "Preparing PDF..." : "Print PDF"}
      </Button>
      <Button
        size="sm"
        variant="default"
        onClick={handleExportExcel}
        disabled={empty || isPdfLoading || isExcelLoading}
        className="whitespace-nowrap"
        icon={
          isExcelLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileSpreadsheet className="h-3.5 w-3.5" />
          )
        }
      >
        {isExcelLoading ? "Exporting..." : "Export Excel"}
      </Button>
    </div>
  );
}
