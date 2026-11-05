/**
 * Translation layer: MDOS database rows → FIFO events.
 * =====================================================
 *
 * Kept separate from the server action so the mapping rules — which source is an inflow,
 * which date governs it, which quantity actually entered the warehouse — can be tested
 * without a database. `runFifo` then turns these events into inventory values.
 *
 * The quantity rules deliberately mirror the `warehouse_standard_levels` view, because a
 * valuation ledger that disagrees with the on-hand view will drift away from physical stock
 * and never recover. Reading that view (`supabase/mdos_v62_*.sql`) term by term:
 *
 *   on hand = Σ sell-in net arrivals          → `purchase`
 *           + Σ stock_report_entries.ph_case  → `opening_count`
 *           − Σ sale_entry_lines.qty          → `sale`      (dated by the invoice's delivery)
 *           − Σ waybill_items.quantity        → `adjustment_out`
 *           − Σ leased_empty_items (out on lease date, in on returned_date)
 *           − Σ damaged_stock.quantity        → `adjustment_out`
 *
 * The last three leave at FIFO cost but are not cost of goods *sold*, so they are reported
 * separately from COGS rather than folded into it.
 */

import { parseProductsWithCode } from "@/lib/parsers/products";
import type { FifoEvent } from "./engine";

// ── Row shapes (only the columns this module reads) ────────────────────────────────────

export interface ProductRow {
  id: string;
  product_name?: string | null;
  product_code?: string | null;
  purchase_rate?: number | string | null;
  product_categories?: { is_implied?: boolean | null } | null | Array<{ is_implied?: boolean | null }>;
}

export interface StockReportRow {
  product_id: string;
  report_date: string;
  ph_case?: number | string | null;
  amount?: number | string | null;
}

export interface SellInArrivedRow {
  arrived_qty?: number | string | null;
  returned_qty?: number | string | null;
}

export interface SellInLineRow {
  product_id: string;
  qty?: number | string | null;
  rate?: number | string | null;
  bill_amount?: number | string | null;
  net_bill_amount?: number | string | null;
  invoice_type?: string | null;
  sell_in_arrived_lines?: SellInArrivedRow | SellInArrivedRow[] | null;
}

export interface SellInOrderRow {
  id: string;
  po_no?: string | null;
  transaction_date?: string | null;
  billed_date?: string | null;
  created_at?: string | null;
  status?: string | null;
  sell_in_lines?: SellInLineRow[] | null;
}

export interface SaleEntryRow {
  sale_no?: string | null;
  sale_entry_lines?: Array<{ product_id: string; qty?: number | string | null }> | null;
}

export interface InvoiceRow {
  invoice_no?: string | null;
  delivery_date?: string | null;
  products?: string | null;
}

/** `damaged_stock` has no product_id — it is matched on product name, as the views do. */
export interface DamagedStockRow {
  product_name?: string | null;
  quantity?: number | string | null;
  recorded_date?: string | null;
}

export interface WaybillItemRow {
  product_id: string;
  quantity?: number | string | null;
  waybills?: { date?: string | null } | Array<{ date?: string | null }> | null;
}

export interface LeasedEmptyItemRow {
  product_id: string;
  quantity?: number | string | null;
  returned_qty?: number | string | null;
  returned_date?: string | null;
  leased_empties?: { date?: string | null } | Array<{ date?: string | null }> | null;
  leased_empty_returns?: Array<{ return_date?: string | null; quantity?: number | string | null }> | null;
}

/** PostgREST returns a to-one embed as an object or a single-element array depending on the FK. */
function embedded<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// ── Product classification ────────────────────────────────────────────────────────────

/** PO statuses whose goods have physically arrived and therefore belong in the ledger. */
export const CONFIRMED_PO_STATUSES: ReadonlySet<string> = new Set([
  "stock_arrived",
  "on_credit",
  "billed",
]);

export interface ProductClassification {
  /** Implied/empties SKUs: no cost basis, kept out of the ledger entirely. */
  impliedProductIds: Set<string>;
  /** products.purchase_rate, used only as a stock-out fallback. */
  fallbackRates: Map<string, number>;
  productCodeMap: Map<string, ProductRow>;
  productNameMap: Map<string, ProductRow>;
  /**
   * Products that look like empties by name or code but whose category does not say so.
   * Classification does NOT act on this — it exists so a missing `is_implied` flag is
   * reported rather than guessed at. Each entry is either a genuine beverage that happens
   * to be named or numbered like an empty (correctly costed, nothing to do) or an empty
   * whose category needs fixing in the Products menu.
   */
  suspectedUnflaggedImplied: ProductRow[];
}

