export interface ParsedStockReportItem {
  code: string;
  name: string;
  ph_case: number;
  group?: string;
}

export interface ParsedStockReport {
  reportDate: string | null;
  items: ParsedStockReportItem[];
  rawCount: number;
}

export function parseSapNumber(val: string | null | undefined): number {
  if (!val) return 0;
  const s = String(val).trim();
  if (!s) return 0;

  // If comma is present: e.g. "3.804,24", "25,15", "1.094.400,00"
  if (s.includes(",")) {
    const clean = s.replace(/\./g, "").replace(",", ".");
    return parseFloat(clean) || 0;
  }

  // If no comma:
  // In SAP numbers like "2.400", "3.630", "1.875" where dots separate thousands:
  // If pattern is digits + dot + 3 digits (e.g. 2.400, 35.663)
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    return parseInt(s.replace(/\./g, ""), 10) || 0;
  }

  return parseFloat(s) || 0;
}

export function parseStockReportPdfText(text: string): ParsedStockReport {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let reportDate: string | null = null;
  const items: ParsedStockReportItem[] = [];
  let currentGroup = "";
  let inTable = false;

  // 1. Extract report date from header (e.g., "06.09.2026 Past Stock Monitoring Report" or "06.09.2026")
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const l = lines[i];
    // Ignore lines that include generation time like "05.09.2026 - 12:46"
    if (l.includes(":")) continue;

    const dm = l.match(/\b(\d{2})[./-](\d{2})[./-](\d{4})\b/);
    if (dm) {
      reportDate = `${dm[3]}-${dm[2]}-${dm[1]}`;
      break;
    }
  }

  // 2. Parse lines: Distinguish category headers from real product rows
  for (const line of lines) {
    // Start tracking once table header is reached
    if (!inTable) {
      if (
        line.includes("Group Product") ||
        line.includes("Ph. Case") ||
        line.includes("AmountUn. Case") ||
        line.includes("1.5L Water")
      ) {
        inTable = true;
        if (line.includes("1.5L Water")) {
          currentGroup = "1.5L Water";
        }
      }
      continue;
    }

    // Skip totals, grand totals, headers, page numbers, and report metadata
    if (
      line.includes("Total:") ||
      line.startsWith("Grand Total") ||
      line.includes("Past Stock Monitoring") ||
      line.includes("Product Grouping") ||
      line.includes("Store:") ||
      line.includes("Product Group:") ||
      line.includes("Product:") ||
      line.includes("CCI Voyage") ||
      line.includes("Group Product") ||
      line.includes("Ph. Case Kg") ||
      line.includes("Stock") ||
      line.includes("AmountUn. CaseGroup Product") ||
      /^\d{2}[./-]\d{2}[./-]\d{4}/.test(line) ||
      /^\d+\s*[\/-]\s*\d+$/.test(line) ||
      /^\d+\s*,\s*\d+$/.test(line)
    ) {
      continue;
    }

    // Pattern A (unpdf extracted layout):
    // <code> <ph_case> <kg> <amount><name> <un_case>
    // e.g.: "133501 2.400 23.112,00 1.094.400,00DASANI WATER PET 1.5L 1X6 PS 3.804,24"
    // e.g.: "194375 140 949,20 59.850,00FANTA ORANGE PET1LT UPGRADE 147,94"
    const unpdfMatch = line.match(
      /^(\d{5,8})\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*([A-Za-z][\w\s\-\/\.\+\*#&]+?)\s+([\d.,]+)$/
    );
    if (unpdfMatch) {
      const code = unpdfMatch[1];
      const ph_case = parseSapNumber(unpdfMatch[2]);
      const name = unpdfMatch[5].trim();

      items.push({
        code,
        name,
        ph_case,
        group: currentGroup || undefined,
      });
      continue;
    }

    // Pattern B (OCR / standard table row):
    // <code> <name> <ph_case> <un_case> [<kg>] [<amount>]
    // e.g.: "133501 DASANI WATER PET 1.5L 1X6 PS 2.400 3.804,24 23.112,00 1.094.400,00"
    // Must have a 5-8 digit product code, a name starting with a letter, and multiple numeric columns
    const ocrMatch = line.match(
      /^(\d{5,8})\s+([A-Za-z][\w\s\-\/\.\+\*#&]+?)\s+([\d.,]+)\s+([\d.,]+)(?:\s+([\d.,]+))?(?:\s+([\d.,]+))?$/
    );
    if (ocrMatch) {
      const code = ocrMatch[1];
      const name = ocrMatch[2].trim();
      const ph_case = parseSapNumber(ocrMatch[3]);

      items.push({
        code,
        name,
        ph_case,
        group: currentGroup || undefined,
      });
      continue;
    }

    // If it is not a product row and not metadata/total, this line is a category/product group header
    // e.g. "1.5L Water", "1000 ML PET 1x6", "1500 ML PET 1x6", "2000 ML PET 1x6",
    // "250ML RGB 1x24", "250ML SLIM CAN 1x12", "350 ML PET 1x12", "350ML PULPY 1x12",
    // "500ML PET 1x12", "500ML Water", "PREDATOR"
    currentGroup = line.trim();
  }

  return {
    reportDate,
    items,
    rawCount: items.length,
  };
}
