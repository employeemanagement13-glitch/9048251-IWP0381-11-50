"use server";

import { createClient, createAdminClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  leaseOutstandingAsOf,
  leaseReturnedQtyAsOf,
  type LeaseReturnEntry,
} from "@/lib/empties/lease-as-of";

export interface LeasedEmptyItem {
  id?: string;
  product_id: string;
  product_code: string;
  product_name: string;
  quantity: number;
  returned_qty?: number;
  returned_date?: string | null;
  returns?: (LeaseReturnEntry & { id?: string })[];
}

export interface LeasedEmptyRecord {
  id: string;
  date: string;
  shop_id: string;
  outlet_code: string;
  outlet_name: string;
  created_at: string;
  updated_at: string;
  items: LeasedEmptyItem[];
  formatted_products: string;
  formatted_returned: string;
  returned_date?: string | null;
}

export interface OutletEmptyBalanceRow {
  shop_id: string;
  outlet_code: string;
  outlet_name: string;
  quantities: Record<string, number>;
  total_qty: number;
  formatted_returned: string;
}

export interface OutletEmptyBalanceData {
  products: { id: string; product_name: string; product_code: string }[];
  rows: OutletEmptyBalanceRow[];
  totals: Record<string, number>;
  grand_total: number;
}

function getSupabase() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : createClient();
}

export async function getReturnableNonRgbProducts(opts?: { uniqueByName?: boolean }) {
  const supabase = await getSupabase();
  const tenantId = await getTenantId();
  if (!tenantId) return [];

  const { data, error } = await supabase
    .from("products")
    .select("id, product_name, product_code, is_returnable, category_id, product_categories(id, title, is_returnable, is_rgb, is_implied)")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("product_name");

  if (error || !data) return [];

  const uniqueByName = opts?.uniqueByName !== false;
  const unique = new Map<string, any>();
  for (const p of data) {
    const rawCat = (p as any).product_categories;
    const cat = Array.isArray(rawCat) ? rawCat[0] : rawCat;
    const catTitle = (cat?.title || "").toLowerCase();
    const name = String(p.product_name || "");
    const code = String(p.product_code || "");
    const isRgb = Boolean((p as any).is_rgb || cat?.is_rgb);
    const isImplied = Boolean(
      (p as any).is_implied ||
      cat?.is_implied ||
      catTitle.includes("implied") ||
      name.toUpperCase().includes("IMPLIED") ||
      name.toUpperCase().includes("IMP.EMP") ||
      name.toUpperCase().includes("IMP EMP")
    );
    if (isRgb || isImplied) continue;

    const isRet = Boolean((p as any).is_returnable || cat?.is_returnable);
    if (isRet) {
      const key = uniqueByName ? `${code}-${name.trim().toUpperCase()}` : p.id;
      if (!unique.has(key)) {
        unique.set(key, {
          id: p.id,
          product_name: p.product_name,
          product_code: p.product_code || "",
        });
      }
    }
  }

  return Array.from(unique.values()).sort((a, b) => a.product_name.localeCompare(b.product_name));
}

export async function getImpliedProducts() {
  const supabase = await getSupabase();
  const tenantId = await getTenantId();
  if (!tenantId) return [];

  const { data, error } = await supabase
    .from("products")
    .select("id, product_name, product_code, category_id, product_categories(id, title, is_implied)")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("product_name");

  if (error || !data) return [];

  return data
    .filter((p: any) => {
      const cat = Array.isArray(p.product_categories) ? p.product_categories[0] : p.product_categories;
      const catTitle = (cat?.title || "").toLowerCase();
      const name = (p.product_name || "").toUpperCase();
      return (
        Boolean(cat?.is_implied) ||
        Boolean((p as any).is_implied) ||
        catTitle.includes("implied") ||
        name.includes("IMPLIED") ||
        name.includes("IMP.EMP") ||
        name.includes("IMP EMP")
      );
    })
    .map((p: any) => {
      const cat = Array.isArray(p.product_categories) ? p.product_categories[0] : p.product_categories;
      return {
        id: p.id,
        product_name: p.product_name,
        product_code: p.product_code || "",
        category_id: p.category_id || cat?.id || null,
      };
    });
}

