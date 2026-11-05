import * as XLSX from "xlsx";
import Papa from "papaparse";

export interface ParsedProductImportRow {
  product_code?: string;
  product_name: string;
  category_title?: string;
  sale_rate: number;
  purchase_rate: number;
  packing_qty: number;
  active: boolean;
  is_returnable?: boolean;
  is_rgb?: boolean;
  is_implied?: boolean;
  un_case?: number;
}

export async function parseProductExcel(file: File): Promise<ParsedProductImportRow[]> {
  const fileName = file.name.toLowerCase();
  const isExcel = fileName.endsWith(".xlsx") || fileName.endsWith(".xls");

  let matrix: any[][] = [];

  if (isExcel) {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const worksheet = workbook.Sheets[sheetName];
    matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
  } else {
    const text = await file.text();
    const results = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
    matrix = results.data;
  }

  if (!matrix || matrix.length === 0) {
    return [];
  }

  // Find the header row (flexible scan for header keywords)
  let headerIdx = matrix.findIndex((row) => {
    if (!Array.isArray(row)) return false;
    const str = row.map((cell) => String(cell || "")).join(" ").toLowerCase();
    const hasNameOrProduct = str.includes("product") || str.includes("name") || str.includes("item") || str.includes("desc");
    const hasCodeOrCatOrRate = str.includes("code") || str.includes("category") || str.includes("rate") || str.includes("price") || str.includes("pack");
    return hasNameOrProduct && hasCodeOrCatOrRate;
  });

  // If no descriptive header found, default to first non-empty row
  if (headerIdx === -1) {
    headerIdx = matrix.findIndex((row) => Array.isArray(row) && row.some((cell) => String(cell || "").trim().length > 0));
  }

  if (headerIdx === -1) return [];

  const headers = matrix[headerIdx].map((h: any) => String(h || "").trim());
  const colMap: {
    code?: number;
    name?: number;
    category?: number;
    sale_rate?: number;
    purchase_rate?: number;
    packing_qty?: number;
    status?: number;
    un_case?: number;
    returnable?: number;
    rgb?: number;
    implied?: number;
  } = {};

  headers.forEach((h, idx) => {
    const norm = h.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (norm.includes("code")) {
      colMap.code = idx;
    } else if (norm.includes("product") || norm.includes("name") || norm.includes("item") || norm.includes("desc")) {
      if (colMap.name === undefined) colMap.name = idx;
    } else if (norm.includes("category") || norm.includes("head") || norm.includes("group")) {
      colMap.category = idx;
    } else if (norm.includes("salerate") || norm.includes("saleprice") || (norm.includes("sale") && norm.includes("rate")) || norm.includes("retail")) {
      colMap.sale_rate = idx;
    } else if (norm.includes("purchaserate") || norm.includes("cost") || norm.includes("buy") || (norm.includes("purchase") && norm.includes("rate"))) {
      colMap.purchase_rate = idx;
    } else if (norm.includes("packing") || norm.includes("packqty") || norm.includes("packsize") || norm.includes("pack")) {
      colMap.packing_qty = idx;
    } else if (norm.includes("status") || norm.includes("active") || norm.includes("enabled")) {
      colMap.status = idx;
    } else if (norm.includes("uncase") || norm.includes("unitcase") || norm.includes("setuncase")) {
      colMap.un_case = idx;
    } else if (norm.includes("isrgb") || norm === "rgb") {
      colMap.rgb = idx;
    } else if (norm.includes("returnable") || norm.includes("isreturnable")) {
      colMap.returnable = idx;
    } else if (norm.includes("implied") || norm.includes("isimplied")) {
      colMap.implied = idx;
    }
  });

  // Secondary scan for rgb, returnable, or implied if not matched above
  headers.forEach((h, idx) => {
    const norm = h.toLowerCase();
    if (colMap.rgb === undefined && /rgb/i.test(norm)) {
      colMap.rgb = idx;
    }
    if (colMap.returnable === undefined && /returnable/i.test(norm)) {
      colMap.returnable = idx;
    }
    if (colMap.implied === undefined && /implied/i.test(norm)) {
      colMap.implied = idx;
    }
    if (colMap.un_case === undefined && /un\s*case|unit\s*case/i.test(norm)) {
      colMap.un_case = idx;
    }
  });

  // Fallbacks if columns weren't matched explicitly by normalized names
  if (colMap.name === undefined) {
    colMap.name = headers.findIndex((h) => /name|item/i.test(h));
    if (colMap.name === -1) colMap.name = 1; // Default second column
  }
  if (colMap.code === undefined) {
    const idx = headers.findIndex((h) => /code|id|sku/i.test(h));
    if (idx !== -1) colMap.code = idx;
  }

  const parseBool = (val: any): boolean | undefined => {
    if (val === undefined || val === null || val === "") return undefined;
    if (typeof val === "boolean") return val;
    const s = String(val).trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
    if (s === "false" || s === "0" || s === "no" || s === "n") return false;
    return undefined;
  };

  const parsedProducts: ParsedProductImportRow[] = [];

  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || !Array.isArray(row)) continue;

    const name = colMap.name !== undefined ? String(row[colMap.name] ?? "").trim() : "";
    const code = colMap.code !== undefined ? String(row[colMap.code] ?? "").trim() : "";

    if (!name && !code) continue;

    const category = colMap.category !== undefined ? String(row[colMap.category] ?? "").trim() : "";

    const rawSale = colMap.sale_rate !== undefined ? String(row[colMap.sale_rate] ?? "0") : "0";
    const sale_rate = parseFloat(rawSale.replace(/[^0-9.]/g, "")) || 0;

    const rawPurchase = colMap.purchase_rate !== undefined ? String(row[colMap.purchase_rate] ?? "0") : "0";
    const purchase_rate = parseFloat(rawPurchase.replace(/[^0-9.]/g, "")) || 0;

    const rawPack = colMap.packing_qty !== undefined ? String(row[colMap.packing_qty] ?? "1") : "1";
    const parsedPack = parseFloat(rawPack.replace(/[^0-9.]/g, "")) || 1;
    const packing_qty = parsedPack <= 0 ? 1 : parsedPack;

    const rawStatus = colMap.status !== undefined ? String(row[colMap.status] ?? "active").trim().toLowerCase() : "active";
    const active = !(
      rawStatus === "inactive" ||
      rawStatus === "false" ||
      rawStatus === "0" ||
      rawStatus === "no" ||
      rawStatus === "disabled"
    );

    let un_case: number | undefined = undefined;
    if (colMap.un_case !== undefined) {
      const rawUn = String(row[colMap.un_case] ?? "").trim();
      const parsedUn = parseFloat(rawUn.replace(/[^0-9.]/g, ""));
      if (!isNaN(parsedUn) && parsedUn > 0) un_case = parsedUn;
    }

    const is_returnable = colMap.returnable !== undefined ? parseBool(row[colMap.returnable]) : undefined;
    const is_rgb = colMap.rgb !== undefined ? parseBool(row[colMap.rgb]) : undefined;
    const is_implied = colMap.implied !== undefined ? parseBool(row[colMap.implied]) : undefined;

    parsedProducts.push({
      product_code: code || undefined,
      product_name: name || code,
      category_title: category || undefined,
      sale_rate,
      purchase_rate,
      packing_qty,
      active,
      is_returnable,
      is_rgb,
      is_implied,
      un_case,
    });
  }

  return parsedProducts;
}
