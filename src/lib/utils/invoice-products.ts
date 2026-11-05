import { parseProducts, parseProductsWithCode } from "@/lib/parsers/products";

export interface ProductMarginRow {
  product: string;
  product_id?: string;
  product_code?: string;
  sales: number; // units
  saleRate: number;
  purchaseRate: number;
  caseProfit: number;
  profit: number;
  runningBalance: number;
  hasPrices: boolean;
}

export interface InvoiceSalesResult {
  rows: ProductMarginRow[];
  totalSales: number;
  totalMargin: number;
}

export function getInvoiceDate(inv: any): string {
  return String(
    inv.record_date ||
    inv.delivery_date ||
    inv.invoice_date ||
    inv.scheduled_date ||
    inv.created_at ||
    ""
  ).slice(0, 10);
}

export function calculateProductSalesFromInvoices(
  invoices: any[] = [],
  products: any[] = [],
  fromDate: string,
  toDate: string
): InvoiceSalesResult {
  let totalSales = 0;

  // Build product lookup maps
  const codeToProduct = new Map<string, any>();
  const nameToProduct = new Map<string, any>();

  (products || []).forEach((p) => {
    if (p.product_code) {
      codeToProduct.set(String(p.product_code).trim(), p);
    }
    if (p.product_name) {
      nameToProduct.set(p.product_name.toLowerCase().trim(), p);
    }
  });

  // Track product units: key -> { product, name, units }
  const salesMap = new Map<string, { product?: any; name: string; units: number }>();

  (invoices || [])
    .filter((inv: any) => {
      const d = getInvoiceDate(inv);
      if (!d) return false;
      return d >= fromDate && d <= toDate;
    })
    .forEach((inv: any) => {
      // 1. Calculate sales from invoice amount
      const invoiceAmt = Number(inv.amount ?? inv.invoice_total ?? inv.grand_total ?? 0);
      totalSales += invoiceAmt;

      // 2. Parse products from invoice
      let parsedItems: { code?: string; name: string; qty: number }[] = [];

      if (inv.products && typeof inv.products === "string" && inv.products.trim()) {
        const withCodes = parseProductsWithCode(inv.products);
        if (withCodes && withCodes.length > 0) {
          parsedItems = withCodes;
        } else {
          parsedItems = parseProducts(inv.products);
        }
      } else if (Array.isArray(inv.invoice_lines) && inv.invoice_lines.length > 0) {
        // Fallback for legacy invoice_lines
        parsedItems = inv.invoice_lines.map((l: any) => ({
          code: l.product?.product_code,
          name: l.product?.product_name || l.product_name || "",
          qty: Number(l.qty_delivered ?? l.qty_ordered ?? l.qty ?? 0) || 0,
        }));
      }

      // 3. Aggregate units sold
      parsedItems.forEach((item) => {
        if (!item.qty || item.qty <= 0) return;

        let matched: any = null;
        if (item.code && codeToProduct.has(String(item.code).trim())) {
          matched = codeToProduct.get(String(item.code).trim());
        } else if (item.name) {
          const norm = item.name.toLowerCase().trim();
          if (nameToProduct.has(norm)) {
            matched = nameToProduct.get(norm);
          } else {
            // Partial match fallback
            for (const p of products) {
              const pNorm = (p.product_name || "").toLowerCase().trim();
              if (pNorm && (norm.includes(pNorm) || pNorm.includes(norm))) {
                matched = p;
                break;
              }
            }
          }
        }

        const key = matched ? matched.id : (item.name ? item.name.trim() : "Unknown");
        const displayName = matched?.product_name || item.name || "Unknown Product";

        const current = salesMap.get(key) || { product: matched, name: displayName, units: 0 };
        current.units += item.qty;
        if (matched && !current.product) current.product = matched;
        salesMap.set(key, current);
      });
    });

  // 4. Build output rows
  const rawRows: Omit<ProductMarginRow, "runningBalance">[] = [];

  salesMap.forEach((entry) => {
    if (entry.units <= 0) return;

    const p = entry.product;
    const saleRate = Number(p?.sale_rate ?? 0);
    const purchaseRate = Number(p?.purchase_rate ?? 0);
    const caseProfit = Math.round((saleRate - purchaseRate) * 100) / 100;
    const profit = Math.round(entry.units * caseProfit * 100) / 100;
    const hasPrices = Boolean(p && (saleRate > 0 || purchaseRate > 0));

    rawRows.push({
      product: entry.name,
      product_id: p?.id,
      product_code: p?.product_code || undefined,
      sales: entry.units,
      saleRate,
      purchaseRate,
      caseProfit,
      profit,
      hasPrices,
    });
  });

  // Sort alphabetically
  rawRows.sort((a, b) => a.product.localeCompare(b.product));

  // 5. Compute running balance
  let accumProfit = 0;
  const rows: ProductMarginRow[] = rawRows.map((r) => {
    accumProfit = Math.round((accumProfit + r.profit) * 100) / 100;
    return {
      ...r,
      runningBalance: accumProfit,
    };
  });

  return {
    rows,
    totalSales,
    totalMargin: accumProfit,
  };
}
