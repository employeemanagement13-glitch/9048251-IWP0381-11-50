"use server";

import { createClient, createAdminClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

function getSupabase() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : createClient();
}

async function resolveLiveTenantId(): Promise<string> {
  const claimed = await getTenantId();
  if (!claimed) throw new Error("Unauthorized");
  const admin = createAdminClient();
  const { data } = await admin.from("tenants").select("id").eq("id", claimed).maybeSingle();
  if (data?.id) return data.id as string;
  throw new Error("Session tenant was not found in tenants. Sign out and sign back in, then try again.");
}

export interface SoldEmptyItem {
  product_id: string;
  product_code: string;
  product_name: string;
  quantity: number;
}

export interface SoldEmptyRecord {
  id: string;
  date: string;
  shop_id: string | null;
  outlet_code: string;
  outlet_name: string;
  amount: number;
  items: SoldEmptyItem[];
  formatted_products: string;
}

export async function getSoldEmpties(opts?: { from?: string; to?: string }): Promise<SoldEmptyRecord[]> {
  const supabase = await getSupabase();
  const tenantId = await getTenantId();
  if (!tenantId) return [];

  let q = supabase
    .from("sold_empties")
    .select("id, date, shop_id, outlet_code, outlet_name, amount, sold_empty_items(product_id, product_code, product_name, quantity)")
    .eq("tenant_id", tenantId)
    .order("date", { ascending: false });

  if (opts?.from) q = q.gte("date", opts.from);
  if (opts?.to) q = q.lte("date", opts.to);

  const { data, error } = await q;
  if (error || !data) return [];

  return data.map((r: any) => {
    const items: SoldEmptyItem[] = (r.sold_empty_items || []).map((it: any) => ({
      product_id: it.product_id,
      product_code: it.product_code || "",
      product_name: it.product_name,
      quantity: Number(it.quantity || 0),
    }));
    const formatted = items
      .map(it => `${it.product_code} ${it.product_name}×${it.quantity}`)
      .join(", ");
    return {
      id: r.id,
      date: r.date,
      shop_id: r.shop_id,
      outlet_code: r.outlet_code || "",
      outlet_name: r.outlet_name || "",
      amount: Number(r.amount || 0),
      items,
      formatted_products: formatted,
    };
  });
}

export async function getSoldEmptiesTotal(from: string, to: string): Promise<number> {
  const supabase = await getSupabase();
  const tenantId = await getTenantId();
  if (!tenantId) return 0;

  const { data, error } = await supabase
    .from("sold_empties")
    .select("amount")
    .eq("tenant_id", tenantId)
    .gte("date", from)
    .lte("date", to);

  if (error || !data) return 0;
  return data.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
}

export async function createSoldEmpties(payload: {
  date: string;
  shop_id: string;
  outlet_code: string;
  outlet_name: string;
  amount: number;
  items: SoldEmptyItem[];
}): Promise<{ id: string }> {
  const supabase = await getSupabase();
  const tenantId = await resolveLiveTenantId();
  if (!payload.items.length) throw new Error("At least one product required.");

  const { data: rec, error } = await supabase
    .from("sold_empties")
    .insert({
      tenant_id: tenantId,
      date: payload.date,
      shop_id: payload.shop_id || null,
      outlet_code: payload.outlet_code,
      outlet_name: payload.outlet_name,
      amount: payload.amount,
    })
    .select("id")
    .single();

  if (error || !rec) {
    const msg = error?.message ?? "Failed to create sold empties record.";
    if (/schema cache|does not exist|could not find|foreign key constraint/i.test(msg)) {
      throw new Error("Sold empties tables are missing or tenant link is invalid. Run supabase/mdos_v72_sold_empties_and_empty_outflows.sql in the Supabase SQL editor, sign out and sign back in, then try again.");
    }
    throw new Error(msg);
  }

  const itemRows = payload.items.map(it => ({
    tenant_id: tenantId,
    sold_empty_id: rec.id,
    product_id: it.product_id,
    product_code: it.product_code,
    product_name: it.product_name,
    quantity: it.quantity,
  }));

  const { error: itemErr } = await supabase.from("sold_empty_items").insert(itemRows);
  if (itemErr) throw new Error(itemErr.message);

  revalidatePath("/inventory/empties-movements");
  revalidatePath("/income/statement");
  return { id: rec.id };
}

export async function updateSoldEmpties(id: string, payload: {
  date?: string;
  outlet_code?: string;
  outlet_name?: string;
  shop_id?: string | null;
  amount?: number;
  items?: SoldEmptyItem[];
}): Promise<void> {
  const supabase = await getSupabase();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const updateFields: any = {};
  if (payload.date !== undefined) updateFields.date = payload.date;
  if (payload.outlet_code !== undefined) updateFields.outlet_code = payload.outlet_code;
  if (payload.outlet_name !== undefined) updateFields.outlet_name = payload.outlet_name;
  if (payload.shop_id !== undefined) updateFields.shop_id = payload.shop_id;
  if (payload.amount !== undefined) updateFields.amount = payload.amount;

  if (Object.keys(updateFields).length) {
    const { error } = await supabase.from("sold_empties").update(updateFields).eq("id", id).eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
  }

  if (payload.items) {
    await supabase.from("sold_empty_items").delete().eq("sold_empty_id", id);
    if (payload.items.length) {
      const itemRows = payload.items.map(it => ({
        tenant_id: tenantId,
        sold_empty_id: id,
        product_id: it.product_id,
        product_code: it.product_code,
        product_name: it.product_name,
        quantity: it.quantity,
      }));
      const { error: itemErr } = await supabase.from("sold_empty_items").insert(itemRows);
      if (itemErr) throw new Error(itemErr.message);
    }
  }

  revalidatePath("/inventory/empties-movements");
  revalidatePath("/income/statement");
}

export async function deleteSoldEmpties(id: string): Promise<void> {
  const supabase = await getSupabase();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  await supabase.from("sold_empty_items").delete().eq("sold_empty_id", id);
  const { error } = await supabase.from("sold_empties").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);

  revalidatePath("/inventory/empties-movements");
  revalidatePath("/income/statement");
}
