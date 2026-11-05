"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// --------------------------------------------------------------------------
// WAREHOUSE STOCK (Tab 3 Page 1)
// --------------------------------------------------------------------------
export async function getWarehouseStock() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("warehouse_stock")
      .select("*")
      .order("product_name");
    if (error) {
      console.error("[getWarehouseStock] error:", error.message);
      return [];
    }
    return data || [];
  } catch (err: any) {
    console.error("[getWarehouseStock] unexpected error:", err?.message ?? err);
    return [];
  }
}

/**
 * Returns warehouse products with their available qty for invoice form dropdowns.
 * available = qty_total - qty_reserved - qty_flappy
 */
export async function getWarehouseProductNames(): Promise<{
  id: string;
  product_name: string;
  qty_total: number;
  qty_reserved: number;
  qty_flappy: number;
  available: number;
}[]> {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();

    let stdQuery = supabase.from("warehouse_standard_levels").select("product_id, product_name, total_qty, flappy");
    let rgbQuery = supabase.from("warehouse_rgb_levels").select("product_id, product_name, total_qty, available");
    let empQuery = supabase.from("warehouse_empties_levels").select("product_id, product_name, total_qty, available");
    let prodQuery = supabase.from("products").select("product_name, sale_rate");

    if (tenantId) {
      stdQuery = stdQuery.eq("tenant_id", tenantId);
      rgbQuery = rgbQuery.eq("tenant_id", tenantId);
      empQuery = empQuery.eq("tenant_id", tenantId);
      prodQuery = prodQuery.eq("tenant_id", tenantId);
    }

    const [stdReq, rgbReq, empReq, prodReq] = await Promise.all([stdQuery, rgbQuery, empQuery, prodQuery]);

    const saleRateMap = new Map<string, number>();
    if (prodReq.data) {
      prodReq.data.forEach((p: any) => {
        saleRateMap.set(p.product_name, Number(p.sale_rate) || 0);
      });
    }

    const items: {
      id: string;
      product_name: string;
      qty_total: number;
      qty_reserved: number;
      qty_flappy: number;
      available: number;
      sale_rate: number;
    }[] = [];

    const seen = new Set<string>();

    if (stdReq.data) {
      stdReq.data.forEach((s: any) => {
        const key = s.product_name;
        if (!seen.has(key)) {
          seen.add(key);
          const avail = Math.max(0, Number(s.total_qty || 0));
          items.push({
            id: s.product_id || s.product_name,
            product_name: s.product_name,
            qty_total: avail,
            qty_reserved: 0,
            qty_flappy: Number(s.flappy || 0),
            available: avail,
            sale_rate: saleRateMap.get(key) || 0,
          });
        }
      });
    }

    if (rgbReq.data) {
      rgbReq.data.forEach((s: any) => {
        const key = s.product_name;
        if (!seen.has(key)) {
          seen.add(key);
          items.push({
            id: s.product_id || s.product_name,
            product_name: s.product_name,
            qty_total: s.total_qty || 0,
            qty_reserved: 0,
            qty_flappy: 0,
            available: s.available || 0,
            sale_rate: saleRateMap.get(key) || 0,
          });
        }
      });
    }

    if (empReq.data) {
      empReq.data.forEach((s: any) => {
        const key = s.product_name;
        if (!seen.has(key)) {
          seen.add(key);
          items.push({
            id: s.product_id || s.product_name,
            product_name: s.product_name,
            qty_total: s.total_qty || 0,
            qty_reserved: 0,
            qty_flappy: 0,
            available: s.available || 0,
            sale_rate: saleRateMap.get(key) || 0,
          });
        }
      });
    }

    if (prodReq.data) {
      prodReq.data.forEach((p: any) => {
        const key = p.product_name;
        if (!seen.has(key)) {
          seen.add(key);
          items.push({
            id: p.id || p.product_name,
            product_name: p.product_name,
            qty_total: 0,
            qty_reserved: 0,
            qty_flappy: 0,
            available: 0,
            sale_rate: Number(p.sale_rate) || 0,
          });
        }
      });
    }

    items.sort((a, b) => a.product_name.localeCompare(b.product_name));

    return items;
  } catch (err: any) {
    console.error("[getWarehouseProductNames] error:", err?.message ?? err);
    return [];
  }
}

