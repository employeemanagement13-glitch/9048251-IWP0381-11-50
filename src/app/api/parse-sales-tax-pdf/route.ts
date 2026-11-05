import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Robust European / Pakistani number parser:
 * Formats:
 * "1,00"         -> 1.00
 * "818,00"       -> 818.00
 * "1.636,00"     -> 1636.00
 * "134.978,00"   -> 134978.00
 * "-5,30"        -> -5.30
 * "-14.166,80"   -> -14166.80
 * "0,00"         -> 0.00
 * "-10,60"       -> -10.60
 */
function parseEuroPakNum(str?: string | null): number | null {
  if (!str) return null;
  let s = String(str).trim();
  if (s.includes("#") || !s) return null;

  // Handle minus sign variations (unicode minus, en-dash, em-dash, standard hyphen)
  let isNegative = false;
  if (/^[-\u2010\u2012\u2013\u2014\u2212]/.test(s)) {
    isNegative = true;
    s = s.replace(/^[-\u2010\u2012\u2013\u2014\u2212]\s*/, "");
  }

  // If format is like 1.234,56 or 1234,56 (dots for thousands, comma for decimal)
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    // Standard decimal comma: 147,30 or 1,00
    s = s.replace(",", ".");
  } else if (s.includes(".")) {
    // If only dots exist and there are 3 decimals (e.g. "1.636" where dot is thousand sep)
    // In this report, all decimals have 2 digits (e.g. ,00, ,25, ,30).
    // A single dot followed by 3 digits is a thousand separator.
    if (/\.\d{3}$/.test(s)) {
      s = s.replace(/\./g, "");
    }
  }

  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return isNegative ? -Math.abs(n) : n;
}

