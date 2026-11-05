"use client";

import { FileSpreadsheet, Printer, Loader2 } from "lucide-react";
import { useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/Button";

export interface PromoRowExport {
  id?: string;
  outlet_code: string;
  shop_name: string;
  invoice_no: string;
  invoice_date: string;
  col_01_trade_discount: number;
  col_58_cross_promotion: number;
  col_59_additional_trade: number;
  col_63_distributor: number;
  col_68_trade_promotions: number;
  col_utc_discount?: number;
  row_total: number;
}

export interface PromoShopGroupExport {
  outletCode: string;
  shopName: string;
  invoices: PromoRowExport[];
  totals: {
    col_01: number;
    col_58: number;
    col_59: number;
    col_63: number;
    col_68: number;
    col_utc: number;
    grand: number;
  };
  shopTotal: number;
}

export interface PromoExportButtonsProps {
  groups: PromoShopGroupExport[];
  hasUtc?: boolean;
  fromDate?: string;
  toDate?: string;
  filename?: string;
}

function formatDateDisplay(raw: string): string {
  if (!raw) return "";
  const parts = String(raw).split("T")[0];
  const dashParts = parts.split("-");
  if (dashParts.length === 3 && dashParts[0].length === 4) {
    return `${dashParts[2]}/${dashParts[1]}/${dashParts[0]}`;
  }
  return raw;
}

function fmtCurrency(val: number) {
  return `Rs. ${Number(val || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

export function PromoExportButtons({
  groups,
  hasUtc = false,
  fromDate,
  toDate,
  filename,
}: PromoExportButtonsProps) {
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [isExcelLoading, setIsExcelLoading] = useState(false);

  const defaultBaseName =
    fromDate && toDate
      ? `promo_summary_${fromDate}_to_${toDate}`
      : fromDate
      ? `promo_summary_${fromDate}`
      : "promo_summary_report";

  const baseName = sanitizeFileName(filename ? filename.replace(/\.(pdf|xlsx)$/i, "") : defaultBaseName);

  const handleExportPdf = async () => {
    if (!groups || !groups.length) return;

    setIsPdfLoading(true);

    try {
      const res = await fetch("/api/export-promo-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groups,
          hasUtc,
          fromDate,
          toDate,
          filename: baseName,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `Server responded with ${res.status}`);
      }

      const blob = await res.blob();
      downloadBlob(blob, `${baseName}.pdf`);
    } catch (err: any) {
      console.error("Promo PDF export failed:", err);
      alert(`PDF export failed:\n${err?.message || String(err)}`);
    } finally {
      setIsPdfLoading(false);
    }
  };

  const handleExportExcel = async () => {
    if (!groups || !groups.length) return;
    setIsExcelLoading(true);
    await new Promise((r) => setTimeout(r, 40));

    try {
      const totShops = groups.length;
      const totInvoices = groups.reduce((sum, g) => sum + g.invoices.length, 0);
      const grandTotal = groups.reduce((sum, g) => sum + g.totals.grand, 0);

      const grandTotals = groups.reduce(
        (acc, g) => ({
          col_01: acc.col_01 + g.totals.col_01,
          col_58: acc.col_58 + g.totals.col_58,
          col_59: acc.col_59 + g.totals.col_59,
          col_63: acc.col_63 + g.totals.col_63,
          col_68: acc.col_68 + g.totals.col_68,
          col_utc: acc.col_utc + g.totals.col_utc,
          grand: acc.grand + g.totals.grand,
        }),
        { col_01: 0, col_58: 0, col_59: 0, col_63: 0, col_68: 0, col_utc: 0, grand: 0 }
      );

      const totalCols = hasUtc ? 9 : 8;
      const aoa: (string | number)[][] = [];
      const merges: XLSX.Range[] = [];

      aoa.push(["Promo Summary Report", ...Array(totalCols - 1).fill("")]);
      merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } });

      const filterText =
        fromDate && toDate
          ? `${formatDateDisplay(fromDate)} to ${formatDateDisplay(toDate)}`
          : fromDate
          ? `From ${formatDateDisplay(fromDate)}`
          : toDate
          ? `To ${formatDateDisplay(toDate)}`
          : "All Dates";

      aoa.push([`Date Filter: ${filterText}`, ...Array(totalCols - 1).fill("")]);
      merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } });

      aoa.push([
        `Total Shops: ${totShops}   |   Total Invoices: ${totInvoices}   |   Total Discount: ${fmtCurrency(grandTotal)}`,
        ...Array(totalCols - 1).fill(""),
      ]);
      merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: totalCols - 1 } });

      aoa.push([]);

      const headers = [
        "Invoice No",
        "Date",
        "01 HTH-Trade Discount",
        "58 Cross Promotion",
        "59 Additional Trade Promotions",
        "63 Distributor Promotion",
        "68 Trade Promotions",
        ...(hasUtc ? ["UTC Discount"] : []),
        "Total",
      ];
      aoa.push(headers);

      for (const g of groups) {
        const shopRowIdx = aoa.length;
        aoa.push([`${g.outletCode} — ${g.shopName}`, ...Array(totalCols - 1).fill("")]);
        merges.push({ s: { r: shopRowIdx, c: 0 }, e: { r: shopRowIdx, c: totalCols - 1 } });

        for (const inv of g.invoices) {
          if (!hasUtc) {
            aoa.push([
              inv.invoice_no,
              formatDateDisplay(inv.invoice_date),
              inv.col_01_trade_discount || 0,
              inv.col_58_cross_promotion || 0,
              inv.col_59_additional_trade || 0,
              inv.col_63_distributor || 0,
              inv.col_68_trade_promotions || 0,
              inv.row_total,
            ]);
          } else {
            aoa.push([
              inv.invoice_no,
              formatDateDisplay(inv.invoice_date),
              inv.col_01_trade_discount || 0,
              inv.col_58_cross_promotion || 0,
              inv.col_59_additional_trade || 0,
              inv.col_63_distributor || 0,
              inv.col_68_trade_promotions || 0,
              inv.col_utc_discount || 0,
              inv.row_total,
            ]);
          }
        }

        const totalRowIdx = aoa.length;
        if (!hasUtc) {
          aoa.push([
            "Total",
            "",
            g.totals.col_01,
            g.totals.col_58,
            g.totals.col_59,
            g.totals.col_63,
            g.totals.col_68,
            g.totals.grand,
          ]);
        } else {
          aoa.push([
            "Total",
            "",
            g.totals.col_01,
            g.totals.col_58,
            g.totals.col_59,
            g.totals.col_63,
            g.totals.col_68,
            g.totals.col_utc,
            g.totals.grand,
          ]);
        }
        merges.push({ s: { r: totalRowIdx, c: 0 }, e: { r: totalRowIdx, c: 1 } });

        const shopTotalRowIdx = aoa.length;
        aoa.push([
          `Shop Total (${g.outletCode} — ${g.shopName}):`,
          ...Array(totalCols - 2).fill(""),
          g.shopTotal,
        ]);
        merges.push({ s: { r: shopTotalRowIdx, c: 0 }, e: { r: shopTotalRowIdx, c: totalCols - 2 } });

        aoa.push([]);
      }

      const grandTotalRowIdx = aoa.length;
      if (!hasUtc) {
        aoa.push([
          "Grand Total",
          "",
          grandTotals.col_01,
          grandTotals.col_58,
          grandTotals.col_59,
          grandTotals.col_63,
          grandTotals.col_68,
          grandTotals.grand,
        ]);
      } else {
        aoa.push([
          "Grand Total",
          "",
          grandTotals.col_01,
          grandTotals.col_58,
          grandTotals.col_59,
          grandTotals.col_63,
          grandTotals.col_68,
          grandTotals.col_utc,
          grandTotals.grand,
        ]);
      }
      merges.push({ s: { r: grandTotalRowIdx, c: 0 }, e: { r: grandTotalRowIdx, c: 1 } });

      const worksheet = XLSX.utils.aoa_to_sheet(aoa);
      worksheet["!merges"] = merges;
      worksheet["!cols"] = [
        { wch: 18 },
        { wch: 14 },
        { wch: 22 },
        { wch: 22 },
        { wch: 24 },
        { wch: 22 },
        { wch: 22 },
        ...(hasUtc ? [{ wch: 18 }] : []),
        { wch: 18 },
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Promo Summary");
      XLSX.writeFile(workbook, `${baseName}.xlsx`);
    } catch (err: any) {
      alert("Failed to export Excel: " + (err?.message || String(err)));
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
        disabled={isPdfLoading || isExcelLoading || !groups?.length}
        className="h-9 px-3 gap-1.5 text-xs font-semibold text-zinc-700 hover:text-zinc-900 border-zinc-200 hover:bg-zinc-50"
      >
        {isPdfLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-600" />
        ) : (
          <Printer className="h-3.5 w-3.5 text-zinc-600" />
        )}
        <span>{isPdfLoading ? "Printing PDF..." : "Print PDF"}</span>
      </Button>

      <Button
        size="sm"
        variant="outline"
        onClick={handleExportExcel}
        disabled={isExcelLoading || isPdfLoading || !groups?.length}
        className="h-9 px-3 gap-1.5 text-xs font-semibold text-zinc-700 hover:text-zinc-900 border-zinc-200 hover:bg-zinc-50"
      >
        {isExcelLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
        ) : (
          <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
        )}
        <span>{isExcelLoading ? "Exporting..." : "Export Excel"}</span>
      </Button>
    </div>
  );
}