function categoryOf(row: ProductRow): { is_implied?: boolean | null } | null {
  const cat = row.product_categories;
  if (Array.isArray(cat)) return cat[0] ?? null;
  return cat ?? null;
}

/**
 * Empties detection is driven solely by `product_categories.is_implied`.
 *
 * It used to also treat any product whose name contained "IMPLIED" or whose code began
 * "80000" as an empty. Those string matches cannot distinguish a shell from a beverage that
 * merely reads like one, and being excluded is not a small penalty: an excluded product's
 * entire position silently disappears from Opening and Closing Stock, with no shortfall and
 * no warning, because exclusion happens before the ledger ever sees its events. A single
 * colliding product code would therefore understate stock indefinitely and invisibly.
 *
 * The flag is editable in the Products menu, so it is both authoritative and fixable.
 */
export function classifyProducts(rows: readonly ProductRow[]): ProductClassification {
  const impliedProductIds = new Set<string>();
  const fallbackRates = new Map<string, number>();
  const productCodeMap = new Map<string, ProductRow>();
  const productNameMap = new Map<string, ProductRow>();
  const suspectedUnflaggedImplied: ProductRow[] = [];

  for (const p of rows) {
    const code = String(p.product_code ?? "").trim();
    const isImplied = Boolean(categoryOf(p)?.is_implied);

    if (isImplied) {
      impliedProductIds.add(p.id);
      fallbackRates.set(p.id, 0);
    } else {
      fallbackRates.set(p.id, Number(p.purchase_rate) || 0);
      if ((p.product_name || "").toUpperCase().includes("IMPLIED") || code.startsWith("80000")) {
        suspectedUnflaggedImplied.push(p);
      }
    }

    if (code) productCodeMap.set(code, p);
    if (p.product_name) productNameMap.set(p.product_name.toLowerCase().trim(), p);
  }

  return {
    impliedProductIds,
    fallbackRates,
    productCodeMap,
    productNameMap,
    suspectedUnflaggedImplied,
  };
}

// ── Sell-in helpers ───────────────────────────────────────────────────────────────────

/**
 * The date a PO's goods became inventory.
 * `transaction_date` is the user-entered arrival date and wins; `billed_date` and
 * `created_at` only cover rows saved before that field was captured.
 */
export function getOrderEffDate(order: SellInOrderRow): string | null {
  if (order.transaction_date) return String(order.transaction_date).slice(0, 10);
  if (order.billed_date) return String(order.billed_date).slice(0, 10);
  if (order.created_at) return String(order.created_at).slice(0, 10);
  return null;
}

/**
 * What actually entered the warehouse for a PO line: arrived minus returned at the door,
 * falling back to the ordered quantity for POs saved before arrivals were recorded.
 */
export function resolveArrivedQty(line: SellInLineRow): number {
  const arrived = Array.isArray(line.sell_in_arrived_lines)
    ? line.sell_in_arrived_lines[0]
    : line.sell_in_arrived_lines;
  if (arrived && arrived.arrived_qty !== null && arrived.arrived_qty !== undefined) {
    return Math.max(0, (Number(arrived.arrived_qty) || 0) - (Number(arrived.returned_qty) || 0));
  }
  return Number(line.qty) || 0;
}

/**
 * Unit cost of a PO line. A zero rate is legitimate for scheme and promotional deliveries,
 * so it is kept: dropping such a line would send the matching sale to the stock-out fallback
 * and overstate COGS. `bill_amount` is a generated `rate × qty` column, so dividing it by the
 * ordered quantity recovers the rate for rows where `rate` itself was left blank.
 */
export function resolveLineRate(line: SellInLineRow): number {
  const rate = Number(line.rate) || 0;
  if (rate > 0) return rate;
  const orderedQty = Number(line.qty) || 0;
  if (orderedQty > 0) {
    const billed = Number(line.bill_amount) || Number(line.net_bill_amount) || 0;
    if (billed !== 0) return billed / orderedQty;
  }
  return 0;
}

// ── Event construction ────────────────────────────────────────────────────────────────

export interface BuildFifoEventsInput {
  products: ProductClassification;
  stockReports: readonly StockReportRow[];
  sellInOrders: readonly SellInOrderRow[];
  saleEntries: readonly SaleEntryRow[];
  /** Delivered invoices only — a non-delivered invoice has not moved any stock. */
  invoices: readonly InvoiceRow[];
  /**
   * Damaged stock at every status. `warehouse_standard_levels` (v62) and
   * `stock_balance_by_level` (v37) both subtract damaged stock regardless of whether the
   * CCBPL claim is still `pending`, `complaint_filed` or already `adjusted`, so the ledger
   * does the same — damaged cases are not saleable stock whatever the claim says.
   */
  damagedStock?: readonly DamagedStockRow[];
  /** Empties dispatched back to CCBPL. */
  waybillItems?: readonly WaybillItemRow[];
  /** Empties lent to outlets, net of what has come back. */
  leasedEmptyItems?: readonly LeasedEmptyItemRow[];
}