export async function getOutletsForLease() {
  const supabase = await getSupabase();
  const tenantId = await getTenantId();
  if (!tenantId) return [];

  const { data, error } = await supabase
    .from("shops")
    .select("id, outlet_code, shop_name")
    .eq("tenant_id", tenantId)
    .order("shop_name");

  if (error || !data) return [];
  return data.map((s: any) => ({
    id: s.id,
    outlet_code: s.outlet_code || "",
    shop_name: s.shop_name || "",
  }));
}

export async function getLeaseEmpties(opts?: { from?: string; to?: string }): Promise<LeasedEmptyRecord[]> {
  const supabase = await getSupabase();
  const tenantId = await getTenantId();
  if (!tenantId) return [];

  const { data: dedicated, error: dErr } = await supabase
    .from("leased_empties")
    .select("id, date, shop_id, outlet_code, outlet_name, created_at, updated_at, leased_empty_items(id, product_id, product_code, product_name, quantity, returned_qty, returned_date)")
    .eq("tenant_id", tenantId)
    .order("date", { ascending: false });

  if (!dErr && dedicated) {
    const leaseIds = dedicated.map((l: any) => l.id).filter(Boolean);
    const returnsByItem = new Map<string, (LeaseReturnEntry & { id?: string })[]>();
    if (leaseIds.length > 0) {
      const { data: retRows } = await supabase
        .from("leased_empty_returns")
        .select("id, lease_item_id, return_date, quantity, is_legacy")
        .eq("tenant_id", tenantId)
        .in("lease_id", leaseIds)
        .order("return_date", { ascending: true });
      for (const r of retRows || []) {
        const key = r.lease_item_id;
        if (!returnsByItem.has(key)) returnsByItem.set(key, []);
        returnsByItem.get(key)!.push({
          id: r.id,
          date: String(r.return_date).slice(0, 10),
          quantity: Number(r.quantity || 0),
          is_legacy: Boolean(r.is_legacy),
        });
      }
    }

    let list = dedicated.map((l: any) => {
      const items: LeasedEmptyItem[] = (l.leased_empty_items || []).map((it: any) => {
        const returns = returnsByItem.get(it.id) || [];
        const returned_qty =
          returns.length > 0
            ? returns.reduce((s, x) => s + (Number(x.quantity) || 0), 0)
            : Number(it.returned_qty || 0);
        const returned_date =
          returns.length > 0
            ? returns.map((x) => x.date).sort().slice(-1)[0]
            : it.returned_date || null;
        return {
          id: it.id,
          product_id: it.product_id,
          product_code: it.product_code || "",
          product_name: it.product_name,
          quantity: Number(it.quantity || 0),
          returned_qty,
          returned_date,
          returns,
        };
      });
      const formatted = items
        .map((it) => `${it.product_code ? it.product_code + "    " : ""}${it.product_name}\u00D7${it.quantity}`)
        .join(", ");
      // One line per return date: "2026-06-06 Plastic Separator x6, Wooden Pallets x3"
      const byDate = new Map<string, string[]>();
      for (const it of items) {
        for (const r of it.returns || []) {
          if ((r.quantity || 0) <= 0) continue;
          const d = r.date;
          if (!byDate.has(d)) byDate.set(d, []);
          const legacy = r.is_legacy ? " (legacy)" : "";
          byDate.get(d)!.push(`${it.product_name} x${r.quantity}${legacy}`);
        }
      }
      const formattedRet =
        byDate.size > 0
          ? Array.from(byDate.entries())
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([d, parts]) => `${d} ${parts.join(", ")}`)
              .join("\n")
          : "—";
      const returnedDates = Array.from(byDate.keys()).sort();
      return {
        id: l.id,
        date: l.date,
        shop_id: l.shop_id,
        outlet_code: l.outlet_code,
        outlet_name: l.outlet_name,
        created_at: l.created_at,
        updated_at: l.updated_at,
        items,
        formatted_products: formatted,
        formatted_returned: formattedRet,
        returned_date: returnedDates.slice(-1)[0] || null,
      };
    });

    if (opts?.from) list = list.filter((r) => r.date >= opts.from!);
    if (opts?.to) list = list.filter((r) => r.date <= opts.to!);
    return list;
  }

  let sq = supabase
    .from("stock_audits")
    .select("id, scheduled_date, audit_date, products_counted, created_at")
    .eq("tenant_id", tenantId)
    .eq("status", "leased_empty")
    .order("scheduled_date", { ascending: false });

  if (opts?.from) sq = sq.gte("scheduled_date", opts.from);
  if (opts?.to) sq = sq.lte("scheduled_date", opts.to);

  const { data: audits } = await sq;
  if (!audits) return [];

  return audits.map((a: any) => {
    const p = a.products_counted || {};
    const items: LeasedEmptyItem[] = (p.items || []).map((it: any) => ({
      id: it.id || it.product_id,
      product_id: it.product_id,
      product_code: it.product_code || "",
      product_name: it.product_name,
      quantity: Number(it.quantity || 0),
      returned_qty: Number(it.returned_qty || 0),
      returned_date: it.returned_date || null,
    }));
    const formatted = items
      .map((it) => `${it.product_code ? it.product_code + "    " : ""}${it.product_name}\u00D7${it.quantity}`)
      .join(", ");
    const returnedList = items.filter((it) => (it.returned_qty || 0) > 0);
    const formattedRet = returnedList.length > 0
      ? returnedList.map((it) => `${it.product_name}\u00D7${it.returned_qty}`).join(", ")
      : "—";
    const returnedDates = Array.from(new Set(returnedList.map((it) => it.returned_date).filter(Boolean))) as string[];
    return {
      id: a.id,
      date: a.scheduled_date || a.audit_date || a.created_at.slice(0, 10),
      shop_id: p.shop_id || "",
      outlet_code: p.outlet_code || "",
      outlet_name: p.outlet_name || "",
      created_at: a.created_at,
      updated_at: a.created_at,
      items,
      formatted_products: formatted,
      formatted_returned: formattedRet,
      returned_date: returnedDates.sort().slice(-1)[0] || p.returned_date || null,
    };
  });
}

