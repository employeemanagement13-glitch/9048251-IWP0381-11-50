import { NextRequest, NextResponse } from "next/server";

interface ProductEntry {
  code: string;
  name: string;
  phCase: number;
}

interface InvoiceProducts {
  invoice_no: string;
  products: ProductEntry[];
}

export const runtime = "nodejs";
export const maxDuration = 60;

const TAB_CODE_RE = /^(\d{4,9})\s+(.+)$/;
const SPACE_RE = /^(\d{4,9})\s+(.+?)\s+(-?\d+(?:[.,]\d+)?)\s+(-?[\d.,]+[.,]\d{2})\b/;
const FALLBACK_RE = /^(\d{4,9})\s+(.+?)(?:\s{2,}|\t|\s+)\s*(-?\d+(?:[.,]\d+)?)\s+/;
const INVOICE_NO_RE = /Invoice\s+Nr\s*[:\s]+(?:DATE\s*)?([A-Za-z0-9]+)/i;

function isImpliedProduct(name: string, code: string): boolean {
  const n = name.toUpperCase();
  const c = code;
  return n.includes("IMPLIED") || n.includes("IMP.EMP") || n.includes("IMP EMP") || c.startsWith("80000");
}

function parseProductLine(line: string): ProductEntry | null {
  const trimmed = line.trim();

  if (trimmed.includes("\t")) {
    const parts = trimmed.split("\t").map((p) => p.trim());
    const firstPart = parts[0];
    const codeMatch = TAB_CODE_RE.exec(firstPart);
    if (codeMatch && parts.length > 1) {
      const code = codeMatch[1];
      const name = codeMatch[2].trim();
      const phCase = parseFloat(parts[1].replace(",", "."));
      if (!isNaN(phCase)) {
        return { code, name, phCase };
      }
    }
  }

  const match = SPACE_RE.exec(trimmed);
  if (match) {
    const code = match[1];
    const name = match[2].trim();
    const phCase = parseFloat(match[3].replace(",", "."));
    if (!isNaN(phCase)) {
      return { code, name, phCase };
    }
  }

  const fbMatch = FALLBACK_RE.exec(trimmed);
  if (fbMatch) {
    const code = fbMatch[1];
    const name = fbMatch[2].trim();
    const phCase = parseFloat(fbMatch[3].replace(",", "."));
    if (!isNaN(phCase)) {
      return { code, name, phCase };
    }
  }

  return null;
}

function parseSaleDetailPdf(text: string): InvoiceProducts[] {
  const lines = text.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());

  const invoiceOrder: string[] = [];
  const invoiceProductsMap = new Map<string, ProductEntry[]>();
  let currentInvoice: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const invMatch = INVOICE_NO_RE.exec(trimmed);
    if (invMatch) {
      const invNo = invMatch[1].replace(/^DATE/i, "").trim();
      if (invNo && invNo.toUpperCase() !== "DATE") {
        currentInvoice = invNo;
        if (!invoiceProductsMap.has(currentInvoice)) {
          invoiceProductsMap.set(currentInvoice, []);
          invoiceOrder.push(currentInvoice);
        }
        continue;
      }
    }

    if (currentInvoice) {
      const prodMatch = parseProductLine(trimmed);
      if (prodMatch) {
        const { code, name, phCase } = prodMatch;
        const upperName = name.toUpperCase();
        if (upperName.startsWith("DMG") || upperName.startsWith("DMGD")) {
          continue;
        }
        if (code === "980427" || upperName.includes("PRO POINTS") || upperName.includes("REDEEEM") || upperName.includes("REDEEM")) {
          continue;
        }
        const implied = isImpliedProduct(name, code);
        if (implied) {
          if (!isNaN(phCase) && phCase < 0 && name) {
            const list = invoiceProductsMap.get(currentInvoice) || [];
            list.push({ code, name, phCase });
            invoiceProductsMap.set(currentInvoice, list);
          }
        } else {
          if (!isNaN(phCase) && phCase > 0 && name) {
            const list = invoiceProductsMap.get(currentInvoice) || [];
            list.push({ code, name, phCase });
            invoiceProductsMap.set(currentInvoice, list);
          }
        }
      }
    }
  }

  return invoiceOrder
    .map((invNo) => ({
      invoice_no: invNo,
      products: invoiceProductsMap.get(invNo) || [],
    }))
    .filter((entry) => entry.products.length > 0);
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });

    const invoiceProducts = parseSaleDetailPdf(text);

    return NextResponse.json({
      success: true,
      data: invoiceProducts,
      rawText: text.slice(0, 5000),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
