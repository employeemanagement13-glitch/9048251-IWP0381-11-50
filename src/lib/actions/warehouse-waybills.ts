"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { leaseOutstandingAsOf } from "@/lib/empties/lease-as-of";

export interface WaybillItem {
  id?: string;
  product_id: string;
  product_code: string;
  product_name: string;
  quantity: number;
}

export interface Waybill {
  id: string;
  date: string;
  sap_waybill: string;
  created_at: string;
  updated_at: string;
  items: WaybillItem[];
}

export interface WaybillSummaryItem {
  id?: string;
  product_id?: string;
  product_code?: string;
  product_name: string;
  quantity: number;
}

export interface WaybillSummaryRow {
  id: string;
  date: string;
  sap_waybill: string;
  items: WaybillSummaryItem[];
  total_qty: number;
}

export async function getWaybills(): Promise<Waybill[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("waybills")
    .select("id, date, sap_waybill, created_at, updated_at, waybill_items(id, product_id, product_code, product_name, quantity)")
    .order("date", { ascending: false });
  if (error || !data) return [];
  return data.map((w: any) => ({
    ...w,
    items: (w.waybill_items ?? []).map((item: any) => ({
      id: item.id,
      product_id: item.product_id,
      product_code: item.product_code ?? "",
      product_name: item.product_name,
      quantity: Number(item.quantity),
    })),
  }));
}

export async function createWaybill(payload: {
  date: string;
  sap_waybill: string;
  items: WaybillItem[];
}): Promise<{ id: string }> {
  const supabase = await createClient();
  const tenantId = await getTenantId();

  const { data: wbData, error: wbErr } = await supabase
    .from("waybills")
    .insert({ tenant_id: tenantId, date: payload.date, sap_waybill: payload.sap_waybill })
    .select("id")
    .single();
  if (wbErr || !wbData) throw new Error(wbErr?.message ?? "Failed to create waybill");

  const waybillId = wbData.id;

  if (payload.items.length > 0) {
    const itemRows = payload.items.map((item) => ({
      tenant_id: tenantId,
      waybill_id: waybillId,
      product_id: item.product_id,
      product_code: item.product_code ?? "",
      product_name: item.product_name,
      quantity: item.quantity,
    }));
    const { error: itemErr } = await supabase.from("waybill_items").insert(itemRows);
    if (itemErr) throw new Error(itemErr.message);
  }

  const { revalidatePath } = await import("next/cache");
  revalidatePath("/inventory/warehouse");
  revalidatePath("/inventory/stock-reports");
  revalidatePath("/inventory/empties-movements");

  return { id: waybillId };
}

export async function updateWaybill(
  waybillId: string,
  payload: {
    date: string;
    sap_waybill: string;
    items: WaybillItem[];
  }
): Promise<void> {
  const supabase = await createClient();
  const tenantId = await getTenantId();

  const { error: wbErr } = await supabase
    .from("waybills")
    .update({ date: payload.date, sap_waybill: payload.sap_waybill })
    .eq("id", waybillId);
  if (wbErr) throw new Error(wbErr.message);

  const { error: delErr } = await supabase
    .from("waybill_items")
    .delete()
    .eq("waybill_id", waybillId);
  if (delErr) throw new Error(delErr.message);

  if (payload.items.length > 0) {
    const itemRows = payload.items.map((item) => ({
      tenant_id: tenantId,
      waybill_id: waybillId,
      product_id: item.product_id,
      product_code: item.product_code ?? "",
      product_name: item.product_name,
      quantity: item.quantity,
    }));
    const { error: itemErr } = await supabase.from("waybill_items").insert(itemRows);
    if (itemErr) throw new Error(itemErr.message);
  }

  const { revalidatePath } = await import("next/cache");
  revalidatePath("/inventory/warehouse");
  revalidatePath("/inventory/stock-reports");
  revalidatePath("/inventory/empties-movements");
}

export async function deleteWaybill(waybillId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("waybills").delete().eq("id", waybillId);
  if (error) throw new Error(error.message);

  const { revalidatePath } = await import("next/cache");
  revalidatePath("/inventory/warehouse");
  revalidatePath("/inventory/stock-reports");
  revalidatePath("/inventory/empties-movements");
}

