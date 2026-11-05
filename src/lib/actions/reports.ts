"use server";

import { createClient, createAdminClient, getTenantId } from "@/lib/supabase/server";
import { parseProducts } from "@/lib/parsers/products";
import { leaseReturnedQtyAsOf } from "@/lib/empties/lease-as-of";
import { warehouseNetAsOf } from "@/lib/inventory/as-of-net";

// ─── STOCK LEDGER ─────────────────────────────────────────────────────────────
// productId here is the UUID from the products table.
// The UI resolves product_name → product_id via getProducts() below.

export async function getStockLedger(params: {
  productId: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_stock_ledger", {
      p_product_id: params.productId,
      p_date_from:  params.dateFrom || null,
      p_date_to:    params.dateTo   || null,
    });
    if (error) { console.error("[getStockLedger]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getStockLedger] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getEmptyLedger(params: {
  productId: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_empty_ledger", {
      p_product_id: params.productId,
      p_date_from:  params.dateFrom || null,
      p_date_to:    params.dateTo   || null,
    });
    if (error) { console.error("[getEmptyLedger]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getEmptyLedger] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function deleteEmptyLedgerEntry(eventId: string, sourceType: string) {
  try {
    const supabase = await createClient();

    if (sourceType === "po" || sourceType === "po_return") {
      const { data: entry } = await supabase
        .from("sell_in_return_entries")
        .select("sell_in_line_id, returned_qty")
        .eq("id", eventId)
        .single();

      if (entry) {
        await supabase.from("sell_in_return_entries").delete().eq("id", eventId);
        const { data: sal } = await supabase
          .from("sell_in_arrived_lines")
          .select("returned_qty")
          .eq("sell_in_line_id", entry.sell_in_line_id)
          .single();
        if (sal) {
          const newRet = Math.max(0, (sal.returned_qty || 0) - (entry.returned_qty || 0));
          await supabase
            .from("sell_in_arrived_lines")
            .update({ returned_qty: newRet })
            .eq("sell_in_line_id", entry.sell_in_line_id);
        }
      } else {
        await supabase.from("sell_in_arrived_lines").delete().eq("id", eventId);
      }
    } else if (sourceType === "returns") {
      await supabase.from("invoice_returns").delete().eq("id", eventId);
    } else if (sourceType === "invoice") {
      await supabase.from("invoice_line_items").delete().eq("id", eventId);
    }

    return { success: true };
  } catch (err: any) {
    console.error("[deleteEmptyLedgerEntry]", err.message);
    throw new Error(err.message);
  }
}

export async function getInvoicesForLedger(productName: string, date: string) {
  try {
    const supabase = await createClient();
    const normName = productName.toLowerCase().trim();

    // Try invoice_line_items table first (normalized schema)
    // Filter by invoice_date on the joined invoices table to avoid fetching all rows
    const { data: lineItems } = await supabase
      .from("invoice_line_items")
      .select(`
        quantity,
        line_amount,
        invoice:invoices(
          id,
          invoice_no,
          invoice_date,
          payment_status,
          shop:shops(shop_name, outlet_code)
        ),
        product:products(product_name)
      `)
      .eq("invoice:invoices.invoice_date", date);

    const directMatches = (lineItems || [])
      .filter((item: any) =>
        item.invoice &&
        item.invoice.invoice_date === date &&
        item.product &&
        item.product.product_name.toLowerCase().trim() === normName
      )
      .map((item: any) => ({
        invoice_no: item.invoice.invoice_no || "-",
        invoice_date: item.invoice.invoice_date,
        shop_name: item.invoice?.shop?.shop_name || "-",
        outlet_code: item.invoice?.shop?.outlet_code || "-",
        product_name: item.product.product_name,
        quantity: item.quantity,
        amount: item.line_amount,
        payment_status: item.invoice.payment_status || "-",
      }));

    if (directMatches.length > 0) return directMatches;

    // Fallback: read from the invoices.products text column using the shared parseProducts parser
    const { data: invoices } = await supabase
      .from("invoices")
      .select("id, invoice_no, invoice_date, products, payment_status, shop:shops(shop_name, outlet_code)")
      .eq("invoice_date", date);

    const fallbackMatches: any[] = [];
    (invoices || []).forEach((inv: any) => {
      if (!inv.products) return;
      const parsed = parseProducts(inv.products);
      for (const { name, qty } of parsed) {
        if (name.toLowerCase().trim() === normName) {
          fallbackMatches.push({
            invoice_no: inv.invoice_no || "-",
            invoice_date: inv.invoice_date,
            shop_name: inv.shop?.shop_name || "-",
            outlet_code: inv.shop?.outlet_code || "-",
            product_name: name,
            quantity: qty,
            amount: 0,
            payment_status: inv.payment_status || "-",
          });
        }
      }
    });

    return fallbackMatches;
  } catch (err: any) {
    console.error("[getInvoicesForLedger] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getReturnsForLedger(productName: string, date: string) {
  try {
    const supabase = await createClient();
    const normName = productName.toLowerCase().trim();

    const { data: returnsData, error } = await supabase
      .from("invoice_returns")
      .select(`
        id,
        return_date,
        product_name,
        returned_qty,
        note,
        invoice:invoices(
          invoice_no,
          shop:shops(shop_name, outlet_code)
        )
      `)
      .gt("returned_qty", 0);

    if (error) {
      console.error("[getReturnsForLedger]", error.message);
      return [];
    }

    const filtered = (returnsData || [])
      .filter((r: any) => {
        if (!r.product_name) return false;
        const pName = r.product_name.toLowerCase().trim();
        const matchesProduct = pName === normName || normName.includes(pName) || pName.includes(normName);
        const matchesDate = !date || r.return_date === date || String(r.return_date).startsWith(date);
        return matchesProduct && matchesDate;
      })
      .map((r: any) => ({
        invoice_no: r.invoice?.invoice_no || "—",
        return_date: r.return_date,
        shop_name: r.invoice?.shop?.shop_name || "—",
        outlet_code: r.invoice?.shop?.outlet_code || "—",
        product_name: r.product_name,
        returned_qty: r.returned_qty,
        note: r.note || "—",
        status: "approved",
      }));

    return filtered;
  } catch (err: any) {
    console.error("[getReturnsForLedger] unexpected:", err?.message ?? err);
    return [];
  }
}

/**
 * Helper to fetch all rows from Supabase, overcoming the default PostgREST 1000-row limit.
 */
async function fetchAllSupabaseRows<T = any>(queryBuilder: any): Promise<T[]> {
  const PAGE_SIZE = 1000;
  let allRows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryBuilder.range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("[fetchAllSupabaseRows] query error:", error.message);
      break;
    }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return allRows;
}

function resolveStockProductId(
  prodIdMap: Map<string, any>,
  prodNameMap: Map<string, any>,
  productId?: string | null,
  productName?: string | null,
): string | null {
  if (productId && prodIdMap.has(productId)) return productId;
  const name = (productName || "").toLowerCase().trim();
  if (name && prodNameMap.has(name)) return prodNameMap.get(name).id;
  return null;
}

/** PostgREST may embed a to-one relation as an object or a single-element array. */
function embedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function productCategory(prod: any) {
  const cat = prod?.product_categories;
  return Array.isArray(cat) ? cat[0] : cat;
}

export async function getStockBalanceReport(params?: {
  asOfDate?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  try {
    const toDate = params?.dateTo || params?.asOfDate || new Date().toISOString().slice(0, 10);
    const bblRows = await getStockBalanceByLevel({
      dateFrom: params?.dateFrom || undefined,
      dateTo: toDate,
    });
    return (bblRows || []).map((r: any) => ({
      product_id: r.product_id,
      code: r.code,
      product_name: r.product_name,
      category: r.category_title || "—",
      packing_qty: r.packing_qty ?? 1,
      net_balance: Number(r.net_balance || 0),
    }));
  } catch (err: any) {
    console.error("[getStockBalanceReport] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getStockBalanceByLevel(params?: {
  dateFrom?: string;
  dateTo?: string;
}) {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    const prodQuery = supabase
      .from("products")
      .select(`
        id, product_name, product_code, packing_qty, is_returnable,
        product_categories(id, title, set_un_case, is_returnable, is_rgb, is_implied)
      `)
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("product_name");

    const prods = await fetchAllSupabaseRows(prodQuery);
    if (!prods || prods.length === 0) return [];

    const prodIdMap = new Map<string, any>();
    const prodNameMap = new Map<string, any>();
    prods.forEach((p: any) => {
      prodIdMap.set(p.id, p);
      if (p.product_name) prodNameMap.set(p.product_name.toLowerCase().trim(), p);
    });

    const fromDate = params?.dateFrom || null;
    const toDate = params?.dateTo || null;

    let sellInQuery = supabase
      .from("sell_in_lines")
      .select(`
        id, product_id, qty, invoice_type,
        sell_in_orders!inner(tenant_id, transaction_date, status),
        sell_in_arrived_lines(arrived_qty, returned_qty)
      `)
      .eq("sell_in_orders.tenant_id", tenantId)
      .in("sell_in_orders.status", ["stock_arrived", "on_credit", "billed"]);

    if (toDate) sellInQuery = sellInQuery.lte("sell_in_orders.transaction_date", toDate);

    let sreQuery = supabase
      .from("stock_report_entries")
      .select("product_id, ph_case, report_date")
      .eq("tenant_id", tenantId);

    if (toDate) sreQuery = sreQuery.lte("report_date", toDate);

    let saleQuery = supabase
      .from("sale_entry_lines")
      .select(`
        product_id, qty,
        sale_entries!inner(tenant_id, sale_date)
      `)
      .eq("sale_entries.tenant_id", tenantId);

    if (toDate) saleQuery = saleQuery.lte("sale_entries.sale_date", toDate);

    let waybillQuery = supabase
      .from("waybill_items")
      .select(`
        product_id, product_name, quantity,
        waybills!inner(tenant_id, date)
      `)
      .eq("waybills.tenant_id", tenantId)
      .gt("quantity", 0);

    if (toDate) waybillQuery = waybillQuery.lte("waybills.date", toDate);

    let damagedQuery = supabase
      .from("damaged_stock")
      .select("product_name, quantity, recorded_date")
      .eq("tenant_id", tenantId)
      .gt("quantity", 0)
      .eq("status", "adjusted");

    if (toDate) damagedQuery = damagedQuery.lte("recorded_date", toDate);

    let returnsQuery = supabase
      .from("invoice_returns")
      .select("product_name, returned_qty, return_date")
      .eq("tenant_id", tenantId)
      .gt("returned_qty", 0);

    if (toDate) returnsQuery = returnsQuery.lte("return_date", toDate);

    let leaseQuery = supabase
      .from("leased_empty_items")
      .select("id, product_id, product_name, quantity, returned_qty, returned_date, leased_empties!inner(tenant_id, date), leased_empty_returns(return_date, quantity)")
      .eq("leased_empties.tenant_id", tenantId);

    if (toDate) leaseQuery = leaseQuery.lte("leased_empties.date", toDate);

    let soldQuery = supabase
      .from("sold_empty_items")
      .select("product_id, product_name, quantity, sold_empties!inner(tenant_id, date)")
      .eq("sold_empties.tenant_id", tenantId);

    if (toDate) soldQuery = soldQuery.lte("sold_empties.date", toDate);

    const [
      sellInRows,
      sreRows,
      saleRows,
      waybillRows,
      damagedRows,
      returnRows,
      leaseRows,
      soldRows,
    ] = await Promise.all([
      fetchAllSupabaseRows(sellInQuery),
      fetchAllSupabaseRows(sreQuery),
      fetchAllSupabaseRows(saleQuery),
      fetchAllSupabaseRows(waybillQuery),
      fetchAllSupabaseRows(damagedQuery),
      fetchAllSupabaseRows(returnsQuery),
      fetchAllSupabaseRows(leaseQuery),
      fetchAllSupabaseRows(soldQuery),
    ]);

    const priorInMap = new Map<string, number>();
    const priorOutMap = new Map<string, number>();
    const periodInMap = new Map<string, number>();
    const periodOutMap = new Map<string, number>();

    const addQty = (map: Map<string, number>, id: string, qty: number) => {
      map.set(id, (map.get(id) || 0) + qty);
    };

    (sellInRows || []).forEach((l: any) => {
      if (!l.product_id) return;
      const date = embedOne(l.sell_in_orders)?.transaction_date;
      const arrived = Array.isArray(l.sell_in_arrived_lines) ? l.sell_in_arrived_lines[0] : l.sell_in_arrived_lines;
      const netQty = arrived ? (Number(arrived.arrived_qty || 0) - Number(arrived.returned_qty || 0)) : Number(l.qty || 0);
      const isPrior = fromDate && date && date < fromDate;
      const targetIn = isPrior ? priorInMap : periodInMap;
      const targetOut = isPrior ? priorOutMap : periodOutMap;

      if (l.invoice_type === "return") {
        addQty(targetOut, l.product_id, Math.abs(netQty));
      } else {
        addQty(targetIn, l.product_id, Math.max(0, netQty));
      }
    });

    (sreRows || []).forEach((r: any) => {
      if (!r.product_id) return;
      const date = r.report_date;
      const isPrior = fromDate && date && date < fromDate;
      const targetIn = isPrior ? priorInMap : periodInMap;
      addQty(targetIn, r.product_id, Number(r.ph_case || 0));
    });

    (saleRows || []).forEach((l: any) => {
      if (!l.product_id) return;
      const date = embedOne(l.sale_entries)?.sale_date;
      const qty = Number(l.qty || 0);
      const isPrior = fromDate && date && date < fromDate;
      const targetIn = isPrior ? priorInMap : periodInMap;
      const targetOut = isPrior ? priorOutMap : periodOutMap;

      const prod = prodIdMap.get(l.product_id);
      const cat = productCategory(prod);
      const isImplied = Boolean(cat?.is_implied);

      if (isImplied) {
        if (qty < 0) {
          addQty(targetIn, l.product_id, Math.abs(qty));
        } else if (qty > 0) {
          addQty(targetOut, l.product_id, qty);
        }
      } else {
        if (qty > 0) {
          addQty(targetOut, l.product_id, qty);
        }
      }
    });

    (waybillRows || []).forEach((w: any) => {
      const pid = resolveStockProductId(prodIdMap, prodNameMap, w.product_id, w.product_name);
      if (!pid) return;
      const date = embedOne(w.waybills)?.date;
      const isPrior = fromDate && date && date < fromDate;
      const targetOut = isPrior ? priorOutMap : periodOutMap;
      addQty(targetOut, pid, Number(w.quantity || 0));
    });

    (leaseRows || []).forEach((l: any) => {
      const pid = resolveStockProductId(prodIdMap, prodNameMap, l.product_id, l.product_name);
      if (!pid) return;
      const qty = Number(l.quantity || 0);
      if (qty <= 0) return;
      const leaseDate = embedOne(l.leased_empties)?.date;
      const returns = (l.leased_empty_returns || []).map((r: any) => ({
        date: String(r.return_date || "").slice(0, 10),
        quantity: Number(r.quantity || 0),
      }));
      const retQty = Number(l.returned_qty || 0);
      const retDate = l.returned_date || null;
      const isPriorLease = fromDate && leaseDate && leaseDate < fromDate;

      if (returns.length > 0) {
        addQty(isPriorLease ? priorOutMap : periodOutMap, pid, qty);
        for (const r of returns) {
          if (!r.date || r.quantity <= 0) continue;
          if (toDate && r.date > toDate) continue;
          const isPriorRet = Boolean(fromDate && r.date < fromDate);
          addQty(isPriorRet ? priorInMap : periodInMap, pid, r.quantity);
        }
        return;
      }

      if (!retDate) {
        const outstanding = Math.max(0, qty - retQty);
        if (outstanding <= 0) return;
        addQty(isPriorLease ? priorOutMap : periodOutMap, pid, outstanding);
        return;
      }

      addQty(isPriorLease ? priorOutMap : periodOutMap, pid, qty);
      const returnedAsOf = leaseReturnedQtyAsOf(retQty, retDate, toDate);
      if (returnedAsOf > 0) {
        const isPriorRet = Boolean(fromDate && retDate && retDate < fromDate);
        addQty(isPriorRet ? priorInMap : periodInMap, pid, returnedAsOf);
      }
    });

    (soldRows || []).forEach((s: any) => {
      const pid = resolveStockProductId(prodIdMap, prodNameMap, s.product_id, s.product_name);
      if (!pid) return;
      const date = embedOne(s.sold_empties)?.date;
      const isPrior = fromDate && date && date < fromDate;
      const targetOut = isPrior ? priorOutMap : periodOutMap;
      addQty(targetOut, pid, Number(s.quantity || 0));
    });

    (damagedRows || []).forEach((d: any) => {
      const prod = prodNameMap.get((d.product_name || "").toLowerCase().trim());
      if (!prod) return;
      const date = d.recorded_date;
      const isPrior = fromDate && date && date < fromDate;
      const targetOut = isPrior ? priorOutMap : periodOutMap;
      addQty(targetOut, prod.id, Number(d.quantity || 0));
    });

    (returnRows || []).forEach((r: any) => {
      const prod = prodNameMap.get((r.product_name || "").toLowerCase().trim());
      if (!prod) return;
      const date = r.return_date;
      const isPrior = fromDate && date && date < fromDate;
      const targetIn = isPrior ? priorInMap : periodInMap;
      addQty(targetIn, prod.id, Number(r.returned_qty || 0));
    });

    return prods.map((p: any) => {
      const cat = productCategory(p);
      const isImplied = Boolean(cat?.is_implied);
      const isReturnable = Boolean(p.is_returnable || cat?.is_returnable);
      const isRgb = Boolean(cat?.is_rgb);

      const priorIn = priorInMap.get(p.id) || 0;
      const priorOut = priorOutMap.get(p.id) || 0;
      const openingStock = Math.max(0, priorIn - priorOut);

      const pIn = periodInMap.get(p.id) || 0;
      const pOut = periodOutMap.get(p.id) || 0;

      const totalIn = openingStock + pIn;
      const totalOut = pOut;
      // Closing Net is stock as of To. From only splits Opening vs period IN/OUT.
      const net = warehouseNetAsOf(priorIn, priorOut, pIn, pOut);

      return {
        product_id: p.id,
        code: p.product_code || p.product_name,
        product_name: p.product_name,
        packing_qty: p.packing_qty ?? 1,
        total_qty_in: totalIn,
        total_qty_out: totalOut,
        net_balance: net,
        category_title: cat?.title || "",
        is_implied: isImplied,
        is_returnable: isReturnable,
        is_rgb: isRgb,
      };
    });
  } catch (err: any) {
    console.error("[getStockBalanceByLevel] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getSalePurchaseSummary(params?: {
  dateFrom?: string;
  dateTo?: string;
}) {
  try {
    const supabase = await createClient();
    if (params?.dateFrom || params?.dateTo) {
      const { data, error } = await supabase.rpc("get_sale_purchase_filtered", {
        p_date_from: params.dateFrom || null,
        p_date_to:   params.dateTo   || null,
      });
      if (error) { console.error("[getSalePurchaseSummary RPC]", error.message); return []; }
      return data || [];
    }
    const { data, error } = await supabase
      .from("sale_purchase_summary")
      .select("*")
      .order("product_name");
    if (error) { console.error("[getSalePurchaseSummary]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getSalePurchaseSummary] unexpected:", err?.message ?? err);
    return [];
  }
}



export async function getStockDiscrepancies() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("stock_discrepancies_view")
      .select("product_name, audit_date, system_qty, physical_qty, diff, status, reason")
      .order("audit_date", { ascending: false });
    if (error) { console.error("[getStockDiscrepancies]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getStockDiscrepancies] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getWHTaxSummary(params?: {
  dateFrom?: string;
  dateTo?: string;
}) {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    let query = supabase
      .from("invoices")
      .select(`
        id,
        delivery_date,
        record_date,
        invoice_date,
        amount,
        invoice_total,
        grand_total,
        invoice_type,
        outlet_type,
        shop:shops(id, shop_name, shop_type, outlet_type)
      `)
      .eq("tenant_id", tenantId);

    if (params?.dateFrom) query = query.gte("delivery_date", params.dateFrom);
    if (params?.dateTo)   query = query.lte("delivery_date", params.dateTo);

    query = query.order("delivery_date", { ascending: false, nullsFirst: false });

    const PAGE_SIZE = 1000;
    let allInvoices: any[] = [];
    let fromIndex = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await query.range(fromIndex, fromIndex + PAGE_SIZE - 1);
      if (error) {
        console.error("[getWHTaxSummary]", error.message);
        return [];
      }
      if (data && data.length > 0) {
        allInvoices.push(...data);
        if (data.length < PAGE_SIZE) hasMore = false;
        else fromIndex += PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    // Aggregate per date
    const map = new Map<string, { date: string; sale: number; cash_collection: number; wh_tax: number }>();
    for (const inv of allInvoices) {
      const d = (inv.delivery_date || inv.invoice_date || inv.record_date || "").split("T")[0];
      if (!d) continue;
      if (params?.dateFrom && d < params.dateFrom) continue;
      if (params?.dateTo   && d > params.dateTo)   continue;

      const sale = Number(inv.amount ?? inv.invoice_total ?? inv.grand_total ?? 0);

      const invType    = (inv.invoice_type          || "").toLowerCase();
      const outType    = (inv.outlet_type           || "").toLowerCase();
      const shopType   = (inv.shop?.shop_type       || "").toLowerCase();
      const shopOut    = (inv.shop?.outlet_type     || "").toLowerCase();
      const isCredit   = invType === "credit" || outType === "credit" || shopType === "credit" || shopOut === "credit";
      const cash       = isCredit ? 0 : sale;

      const existing = map.get(d);
      if (existing) {
        existing.sale             += sale;
        existing.cash_collection  += cash;
        existing.wh_tax           += sale * 0.001;
      } else {
        map.set(d, { date: d, sale, cash_collection: cash, wh_tax: sale * 0.001 });
      }
    }

    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  } catch (err: any) {
    console.error("[getWHTaxSummary] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getTrialBalance() {
  try {
    const supabase = await createClient();
    // trial_balance view: code, category, label, total_debit, total_credit, net_balance
    const { data, error } = await supabase
      .from("trial_balance")
      .select("code, category, label, total_debit, total_credit, net_balance")
      .order("category")
      .order("code");
    if (error) { console.error("[getTrialBalance]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getTrialBalance] unexpected:", err?.message ?? err);
    return [];
  }
}

// Returns { id, product_name } pairs for use in stock ledger product dropdown
export async function getProducts(): Promise<{ id: string; product_name: string }[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("products")
      .select("id, product_name")
      .eq("active", true)
      .order("product_name");
    if (error || !data) return [];
    return data;
  } catch {
    return [];
  }
}

export async function getReturnableProducts(): Promise<{ id: string; product_name: string }[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("products")
      .select("id, product_name, category_id, is_returnable, product_categories(is_returnable)")
      .eq("active", true)
      .order("product_name");
    if (error || !data) return [];
    
    return data.filter((p: any) => {
      const isRet = Boolean(p.product_categories?.is_returnable || p.is_returnable);
      if (isRet) return true;
      const lower = (p.product_name || "").toLowerCase().trim();
      return (
        lower.includes("rgb") ||
        lower.includes("pallet") ||
        lower.includes("shell") ||
        lower.includes("sheet") ||
        lower.includes("empties") ||
        lower.includes("crate")
      );
    }).map((p: any) => ({ id: p.id, product_name: p.product_name }));
  } catch {
    return [];
  }
}

// Legacy alias kept for backward compat
export async function getProductNames(): Promise<string[]> {
  const products = await getProducts();
  return products.map((p) => p.product_name);
}

// ─── NEW: ADVANCE TAX REPORT ─────────────────────────────────────────────────

export async function getAdvanceTaxReport(params?: {
  dateFrom?: string;
  dateTo?: string;
}) {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    let query = supabase
      .from("invoices")
      .select(`
        id,
        delivery_date,
        record_date,
        invoice_date,
        amount,
        invoice_total,
        grand_total,
        adv_tax,
        advance_tax,
        invoice_type,
        outlet_type,
        shop:shops(id, shop_name, outlet_code, shop_type, outlet_type)
      `)
      .eq("tenant_id", tenantId);

    if (params?.dateFrom) {
      query = query.gte("delivery_date", params.dateFrom);
    }
    if (params?.dateTo) {
      query = query.lte("delivery_date", params.dateTo);
    }

    query = query.order("delivery_date", { ascending: false, nullsFirst: false });

    const PAGE_SIZE = 1000;
    let allInvoices: any[] = [];
    let fromIndex = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await query.range(fromIndex, fromIndex + PAGE_SIZE - 1);
      if (error) {
        let vQuery = supabase
          .from("advance_tax_report")
          .select("date, sale, cash_collection, tax_collected")
          .order("date", { ascending: false });
        if (params?.dateFrom) vQuery = vQuery.gte("date", params.dateFrom);
        if (params?.dateTo)   vQuery = vQuery.lte("date", params.dateTo);
        const { data: vData } = await vQuery;
        return vData || [];
      }
      if (data && data.length > 0) {
        allInvoices.push(...data);
        if (data.length < PAGE_SIZE) hasMore = false;
        else fromIndex += PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    const map = new Map<string, { date: string; sale: number; cash_collection: number; tax_collected: number }>();
    for (const inv of allInvoices) {
      const d = (inv.delivery_date || inv.invoice_date || inv.record_date || "").split("T")[0];
      if (!d) continue;
      if (params?.dateFrom && d < params.dateFrom) continue;
      if (params?.dateTo && d > params.dateTo) continue;

      const sale = Number(inv.amount ?? inv.invoice_total ?? inv.grand_total ?? 0);
      const tax = Number(inv.adv_tax ?? inv.advance_tax ?? 0);

      const invType = (inv.invoice_type || "").toLowerCase();
      const outType = (inv.outlet_type || "").toLowerCase();
      const shopType = (inv.shop?.shop_type || "").toLowerCase();
      const shopOutType = (inv.shop?.outlet_type || "").toLowerCase();

      const isCredit =
        invType === "credit" ||
        outType === "credit" ||
        shopType === "credit" ||
        shopOutType === "credit";

      const cash = isCredit ? 0 : sale;

      const existing = map.get(d);
      if (existing) {
        existing.sale += sale;
        existing.cash_collection += cash;
        existing.tax_collected += tax;
      } else {
        map.set(d, { date: d, sale, cash_collection: cash, tax_collected: tax });
      }
    }

    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  } catch (err: any) {
    console.error("[getAdvanceTaxReport] unexpected:", err?.message ?? err);
    return [];
  }
}

// ─── NEW: DISCOUNT REPORT ────────────────────────────────────────────────────

export async function getDiscountReport(params?: {
  dateFrom?: string;
  dateTo?: string;
}) {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("discount_report")
      .select("date, sale, cash_collection, discount_given")
      .order("date", { ascending: false });

    if (params?.dateFrom) query = query.gte("date", params.dateFrom);
    if (params?.dateTo)   query = query.lte("date", params.dateTo);

    const { data, error } = await query;
    if (error) { console.error("[getDiscountReport]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getDiscountReport] unexpected:", err?.message ?? err);
    return [];
  }
}

// ─── NEW: ADDITIONAL DISCOUNTS REPORT ────────────────────────────────────────

export async function getAdditionalDiscountsReport(params?: {
  dateFrom?: string;
  dateTo?: string;
}) {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("invoices")
      .select(`
        id,
        invoice_no,
        invoice_date,
        products,
        grand_total,
        additional_discount,
        shop:shops(shop_name, outlet_code)
      `)
      .order("invoice_date", { ascending: false });

    if (params?.dateFrom) query = query.gte("invoice_date", params.dateFrom);
    if (params?.dateTo)   query = query.lte("invoice_date", params.dateTo);

    const { data: allInvoices, error } = await query;
    if (error) {
      console.error("[getAdditionalDiscountsReport]", error.message);
      return [];
    }

    const dateMap = new Map<string, {
      date: string;
      sale: number;
      additional_discount: number;
      invoices: any[];
    }>();

    (allInvoices || []).forEach((inv: any) => {
      const d = inv.invoice_date;
      if (!d) return;
      if (!dateMap.has(d)) {
        dateMap.set(d, {
          date: d,
          sale: 0,
          additional_discount: 0,
          invoices: [],
        });
      }
      const entry = dateMap.get(d)!;
      entry.sale += Number(inv.grand_total || 0);
      const addDisc = Number(inv.additional_discount || 0);
      if (addDisc > 0) {
        entry.additional_discount += addDisc;
        entry.invoices.push({
          id: inv.id,
          invoice_no: inv.invoice_no,
          shop_name: inv.shop?.shop_name || "—",
          outlet_code: inv.shop?.outlet_code || "—",
          products: inv.products || "—",
          grand_total: Number(inv.grand_total || 0),
          additional_discount: addDisc,
        });
      }
    });

    const result = Array.from(dateMap.values())
      .filter((entry) => entry.additional_discount > 0)
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    return result;
  } catch (err: any) {
    console.error("[getAdditionalDiscountsReport] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getSaleEntriesForLedger(saleNo: string) {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    const { data, error } = await supabase
      .from("sale_entry_lines")
      .select(`
        qty, sale_rate, amount,
        product:products(product_name),
        sale_entry:sale_entries!inner(tenant_id, sale_no)
      `)
      .eq("sale_entry.tenant_id", tenantId)
      .eq("sale_entry.sale_no", saleNo);

    if (error) { console.error("[getSaleEntriesForLedger]", error.message); return []; }

    return (data || []).map((l: any) => ({
      product_name: l.product?.product_name ?? "—",
      sale_rate: Number(l.sale_rate || 0),
      qty: Number(l.qty || 0),
      amount: Number(l.amount || 0),
    }));
  } catch (err: any) {
    console.error("[getSaleEntriesForLedger] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getDateWiseSalesSummary(params?: {
  from?: string;
  to?: string;
}) {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    let query = supabase
      .from("invoices")
      .select(`
        id,
        invoice_no,
        delivery_date,
        record_date,
        invoice_date,
        amount,
        invoice_total,
        invoice_type,
        outlet_type,
        shop:shops(id, shop_name, outlet_code, shop_type, outlet_type)
      `)
      .eq("tenant_id", tenantId);

    if (params?.from) {
      query = query.gte("delivery_date", params.from);
    }
    if (params?.to) {
      query = query.lte("delivery_date", params.to);
    }

    query = query.order("delivery_date", { ascending: false, nullsFirst: false });

    const PAGE_SIZE = 1000;
    let allInvoices: any[] = [];
    let fromIndex = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await query.range(fromIndex, fromIndex + PAGE_SIZE - 1);
      if (error) {
        console.error("[getDateWiseSalesSummary] error:", error.message);
        break;
      }
      if (data && data.length > 0) {
        allInvoices.push(...data);
        if (data.length < PAGE_SIZE) hasMore = false;
        else fromIndex += PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    const dateMap = new Map<string, { date: string; sales: number; cash: number; credit: number }>();

    for (const inv of allInvoices) {
      const dateStr = (inv.delivery_date || inv.invoice_date || inv.record_date || "").split("T")[0];
      if (!dateStr) continue;
      if (params?.from && dateStr < params.from) continue;
      if (params?.to && dateStr > params.to) continue;

      const amt = Number(inv.amount ?? inv.invoice_total ?? inv.grand_total ?? 0);

      const invType = (inv.invoice_type || "").toLowerCase();
      const outType = (inv.outlet_type || "").toLowerCase();
      const shopType = (inv.shop?.shop_type || "").toLowerCase();
      const shopOutType = (inv.shop?.outlet_type || "").toLowerCase();

      const isCredit =
        invType === "credit" ||
        outType === "credit" ||
        shopType === "credit" ||
        shopOutType === "credit";

      const existing = dateMap.get(dateStr);
      if (existing) {
        existing.sales += amt;
        if (isCredit) {
          existing.credit += amt;
        } else {
          existing.cash += amt;
        }
      } else {
        dateMap.set(dateStr, {
          date: dateStr,
          sales: amt,
          cash: isCredit ? 0 : amt,
          credit: isCredit ? amt : 0,
        });
      }
    }

    return Array.from(dateMap.values()).sort((a, b) => b.date.localeCompare(a.date));
  } catch (err: any) {
    console.error("[getDateWiseSalesSummary] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getShopWiseSalesSummary(params: {
  shopId: string;
  from?: string;
  to?: string;
}) {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();
    if (!tenantId || !params.shopId) return [];

    const { data: shop } = await supabase
      .from("shops")
      .select("id, shop_name, outlet_code, shop_type, outlet_type")
      .eq("id", params.shopId)
      .maybeSingle();

    if (!shop) return [];

    const isShopCredit =
      (shop.shop_type || "").toLowerCase() === "credit" ||
      (shop.outlet_type || "").toLowerCase() === "credit";

    let query = supabase
      .from("invoices")
      .select(`
        id,
        invoice_no,
        delivery_date,
        record_date,
        invoice_date,
        amount,
        invoice_total,
        invoice_type,
        outlet_type,
        payment_status,
        amount_received,
        shop_id,
        outlet_code
      `)
      .eq("tenant_id", tenantId);

    if (shop.outlet_code) {
      query = query.or(`shop_id.eq.${shop.id},outlet_code.eq.${shop.outlet_code}`);
    } else {
      query = query.eq("shop_id", shop.id);
    }

    if (params.from) {
      query = query.gte("delivery_date", params.from);
    }
    if (params.to) {
      query = query.lte("delivery_date", params.to);
    }

    query = query.order("delivery_date", { ascending: false, nullsFirst: false });

    const PAGE_SIZE = 1000;
    let allInvoices: any[] = [];
    let fromIndex = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await query.range(fromIndex, fromIndex + PAGE_SIZE - 1);
      if (error) {
        console.error("[getShopWiseSalesSummary] error:", error.message);
        break;
      }
      if (data && data.length > 0) {
        allInvoices.push(...data);
        if (data.length < PAGE_SIZE) hasMore = false;
        else fromIndex += PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    return allInvoices.map((inv) => {
      const invType = (inv.invoice_type || "").toLowerCase();
      const outType = (inv.outlet_type || "").toLowerCase();
      const isCredit =
        isShopCredit ||
        invType === "credit" ||
        outType === "credit";

      const saleAmount = Number(inv.amount ?? inv.invoice_total ?? 0);
      const paidAmt = Number(inv.amount_received || 0);
      const rawStatus = (inv.payment_status || "").toLowerCase();

      let status: "Paid" | "Partial" | "Unpaid" = "Unpaid";
      if (!isCredit) {
        status = "Paid";
      } else {
        if (rawStatus === "paid" || (saleAmount > 0 && paidAmt >= saleAmount - 0.01)) {
          status = "Paid";
        } else if (rawStatus === "partial" || paidAmt > 0.01) {
          status = "Partial";
        } else {
          status = "Unpaid";
        }
      }

      return {
        id: inv.id,
        invoice_no: inv.invoice_no || "—",
        date: (inv.delivery_date || inv.invoice_date || inv.record_date || "").split("T")[0] || "—",
        sale: saleAmount,
        type: isCredit ? ("Credit" as const) : ("Cash" as const),
        status,
      };
    });
  } catch (err: any) {
    console.error("[getShopWiseSalesSummary] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getCreditSummaryReport(params?: {
  from?: string;
  to?: string;
}) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createAdminClient()
      : await createClient();

    // 1. Fetch all shops (paginated)
    const PAGE_SIZE = 1000;
    let allShops: any[] = [];
    let fromIdx = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from("shops")
        .select("id, shop_name, outlet_code, shop_type, outlet_type")
        .eq("tenant_id", tenantId)
        .order("shop_name")
        .range(fromIdx, fromIdx + PAGE_SIZE - 1);

      if (error) {
        console.error("[getCreditSummaryReport] shops error:", error.message);
        break;
      }
      if (data && data.length > 0) {
        allShops.push(...data);
        if (data.length < PAGE_SIZE) hasMore = false;
        else fromIdx += PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    if (allShops.length === 0) return [];

    const creditShopIds = new Set(
      allShops
        .filter(
          (s) =>
            (s.shop_type || "").toLowerCase() === "credit" ||
            (s.outlet_type && s.outlet_type.toLowerCase() === "credit")
        )
        .map((s) => s.id)
    );
    const creditOutletCodes = new Set(
      allShops
        .filter(
          (s) =>
            (s.shop_type || "").toLowerCase() === "credit" ||
            (s.outlet_type && s.outlet_type.toLowerCase() === "credit")
        )
        .map((s) => (s.outlet_code ? String(s.outlet_code).trim().toLowerCase() : ""))
        .filter(Boolean)
    );

    const shopMap = new Map<string, any>(allShops.map((s) => [s.id, s]));
    const shopByCode = new Map<string, any>();
    const shopByName = new Map<string, any>();

    for (const s of allShops) {
      if (s.outlet_code) {
        shopByCode.set(String(s.outlet_code).trim().toLowerCase(), s);
        shopByCode.set(String(s.outlet_code).trim(), s);
      }
      if (s.shop_name) {
        shopByName.set(String(s.shop_name).trim().toLowerCase(), s);
      }
    }

    // 2. Fetch all invoices (paginated)
    let allInvoices: any[] = [];
    fromIdx = 0;
    hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from("invoices")
        .select(`
          id,
          invoice_no,
          delivery_date,
          record_date,
          invoice_date,
          scheduled_date,
          amount,
          grand_total,
          invoice_total,
          invoice_type,
          outlet_type,
          amount_received,
          payment_status,
          shop_id,
          outlet_code,
          outlet_name
        `)
        .eq("tenant_id", tenantId)
        .range(fromIdx, fromIdx + PAGE_SIZE - 1);

      if (error) {
        console.error("[getCreditSummaryReport] invoices error:", error.message);
        break;
      }
      if (data && data.length > 0) {
        allInvoices.push(...data);
        if (data.length < PAGE_SIZE) hasMore = false;
        else fromIdx += PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    // 3. Fetch all payments (paginated)
    let allPayments: any[] = [];
    fromIdx = 0;
    hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from("shop_payments")
        .select("id, shop_id, amount, payment_date")
        .eq("tenant_id", tenantId)
        .range(fromIdx, fromIdx + PAGE_SIZE - 1);

      if (error) {
        console.error("[getCreditSummaryReport] payments error:", error.message);
        break;
      }
      if (data && data.length > 0) {
        allPayments.push(...data);
        if (data.length < PAGE_SIZE) hasMore = false;
        else fromIdx += PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    const paymentTotals = new Map<string, number>();
    for (const p of allPayments) {
      if (p.shop_id) {
        paymentTotals.set(
          p.shop_id,
          (paymentTotals.get(p.shop_id) || 0) + Number(p.amount || 0)
        );
      }
    }

    const shopCreditSales = new Map<string, number>();
    const shopUnpaidInvoices = new Map<string, any[]>();

    for (const inv of allInvoices) {
      const invOutletCode = inv.outlet_code ? String(inv.outlet_code).trim().toLowerCase() : "";
      const invOutletName = inv.outlet_name ? String(inv.outlet_name).trim().toLowerCase() : "";

      let shop =
        (inv.shop_id && shopMap.get(inv.shop_id)) ||
        (invOutletCode && shopByCode.get(invOutletCode)) ||
        (invOutletName && shopByName.get(invOutletName));

      if (!shop) {
        shop = {
          id: inv.shop_id || inv.outlet_code || inv.invoice_no,
          shop_name: inv.outlet_name || (inv.outlet_code ? `Shop (${inv.outlet_code})` : "Unknown Shop"),
          outlet_code: inv.outlet_code || "",
          shop_type: (inv.invoice_type || "").toLowerCase() === "credit" ? "credit" : "cash",
          outlet_type: (inv.invoice_type || "").toLowerCase() === "credit" ? "credit" : "cash",
        };
        shopMap.set(shop.id, shop);
      }

      const invType = (inv.invoice_type || "").toLowerCase();
      const outType = (inv.outlet_type || "").toLowerCase();
      const isCreditInvoiceType = invType === "credit" || outType === "credit";

      const shopType = (shop.shop_type || "").toLowerCase();
      const shopOutletType = (shop.outlet_type || "").toLowerCase();
      const isCreditShop =
        shopType === "credit" ||
        shopOutletType === "credit" ||
        (inv.shop_id && creditShopIds.has(inv.shop_id)) ||
        (invOutletCode && creditOutletCodes.has(invOutletCode));

      // ONLY include invoices belonging to credit shops OR invoices switched/marked as credit
      if (!isCreditInvoiceType && !isCreditShop) continue;

      const saleAmt = Number(inv.amount ?? inv.invoice_total ?? inv.grand_total ?? 0);
      const paidAmt = Number(inv.amount_received || 0);
      const remainingAmt = Math.max(0, saleAmt - paidAmt);

      // ONLY include invoices that are unpaid or partially paid
      if (remainingAmt <= 0.01) continue;

      const d = (inv.delivery_date || inv.invoice_date || inv.record_date || inv.scheduled_date || "").split("T")[0];
      if (params?.from && d && d < params.from) continue;
      if (params?.to && d && d > params.to) continue;

      let status: "Paid" | "Partial" | "Unpaid" = "Unpaid";
      if (paidAmt > 0.01) {
        status = "Partial";
      } else {
        status = "Unpaid";
      }

      if (!shopUnpaidInvoices.has(shop.id)) {
        shopUnpaidInvoices.set(shop.id, []);
      }
      shopUnpaidInvoices.get(shop.id)!.push({
        id: inv.id,
        invoice_no: inv.invoice_no || "—",
        date: d || "—",
        sale: saleAmt,
        paid: paidAmt,
        remaining: remainingAmt,
        status,
      });
    }

    const result: any[] = [];
    for (const [shopId, invoices] of shopUnpaidInvoices.entries()) {
      if (!invoices || invoices.length === 0) continue;

      const shop = shopMap.get(shopId);
      if (!shop) continue;

      invoices.sort((a, b) => b.date.localeCompare(a.date));

      const invRemaining = invoices.reduce((acc, inv) => acc + Number(inv.remaining || 0), 0);
      if (invRemaining <= 0.01) continue;

      result.push({
        shop_id: shop.id,
        shop_name: shop.shop_name,
        outlet_code: shop.outlet_code || "",
        balance: invRemaining,
        invoices,
      });
    }

    result.sort((a, b) => a.shop_name.localeCompare(b.shop_name));
    return result;
  } catch (err: any) {
    console.error("[getCreditSummaryReport] unexpected:", err?.message ?? err);
    return [];
  }
}



