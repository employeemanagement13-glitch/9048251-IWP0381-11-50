"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const SCHEME_TYPES = [
  "cpo", "customer_suc", "free_sampling",
  "leakage_burst_incentive", "red_box",
  "target_incentive", "trade_promo", "other",
] as const;

export type SchemeType = typeof SCHEME_TYPES[number];

export async function getSchemeIncome(month?: string) {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("scheme_income")
      .select("*")
      .order("income_month", { ascending: false })
      .order("created_at", { ascending: false });

    if (month) {
      query = query.gte("income_month", `${month}-01`).lt("income_month", `${month}-32`);
    }
    const { data, error } = await query;
    if (error) { console.error("[getSchemeIncome]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getSchemeIncome] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function createSchemeIncome(formData: {
  scheme_type: SchemeType;
  description?: string;
  amount: number;
  income_month: string;
  vendor_account_id?: string;
  income_date?: string;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const { data, error } = await supabase
    .from("scheme_income")
    .insert({ ...formData, tenant_id: tenantId })
    .select().single();
  if (error) throw new Error(error.message);
  revalidatePath("/income/margin");
  revalidatePath("/income/statement");
  revalidatePath("/cash-bank/bank-accounts");
  return data;
}

export async function updateSchemeIncome(id: string, formData: {
  scheme_type?: SchemeType;
  description?: string;
  amount?: number;
  income_month?: string;
  vendor_account_id?: string | null;
  income_date?: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scheme_income")
    .update(formData)
    .eq("id", id)
    .select().single();
  if (error) throw new Error(error.message);
  revalidatePath("/income/margin");
  revalidatePath("/income/statement");
  revalidatePath("/cash-bank/bank-accounts");
  return data;
}

export async function deleteSchemeIncome(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("scheme_income").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/income/margin");
  revalidatePath("/income/statement");
}

export async function deleteSchemeIncomes(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("scheme_income").delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/income/margin");
  revalidatePath("/income/statement");
}