export async function createLeaseEmpties(payload: {
  date: string;
  shop_id: string;
  outlet_code: string;
  outlet_name: string;
  items: { product_id: string; product_code: string; product_name: string; quantity: number }[];
}): Promise<{ id: string }> {
  const supabase = await getSupabase();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");
  if (!payload.items.length) throw new Error("At least one product is required.");
  if (payload.items.some((it) => it.quantity <= 0)) throw new Error("All quantities must be greater than 0.");

  const { data: insLease, error: insErr } = await supabase
    .from("leased_empties")
    .insert({
      tenant_id: tenantId,
      date: payload.date,
      shop_id: payload.shop_id || null,
      outlet_code: payload.outlet_code,
      outlet_name: payload.outlet_name,
    })
    .select("id")
    .single();

  if (!insErr && insLease) {
    const leaseId = insLease.id;
    const { data: tenantProds } = await supabase
      .from("products")
      .select("id, product_name, product_code")
      .eq("tenant_id", tenantId)
      .eq("active", true);

    const prodIdByName = new Map<string, string>();
    (tenantProds || []).forEach((tp) => {
      prodIdByName.set(tp.product_name.toLowerCase().trim(), tp.id);
      if (tp.product_code) prodIdByName.set(tp.product_code.trim(), tp.id);
    });

    const itemRows = payload.items.map((it) => {
      const matchedId = prodIdByName.get(it.product_name.toLowerCase().trim()) || it.product_id;
      return {
        tenant_id: tenantId,
        lease_id: leaseId,
        product_id: matchedId,
        product_code: it.product_code || "",
        product_name: it.product_name,
        quantity: it.quantity,
        returned_qty: 0,
      };
    });
    await supabase.from("leased_empty_items").insert(itemRows);
    revalidatePath("/inventory/warehouse");
    revalidatePath("/inventory/stock-reports");
    revalidatePath("/inventory/empties-movements");
    return { id: leaseId };
  }

  const auditItems = payload.items.map((it) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    product_id: it.product_id,
    product_code: it.product_code || "",
    product_name: it.product_name,
    quantity: it.quantity,
    returned_qty: 0,
  }));

  const { data: fbAudit, error: fbErr } = await supabase
    .from("stock_audits")
    .insert({
      tenant_id: tenantId,
      scheduled_date: payload.date,
      audit_date: payload.date,
      status: "leased_empty",
      products_counted: {
        shop_id: payload.shop_id,
        outlet_code: payload.outlet_code,
        outlet_name: payload.outlet_name,
        items: auditItems,
      },
    })
    .select("id")
    .single();

  if (fbErr || !fbAudit) throw new Error(fbErr?.message ?? "Failed to save lease record.");

  revalidatePath("/inventory/warehouse");
  revalidatePath("/inventory/stock-reports");
    revalidatePath("/inventory/empties-movements");
  return { id: fbAudit.id };
}