export async function getWaybillsSummary(opts?: {
  from?: string;
  to?: string;
}): Promise<WaybillSummaryRow[]> {
  const supabase = await createClient();
  const tenantId = await getTenantId();

  let q = supabase
    .from("waybills")
    .select("id, date, sap_waybill, waybill_items(id, product_id, product_code, product_name, quantity)")
    .eq("tenant_id", tenantId)
    .order("date", { ascending: false });

  if (opts?.from) q = q.gte("date", opts.from);
  if (opts?.to) q = q.lte("date", opts.to);

  const { data, error } = await q;
  if (error || !data) return [];

  return data.map((w: any) => {
    const items: WaybillSummaryItem[] = (w.waybill_items ?? []).map((i: any) => ({
      id: i.id,
      product_id: i.product_id,
      product_code: i.product_code || "",
      product_name: i.product_name,
      quantity: Number(i.quantity),
    }));
    return {
      id: w.id,
      date: w.date,
      sap_waybill: w.sap_waybill,
      items,
      total_qty: items.reduce((s, i) => s + i.quantity, 0),
    };
  });
}

/** PostgREST caps every response at 1000 rows; page through everything so totals are accurate. */
async function fetchAllPages(
  build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>
): Promise<any[]> {
  const PAGE = 1000;
  const all: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

function parseInvoiceItems(str: string): { code?: string; name: string; qty: number }[] {
  if (!str) return [];
  const parts = str.split(",").map((s) => s.trim()).filter(Boolean);
  const items: { code?: string; name: string; qty: number }[] = [];

  for (const part of parts) {
    const m1 = /^(\d{4,9})\s+(.+?)\s*[×xX*]\s*(-?\d+(?:\.\d+)?)$/.exec(part);
    if (m1) {
      items.push({ code: m1[1], name: m1[2].trim(), qty: parseFloat(m1[3]) || 0 });
      continue;
    }

    const m2 = /^(.+?)\s*[×xX*]\s*(-?\d+(?:\.\d+)?)$/.exec(part);
    if (m2) {
      const namePart = m2[1].trim();
      const codeMatch = /^(\d{4,9})\s+(.+)$/.exec(namePart);
      if (codeMatch) {
        items.push({ code: codeMatch[1], name: codeMatch[2].trim(), qty: parseFloat(m2[2]) || 0 });
      } else {
        items.push({ name: namePart, qty: parseFloat(m2[2]) || 0 });
      }
      continue;
    }

    const m3 = /^(\d{4,9})\s+(.+?)\s+(-?\d+(?:\.\d+)?)$/.exec(part);
    if (m3) {
      items.push({ code: m3[1], name: m3[2].trim(), qty: parseFloat(m3[3]) || 0 });
      continue;
    }

    const m4 = /^(.+?)\s+(-?\d+(?:\.\d+)?)$/.exec(part);
    if (m4) {
      items.push({ name: m4[1].trim(), qty: parseFloat(m4[2]) || 0 });
      continue;
    }
  }

  return items;
}

/**
 * Calculates current market held RGB balances per outlet:
 * Outlet Held = Cumulative RGB Ordered by Outlet - Cumulative Linked Implied Empties Returned by Outlet
 */
async function computeOutletRgbBalances(supabase: any, tenantId: string) {
  // 1. Fetch RGB products
  const { data: rgbProds } = await supabase
    .from("products")
    .select("id, product_name, product_code, product_categories!inner(id, title, is_rgb)")
    .eq("tenant_id", tenantId)
    .eq("product_categories.is_rgb", true)
    .eq("active", true)
    .order("product_name");

  const rgbList = rgbProds || [];

  // 2. Fetch Implied products with linked_rgb_product_id
  const { data: impliedProds } = await supabase
    .from("products")
    .select("id, product_name, product_code, category_id, linked_rgb_product_id, product_categories!inner(id, title, is_implied)")
    .eq("tenant_id", tenantId)
    .eq("product_categories.is_implied", true)
    .eq("active", true);

  const impliedList = impliedProds || [];

  // 3. Bidirectional maps for Implied -> RGB
  const impliedToRgb = new Map<string, string>(); // implied.id -> rgb.id
  const impliedCodeToRgb = new Map<string, string>(); // implied.code -> rgb.id
  const impliedNameToRgb = new Map<string, string>(); // implied.name -> rgb.id

  impliedList.forEach((ip: any) => {
    let rgbId = ip.linked_rgb_product_id;
    if (!rgbId) {
      const normIp = ip.product_name.toUpperCase();
      const matched = rgbList.find((rp: any) => {
        const normRp = rp.product_name.toUpperCase();
        if (normIp.includes("COKE") || normIp.includes("COCA")) return normRp.includes("COCA") || normRp.includes("COKE");
        if (normIp.includes("FANTA") || normIp.includes("FAN")) return normRp.includes("FANTA");
        if (normIp.includes("MINT")) return normRp.includes("MINT");
        if (normIp.includes("SPRITE") || normIp.includes("SPR")) return normRp.includes("SPRITE") && !normRp.includes("MINT");
        return false;
      });
      if (matched) rgbId = matched.id;
    }

    if (rgbId) {
      impliedToRgb.set(ip.id, rgbId);
      if (ip.product_code) impliedCodeToRgb.set(ip.product_code.trim(), rgbId);
      impliedNameToRgb.set(ip.product_name.toLowerCase().trim(), rgbId);
    }
  });

  // 4. Quick match maps for RGB products
  const rgbIdMap = new Map<string, any>();
  const rgbCodeMap = new Map<string, any>();
  const rgbNameMap = new Map<string, any>();
  rgbList.forEach((rp: any) => {
    rgbIdMap.set(rp.id, rp);
    if (rp.product_code) rgbCodeMap.set(rp.product_code.trim(), rp);
    rgbNameMap.set(rp.product_name.toLowerCase().trim(), rp);
  });

  // 5. Query all shops
  const shopsData: any[] = await fetchAllPages((f, t) =>
    supabase.from("shops").select("id, shop_name, outlet_code").eq("tenant_id", tenantId).order("id").range(f, t)
  );

  const shopLookup = new Map<string, { id: string; shop_name: string; outlet_code: string }>();
  (shopsData || []).forEach((s: any) => shopLookup.set(s.id, s));

  // 6. Query all invoices with their products string
  const invoices = await fetchAllPages((f, t) =>
    supabase
      .from("invoices")
      .select("id, invoice_no, shop_id, products, shop:shops(id, shop_name, outlet_code)")
      .eq("tenant_id", tenantId)
      .order("id")
      .range(f, t)
  );

  const shopRgbOrdered = new Map<string, Map<string, number>>();
  const shopImpliedReturned = new Map<string, Map<string, number>>();

  for (const inv of (invoices || [])) {
    const shop = (inv.shop as any) || (inv.shop_id ? shopLookup.get(inv.shop_id) : null);
    if (!shop || !inv.products) continue;
    const shopId = shop.id;

    if (!shopRgbOrdered.has(shopId)) shopRgbOrdered.set(shopId, new Map());
    if (!shopImpliedReturned.has(shopId)) shopImpliedReturned.set(shopId, new Map());

    const ordMap = shopRgbOrdered.get(shopId)!;
    const retMap = shopImpliedReturned.get(shopId)!;

    const items = parseInvoiceItems(inv.products);
    for (const item of items) {
      // Positive RGB item
      const rgb =
        (item.code ? rgbCodeMap.get(item.code.trim()) : undefined) ||
        rgbNameMap.get(item.name.toLowerCase().trim());

      if (rgb && item.qty > 0) {
        ordMap.set(rgb.id, (ordMap.get(rgb.id) || 0) + item.qty);
      }

      // Negative Implied item (returned empties)
      const linkedRgbId =
        (item.code ? impliedCodeToRgb.get(item.code.trim()) : undefined) ||
        impliedNameToRgb.get(item.name.toLowerCase().trim());

      if (linkedRgbId && item.qty < 0) {
        retMap.set(linkedRgbId, (retMap.get(linkedRgbId) || 0) + Math.abs(item.qty));
      }
    }
  }

  // Also include approved manual returns in returns_wayback
  const waybackReturns = await fetchAllPages((f, t) =>
    supabase
      .from("returns_wayback")
      .select("shop_id, product_name, received_qty, status")
      .eq("tenant_id", tenantId)
      .eq("status", "approved")
      .order("id")
      .range(f, t)
  );

  (waybackReturns || []).forEach((wr: any) => {
    if (!wr.shop_id) return;
    const norm = (wr.product_name || "").toLowerCase().trim();
    const linkedRgbId = impliedNameToRgb.get(norm);
    const directRgb = rgbNameMap.get(norm);
    const targetId = linkedRgbId || directRgb?.id;
    if (targetId) {
      if (!shopImpliedReturned.has(wr.shop_id)) shopImpliedReturned.set(wr.shop_id, new Map());
      const m = shopImpliedReturned.get(wr.shop_id)!;
      m.set(targetId, (m.get(targetId) || 0) + Number(wr.received_qty || 0));
    }
  });

  // 7. Calculate held balances for each shop
  const outletRows: OutletEmptyLedgerRow[] = [];
  const totalHeldByRgbId = new Map<string, number>();

  for (const shop of (shopsData || [])) {
    const ordMap = shopRgbOrdered.get(shop.id) || new Map<string, number>();
    const retMap = shopImpliedReturned.get(shop.id) || new Map<string, number>();

    let shopTotal = 0;
    const rowObj: Record<string, number> = {};

    for (const rp of rgbList) {
      const ord = ordMap.get(rp.id) || 0;
      const ret = retMap.get(rp.id) || 0;
      const held = Math.max(0, ord - ret);
      rowObj[rp.product_name] = held;
      shopTotal += held;

      totalHeldByRgbId.set(rp.id, (totalHeldByRgbId.get(rp.id) || 0) + held);
    }

    if (shopTotal > 0) {
      outletRows.push({
        outlet_code: shop.outlet_code || "—",
        outlet_name: shop.shop_name || "—",
        total_qty: shopTotal,
        ...rowObj,
      });
    }
  }

  outletRows.sort((a, b) => b.total_qty - a.total_qty);

  return {
    rgbList,
    impliedList,
    impliedToRgb,
    outletRows,
    totalHeldByRgbId,
  };
}

export interface OutletEmptyLedgerRow {
  outlet_code: string;
  outlet_name: string;
  total_qty: number;
  [rgbProductName: string]: string | number;
}

export async function getOutletsEmptyLedger(): Promise<{
  rows: OutletEmptyLedgerRow[];
  productNames: string[];
}> {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) return { rows: [], productNames: [] };

  const { rgbList, outletRows } = await computeOutletRgbBalances(supabase, tenantId);

  return {
    rows: outletRows,
    productNames: rgbList.map((p: any) => p.product_name),
  };
}

