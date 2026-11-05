"use client";

import { Document, Page, pdf, StyleSheet, Text, View } from "@react-pdf/renderer";
import { FileSpreadsheet, Printer } from "lucide-react";
import { useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/Button";
import { ensureArialRegistered, formatExportDateTime } from "@/lib/pdf/registerFonts";

export interface CreditSummaryInvoice {
  id: string;
  invoice_no: string;
  date: string;
  sale: number;
  paid: number;
  remaining: number;
  status: "Paid" | "Partial" | "Unpaid";
}

export interface CreditSummaryShop {
  shop_id: string;
  shop_name: string;
  outlet_code: string;
  balance: number;
  invoices: CreditSummaryInvoice[];
}

export interface CreditSummaryExportButtonsProps {
  shops: CreditSummaryShop[];
  dateFrom?: string;
  dateTo?: string;
  filename?: string;
}

const styles = StyleSheet.create({
  page: {
    padding: 24,
    fontFamily: "Arial",
    backgroundColor: "#ffffff",
    fontSize: 9,
    color: "#18181b",
  },
  headerContainer: {
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
    paddingBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#09090b",
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 8.5,
    color: "#71717a",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#e51e2a",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#c41a24",
    paddingVertical: 6,
    paddingHorizontal: 4,
    fontWeight: "bold",
    fontSize: 8,
    color: "#ffffff",
  },
  colNum: { width: "5%", textAlign: "center" },
  colInvoice: { width: "20%", paddingLeft: 4 },
  colDate: { width: "13%", paddingLeft: 4 },
  colSale: { width: "18%", textAlign: "right", paddingRight: 6 },
  colPaid: { width: "16%", textAlign: "right", paddingRight: 6 },
  colRemaining: { width: "18%", textAlign: "right", paddingRight: 6 },
  colStatus: { width: "10%", textAlign: "center" },

  shopContainer: {
    marginTop: 8,
    marginBottom: 4,
  },
  shopHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff1f2",
    borderWidth: 1,
    borderColor: "#fecdd3",
    borderLeftWidth: 4,
    borderLeftColor: "#e51e2a",
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  shopLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  shopName: {
    fontSize: 9.5,
    fontWeight: "bold",
    color: "#881337",
  },
  outletBadge: {
    fontSize: 7.5,
    backgroundColor: "#ffffff",
    borderWidth: 0.5,
    borderColor: "#fda4af",
    borderRadius: 2,
    paddingVertical: 1,
    paddingHorizontal: 4,
    color: "#be123c",
    fontFamily: "Courier",
  },
  shopRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  shopBalanceLabel: {
    fontSize: 8.5,
    fontWeight: "bold",
    color: "#9f1239",
  },
  shopBalanceValue: {
    fontSize: 9.5,
    fontWeight: "bold",
    color: "#e11d48",
    fontFamily: "Courier",
  },

  invoiceRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e4e4e7",
    paddingVertical: 4,
    paddingHorizontal: 4,
    alignItems: "center",
    fontSize: 8.5,
  },
  numCell: {
    color: "#71717a",
    fontFamily: "Courier",
  },
  invoiceNoCell: {
    fontWeight: "bold",
    color: "#18181b",
    fontFamily: "Courier",
  },
  dateCell: {
    color: "#52525b",
    fontFamily: "Courier",
  },
  saleCell: {
    fontWeight: "bold",
    color: "#18181b",
    fontFamily: "Courier",
  },
  paidCell: {
    fontWeight: "bold",
    color: "#15803d",
    fontFamily: "Courier",
  },
  remainingCell: {
    fontWeight: "bold",
    color: "#dc2626",
    fontFamily: "Courier",
  },

  statusBadge: {
    fontSize: 7,
    borderRadius: 3,
    paddingVertical: 1.5,
    paddingHorizontal: 5,
    textAlign: "center",
    fontWeight: "bold",
  },
  statusPaid: {
    backgroundColor: "#dcfce7",
    color: "#166534",
  },
  statusPartial: {
    backgroundColor: "#fef3c7",
    color: "#92400e",
  },
  statusUnpaid: {
    backgroundColor: "#fee2e2",
    color: "#991b1b",
  },

  shopTotalRow: {
    flexDirection: "row",
    backgroundColor: "#fafafa",
    borderTopWidth: 0.5,
    borderTopColor: "#e4e4e7",
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
    paddingVertical: 4,
    paddingHorizontal: 4,
    alignItems: "center",
    fontSize: 8.5,
  },
  shopTotalLabelCol: {
    width: "38%",
    textAlign: "right",
    paddingRight: 8,
    color: "#71717a",
    fontSize: 8,
  },

  grandTotalRow: {
    flexDirection: "row",
    backgroundColor: "#f4f4f5",
    borderTopWidth: 1.5,
    borderTopColor: "#71717a",
    borderBottomWidth: 1.5,
    borderBottomColor: "#71717a",
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: "center",
    marginTop: 10,
    fontSize: 9,
    fontWeight: "bold",
  },
  grandTotalLabelCol: {
    width: "38%",
    textAlign: "right",
    paddingRight: 8,
    color: "#09090b",
    fontWeight: "bold",
  },
});

