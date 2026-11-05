"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function getLedger() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("agency_ledger_with_balance")
      .select("*")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) {
      // fallback if view not found
      const { data: raw, error: rawErr } = await supabase
        .from("agency_ledger")
        .select("*")
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (rawErr) {
        console.error("[getLedger] fallback error:", rawErr.message);
        return [];
      }
      return raw || [];
    }
    return data || [];
  } catch (err: any) {
    console.error("[getLedger] unexpected error:", err?.message ?? err);
    return [];
  }
}

export async function addRevenue(formData: {
  entry_date: string;
  description: string;
  amount: number;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const { data, error } = await supabase
    .from("agency_ledger")
    .insert({ ...formData, entry_type: "revenue", tenant_id: tenantId })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/tab6/ledger");
  return data;
}

