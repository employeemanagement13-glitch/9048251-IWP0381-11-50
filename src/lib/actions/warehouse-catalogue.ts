"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { parseProducts } from "@/lib/parsers/products";

export interface PendingReturnInvoice {
  invoice_id: string;
  invoice_no: string;
  invoice_date: string;
  shop_name: string;
  outlet_code: string;
  pending_products: {
    product_name: string;
    invoiced_qty: number;
    returned_qty: number;
  }[];
}

export async function getPendingReturnsInvoices(type: "standard" | "rgb" | "empties"): Promise<PendingReturnInvoice[]> {
  const supabase = await createClient();

  // 1. Fetch products belonging to target category type
  let prodQuery = supabase
    .from("products")
    .select("id, product_name, category:product_categories(is_returnable, is_rgb)");

  const { data: prods, error: prodErr } = await prodQuery;
  if (prodErr || !prods) return [];

  const targetProductNames = new Set<string>();
  prods.forEach((p: any) => {
    const isRet = p.category?.is_returnable;
    const isRgb = p.category?.is_rgb;
    if (type === "standard" && !isRet) targetProductNames.add(p.product_name.toLowerCase().trim());
    else if (type === "rgb" && isRet && isRgb) targetProductNames.add(p.product_name.toLowerCase().trim());
    else if (type === "empties" && isRet && !isRgb) targetProductNames.add(p.product_name.toLowerCase().trim());
  });

  if (targetProductNames.size === 0) return [];

  // 2. Fetch all invoices with shops
  const { data: invoices, error: invErr } = await supabase
    .from("invoices")
    .select("id, invoice_no, invoice_date, products, shop:shops(shop_name, outlet_code)")
    .order("invoice_date", { ascending: false });

  if (invErr || !invoices) return [];

  // 3. Fetch invoice_returns
  const { data: returnsData } = await supabase
    .from("invoice_returns")
    .select("invoice_id, product_name, returned_qty");

  const returnMap = new Map<string, number>();
  (returnsData || []).forEach((r: any) => {
    const key = `${r.invoice_id}|${(r.product_name || "").toLowerCase().trim()}`;
    returnMap.set(key, (returnMap.get(key) || 0) + (r.returned_qty || 0));
  });

  // 4. Match
  const result: PendingReturnInvoice[] = [];

  for (const inv of invoices) {
    if (!inv.products) continue;
    const parsed = parseProducts(inv.products);
    const pendingProducts: { product_name: string; invoiced_qty: number; returned_qty: number }[] = [];

    for (const item of parsed) {
      const normName = item.name.toLowerCase().trim();
      if (!targetProductNames.has(normName)) continue;

      const retQty = returnMap.get(`${inv.id}|${normName}`) || 0;
      if (item.qty > retQty) {
        pendingProducts.push({
          product_name: item.name,
          invoiced_qty: item.qty,
          returned_qty: retQty,
        });
      }
    }

    if (pendingProducts.length > 0) {
      const shop = inv.shop as any;
      result.push({
        invoice_id: inv.id,
        invoice_no: inv.invoice_no,
        invoice_date: inv.invoice_date,
        shop_name: shop?.shop_name || "—",
        outlet_code: shop?.outlet_code || "—",
        pending_products: pendingProducts,
      });
    }
  }

  return result;
}

export async function getCategoryHasStock(category: any): Promise<boolean> {
  return true;
}

export async function getWarehouseCategories() {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) return [];

  const { data, error } = await supabase
    .from("product_categories")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("sort_order")
    .order("title");

  if (error) {
    console.error("[getWarehouseCategories]", error.message);
    return [];
  }
  return data || [];
}