function fmtCurrency(val: number) {
  return `Rs. ${Number(val || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

function CreditSummaryPdfDocument({
  shops,
  dateFrom,
  dateTo,
}: {
  shops: CreditSummaryShop[];
  dateFrom?: string;
  dateTo?: string;
}) {
  const totShops = shops.length;
  const totBalance = shops.reduce((s, r) => s + Number(r.balance || 0), 0);
  const totSale = shops.reduce((s, r) => s + r.invoices.reduce((acc, inv) => acc + Number(inv.sale || 0), 0), 0);
  const totPaid = shops.reduce((s, r) => s + r.invoices.reduce((acc, inv) => acc + Number(inv.paid || 0), 0), 0);
  const totRemaining = shops.reduce((s, r) => s + r.invoices.reduce((acc, inv) => acc + Number(inv.remaining || 0), 0), 0);

  const filterText =
    dateFrom && dateTo
      ? `${dateFrom} to ${dateTo}`
      : dateFrom
      ? `From ${dateFrom}`
      : dateTo
      ? `To ${dateTo}`
      : "All Dates";

  ensureArialRegistered();
  const exportTimeStr = formatExportDateTime();

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.headerContainer}>
          <Text style={styles.title}>Credit Summary Report</Text>
          <View style={styles.metaRow}>
            <Text>Date: {filterText}  •  Exported: {exportTimeStr}</Text>
            <Text>
              Shops: {totShops}  |  Total Balance: {fmtCurrency(totBalance)}  |  Total Remaining: {fmtCurrency(totRemaining)}
            </Text>
          </View>
        </View>

        <View style={styles.tableHeader} fixed>
          <Text style={[styles.colNum]}>#</Text>
          <Text style={[styles.colInvoice]}>INVOICE NO</Text>
          <Text style={[styles.colDate]}>DATE</Text>
          <Text style={[styles.colSale]}>SALE</Text>
          <Text style={[styles.colPaid]}>PAID</Text>
          <Text style={[styles.colRemaining]}>REMAINING</Text>
          <Text style={[styles.colStatus]}>STATUS</Text>
        </View>

        {shops.map((shop) => {
          const shopSale = shop.invoices.reduce((sum, inv) => sum + Number(inv.sale || 0), 0);
          const shopPaid = shop.invoices.reduce((sum, inv) => sum + Number(inv.paid || 0), 0);
          const shopRemaining = shop.invoices.reduce((sum, inv) => sum + Number(inv.remaining || 0), 0);

          return (
            <View key={shop.shop_id} style={styles.shopContainer}>
              <View style={styles.shopHeader} wrap={false}>
                <View style={styles.shopLeft}>
                  <Text style={styles.shopName}>{shop.shop_name}</Text>
                  {shop.outlet_code ? (
                    <Text style={styles.outletBadge}>{shop.outlet_code}</Text>
                  ) : null}
                </View>
                <View style={styles.shopRight}>
                  <Text style={styles.shopBalanceLabel}>Balance:</Text>
                  <Text style={styles.shopBalanceValue}>{fmtCurrency(shop.balance)}</Text>
                </View>
              </View>

              {shop.invoices.map((inv, idx) => (
                <View key={inv.id} style={styles.invoiceRow} wrap={false}>
                  <Text style={[styles.colNum, styles.numCell]}>{idx + 1}.</Text>
                  <Text style={[styles.colInvoice, styles.invoiceNoCell]}>{inv.invoice_no}</Text>
                  <Text style={[styles.colDate, styles.dateCell]}>{inv.date}</Text>
                  <Text style={[styles.colSale, styles.saleCell]}>{fmtCurrency(inv.sale)}</Text>
                  <Text style={[styles.colPaid, styles.paidCell]}>{fmtCurrency(inv.paid)}</Text>
                  <Text style={[styles.colRemaining, styles.remainingCell]}>{fmtCurrency(inv.remaining)}</Text>
                  <View style={styles.colStatus}>
                    <Text
                      style={[
                        styles.statusBadge,
                        inv.status === "Paid"
                          ? styles.statusPaid
                          : inv.status === "Partial"
                          ? styles.statusPartial
                          : styles.statusUnpaid,
                      ]}
                    >
                      {inv.status}
                    </Text>
                  </View>
                </View>
              ))}

              <View style={styles.shopTotalRow} wrap={false}>
                <Text style={styles.shopTotalLabelCol}>
                  Shop Total ({shop.invoices.length} invoices):
                </Text>
                <Text style={[styles.colSale, styles.saleCell]}>{fmtCurrency(shopSale)}</Text>
                <Text style={[styles.colPaid, styles.paidCell]}>{fmtCurrency(shopPaid)}</Text>
                <Text style={[styles.colRemaining, styles.remainingCell]}>{fmtCurrency(shopRemaining)}</Text>
                <Text style={[styles.colStatus, { color: "#a1a1aa" }]}>—</Text>
              </View>
            </View>
          );
        })}

        <View style={styles.grandTotalRow} wrap={false}>
          <Text style={styles.grandTotalLabelCol}>
            Grand Total ({totShops} Shops):
          </Text>
          <Text style={[styles.colSale, styles.saleCell]}>{fmtCurrency(totSale)}</Text>
          <Text style={[styles.colPaid, styles.paidCell]}>{fmtCurrency(totPaid)}</Text>
          <Text style={[styles.colRemaining, styles.remainingCell]}>{fmtCurrency(totRemaining)}</Text>
          <Text style={[styles.colStatus, { color: "#a1a1aa" }]}>—</Text>
        </View>
      </Page>
    </Document>
  );
}

export function CreditSummaryExportButtons({
  shops,
  dateFrom,
  dateTo,
  filename = "credit_summary_report",
}: CreditSummaryExportButtonsProps) {
  const [pdfProgress, setPdfProgress] = useState<string | null>(null);
  const baseName = sanitizeFileName(filename.replace(/\.(pdf|xlsx)$/i, ""));

  const handleExportPdf = async () => {
    if (!shops || !shops.length) return;
    setPdfProgress("Preparing PDF...");

    try {
      await ensureArialRegistered();
      const blob = await pdf(
        <CreditSummaryPdfDocument shops={shops} dateFrom={dateFrom} dateTo={dateTo} />
      ).toBlob();
      downloadBlob(blob, `${baseName}.pdf`);
    } finally {
      setPdfProgress(null);
    }
  };

  const handleExportExcel = () => {
    if (!shops || !shops.length) return;

    const totShops = shops.length;
    const totBalance = shops.reduce((s, r) => s + Number(r.balance || 0), 0);
    const totSale = shops.reduce(
      (s, r) => s + r.invoices.reduce((acc, inv) => acc + Number(inv.sale || 0), 0),
      0
    );
    const totPaid = shops.reduce(
      (s, r) => s + r.invoices.reduce((acc, inv) => acc + Number(inv.paid || 0), 0),
      0
    );
    const totRemaining = shops.reduce(
      (s, r) => s + r.invoices.reduce((acc, inv) => acc + Number(inv.remaining || 0), 0),
      0
    );

    const aoa: (string | number)[][] = [];
    const merges: XLSX.Range[] = [];

    // Title
    aoa.push(["Credit Summary Report", "", "", "", "", "", ""]);
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } });

    // Date Filter & Summary
    const filterText =
      dateFrom && dateTo
        ? `${dateFrom} to ${dateTo}`
        : dateFrom
        ? `From ${dateFrom}`
        : dateTo
        ? `To ${dateTo}`
        : "All Dates";

    aoa.push([`Date Filter: ${filterText}`, "", "", "", "", "", ""]);
    merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 6 } });

    aoa.push([
      `Total Shops: ${totShops}   |   Total Balance: ${fmtCurrency(totBalance)}   |   Total Remaining: ${fmtCurrency(totRemaining)}`,
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
    merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 6 } });

    aoa.push([]); // empty spacer

    // Column Headers
    aoa.push(["#", "INVOICE NO", "DATE", "SALE", "PAID", "REMAINING", "STATUS"]);

    for (const shop of shops) {
      const shopSale = shop.invoices.reduce((sum, inv) => sum + Number(inv.sale || 0), 0);
      const shopPaid = shop.invoices.reduce((sum, inv) => sum + Number(inv.paid || 0), 0);
      const shopRemaining = shop.invoices.reduce((sum, inv) => sum + Number(inv.remaining || 0), 0);

      const shopRowIdx = aoa.length;
      aoa.push([
        `${shop.shop_name}${shop.outlet_code ? ` (${shop.outlet_code})` : ""}`,
        "",
        "",
        "",
        "",
        `Balance: ${fmtCurrency(shop.balance)}`,
        "",
      ]);
      merges.push({ s: { r: shopRowIdx, c: 0 }, e: { r: shopRowIdx, c: 4 } });
      merges.push({ s: { r: shopRowIdx, c: 5 }, e: { r: shopRowIdx, c: 6 } });

      shop.invoices.forEach((inv, idx) => {
        aoa.push([
          `${idx + 1}.`,
          inv.invoice_no,
          inv.date,
          inv.sale,
          inv.paid,
          inv.remaining,
          inv.status,
        ]);
      });

      // Shop total
      aoa.push([
        "",
        "",
        `Shop Total (${shop.invoices.length} invoices):`,
        shopSale,
        shopPaid,
        shopRemaining,
        "—",
      ]);

      aoa.push([]); // blank separator line between shops
    }

    // Grand total
    aoa.push([
      "",
      "",
      `Grand Total (${totShops} Shops):`,
      totSale,
      totPaid,
      totRemaining,
      "—",
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    worksheet["!merges"] = merges;
    worksheet["!cols"] = [
      { wch: 8 },  // #
      { wch: 22 }, // Invoice No
      { wch: 14 }, // Date
      { wch: 18 }, // Sale
      { wch: 18 }, // Paid
      { wch: 18 }, // Remaining
      { wch: 14 }, // Status
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Credit Summary");
    XLSX.writeFile(workbook, `${baseName}.xlsx`);
  };

  return (
    <div className="flex gap-2">
      <Button
        onClick={handleExportPdf}
        variant="default"
        size="sm"
        className="whitespace-nowrap"
        icon={<Printer className="h-3.5 w-3.5" />}
        iconClassName="text-white"
        disabled={pdfProgress !== null || !shops?.length}
      >
        {pdfProgress ?? "Print PDF"}
      </Button>

      <Button
        onClick={handleExportExcel}
        variant="default"
        size="sm"
        className="whitespace-nowrap"
        icon={<FileSpreadsheet className="h-3.5 w-3.5" />}
        disabled={!shops?.length}
      >
        Export Excel
      </Button>
    </div>
  );
}
