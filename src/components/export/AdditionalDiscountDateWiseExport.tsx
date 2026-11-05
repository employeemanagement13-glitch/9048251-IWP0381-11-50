"use client";

import { Document, Page, pdf, StyleSheet, Text, View } from "@react-pdf/renderer";
import { FileSpreadsheet, Printer, Loader2 } from "lucide-react";
import { useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/Button";
import { ensurePoppinsRegistered, formatExportDateTime } from "@/lib/pdf/registerFonts";
import { buildWorksheet, downloadBlob, sanitizeFileName } from "./ExportButtons";

export interface DiscountExportShop {
  shopName: string;
  invoiceNo?: string;
  products: string;
  discount: number;
}

export interface DiscountExportRow {
  date: string;
  totalDiscount: number;
  shops: DiscountExportShop[];
}

const styles = StyleSheet.create({
  page: { padding: 20, fontFamily: "Poppins", backgroundColor: "#ffffff", fontSize: 7, color: "#18181b" },
  header: { marginBottom: 6, borderBottomWidth: 1, borderBottomColor: "#e4e4e7", paddingBottom: 5 },
  title: { fontSize: 11, fontWeight: "bold", fontFamily: "Poppins", marginBottom: 2 },
  meta: { fontSize: 7, fontFamily: "Poppins", color: "#71717a" },
  headRow: { flexDirection: "row", backgroundColor: "#f4f4f5", borderBottomWidth: 1, borderBottomColor: "#e4e4e7", paddingVertical: 3.5, paddingHorizontal: 6 },
  th: { fontSize: 6.5, fontWeight: "bold", fontFamily: "Poppins", color: "#52525b", textTransform: "uppercase" },
  dayRow: { flexDirection: "row", backgroundColor: "#fafafa", borderBottomWidth: 0.5, borderBottomColor: "#e4e4e7", paddingVertical: 3, paddingHorizontal: 6, marginTop: 4 },
  dayText: { fontSize: 7, fontWeight: "bold", fontFamily: "Poppins" },
  subHead: { flexDirection: "row", paddingVertical: 2, paddingHorizontal: 6, paddingLeft: 14, borderBottomWidth: 0.5, borderBottomColor: "#e4e4e7" },
  subTh: { fontSize: 6, fontWeight: "bold", fontFamily: "Poppins", color: "#71717a" },
  subRow: { flexDirection: "row", paddingVertical: 2, paddingHorizontal: 6, paddingLeft: 14, borderBottomWidth: 0.5, borderBottomColor: "#f4f4f5" },
  cell: { fontSize: 6.5, fontFamily: "Poppins", color: "#3f3f46" },
  subTotal: { flexDirection: "row", paddingVertical: 2, paddingHorizontal: 6, paddingLeft: 14, backgroundColor: "#f4f4f5" },
  grand: { flexDirection: "row", marginTop: 6, backgroundColor: "#18181b", paddingVertical: 5, paddingHorizontal: 6 },
  grandText: { color: "#ffffff", fontSize: 8, fontWeight: "bold", fontFamily: "Poppins" },
  cDate: { width: "35%" },
  cRef: { width: "35%" },
  cAmt: { width: "30%", textAlign: "right" },
  sShop: { width: "22%" },
  sInv: { width: "16%" },
  sProd: { width: "40%" },
  sAmt: { width: "22%", textAlign: "right" },
});

const fmt = (n: number) =>
  "Rs. " + Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function DiscountPdf({ rows, title, period }: { rows: DiscountExportRow[]; title: string; period: string }) {
  ensurePoppinsRegistered();
  const grand = rows.reduce((s, r) => s + (Number(r.totalDiscount) || 0), 0);
  return (
    <Document>
      <Page size="A4" orientation="portrait" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta}>{period}  •  Exported: {formatExportDateTime()}</Text>
        </View>
        <View style={styles.headRow} fixed>
          <Text style={[styles.th, styles.cDate]}>Date</Text>
          <Text style={[styles.th, styles.cRef]}>Reference</Text>
          <Text style={[styles.th, styles.cAmt]}>Discount (Rs.)</Text>
        </View>
        {rows.map((r, i) => (
          <View key={i}>
            <View style={styles.dayRow} wrap={false}>
              <Text style={[styles.dayText, styles.cDate]}>{r.date}</Text>
              <Text style={[styles.cell, styles.cRef]}>Shops ({r.shops.length})</Text>
              <Text style={[styles.dayText, styles.cAmt]}>{fmt(r.totalDiscount)}</Text>
            </View>
            <View style={styles.subHead} wrap={false}>
              <Text style={[styles.subTh, styles.sShop]}>Shop</Text>
              <Text style={[styles.subTh, styles.sInv]}>Invoice No</Text>
              <Text style={[styles.subTh, styles.sProd]}>Products</Text>
              <Text style={[styles.subTh, styles.sAmt]}>Discount (Rs.)</Text>
            </View>
            {r.shops.map((sh, j) => (
              <View key={j} style={styles.subRow} wrap={false}>
                <Text style={[styles.cell, styles.sShop]}>{sh.shopName}</Text>
                <Text style={[styles.cell, styles.sInv]}>{sh.invoiceNo || "—"}</Text>
                <Text style={[styles.cell, styles.sProd]}>{sh.products}</Text>
                <Text style={[styles.cell, styles.sAmt]}>{fmt(sh.discount)}</Text>
              </View>
            ))}
            <View style={styles.subTotal} wrap={false}>
              <Text style={[styles.dayText, { width: "78%" }]}>Total</Text>
              <Text style={[styles.dayText, styles.sAmt]}>{fmt(r.shops.reduce((s, sh) => s + (Number(sh.discount) || 0), 0))}</Text>
            </View>
          </View>
        ))}
        <View style={styles.grand} wrap={false}>
          <Text style={[styles.grandText, { width: "70%" }]}>GRAND TOTAL</Text>
          <Text style={[styles.grandText, { width: "30%", textAlign: "right" }]}>{fmt(grand)}</Text>
        </View>
      </Page>
    </Document>
  );
}