export async function updateLeaseEmpties(
  id: string,
  payload: {
    date: string;
    shop_id: string;
    outlet_code: string;
    outlet_name: string;
    items: { id?: string; product_id: string; product_code: string; product_name: string; quantity: number }[];
  }
) {
  const supabase = await getSupabase();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");
  if (!payload.items.length) throw new Error("At least one product is required.");

  const { data: existingDedicated } = await supabase
    .from("leased_empties")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existingDedicated) {
    await supabase
      .from("leased_empties")
      .update({
        date: payload.date,
        shop_id: payload.shop_id || null,
        outlet_code: payload.outlet_code,
        outlet_name: payload.outlet_name,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("tenant_id", tenantId);

    const { data: oldItems } = await supabase
      .from("leased_empty_items")
      .select("product_id, returned_qty, returned_date")
      .eq("lease_id", id)
      .eq("tenant_id", tenantId);

    const retMap = new Map<string, number>();
    const retDateMap = new Map<string, string | null>();
    (oldItems || []).forEach((it: any) => {
      retMap.set(it.product_id, Number(it.returned_qty || 0));
      retDateMap.set(it.product_id, it.returned_date || null);
    });

    await supabase.from("leased_empty_items").delete().eq("lease_id", id).eq("tenant_id", tenantId);

    const { data: tenantProds } = await supabase
      .from("products")
      .select("id, product_name, product_code")
      .eq("tenant_id", tenantId)
      .eq("active", true);

    const prodIdByName = new Map<string, string>();
    (tenantProds || []).forEach((tp) => {
      prodIdByName.set(tp.product_name.toLowerCase().trim(), tp.id);
      if (tp.product_code) prodIdByName.set(tp.product_code.trim(), tp.id);
    });

    const newRows = payload.items.map((it) => {
      const matchedId = prodIdByName.get(it.product_name.toLowerCase().trim()) || it.product_id;
      return {
        tenant_id: tenantId,
        lease_id: id,
        product_id: matchedId,
        product_code: it.product_code || "",
        product_name: it.product_name,
        quantity: it.quantity,
        returned_qty: retMap.get(matchedId) || retMap.get(it.product_id) || 0,
        returned_date: retDateMap.get(matchedId) || retDateMap.get(it.product_id) || null,
      };
    });
    await supabase.from("leased_empty_items").insert(newRows);

    revalidatePath("/inventory/warehouse");
    revalidatePath("/inventory/stock-reports");
    revalidatePath("/inventory/empties-movements");
    return { success: true };
  }

  const { data: audit } = await supabase
    .from("stock_audits")
    .select("products_counted")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  const prevItems = audit?.products_counted?.items || [];
  const retMap = new Map<string, number>();
  const retDateMap = new Map<string, string | null>();
  prevItems.forEach((it: any) => {
    retMap.set(it.product_id, Number(it.returned_qty || 0));
    retDateMap.set(it.product_id, it.returned_date || null);
  });

  const updatedItems = payload.items.map((it) => ({
    id: it.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    product_id: it.product_id,
    product_code: it.product_code || "",
    product_name: it.product_name,
    quantity: it.quantity,
    returned_qty: retMap.get(it.product_id) || 0,
    returned_date: retDateMap.get(it.product_id) || null,
  }));

  const { error } = await supabase
    .from("stock_audits")
    .update({
      scheduled_date: payload.date,
      audit_date: payload.date,
      products_counted: {
        shop_id: payload.shop_id,
        outlet_code: payload.outlet_code,
        outlet_name: payload.outlet_name,
        items: updatedItems,
      },
    })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) throw new Error(error.message);

  revalidatePath("/inventory/warehouse");
  revalidatePath("/inventory/stock-reports");
    revalidatePath("/inventory/empties-movements");
  return { success: true };
}

