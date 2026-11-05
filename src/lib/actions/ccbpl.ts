"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// --------------------------------------------------------------------------
// CCBPL PURCHASES (Tab 6 Page 2)
// --------------------------------------------------------------------------
export async function getPurchases() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("ccbpl_purchases")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[getPurchases] error:", error.message);
      return [];
    }
    return data || [];
  } catch (err: any) {
    console.error("[getPurchases] unexpected error:", err?.message ?? err);
    return [];
  }
}

export async function createPurchase(formData: {
  po_no: string;
  product_name: string;
  ordered_qty: number;
  received_qty?: number;
  billed_amount?: number;
  status?: "in_progress" | "stock_arrived";
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const { data, error } = await supabase
    .from("ccbpl_purchases")
    .insert({ ...formData, status: formData.status || "in_progress", tenant_id: tenantId })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/tab6/purchasing");
  return data;
}

export async function updatePurchase(
  id: string,
  formData: {
    po_no?: string;
    product_name?: string;
    ordered_qty?: number;
    received_qty?: number;
    billed_amount?: number;
  }
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ccbpl_purchases")
    .update(formData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/tab6/purchasing");
  return data;
}

export async function markStockArrived(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ccbpl_purchases")
    .update({ status: "stock_arrived" })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/tab6/purchasing");
  revalidatePath("/tab3/warehouse");
  revalidatePath("/tab6/ledger");
  return data;
}

export async function deletePurchase(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("ccbpl_purchases").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/tab6/purchasing");
}

// --------------------------------------------------------------------------
// AGENCY EXPENSES (Tab 6 Page 3)
// --------------------------------------------------------------------------
export async function getExpenses() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("agency_expenses")
      .select("*")
      .order("expense_date", { ascending: false });
    if (error) {
      console.error("[getExpenses] error:", error.message);
      return [];
    }
    return data || [];
  } catch (err: any) {
    console.error("[getExpenses] unexpected error:", err?.message ?? err);
    return [];
  }
}

export async function createExpense(formData: {
  expense_date: string;
  category: string;
  description?: string;
  amount: number;
  paid_by?: string;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const { data, error } = await supabase
    .from("agency_expenses")
    .insert({ ...formData, tenant_id: tenantId })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/tab6/expenses");
  return data;
}

export async function updateExpense(
  id: string,
  formData: {
    expense_date?: string;
    category?: string;
    description?: string;
    amount?: number;
    paid_by?: string;
  }
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agency_expenses")
    .update(formData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/tab6/expenses");
  return data;
}

export async function deleteExpense(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("agency_expenses").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/tab6/expenses");
}

// --------------------------------------------------------------------------
// CCBPL PENALTIES (Tab 6 Page 4)
// --------------------------------------------------------------------------
export async function getPenalties() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("ccbpl_penalties")
      .select("*")
      .order("penalty_date", { ascending: false });
    if (error) {
      console.error("[getPenalties] error:", error.message);
      return [];
    }
    return data || [];
  } catch (err: any) {
    console.error("[getPenalties] unexpected error:", err?.message ?? err);
    return [];
  }
}

export async function createPenalty(formData: {
  penalty_date: string;
  ccbpl_ref?: string;
  amount: number;
  reason?: string;
  status?: string;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const { data, error } = await supabase
    .from("ccbpl_penalties")
    .insert({ ...formData, status: formData.status || "pending", tenant_id: tenantId })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/tab6/penalties");
  return data;
}

export async function updatePenalty(
  id: string,
  formData: {
    penalty_date?: string;
    ccbpl_ref?: string;
    amount?: number;
    reason?: string;
    status?: string;
    dispute_note?: string;
  }
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ccbpl_penalties")
    .update(formData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/tab6/penalties");
  return data;
}

export async function disputePenalty(id: string, note: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ccbpl_penalties")
    .update({ status: "disputed", dispute_note: note })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/tab6/penalties");
  return data;
}

export async function deletePenalty(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("ccbpl_penalties").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/tab6/penalties");
}


export async function deletePurchases(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("ccbpl_purchases").delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/tab6/purchasing");
}

export async function deleteExpenses(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("agency_expenses").delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/tab6/expenses");
}

export async function deletePenalties(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("ccbpl_penalties").delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/tab6/penalties");
}