export function AdditionalDiscountDateWiseExport({
  rows, filename, title = "Additional Discounts (Date Wise)", period,
}: { rows: DiscountExportRow[]; filename: string; title?: string; period: string }) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [xlsBusy, setXlsBusy] = useState(false);
  const empty = rows.length === 0;

  const handlePdf = async () => {
    if (empty) return;
    try {
      setPdfBusy(true);
      await ensurePoppinsRegistered();
      const blob = await pdf(<DiscountPdf rows={rows} title={title} period={period} />).toBlob();
      downloadBlob(blob, `${sanitizeFileName(filename)}.pdf`);
    } catch (err) {
      console.error("Additional discount PDF export failed:", err);
    } finally {
      setPdfBusy(false);
    }
  };

  const handleExcel = () => {
    if (empty) return;
    try {
      setXlsBusy(true);
      const flat: Array<Record<string, unknown>> = [];
      for (const r of rows) {
        for (const sh of r.shops) {
          flat.push({ Date: r.date, Shop: sh.shopName, "Invoice No": sh.invoiceNo || "", Products: sh.products, "Discount (Rs.)": sh.discount });
        }
        flat.push({ Date: r.date, Shop: "Total", "Invoice No": "", Products: "", "Discount (Rs.)": r.totalDiscount });
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, buildWorksheet(flat), "Sheet1");
      XLSX.writeFile(wb, `${sanitizeFileName(filename)}.xlsx`);
    } finally {
      setXlsBusy(false);
    }
  };

  return (
    <div className="flex gap-2">
      <Button
        onClick={handlePdf} variant="default" size="sm" className="whitespace-nowrap"
        icon={pdfBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
        iconClassName="text-white" disabled={pdfBusy || xlsBusy || empty}
      >
        {pdfBusy ? "Preparing PDF..." : "Print PDF"}
      </Button>
      <Button
        onClick={handleExcel} variant="default" size="sm" className="whitespace-nowrap"
        icon={xlsBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
        disabled={pdfBusy || xlsBusy || empty}
      >
        {xlsBusy ? "Exporting..." : "Export Excel"}
      </Button>
    </div>
  );
}