export interface BuildFifoEventsResult {
  events: FifoEvent[];
  /** PO id → inventory value received, for the Purchases drill-down. */
  orderValueById: Map<string, number>;
  /** Delivered invoices with neither a sale_entry link nor parseable product text. */
  unlinkedInvoices: string[];
  /**
   * Damaged-stock product names that match no product row. Those cases cannot be written off
   * because there is nothing to write them off against, so the name is reported instead.
   */
  unmatchedDamagedNames: string[];
}

/** Index sale entries under every invoice-number spelling seen in the wild. */
function indexSaleEntries(saleEntries: readonly SaleEntryRow[]): Map<string, SaleEntryRow> {
  const map = new Map<string, SaleEntryRow>();
  for (const s of saleEntries) {
    const raw = (s.sale_no || "").trim();
    if (!raw) continue;
    const clean = raw.replace(/^INV-/i, "").trim();
    map.set(raw, s);
    map.set(clean, s);
    map.set(`INV-${clean}`, s);
    map.set(clean.replace(/^0+/, ""), s);
  }
  return map;
}

function lookupSaleEntry(map: Map<string, SaleEntryRow>, invoiceNo: string): SaleEntryRow | undefined {
  const clean = invoiceNo.replace(/^INV-/i, "").trim();
  return (
    map.get(invoiceNo) ||
    map.get(clean) ||
    map.get(`INV-${clean}`) ||
    map.get(clean.replace(/^0+/, ""))
  );
}

