"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// --------------------------------------------------------------------------
// TYPES
// --------------------------------------------------------------------------

export interface LateDeliveryFilters {
  status?: string;
  search?: string;
}

// --------------------------------------------------------------------------
// LIST
// --------------------------------------------------------------------------

export async function getLateDeliveries(filters?: LateDeliveryFilters) {
  try {
    const supabase = await createClient();

    // Ensure late deliveries table is up-to-date with current invoices
    await supabase.rpc("check_late_deliveries");

    let query = supabase
      .from("late_deliveries")
      .select(
        `
        *,
        invoice:invoices(
          invoice_no, scheduled_date, delivery_status, products,
          shop:shops(shop_name, outlet_code),
          dm:employees!invoices_dm_id_fkey(full_name)
        )
      `
      )
      .order("days_late", { ascending: false });

    if (filters?.status) {
      query = query.eq("status", filters.status);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[getLateDeliveries] error:", error.message);
      return [];
    }

    // Client-side search filter (across joined fields)
    if (filters?.search && data) {
      const s = filters.search.toLowerCase();
      return data.filter(
        (d: any) =>
          d.invoice?.invoice_no?.toLowerCase().includes(s) ||
          d.invoice?.shop?.shop_name?.toLowerCase().includes(s) ||
          d.invoice?.dm?.full_name?.toLowerCase().includes(s)
      );
    }

    return data || [];
  } catch (err: any) {
    console.error("[getLateDeliveries] unexpected error:", err?.message ?? err);
    return [];
  }
}

// --------------------------------------------------------------------------
// UPDATE STATUS — Disputed requires reason, Resolved does NOT
// --------------------------------------------------------------------------

export async function updateLateDeliveryStatus(
  id: string,
  status: "pending" | "undelivered" | "resolved" | "disputed",
  reason?: string
) {
  if (status === "disputed" && !reason) {
    throw new Error("Reason is required when disputing a late delivery");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("late_deliveries")
    .update({
      status,
      reason: status === "disputed" ? reason : null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/tab1/late-delivery");
  return data;
}

