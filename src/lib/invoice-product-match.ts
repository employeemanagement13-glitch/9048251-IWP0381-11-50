import { parseProductsWithCode } from "@/lib/parsers/products";

/**
 * Same lookup the warehouse deduction uses: match a Sale Detail line to a Products-menu
 * row by product_code first, then by lower-cased product_name. A miss here is the silent
 * money leak — stock is never deducted for that line.
 */

export interface CatalogProductRow {
  product_code?: string | null;
  product_name?: string | null;
}

export interface InvoiceProductSource {
  invoice_no?: string | null;
  products?: string | null;
}

export interface UnmatchedInvoiceProduct {
  label: string;
  code: string;
  name: string;
  invoiceNos: string[];
}

export interface InvoiceProductMatchResult {
  unmatched: UnmatchedInvoiceProduct[];
  unmatchedInvoiceKeys: Set<string>;
  parsedLineCount: number;
}

export interface ProductCatalogIndex {
  codes: Set<string>;
  names: Set<string>;
}

export function buildProductCatalogIndex(
  catalog: readonly CatalogProductRow[]
): ProductCatalogIndex {
  const codes = new Set<string>();
  const names = new Set<string>();
  for (const p of catalog) {
    const code = String(p.product_code ?? "").trim();
    const name = String(p.product_name ?? "").toLowerCase().trim();
    if (code) codes.add(code);
    if (name) names.add(name);
  }
  return { codes, names };
}

export function catalogHasProduct(
  index: ProductCatalogIndex,
  code: string,
  name: string
): boolean {
  const c = String(code ?? "").trim();
  if (c && index.codes.has(c)) return true;
  const n = String(name ?? "").toLowerCase().trim();
  return Boolean(n && index.names.has(n));
}

export function findUnmatchedInvoiceProducts(
  invoices: readonly InvoiceProductSource[],
  catalog: readonly CatalogProductRow[]
): InvoiceProductMatchResult {
  const index = buildProductCatalogIndex(catalog);
  const byKey = new Map<string, UnmatchedInvoiceProduct>();
  const unmatchedInvoiceKeys = new Set<string>();
  let parsedLineCount = 0;

  for (const inv of invoices) {
    const items = parseProductsWithCode(String(inv.products ?? ""));
    if (items.length === 0) continue;
    parsedLineCount += items.length;
    const invNo = String(inv.invoice_no ?? "").trim();
    const invKey = invNo.toUpperCase();

    for (const item of items) {
      if (catalogHasProduct(index, item.code, item.name)) continue;
      const label = `${item.code} ${item.name}`.trim();
      const key = label.toLowerCase();
      let rec = byKey.get(key);
      if (!rec) {
        rec = { label, code: item.code, name: item.name, invoiceNos: [] };
        byKey.set(key, rec);
      }
      if (invNo && !rec.invoiceNos.includes(invNo)) rec.invoiceNos.push(invNo);
      if (invKey) unmatchedInvoiceKeys.add(invKey);
    }
  }

  const unmatched = Array.from(byKey.values());
  unmatched.sort((a, b) => a.label.localeCompare(b.label));
  return { unmatched, unmatchedInvoiceKeys, parsedLineCount };
}

export function formatUnmatchedProductAlert(unmatched: readonly UnmatchedInvoiceProduct[]): string {
  if (unmatched.length === 0) return "";
  const lines = unmatched.slice(0, 12).map((u) => {
    const sample = u.invoiceNos.slice(0, 3).join(", ");
    const extra = u.invoiceNos.length > 3 ? ` +${u.invoiceNos.length - 3}` : "";
    return `${u.label}${sample ? `  (e.g. ${sample}${extra})` : ""}`;
  });
  const more = unmatched.length > 12 ? `\n…and ${unmatched.length - 12} more` : "";
  return (
    `\n\n⚠ ${unmatched.length} product(s) are not in the Products menu. ` +
    `If you Save now, their stock will NOT be deducted and Closing Stock will read high:\n` +
    lines.join("\n") +
    more
  );
}
