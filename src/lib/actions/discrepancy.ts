"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function getDiscrepancyReport() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("stock_discrepancies")
      .select("*")
      .neq("diff", 0)
      .order("audit_date", { ascending: false });
    if (error) {
      console.error("[getDiscrepancyReport] error:", error.message);
      return [];
    }
    return data || [];
  } catch (err: any) {
    console.error("[getDiscrepancyReport] unexpected error:", err?.message ?? err);
    return [];
  }
}

export async function updateDiscrepancy(
  id: string,
  formData: { status: "pending" | "resolved" | "disputed"; reason?: string }
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_discrepancies")
    .update(formData)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/tab7/discrepancy");
  return data;
}

export async function deleteDiscrepancy(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("stock_discrepancies")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/tab7/discrepancy");
}