export function buildFifoEvents(input: BuildFifoEventsInput): BuildFifoEventsResult {
  const {
    products,
    stockReports,
    sellInOrders,
    saleEntries,
    invoices,
    damagedStock = [],
    waybillItems = [],
    leasedEmptyItems = [],
  } = input;
  const events: FifoEvent[] = [];
  const orderValueById = new Map<string, number>();
  const unlinkedInvoices: string[] = [];
  const unmatchedDamagedNames: string[] = [];

  // 1. Stock reports → `opening_count` inflows, effective at the start of their date.
  //    In MDOS a stock report is a goods-receipt rather than a replacement count: the
  //    warehouse view adds every row's ph_case, so the ledger adds it too. `amount` is the
  //    counted stock's total cost and is passed through as an exact value, which keeps a
  //    total-over-case-count rate (e.g. 1000 over 3 cases) free of rounding error.
  for (const e of stockReports) {
    const qty = Number(e.ph_case) || 0;
    if (!e.product_id || !e.report_date || qty <= 0) continue;
    const amount = Number(e.amount) || 0;
    events.push({
      productId: e.product_id,
      date: e.report_date,
      kind: "opening_count",
      qty,
      value: amount > 0 ? amount : qty * (products.fallbackRates.get(e.product_id) || 0),
      ref: "STOCK-REPORT",
    });
  }

  // 2. Confirmed sell-in POs → `purchase` inflows at their arrival date.
  for (const order of sellInOrders) {
    const effDate = getOrderEffDate(order);
    if (!effDate || !CONFIRMED_PO_STATUSES.has(String(order.status ?? ""))) continue;

    let orderValue = 0;
    for (const line of order.sell_in_lines || []) {
      if (!line.product_id) continue;
      const qty = resolveArrivedQty(line);
      if (qty <= 0) continue;
      const rate = resolveLineRate(line);
      // A return line is a vendor credit note: goods go back and the purchase total drops.
      // Negative quantity tells the engine to draw that stock back out at FIFO cost.
      const isReturn = (line.invoice_type || "").toLowerCase() === "return";
      const signedQty = isReturn ? -qty : qty;
      events.push({
        productId: line.product_id,
        date: effDate,
        kind: "purchase",
        qty: signedQty,
        rate,
        ref: order.po_no || "PO",
      });
      // Implied SKUs are outside the ledger, so they are outside the Purchases total too.
      // Everything else counts at the rate it was billed at, including promotional packs:
      // if a scheme pack is genuinely free its rate is already 0 and it adds nothing.
      if (!products.impliedProductIds.has(line.product_id)) {
        orderValue += signedQty * rate;
      }
    }
    orderValueById.set(order.id, orderValue);
  }

  // 3. Delivered invoices → `sale` outflows.
  //    `invoices.delivery_date` is the authority rather than `sale_entries.sale_date`, so
  //    COGS always lands in the same period as the revenue it belongs to.
  const saleEntryIndex = indexSaleEntries(saleEntries);

  for (const inv of invoices) {
    const deliveryDate = inv.delivery_date ? String(inv.delivery_date).slice(0, 10) : "";
    if (!deliveryDate) continue;
    const invoiceNo = String(inv.invoice_no || "").trim();

    const saleEntry = lookupSaleEntry(saleEntryIndex, invoiceNo);
    if (saleEntry) {
      for (const l of saleEntry.sale_entry_lines || []) {
        const qty = Number(l.qty) || 0;
        if (!l.product_id || qty === 0) continue;
        // A negative quantity is stock coming back in; the engine credits it against COGS.
        events.push({
          productId: l.product_id,
          date: deliveryDate,
          kind: "sale",
          qty,
          ref: invoiceNo,
        });
      }
      continue;
    }

    const items = parseProductsWithCode(inv.products || "");
    if (items.length === 0) {
      unlinkedInvoices.push(invoiceNo);
      continue;
    }
    for (const item of items) {
      const product =
        products.productCodeMap.get(item.code) ||
        products.productNameMap.get((item.name || "").toLowerCase().trim());
      if (!product || !item.qty) continue;
      events.push({
        productId: product.id,
        date: deliveryDate,
        kind: "sale",
        qty: item.qty,
        ref: invoiceNo,
      });
    }
  }

  // 4. Damaged stock → `adjustment_out`, matched on product name exactly as the views do.
  for (const d of damagedStock) {
    const qty = Number(d.quantity) || 0;
    const name = (d.product_name || "").toLowerCase().trim();
    const date = d.recorded_date ? String(d.recorded_date).slice(0, 10) : "";
    if (qty <= 0 || !name || !date) continue;
    const product = products.productNameMap.get(name);
    if (!product) {
      unmatchedDamagedNames.push(d.product_name || "");
      continue;
    }
    events.push({
      productId: product.id,
      date,
      kind: "adjustment_out",
      qty,
      ref: "DAMAGED",
    });
  }

  // 5. Waybill dispatches → `adjustment_out`. Empties going back to CCBPL leave the warehouse.
  for (const w of waybillItems) {
    const qty = Number(w.quantity) || 0;
    const date = embedded(w.waybills)?.date;
    if (qty <= 0 || !w.product_id || !date) continue;
    events.push({
      productId: w.product_id,
      date: String(date).slice(0, 10),
      kind: "adjustment_out",
      qty,
      ref: "WAYBILL",
    });
  }

  // 6. Leased empties leave on the lease date and come back on each return_date.
  //    Legacy rows (returned_qty with no returned_date / no return rows) still net on the lease date.
  for (const l of leasedEmptyItems) {
    const qty = Number(l.quantity) || 0;
    const returned = Number(l.returned_qty) || 0;
    const date = embedded(l.leased_empties)?.date;
    if (qty <= 0 || !l.product_id || !date) continue;
    const leaseDate = String(date).slice(0, 10);
    const returnRows = (l.leased_empty_returns || [])
      .map((r) => ({
        date: r.return_date ? String(r.return_date).slice(0, 10) : "",
        quantity: Number(r.quantity) || 0,
      }))
      .filter((r) => r.date && r.quantity > 0);

    if (returnRows.length > 0) {
      events.push({
        productId: l.product_id,
        date: leaseDate,
        kind: "adjustment_out",
        qty,
        ref: "LEASED-EMPTIES",
      });
      for (const r of returnRows) {
        events.push({
          productId: l.product_id,
          date: r.date,
          kind: "adjustment_in",
          qty: r.quantity,
          ref: "LEASED-EMPTIES-RETURN",
        });
      }
      continue;
    }

    const returnedDate = l.returned_date ? String(l.returned_date).slice(0, 10) : "";

    if (!returnedDate) {
      const outstanding = Math.max(0, qty - returned);
      if (outstanding <= 0) continue;
      events.push({
        productId: l.product_id,
        date: leaseDate,
        kind: "adjustment_out",
        qty: outstanding,
        ref: "LEASED-EMPTIES",
      });
      continue;
    }

    events.push({
      productId: l.product_id,
      date: leaseDate,
      kind: "adjustment_out",
      qty,
      ref: "LEASED-EMPTIES",
    });
    if (returned > 0) {
      events.push({
        productId: l.product_id,
        date: returnedDate,
        kind: "adjustment_in",
        qty: returned,
        ref: "LEASED-EMPTIES-RETURN",
      });
    }
  }

  return { events, orderValueById, unlinkedInvoices, unmatchedDamagedNames };
}