/**
 * Replace all dated returns on a lease.
 * entries: one row per (product, return_date). Totals per product cannot exceed leased qty.
 */
export async function replaceLeaseReturns(
  leaseId: string,
  entries: { product_id: string; return_date: string; quantity: number; is_legacy?: boolean }[]
) {
  const supabase = await getSupabase();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const today = new Date().toISOString().slice(0, 10);
  const { data: lease } = await supabase
    .from("leased_empties")
    .select("id, date")
    .eq("id", leaseId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!lease) throw new Error("Lease record not found.");

  const { data: items } = await supabase
    .from("leased_empty_items")
    .select("id, product_id, quantity")
    .eq("lease_id", leaseId)
    .eq("tenant_id", tenantId);

  const itemByProduct = new Map<string, { id: string; quantity: number }>();
  for (const it of items || []) {
    itemByProduct.set(it.product_id, { id: it.id, quantity: Number(it.quantity || 0) });
  }

  const totalsByProduct = new Map<string, number>();
  const rows: any[] = [];
  for (const e of entries || []) {
    const qty = Number(e.quantity || 0);
    const d = String(e.return_date || "").slice(0, 10);
    if (qty <= 0 || !d) continue;
    if (lease.date && d < lease.date) {
      throw new Error("Returned date cannot be before the lease date.");
    }
    if (d > today) throw new Error("Returned date cannot be in the future.");
    const item = itemByProduct.get(e.product_id);
    if (!item) throw new Error("Unknown product on this lease.");
    totalsByProduct.set(e.product_id, (totalsByProduct.get(e.product_id) || 0) + qty);
    rows.push({
      tenant_id: tenantId,
      lease_id: leaseId,
      lease_item_id: item.id,
      return_date: d,
      quantity: qty,
      is_legacy: Boolean(e.is_legacy),
    });
  }

  for (const [pid, total] of totalsByProduct.entries()) {
    const max = itemByProduct.get(pid)?.quantity || 0;
    if (total > max + 0.0001) {
      throw new Error("Total returned quantity cannot exceed leased quantity.");
    }
  }

  await supabase.from("leased_empty_returns").delete().eq("lease_id", leaseId).eq("tenant_id", tenantId);
  if (rows.length > 0) {
    const { error: insErr } = await supabase.from("leased_empty_returns").insert(rows);
    if (insErr) throw new Error(insErr.message);
  }

  // Keep aggregate columns in sync for any reader that still uses them
  for (const it of items || []) {
    const itemReturns = rows.filter((r) => r.lease_item_id === it.id);
    const sum = itemReturns.reduce((s, r) => s + Number(r.quantity || 0), 0);
    const latest = itemReturns.map((r) => r.return_date).sort().slice(-1)[0] || null;
    await supabase
      .from("leased_empty_items")
      .update({
        returned_qty: sum,
        returned_date: sum > 0 ? latest : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", it.id)
      .eq("tenant_id", tenantId);
  }

  revalidatePath("/inventory/warehouse");
  revalidatePath("/inventory/stock-reports");
  revalidatePath("/inventory/empties-movements");
  revalidatePath("/income/balance-sheet");
  return { success: true };
}

export async function updateLeaseReturned(
  leaseId: string,
  returnedMap: Record<string, number>,
  returnedDate?: string | null
) {
  const supabase = await getSupabase();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const { data: existingDedicated } = await supabase
    .from("leased_empties")
    .select("id, date")
    .eq("id", leaseId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existingDedicated) {
    // Convert single-date map into replaceLeaseReturns entries (one dated return per product)
    const entries: { product_id: string; return_date: string; quantity: number }[] = [];
    const date = returnedDate || existingDedicated.date;
    for (const [pid, qty] of Object.entries(returnedMap || {})) {
      const q = Number(qty || 0);
      if (q > 0 && date) entries.push({ product_id: pid, return_date: date, quantity: q });
    }
    return replaceLeaseReturns(leaseId, entries);
  }

  const { data: audit, error: aErr } = await supabase
    .from("stock_audits")
    .select("products_counted, scheduled_date")
    .eq("id", leaseId)
    .eq("tenant_id", tenantId)
    .single();

  if (aErr || !audit) throw new Error(aErr?.message ?? "Lease record not found.");

  const leaseDate = audit.scheduled_date || audit.products_counted?.date;
  if (returnedDate && leaseDate && returnedDate < leaseDate) {
    throw new Error("Returned date cannot be before the lease date.");
  }

  const p = audit.products_counted || {};
  const currentItems = p.items || [];
  const nextItems = currentItems.map((it: any) => {
    const retVal = returnedMap[it.product_id] ?? returnedMap[it.id];
    if (retVal !== undefined) {
      const bounded = Math.max(0, Math.min(Number(it.quantity || 0), Number(retVal || 0)));
      const next: any = { ...it, returned_qty: bounded };
      if (bounded <= 0) next.returned_date = null;
      else if (returnedDate !== undefined) next.returned_date = returnedDate || null;
      return next;
    }
    return it;
  });

  const { error: uErr } = await supabase
    .from("stock_audits")
    .update({
      products_counted: {
        ...p,
        returned_date: returnedDate !== undefined ? returnedDate : p.returned_date || null,
        items: nextItems,
      },
    })
    .eq("id", leaseId)
    .eq("tenant_id", tenantId);

  if (uErr) throw new Error(uErr.message);

  revalidatePath("/inventory/warehouse");
  revalidatePath("/inventory/stock-reports");
    revalidatePath("/inventory/empties-movements");
  return { success: true };
}

export async function deleteLeaseEmpties(id: string) {
  const supabase = await getSupabase();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const { data: existingDedicated } = await supabase
    .from("leased_empties")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existingDedicated) {
    await supabase.from("leased_empties").delete().eq("id", id).eq("tenant_id", tenantId);
  } else {
    await supabase.from("stock_audits").delete().eq("id", id).eq("tenant_id", tenantId);
  }

  revalidatePath("/inventory/warehouse");
  revalidatePath("/inventory/stock-reports");
    revalidatePath("/inventory/empties-movements");
  return { success: true };
}

export async function getOutletEmptyBalance(opts?: { asOfDate?: string }): Promise<OutletEmptyBalanceData> {
  const asOfDate = opts?.asOfDate || new Date().toISOString().slice(0, 10);
  const [products, leases] = await Promise.all([
    getReturnableNonRgbProducts(),
    getLeaseEmpties({ to: asOfDate }),
  ]);

  const nameKey = (n: string) => String(n || "").toLowerCase().trim();

  const outletMap = new Map<string, {
    shop_id: string;
    outlet_code: string;
    outlet_name: string;
    byId: Record<string, number>;
    byName: Record<string, number>;
    returned_quantities: Record<string, number>;
  }>();

  for (const lease of leases) {
    const outKey = lease.outlet_code || lease.shop_id || lease.outlet_name;
    if (!outKey) continue;

    if (!outletMap.has(outKey)) {
      outletMap.set(outKey, {
        shop_id: lease.shop_id,
        outlet_code: lease.outlet_code || "—",
        outlet_name: lease.outlet_name || "Unknown",
        byId: {},
        byName: {},
        returned_quantities: {},
      });
    }

    const rec = outletMap.get(outKey)!;
    for (const it of lease.items) {
      const remaining = leaseOutstandingAsOf({
        quantity: Number(it.quantity || 0),
        returnedQty: Number(it.returned_qty || 0),
        returnedDate: it.returned_date,
        returns: it.returns,
        leaseDate: lease.date,
        asOfDate,
      });
      const returned = leaseReturnedQtyAsOf(
        Number(it.returned_qty || 0),
        it.returned_date,
        asOfDate,
        it.returns
      );
      const nk = nameKey(it.product_name);
      rec.byName[nk] = (rec.byName[nk] || 0) + remaining;
      if (it.product_id) rec.byId[it.product_id] = (rec.byId[it.product_id] || 0) + remaining;
      rec.returned_quantities[nk] = (rec.returned_quantities[nk] || 0) + returned;
    }
  }

  const rows: OutletEmptyBalanceRow[] = [];
  const totals: Record<string, number> = {};
  for (const p of products) {
    totals[p.product_name] = 0;
  }
  let grandTotal = 0;

  for (const [, rec] of outletMap.entries()) {
    let outletTotal = 0;
    const cleanQuantities: Record<string, number> = {};

    for (const p of products) {
      const q = rec.byId[p.id] ?? rec.byName[nameKey(p.product_name)] ?? 0;
      cleanQuantities[p.product_name] = q;
      outletTotal += q;
    }

    if (outletTotal > 0) {
      const displayName = (key: string) =>
        products.find((p) => nameKey(p.product_name) === key)?.product_name || key;
      const retEntries = Object.entries(rec.returned_quantities).filter(([, q]) => q > 0);
      const formattedReturned = retEntries.length > 0
        ? retEntries.map(([name, q]) => `${displayName(name)}\u00D7${q}`).join(", ")
        : "—";

      rows.push({
        shop_id: rec.shop_id,
        outlet_code: rec.outlet_code,
        outlet_name: rec.outlet_name,
        quantities: cleanQuantities,
        total_qty: outletTotal,
        formatted_returned: formattedReturned,
      });

      for (const p of products) {
        totals[p.product_name] += cleanQuantities[p.product_name] || 0;
      }
      grandTotal += outletTotal;
    }
  }

  rows.sort((a, b) => a.outlet_name.localeCompare(b.outlet_name));

  return {
    products,
    rows,
    totals,
    grand_total: grandTotal,
  };
}

export async function getTotalLeasedEmptiesByProduct(): Promise<Map<string, number>> {
  const leases = await getLeaseEmpties();
  const map = new Map<string, number>();

  for (const lease of leases) {
    for (const it of lease.items) {
      const remaining = leaseOutstandingAsOf({
        quantity: Number(it.quantity || 0),
        returnedQty: Number(it.returned_qty || 0),
        returnedDate: it.returned_date,
        returns: it.returns,
        leaseDate: lease.date,
      });
      const keyName = it.product_name.toLowerCase().trim();
      map.set(keyName, (map.get(keyName) || 0) + remaining);
      if (it.product_id) {
        map.set(it.product_id, (map.get(it.product_id) || 0) + remaining);
      }
      if (it.product_code) {
        map.set(it.product_code.trim(), (map.get(it.product_code.trim()) || 0) + remaining);
      }
    }
  }

  return map;
}