export async function getWarehouseStandardLevels(categoryId: string) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) return [];

  // 1. Query all active products in this category
  const { data: prods, error: pErr } = await supabase
    .from("products")
    .select("id, product_name, product_code, category_id, is_returnable, product_categories(id, title, set_un_case, is_returnable, is_rgb)")
    .eq("tenant_id", tenantId)
    .eq("category_id", categoryId)
    .eq("active", true)
    .order("product_name");

  if (pErr || !prods) {
    console.error("[getWarehouseStandardLevels] products query error:", pErr?.message);
    return [];
  }

  // 2. Query warehouse_standard_levels for this category
  const { data: stdLevels } = await supabase
    .from("warehouse_standard_levels")
    .select("*")
    .eq("category_id", categoryId);

  const stdMap = new Map<string, any>();
  (stdLevels || []).forEach((row: any) => {
    if (row.product_id) stdMap.set(row.product_id, row);
    if (row.product_name) stdMap.set(row.product_name.toLowerCase().trim(), row);
  });

  // 3. Query warehouse_rgb_levels for returnable stock backup
  const { data: rgbLevels } = await supabase
    .from("warehouse_rgb_levels")
    .select("*")
    .eq("tenant_id", tenantId);

  const rgbMap = new Map<string, any>();
  (rgbLevels || []).forEach((row: any) => {
    if (row.product_id) rgbMap.set(row.product_id, row);
    if (row.product_name) rgbMap.set(row.product_name.toLowerCase().trim(), row);
  });

  // 4. Query damaged stock to compute flappy
  const { data: damagedList } = await supabase
    .from("damaged_stock")
    .select("product_name, quantity, status")
    .eq("tenant_id", tenantId)
    .neq("status", "adjusted");

  const flappyMap = new Map<string, number>();
  (damagedList || []).forEach((d: any) => {
    const key = (d.product_name || "").toLowerCase().trim();
    flappyMap.set(key, (flappyMap.get(key) || 0) + (Number(d.quantity) || 0));
  });

  return prods.map((p: any) => {
    const normName = p.product_name.toLowerCase().trim();
    const stdRow = stdMap.get(p.id) || stdMap.get(normName);
    const rgbRow = rgbMap.get(p.id) || rgbMap.get(normName);
    const rawSetUnCase = (p.product_categories as any)?.set_un_case;
    const setUnCase = rawSetUnCase != null ? Number(rawSetUnCase) : 1;

    let ph_case = 0;
    let unit_case = 0;
    let total_qty = 0;
    let flappy = flappyMap.get(normName) || 0;

    if (stdRow) {
      ph_case = Math.max(0, Number(stdRow.ph_case ?? stdRow.total_qty ?? 0));
      unit_case = Math.max(0, Number(stdRow.unit_case ?? 0));
      total_qty = Math.max(0, Number(stdRow.total_qty ?? 0));
      flappy = Number(stdRow.flappy ?? flappy);
    } else if (rgbRow) {
      ph_case = Math.max(0, Number(rgbRow.ph_case ?? rgbRow.total_qty ?? 0));
      unit_case = Math.max(0, Number(rgbRow.unit_case ?? (ph_case * setUnCase)));
      total_qty = Math.max(0, Number(rgbRow.total_qty ?? 0));
    }

    if (ph_case > 0 && setUnCase > 0) {
      unit_case = parseFloat((ph_case * setUnCase).toFixed(2));
    } else {
      unit_case = 0;
    }

    return {
      id: p.id,
      product_id: p.id,
      code: p.product_code || p.product_name,
      product_name: p.product_name,
      category_id: categoryId,
      set_un_case: setUnCase,
      total_qty,
      ph_case,
      unit_case,
      flappy,
      returned: Number(rgbRow?.returned || 0),
      unreturned: Number(rgbRow?.unreturned || 0),
      available: Number(rgbRow?.available || ph_case),
    };
  });
}

export async function getWarehouseRGBLevels() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouse_rgb_levels")
    .select("*")
    .order("product_name");

  if (error) { console.error("[getWarehouseRGBLevels]", error.message); return []; }
  if (!data || data.length === 0) return [];

  return data.map((item: any) => ({
    ...item,
    total_qty: Math.max(0, Number(item.total_qty || 0)),
    returned: Number(item.returned || 0),
    unreturned: Math.max(0, Number(item.unreturned || 0)),
    available: Math.max(0, Number(item.available || 0)),
  }));
}

export async function getWarehouseEmptiesLevels() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouse_empties_levels")
    .select("*")
    .order("product_name");

  if (error) { console.error("[getWarehouseEmptiesLevels]", error.message); return []; }
  if (!data || data.length === 0) return [];

  return data.map((item: any) => ({
    ...item,
    total_qty: Math.max(0, Number(item.total_qty || 0)),
    returned: Number(item.returned || 0),
    unreturned: Math.max(0, Number(item.unreturned || 0)),
    available: Math.max(0, Number(item.available || 0)),
  }));
}

export async function getProductsForStockReport() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("products")
      .select("id, product_name, product_code, category_id, purchase_rate, sale_rate, product_categories(id, title, set_un_case, is_returnable, is_rgb, is_implied)")
      .eq("active", true)
      .order("product_name");
    if (error) { console.error("[getProductsForStockReport]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getProductsForStockReport] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function createStockReport(
  reportDate: string,
  lines: { product_id: string; ph_case: number; unit_case: number; amount?: number }[]
) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");
  if (!lines.length) throw new Error("At least one product is required.");

  const rows = lines.map((l) => ({
    tenant_id: tenantId,
    report_date: reportDate,
    product_id: l.product_id,
    ph_case: l.ph_case,
    unit_case: l.unit_case,
    amount: Number(l.amount) || 0,
  }));

  const { error } = await supabase.from("stock_report_entries").insert(rows);
  if (error) throw new Error(error.message);

  const { revalidatePath } = await import("next/cache");
  revalidatePath("/inventory/warehouse");
  revalidatePath("/inventory/stock-reports");
  revalidatePath("/inventory/empties-movements");
  revalidatePath("/income/statement");
}