export async function createProduct(formData: {
  product_name: string;
  qty_total: number;
  qty_reserved?: number;
  qty_flappy?: number;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const { data, error } = await supabase
    .from("warehouse_stock")
    .insert({
      tenant_id: tenantId,
      product_name: formData.product_name,
      qty_total: formData.qty_total,
      qty_reserved: formData.qty_reserved || 0,
      qty_flappy: formData.qty_flappy || 0,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/tab3/warehouse");
  return data;
}

export async function updateProduct(id: string, formData: {
  product_name?: string;
  qty_total?: number;
  qty_reserved?: number;
  qty_flappy?: number;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouse_stock")
    .update(formData)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/tab3/warehouse");
  return data;
}

export async function deleteProduct(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("warehouse_stock").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/tab3/warehouse");
}


// --------------------------------------------------------------------------
// FLAPPY / DAMAGED STOCK (Tab 3 Page 2)
// Statuses: Pending, Complaint Filed, Adjusted
// --------------------------------------------------------------------------
export async function getDamagedStock() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("damaged_stock")
    .select("*")
    .order("recorded_date", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createDamagedStock(formData: {
  product_name: string;
  quantity: number;
  damage_type?: string;
  batch_no?: string;
  webspace_ref?: string;
  status: "pending" | "complaint_filed" | "adjusted";
  note?: string;
  recorded_date?: string;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const { data, error } = await supabase
    .from("damaged_stock")
    .insert({ ...formData, tenant_id: tenantId })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/tab3/damaged");
  return data;
}

export async function updateDamagedStock(id: string, formData: {
  product_name?: string;
  quantity?: number;
  damage_type?: string;
  batch_no?: string;
  webspace_ref?: string;
  status?: "pending" | "complaint_filed" | "adjusted";
  note?: string;
  recorded_date?: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("damaged_stock")
    .update(formData)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/tab3/damaged");
  return data;
}

export async function deleteDamagedStock(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("damaged_stock").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/tab3/damaged");
}


// --------------------------------------------------------------------------
// RETURNS / WAYBACK (Tab 3 Page 3)
// --------------------------------------------------------------------------
export async function getReturns() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("returns_wayback")
    .select("*, shop:shops(shop_name, outlet_code), original_invoice:invoices(invoice_no, invoice_date, scheduled_date)")
    .order("return_date", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createReturn(formData: {
  shop_id: string;
  product_name: string;
  original_invoice_id?: string;
  received_qty: number;
  status: "pending" | "approved" | "rejected";
  reason?: string;
  return_date?: string;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const { data, error } = await supabase
    .from("returns_wayback")
    .insert({ ...formData, tenant_id: tenantId })
    .select()
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/tab3/returns");
  return data;
}

export async function approveReturn(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("returns_wayback")
    .update({ status: "approved" })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/tab3/returns");
  revalidatePath("/tab3/warehouse");
}

export async function rejectReturn(id: string, reason: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("returns_wayback")
    .update({ status: "rejected", reason })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/tab3/returns");
}

export async function deleteReturn(id: string) {
  const supabase = await createClient();
  
  const { error } = await supabase.from("returns_wayback").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/tab3/returns");
  revalidatePath("/tab3/warehouse");
}


// --------------------------------------------------------------------------
// STOCK COUNT / AUDIT (Tab 3 Page 4)
// --------------------------------------------------------------------------
export async function getStockAudits() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_audits")
    .select("*")
    .order("scheduled_date", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function scheduleStockAudit(date: string) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const { data, error } = await supabase
    .from("stock_audits")
    .insert({
      tenant_id: tenantId,
      scheduled_date: date,
      status: "scheduled",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/tab3/audit");
  return data;
}

export async function startStockAudit(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_audits")
    .update({ status: "in_progress", audit_date: new Date().toISOString().split("T")[0] })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/tab3/audit");
  return data;
}

export async function completeStockAudit(id: string, physicalCounts: { [productName: string]: number }) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const productNames = Object.keys(physicalCounts);
  let totalDiscrepancies = 0;

  for (const productName of productNames) {
    const physicalQty = physicalCounts[productName];

    const systemQty = await (async () => {
      const { data: stdRow } = await supabase
        .from("warehouse_standard_levels")
        .select("total_qty")
        .eq("product_name", productName)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (stdRow) return Number(stdRow.total_qty ?? 0);

      const { data: rgbRow } = await supabase
        .from("warehouse_rgb_levels")
        .select("total_qty")
        .eq("product_name", productName)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (rgbRow) return Number(rgbRow.total_qty ?? 0);

      const { data: empRow } = await supabase
        .from("warehouse_empties_levels")
        .select("total_qty")
        .eq("product_name", productName)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (empRow) return Number(empRow.total_qty ?? 0);

      return 0;
    })();

    const diff = physicalQty - systemQty;
    if (diff !== 0) {
      totalDiscrepancies++;
      await supabase.from("stock_discrepancies").insert({
        audit_id: id,
        product_name: productName,
        system_qty: systemQty,
        physical_qty: physicalQty,
        status: "pending",
        tenant_id: tenantId,
      });
    }
  }

  const { data, error } = await supabase
    .from("stock_audits")
    .update({
      status: "completed",
      products_counted: productNames.length,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/tab3/audit");
  revalidatePath("/inventory/audit");
  revalidatePath("/inventory/warehouse");
  revalidatePath("/tab7/discrepancy");
  return data;
}

export async function getStockDiscrepanciesForAudit(auditId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_discrepancies")
    .select("*")
    .eq("audit_id", auditId);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function deleteStockAudit(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("stock_audits").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/tab3/audit");
}


// --------------------------------------------------------------------------
// EMPTIES LOG (Tab 3 Page 5)
// --------------------------------------------------------------------------
export async function getEmptiesLog() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("empties_log")
    .select("*, shop:shops(shop_name, outlet_code), invoice:invoices(invoice_no)")
    .order("log_date", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function logEmpties(formData: {
  shop_id: string;
  invoice_no?: string;
  product_name: string;
  quantity: number;
  deposit_amount: number;
  log_date?: string;
}) {
  const supabase = await createClient();

  // Validate and links using custom log_empties_against_invoice RPC function
  // signature: log_empties_against_invoice(p_shop_id, p_invoice_no, p_product_name, p_quantity, p_deposit_amount, p_log_date)
  const { data, error } = await supabase.rpc("log_empties_against_invoice", {
    p_shop_id: formData.shop_id,
    p_invoice_no: formData.invoice_no || null,
    p_product_name: formData.product_name,
    p_quantity: formData.quantity,
    p_deposit_amount: formData.deposit_amount,
    p_log_date: formData.log_date || new Date().toISOString().split("T")[0]
  });

  if (error) throw new Error(error.message);
  revalidatePath("/tab3/empties");
  return data;
}

export async function updateEmptiesLogEntry(id: string, formData: {
  shop_id?: string;
  invoice_id?: string;
  product_name?: string;
  quantity?: number;
  deposit_amount?: number;
  log_date?: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("empties_log")
    .update(formData)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/tab3/empties");
  return data;
}

export async function deleteEmptiesLogEntry(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("empties_log").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/tab3/empties");
}

export async function getEmptiesOnHand() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("empties_on_hand")
    .select("*");
  if (error) throw new Error(error.message);
  return data || [];
}


export async function deleteDamagedStocks(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const { error } = await supabase.from("damaged_stock").delete().in("id", ids);
  if (error) throw new Error(error.message);
  revalidatePath("/tab3/damaged");
}

export async function deleteEmptiesStocks(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const { error } = await supabase.from("empties_log").delete().in("id", ids);
  if (error) throw new Error(error.message);
  revalidatePath("/tab3/empties");
}

export async function deleteReturnsWaybacks(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const { error } = await supabase.from("returns_wayback").delete().in("id", ids);
  if (error) throw new Error(error.message);
  revalidatePath("/tab3/returns");
}

export async function deleteAuditStocks(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const { error } = await supabase.from("stock_audits").delete().in("id", ids);
  if (error) throw new Error(error.message);
  revalidatePath("/tab3/audit");
}

export async function deleteWarehouseStocks(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const { error } = await supabase.from("warehouse_stock").delete().in("id", ids);
  if (error) throw new Error(error.message);
  revalidatePath("/tab3/warehouse");
}
export async function deleteEmptiesLogEntries(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const { error } = await supabase.from("empties_log").delete().in("id", ids);
  if (error) throw new Error(error.message);
  revalidatePath("/tab3/empties");
}