function parseDateStr(s?: string | null): string | null {
  if (!s) return null;
  const m = s.match(/(\d{2})[./-](\d{2})[./-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const numPages = pdf.numPages;

    const parsedInvoices: any[] = [];
    const PAGE_CHUNK = 10;

    for (let p = 1; p <= numPages; p += PAGE_CHUNK) {
      const pageBatch = Array.from(
        { length: Math.min(PAGE_CHUNK, numPages - p + 1) },
        (_, idx) => p + idx
      );

      const pageResults = await Promise.all(
        pageBatch.map(async (pageNum) => {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          return (textContent.items as any[]).filter(
            (it) => it.str && it.str.trim()
          );
        })
      );

      for (const items of pageResults) {
        // Sort items: Y desc (top to bottom), then X asc (left to right)
        items.sort((a, b) => {
          if (Math.abs(a.transform[5] - b.transform[5]) > 2.5) {
            return b.transform[5] - a.transform[5];
          }
          return a.transform[4] - b.transform[4];
        });

        // Group items into visual lines
        const lines: { y: number; items: any[] }[] = [];
        let curY: number | null = null;
        let curLine: any[] = [];
        for (const it of items) {
          const y = it.transform[5];
          if (curY === null || Math.abs(curY - y) > 2.5) {
            if (curLine.length) lines.push({ y: curY!, items: curLine });
            curY = y;
            curLine = [it];
          } else {
            curLine.push(it);
          }
        }
        if (curLine.length) lines.push({ y: curY!, items: curLine });

        // Locate table header line
        let headerIdx = -1;
        for (let i = 0; i < lines.length; i++) {
          const lText = lines[i].items.map((it) => it.str).join(" ");
          if (
            (lText.includes("Invoice No") || lText.includes("Invoice")) &&
            (lText.includes("Buyer Code") || lText.includes("Total Qty") || lText.includes("Sales Tax"))
          ) {
            headerIdx = i;
            break;
          }
        }

        const startLine = headerIdx >= 0 ? headerIdx + 1 : 0;

        for (let i = startLine; i < lines.length; i++) {
          const l = lines[i];
          const lText = l.items.map((it) => it.str).join(" ");
          if (lText.includes("TOTAL:") || lText.includes("CCI Voyage")) {
            continue;
          }

          // Check if this line starts an invoice: Date (x < 60) and Invoice No (x ~65-125)
          const dateItem = l.items.find(
            (it) => it.transform[4] < 60 && /\d{2}\.\d{2}\.\d{4}/.test(it.str)
          );
          const invItem = l.items.find(
            (it) =>
              it.transform[4] >= 65 &&
              it.transform[4] < 125 &&
              /^[a-zA-Z0-9_-]+$/.test(it.str.trim())
          );

          if (dateItem && invItem) {
            const rawDate = dateItem.str.trim();
            const invoiceNo = invItem.str.trim();
            if (
              invoiceNo.toLowerCase() === "no" ||
              invoiceNo.toLowerCase() === "invoice"
            ) {
              continue;
            }

            // Buyer code: numeric, located between x=175 and x=245
            const buyerCodeItem = l.items.find(
              (it) =>
                it.transform[4] >= 175 &&
                it.transform[4] < 245 &&
                /^\d{6,15}$/.test(it.str.trim())
            );
            const buyerCode = buyerCodeItem ? buyerCodeItem.str.trim() : null;

            // Buyer name: starts at x >= 235 and ends before CNIC / Tax No column (x < 320)
            const nameParts: string[] = [];
            l.items
              .filter((it) => it.transform[4] >= 235 && it.transform[4] < 318)
              .forEach((it) => {
                let s = it.str.trim();
                // Strip CNIC if concatenated
                s = s.replace(/\b\d{10,15}\b/, "").trim();
                if (s && !/^\d+$/.test(s)) nameParts.push(s);
              });

            // Lookahead next lines for multi-line wrapped buyer names
            for (let j = i + 1; j < lines.length; j++) {
              const nextL = lines[j];
              // If next line starts a new invoice, stop
              const nextDate = nextL.items.find(
                (it) => it.transform[4] < 60 && /\d{2}\.\d{2}\.\d{4}/.test(it.str)
              );
              const nextInv = nextL.items.find(
                (it) =>
                  it.transform[4] >= 65 &&
                  it.transform[4] < 125 &&
                  /^[a-zA-Z0-9_-]+$/.test(it.str.trim())
              );
              if (nextDate && nextInv) break;

              const nextLText = nextL.items.map((it) => it.str).join(" ");
              if (nextLText.includes("TOTAL:") || nextLText.includes("CCI Voyage")) {
                break;
              }

              // Collect wrapped buyer name lines
              const wrapNameItems = nextL.items.filter(
                (it) => it.transform[4] >= 235 && it.transform[4] < 318
              );
              wrapNameItems.forEach((it) => {
                let s = it.str.trim();
                s = s.replace(/\b\d{10,15}\b/, "").trim();
                if (s && !/^\d+$/.test(s)) nameParts.push(s);
              });
            }
            const buyerName = nameParts.join(" ").trim() || null;

            // Tax return: Y, N, N/A (x between 420 and 460)
            const taxReturnItem = l.items.find(
              (it) =>
                it.transform[4] >= 420 &&
                it.transform[4] < 460 &&
                /^(Y|N|N\/A)$/i.test(it.str.trim())
            );
            const taxReturn = taxReturnItem ? taxReturnItem.str.trim().toUpperCase() : null;

            // Numeric columns on the right half of the line (x >= 490):
            // [0] Total Qty  (~500-530)
            // [1] Excl Tax   (~530-575)
            // [2] Sales Tax  (~575-620)
            // [3] Adv. Tax   (~620-665)
            // [4] Disc. Tot. (~665-715)
            // [5] Total Inv  (~715-800)
            const numTokens: { x: number; str: string; num: number | null }[] = [];
            const rightItems = l.items.filter((it) => it.transform[4] >= 490);
            for (const it of rightItems) {
              const parts = it.str.trim().split(/\s+/);
              for (const p of parts) {
                numTokens.push({
                  x: it.transform[4],
                  str: p,
                  num: parseEuroPakNum(p),
                });
              }
            }

            let totalQty: number | null = null;
            let exclTax: number | null = null;
            let salesTax: number | null = null;
            let advTax: number | null = null;
            let discTot: number | null = null;
            let amount: number | null = null;

            if (numTokens.length >= 6) {
              totalQty = numTokens[0].num;
              exclTax = numTokens[1].num;
              salesTax = numTokens[2].num;
              advTax = numTokens[3].num;
              discTot = numTokens[4].num;
              amount = numTokens[5].num;
            } else {
              // Position-based fallback
              for (const token of numTokens) {
                const x = token.x;
                if (x < 530 && totalQty === null) totalQty = token.num;
                else if (x >= 530 && x < 575 && exclTax === null) exclTax = token.num;
                else if (x >= 575 && x < 620 && salesTax === null) salesTax = token.num;
                else if (x >= 620 && x < 665 && advTax === null) advTax = token.num;
                else if (x >= 665 && x < 715 && discTot === null) discTot = token.num;
                else if (x >= 715 && amount === null) amount = token.num;
              }
            }

            // Auto-calculate exclTax if printed as "########" or null
            if (exclTax === null && amount !== null && salesTax !== null) {
              exclTax =
                Math.round(
                  (amount - salesTax - (advTax || 0) - (discTot || 0)) * 100
                ) / 100;
            }

            const parsedDate = parseDateStr(rawDate);

            parsedInvoices.push({
              invoice_no: invoiceNo,
              outlet_code: buyerCode,
              outlet_name: buyerName,
              record_date: parsedDate,
              delivery_date: parsedDate,
              tax_return: taxReturn,
              total_qty: totalQty,
              excl_tax: exclTax,
              sales_tax: salesTax,
              adv_tax: advTax,
              disc_tot: discTot,
              amount: amount,
              // Standardized aliases
              grand_total: amount,
              excl_tax_amount: exclTax,
              advance_income_tax: advTax,
              discount_total: discTot,
            });
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      count: parsedInvoices.length,
      data: parsedInvoices,
    });
  } catch (err: any) {
    console.error("[parse-sales-tax-pdf] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
