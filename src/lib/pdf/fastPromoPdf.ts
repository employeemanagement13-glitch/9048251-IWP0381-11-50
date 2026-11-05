import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface PromoPdfInvoice {
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

export interface PromoPdfShopGroup {
  outletCode: string;
  shopName: string;
  invoices: PromoPdfInvoice[];
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

function fmtNum(val: number): string {
  if (!val || Math.abs(val) < 0.001) return "—";
  return Number(val).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTotalNum(val: number): string {
  return Number(val || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMoney(val: number): string {
  return Number(val || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

export function generateFastPromoPdfBuffer(opts: {
  groups: PromoPdfShopGroup[];
  hasUtc?: boolean;
  fromDate?: string;
  toDate?: string;
  filename?: string;
}): ArrayBuffer {
  const groups = opts.groups || [];
  const hasUtc = Boolean(opts.hasUtc);
  const totalCols = hasUtc ? 9 : 8;

  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.width;
  const totShops = groups.length;
  const totInvoices = groups.reduce((sum, g) => sum + (g.invoices?.length || 0), 0);
  const grandTotal = groups.reduce((sum, g) => sum + Number(g.totals?.grand || g.shopTotal || 0), 0);

  const grandTotals = groups.reduce(
    (acc, g) => ({
      col_01: acc.col_01 + (g.totals?.col_01 || 0),
      col_58: acc.col_58 + (g.totals?.col_58 || 0),
      col_59: acc.col_59 + (g.totals?.col_59 || 0),
      col_63: acc.col_63 + (g.totals?.col_63 || 0),
      col_68: acc.col_68 + (g.totals?.col_68 || 0),
      col_utc: acc.col_utc + (g.totals?.col_utc || 0),
      grand: acc.grand + (g.totals?.grand || 0),
    }),
    { col_01: 0, col_58: 0, col_59: 0, col_63: 0, col_68: 0, col_utc: 0, grand: 0 }
  );

  const filterText =
    opts.fromDate && opts.toDate
      ? `${formatDateDisplay(opts.fromDate)} to ${formatDateDisplay(opts.toDate)}`
      : opts.fromDate
      ? `From ${formatDateDisplay(opts.fromDate)}`
      : opts.toDate
      ? `To ${formatDateDisplay(opts.toDate)}`
      : "All Dates";

  const now = new Date();
  const nowStr = `${now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })} ${now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })}`;

  // ── First Page Header (Income Statement Style) ───────────────────────────
  // Title
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text("PROMO SUMMARY REPORT", 14, 18);

  // Total Discount Badge
  const badgeText = `Total Discount: Rs. ${fmtMoney(grandTotal)}`;
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  const badgeTextWidth = doc.getTextWidth(badgeText);
  const badgeBoxWidth = badgeTextWidth + 14;
  const badgeX = pageWidth - 14 - badgeBoxWidth;
  doc.setFillColor(254, 242, 242); // #fef2f2
  doc.setDrawColor(254, 202, 202); // #fecaca
  doc.setLineWidth(0.5);
  doc.roundedRect(badgeX, 8, badgeBoxWidth, 14, 2, 2, "FD");
  doc.setTextColor(185, 28, 28);
  doc.text(badgeText, badgeX + 7, 18);

  // Meta row
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text(`Period: ${filterText}   •   Exported: ${nowStr}`, 14, 29);
  doc.text(
    `Total Shops: ${totShops}   •   Total Invoices: ${totInvoices}`,
    pageWidth - 14,
    29,
    { align: "right" }
  );

  // Formula / Summary Box
  const summaryBoxWidth = pageWidth - 28;
  doc.setFillColor(248, 250, 252); // #f8fafc
  doc.setDrawColor(226, 232, 240); // #e2e8f0
  doc.setLineWidth(0.5);
  doc.roundedRect(14, 34, summaryBoxWidth, 23, 2, 2, "FD");

  doc.setFontSize(6.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Period: ${filterText}   |   Shops: ${totShops}   |   Invoices: ${totInvoices}   |   Total Promo Discount: Rs. ${fmtMoney(grandTotal)}`,
    18,
    43
  );

  doc.setFont("helvetica", "bold");
  doc.setTextColor(185, 28, 28);
  const promoCats = `Discounts: 01 HTH-Trade (Rs. ${fmtMoney(grandTotals.col_01)}) | 58 Cross (Rs. ${fmtMoney(grandTotals.col_58)}) | 59 Add. Trade (Rs. ${fmtMoney(grandTotals.col_59)}) | 63 Dist. (Rs. ${fmtMoney(grandTotals.col_63)}) | 68 Trade (Rs. ${fmtMoney(grandTotals.col_68)})${hasUtc ? ` | UTC (Rs. ${fmtMoney(grandTotals.col_utc)})` : ""}`;
  doc.text(promoCats, 18, 52);

  // ── Table Definition ─────────────────────────────────────────────────────
  const head: any[] = !hasUtc
    ? [
        [
          { content: "Invoice No", styles: { halign: "left" } },
          { content: "Date", styles: { halign: "left" } },
          { content: "01 HTH-Trade Discount", styles: { halign: "right" } },
          { content: "58 Cross Promotion", styles: { halign: "right" } },
          { content: "59 Additional Trade Promotions", styles: { halign: "right" } },
          { content: "63 Distributor Promotion", styles: { halign: "right" } },
          { content: "68 Trade Promotions", styles: { halign: "right" } },
          { content: "Total", styles: { halign: "right" } },
        ],
      ]
    : [
        [
          { content: "Invoice No", styles: { halign: "left" } },
          { content: "Date", styles: { halign: "left" } },
          { content: "01 HTH-Trade Discount", styles: { halign: "right" } },
          { content: "58 Cross Promotion", styles: { halign: "right" } },
          { content: "59 Additional Trade Promotions", styles: { halign: "right" } },
          { content: "63 Distributor Promotion", styles: { halign: "right" } },
          { content: "68 Trade Promotions", styles: { halign: "right" } },
          { content: "UTC Discount", styles: { halign: "right" } },
          { content: "Total", styles: { halign: "right" } },
        ],
      ];

  const columnStyles: Record<number, any> = !hasUtc
    ? {
        0: { cellWidth: 105, halign: "left" },
        1: { cellWidth: 70, halign: "left" },
        2: { cellWidth: 105, halign: "right" },
        3: { cellWidth: 105, halign: "right" },
        4: { cellWidth: 115, halign: "right" },
        5: { cellWidth: 105, halign: "right" },
        6: { cellWidth: 104, halign: "right" },
        7: { cellWidth: 104, halign: "right", fontStyle: "bold" },
      }
    : {
        0: { cellWidth: 95, halign: "left" },
        1: { cellWidth: 65, halign: "left" },
        2: { cellWidth: 90, halign: "right" },
        3: { cellWidth: 90, halign: "right" },
        4: { cellWidth: 95, halign: "right" },
        5: { cellWidth: 90, halign: "right" },
        6: { cellWidth: 90, halign: "right" },
        7: { cellWidth: 85, halign: "right" },
        8: { cellWidth: 88, halign: "right", fontStyle: "bold" },
      };

  const body: any[] = [];
  for (const g of groups) {
    // 1. Shop Header Row
    body.push([
      {
        content: `${g.outletCode} — ${g.shopName}`,
        colSpan: totalCols,
        styles: {
          fillColor: [254, 242, 242],
          textColor: [220, 38, 38],
          fontStyle: "bold",
          fontSize: 7.5,
          halign: "left",
          cellPadding: { top: 3.5, bottom: 3.5, left: 6, right: 4 },
          lineWidth: { top: 1.5, bottom: 0.5, left: 0, right: 0 },
          lineColor: [220, 38, 38],
        },
      },
    ]);

    // 2. Invoices Rows
    for (const inv of g.invoices || []) {
      const invRow: any[] = [
        {
          content: inv.invoice_no || "",
          styles: {
            fontStyle: "bold",
            textColor: [51, 65, 85],
            lineWidth: { bottom: 0.4, top: 0, left: 0, right: 0 },
            lineColor: [244, 244, 245],
          },
        },
        {
          content: formatDateDisplay(inv.invoice_date),
          styles: {
            textColor: [100, 116, 139],
            lineWidth: { bottom: 0.4, top: 0, left: 0, right: 0 },
            lineColor: [244, 244, 245],
          },
        },
        {
          content: fmtNum(inv.col_01_trade_discount),
          styles: {
            halign: "right",
            textColor: inv.col_01_trade_discount > 0 ? [24, 24, 27] : [148, 163, 184],
            lineWidth: { bottom: 0.4, top: 0, left: 0, right: 0 },
            lineColor: [244, 244, 245],
          },
        },
        {
          content: fmtNum(inv.col_58_cross_promotion),
          styles: {
            halign: "right",
            textColor: inv.col_58_cross_promotion > 0 ? [24, 24, 27] : [148, 163, 184],
            lineWidth: { bottom: 0.4, top: 0, left: 0, right: 0 },
            lineColor: [244, 244, 245],
          },
        },
        {
          content: fmtNum(inv.col_59_additional_trade),
          styles: {
            halign: "right",
            textColor: inv.col_59_additional_trade > 0 ? [24, 24, 27] : [148, 163, 184],
            lineWidth: { bottom: 0.4, top: 0, left: 0, right: 0 },
            lineColor: [244, 244, 245],
          },
        },
        {
          content: fmtNum(inv.col_63_distributor),
          styles: {
            halign: "right",
            textColor: inv.col_63_distributor > 0 ? [24, 24, 27] : [148, 163, 184],
            lineWidth: { bottom: 0.4, top: 0, left: 0, right: 0 },
            lineColor: [244, 244, 245],
          },
        },
        {
          content: fmtNum(inv.col_68_trade_promotions),
          styles: {
            halign: "right",
            textColor: inv.col_68_trade_promotions > 0 ? [24, 24, 27] : [148, 163, 184],
            lineWidth: { bottom: 0.4, top: 0, left: 0, right: 0 },
            lineColor: [244, 244, 245],
          },
        },
      ];
      if (hasUtc) {
        invRow.push({
          content: fmtNum(inv.col_utc_discount || 0),
          styles: {
            halign: "right",
            textColor: (inv.col_utc_discount || 0) > 0 ? [24, 24, 27] : [148, 163, 184],
            lineWidth: { bottom: 0.4, top: 0, left: 0, right: 0 },
            lineColor: [244, 244, 245],
          },
        });
      }
      invRow.push({
        content: fmtTotalNum(inv.row_total),
        styles: {
          halign: "right",
          fontStyle: "bold",
          textColor: [9, 9, 11],
          lineWidth: { bottom: 0.4, top: 0, left: 0, right: 0 },
          lineColor: [244, 244, 245],
        },
      });
      body.push(invRow);
    }

    // 3. Shop Breakdown Subtotal Row
    const subtotalStyles = {
      halign: "right",
      fontStyle: "bold",
      textColor: [194, 65, 12],
      fillColor: [255, 247, 237],
      lineWidth: { top: 0.5, bottom: 0.5, left: 0, right: 0 },
      lineColor: [254, 215, 170],
      cellPadding: { top: 2.8, bottom: 2.8, left: 4, right: 4 },
    };

    const subtotalRow: any[] = [
      {
        content: "Total",
        colSpan: 2,
        styles: subtotalStyles,
      },
      { content: fmtNum(g.totals.col_01), styles: subtotalStyles },
      { content: fmtNum(g.totals.col_58), styles: subtotalStyles },
      { content: fmtNum(g.totals.col_59), styles: subtotalStyles },
      { content: fmtNum(g.totals.col_63), styles: subtotalStyles },
      { content: fmtNum(g.totals.col_68), styles: subtotalStyles },
    ];
    if (hasUtc) {
      subtotalRow.push({ content: fmtNum(g.totals.col_utc), styles: subtotalStyles });
    }
    subtotalRow.push({ content: fmtTotalNum(g.totals.grand), styles: subtotalStyles });
    body.push(subtotalRow);

    // 4. Shop Summary / Total Row
    const shopTotalStyles = {
      halign: "right",
      fontStyle: "bold",
      textColor: [220, 38, 38],
      fillColor: [255, 240, 240],
      lineWidth: { bottom: 1.5, top: 0, left: 0, right: 0 },
      lineColor: [220, 38, 38],
      cellPadding: { top: 3.2, bottom: 3.2, left: 4, right: 4 },
    };

    body.push([
      {
        content: `Shop Total (${g.outletCode} — ${g.shopName}):`,
        colSpan: totalCols - 1,
        styles: shopTotalStyles,
      },
      {
        content: fmtTotalNum(g.shopTotal),
        styles: shopTotalStyles,
      },
    ]);
  }

  // 5. Grand Total Row
  const grandTotalStyles = {
    halign: "right",
    fontStyle: "bold",
    textColor: [255, 255, 255],
    fillColor: [220, 38, 38],
    lineWidth: { top: 1.5, bottom: 0, left: 0, right: 0 },
    lineColor: [153, 27, 27],
    cellPadding: { top: 4, bottom: 4, left: 4, right: 4 },
  };

  const grandTotalRow: any[] = [
    {
      content: "Grand Total",
      colSpan: 2,
      styles: grandTotalStyles,
    },
    { content: fmtNum(grandTotals.col_01), styles: grandTotalStyles },
    { content: fmtNum(grandTotals.col_58), styles: grandTotalStyles },
    { content: fmtNum(grandTotals.col_59), styles: grandTotalStyles },
    { content: fmtNum(grandTotals.col_63), styles: grandTotalStyles },
    { content: fmtNum(grandTotals.col_68), styles: grandTotalStyles },
  ];
  if (hasUtc) {
    grandTotalRow.push({ content: fmtNum(grandTotals.col_utc), styles: grandTotalStyles });
  }
  grandTotalRow.push({ content: fmtTotalNum(grandTotals.grand), styles: grandTotalStyles });
  body.push(grandTotalRow);

  autoTable(doc, {
    head,
    body,
    startY: 64,
    margin: { top: 32, left: 14, right: 14, bottom: 26 },
    styles: {
      fontSize: 6.5,
      cellPadding: 2.5,
      overflow: "linebreak",
      lineColor: [228, 228, 231],
      lineWidth: 0.4,
      textColor: [31, 41, 55],
    },
    headStyles: {
      fillColor: [220, 38, 38],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 6.5,
      cellPadding: 3.5,
    },
    columnStyles,
  });

  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pWidth = doc.internal.pageSize.width;
    const pHeight = doc.internal.pageSize.height;

    if (i > 1) {
      // Mini header for continued pages
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(100, 116, 139);
      doc.text("PROMO SUMMARY REPORT  (Continued)", 14, 18);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text(`Period: ${filterText}`, pWidth - 14, 18, { align: "right" });
    }

    // Bottom divider line
    doc.setDrawColor(228, 228, 231);
    doc.setLineWidth(0.5);
    doc.line(14, pHeight - 18, pWidth - 14, pHeight - 18);

    // Footer text
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(148, 163, 184);
    doc.text(`MDOS Distroline • Generated on ${nowStr}`, 14, pHeight - 8);
    doc.text(`Page ${i} of ${pageCount}`, pWidth - 14, pHeight - 8, { align: "right" });
  }

  return doc.output("arraybuffer");
}