export interface EmptyBalanceRow {
  product_id: string;
  product_code: string;
  product_name: string;
  wayback_qty: number;
  remains_qty: number;
  in_outlets_qty: number | string;
  leased_qty?: number | string;
  sold_qty?: number | string;
  is_implied?: boolean;
}

function isImpliedEmptySku(p: {
  is_implied?: boolean;
  product_id?: string;
  product_name?: string;
  code?: string;
  product_code?: string;
}, impliedIds: Set<string>, impliedNames: Set<string>) {
  const name = String(p.product_name || "").toLowerCase().trim();
  return (
    Boolean(p.is_implied) ||
    (p.product_id ? impliedIds.has(p.product_id) : false) ||
    (name ? impliedNames.has(name) : false) ||
    name.includes("implied") ||
    name.includes("imp.emp") ||
    name.includes("imp emp")
  );
}

function isReturnableEmptySku(p: {
  is_implied?: boolean;
  is_returnable?: boolean;
  is_rgb?: boolean;
  category_title?: string;
}) {
  if (p.is_rgb) return false;
  return Boolean(p.is_returnable);
}

export async function getEmptyBalanceReport(opts?: {
  from?: string;
  to?: string;
  categoryId?: string;
}): Promise<EmptyBalanceRow[]> {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) return [];

  const { getReturnableNonRgbProducts, getLeaseEmpties, getImpliedProducts } = await import("@/lib/actions/leased-empties");
  const { getStockBalanceByLevel } = await import("@/lib/actions/reports");

  const [returnableNonRgb, catalogImplied, periodRows] = await Promise.all([
    getReturnableNonRgbProducts({ uniqueByName: false }),
    getImpliedProducts(),
    // Same call Balance by Level makes. Net Balance is copied from it for every row.
    getStockBalanceByLevel({ dateFrom: opts?.from, dateTo: opts?.to }),
  ]);

  const periodNetById = new Map<string, number>();
  const periodNetByCode = new Map<string, number>();
  const periodNetByName = new Map<string, number>();
  for (const r of periodRows) {
    if (r.product_id) periodNetById.set(r.product_id, Number(r.net_balance || 0));
    const code = String(r.code || "").trim();
    if (code && code !== "—") periodNetByCode.set(code, Number(r.net_balance || 0));
    const nm = String(r.product_name || "").toLowerCase().trim();
    if (nm) periodNetByName.set(nm, Number(r.net_balance || 0));
  }

  // ── Implied / returnable product catalogs ─────────────────────────────
  const impliedIds = new Set<string>();
  const impliedNames = new Set<string>();
  for (const p of catalogImplied) {
    impliedIds.add(p.id);
    const name = String(p.product_name || "").toLowerCase().trim();
    if (name) impliedNames.add(name);
  }

  let allowedIds: Set<string> | null = null;
  if (opts?.categoryId) {
    allowedIds = new Set(
      catalogImplied.filter((p: any) => p.category_id === opts.categoryId).map((p: any) => p.id)
    );
  }

  // ── Build emptyRows list ─────────────────────────────────────────────
  const emptyRows: EmptyBalanceRow[] = [];
  const seen = new Set<string>();

  const pushRow = (p: {
    product_id: string;
    product_code?: string;
    code?: string;
    product_name: string;
    is_implied?: boolean;
    is_returnable?: boolean;
    is_rgb?: boolean;
    category_title?: string;
    net_balance?: number;
  }) => {
    if (!p.product_id || seen.has(p.product_id)) return;
    if (allowedIds && !allowedIds.has(p.product_id)) return;
    const implied = isImpliedEmptySku({ ...p, product_id: p.product_id }, impliedIds, impliedNames);
    const empties = !implied && isReturnableEmptySku(p);
    if (!implied && !empties) return;
    seen.add(p.product_id);

    emptyRows.push({
      product_id: p.product_id,
      product_code: p.product_code || p.code || "—",
      product_name: p.product_name,
      wayback_qty: 0,
      remains_qty: 0,
      in_outlets_qty: implied ? "-" : 0,
      leased_qty: implied ? "-" : 0,
      sold_qty: implied ? "-" : 0,
      is_implied: implied,
    });
  };

  for (const r of periodRows) {
    pushRow({
      product_id: r.product_id,
      product_code: r.code,
      code: r.code,
      product_name: r.product_name,
      is_implied: r.is_implied,
      is_returnable: r.is_returnable,
      is_rgb: r.is_rgb,
    });
  }
  for (const p of catalogImplied) {
    pushRow({ product_id: p.id, product_code: p.product_code, product_name: p.product_name, is_implied: true });
  }
  for (const p of returnableNonRgb) {
    pushRow({ product_id: p.id, product_code: p.product_code, product_name: p.product_name, is_returnable: true, is_rgb: false });
  }

  // ── Waybill (returned-to-Coke) in period [FROM, TO] ──────────────────
  const emptyIdSet = new Set(emptyRows.map((r) => r.product_id));
  const emptyNameToId = new Map<string, string>();
  for (const r of emptyRows) {
    const name = r.product_name.toLowerCase().trim();
    if (name && !emptyNameToId.has(name)) emptyNameToId.set(name, r.product_id);
  }

  const waybillItems = await fetchAllPages((f, t) => {
    let wq = supabase
      .from("waybill_items")
      .select("id, product_id, product_name, quantity, waybills!inner(date)")
      .eq("waybills.tenant_id", tenantId)
      .order("id")
      .range(f, t);
    if (opts?.from) wq = wq.gte("waybills.date", opts.from);
    if (opts?.to) wq = wq.lte("waybills.date", opts.to);
    return wq;
  });

  const waybackMap = new Map<string, number>();
  (waybillItems || []).forEach((wi: any) => {
    const name = String(wi.product_name || "").toLowerCase().trim();
    const pid =
      (wi.product_id && emptyIdSet.has(wi.product_id) && wi.product_id) ||
      emptyNameToId.get(name);
    if (!pid) return;
    waybackMap.set(pid, (waybackMap.get(pid) || 0) + Number(wi.quantity || 0));
  });

  // ── Leased empties outstanding as of To (return date, not just lease date) ─
  const leasesInPeriod = await getLeaseEmpties({ to: opts?.to });
  const leasedByProduct = new Map<string, number>();
  const addLeasedQty = (map: Map<string, number>, it: { product_id?: string; product_code?: string; product_name: string }, qty: number) => {
    const keyName = it.product_name.toLowerCase().trim();
    map.set(keyName, (map.get(keyName) || 0) + qty);
    if (it.product_id) map.set(it.product_id, (map.get(it.product_id) || 0) + qty);
    if (it.product_code) map.set(it.product_code.trim(), (map.get(it.product_code.trim()) || 0) + qty);
  };
  for (const lease of leasesInPeriod) {
    for (const it of lease.items) {
      const remainingTo = leaseOutstandingAsOf({
        quantity: Number(it.quantity || 0),
        returnedQty: Number(it.returned_qty || 0),
        returnedDate: it.returned_date,
        returns: it.returns,
        leaseDate: lease.date,
        asOfDate: opts?.to,
      });
      addLeasedQty(leasedByProduct, it, remainingTo);
    }
  }

  // ── Sold empties IN PERIOD [FROM, TO] ────────────────────────────────
  const { getSoldEmpties } = await import("@/lib/actions/sold-empties");
  const soldList = await getSoldEmpties({ from: opts?.from, to: opts?.to });
  const soldByProduct = new Map<string, number>();
  for (const sale of soldList) {
    for (const it of sale.items) {
      const qty = Number(it.quantity || 0);
      const keyName = it.product_name.toLowerCase().trim();
      soldByProduct.set(keyName, (soldByProduct.get(keyName) || 0) + qty);
      if (it.product_id) {
        soldByProduct.set(it.product_id, (soldByProduct.get(it.product_id) || 0) + qty);
      }
      if (it.product_code) {
        soldByProduct.set(it.product_code.trim(), (soldByProduct.get(it.product_code.trim()) || 0) + qty);
      }
    }
  }

  // ── Final pass: wayback, leased, sold, Net Balance (= BBL Ph. Case) ─
  for (const row of emptyRows) {
    row.wayback_qty = waybackMap.get(row.product_id) || 0;
    const keyName = row.product_name.toLowerCase().trim();
    const keyCode = String(row.product_code || "").trim();
    const pickQty = (map: Map<string, number>) =>
      map.get(row.product_id) ??
      map.get(keyName) ??
      (keyCode && keyCode !== "—" ? map.get(keyCode) : undefined) ??
      0;

    if (!row.is_implied) {
      const leasedVal = pickQty(leasedByProduct);
      row.in_outlets_qty = leasedVal;
      row.leased_qty = leasedVal;
      row.sold_qty = pickQty(soldByProduct);
    } else {
      row.in_outlets_qty = "-";
      row.leased_qty = "-";
      row.sold_qty = "-";
    }

    row.remains_qty = Math.max(
      0,
      periodNetById.get(row.product_id) ??
        (keyCode && keyCode !== "—" ? periodNetByCode.get(keyCode) : undefined) ??
        periodNetByName.get(keyName) ??
        0,
    );
  }

  emptyRows.sort((a, b) => a.product_name.localeCompare(b.product_name));
  return emptyRows;
}
