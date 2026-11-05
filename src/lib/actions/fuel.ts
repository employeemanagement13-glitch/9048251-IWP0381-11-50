"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// Ã¢"â‚¬Ã¢"â‚¬ FUEL ENTRIES (v9.1 odometer-based) Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬Ã¢"â‚¬

export async function getFuelEntries(filters?: { truck_no?: string; dateFrom?: string; dateTo?: string }) {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("fuel_entries")
      .select("*")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (filters?.truck_no) query = query.eq("truck_no", filters.truck_no);
    if (filters?.dateFrom)  query = query.gte("entry_date", filters.dateFrom);
    if (filters?.dateTo)    query = query.lte("entry_date", filters.dateTo);

    const { data, error } = await query;
    if (error) { console.error("[getFuelEntries]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getFuelEntries] unexpected:", err?.message ?? err);
    return [];
  }
}

/** Returns the last final_reading for a given truck (to auto-fill initial_reading) */
export async function getLastFuelReading(truckNo: string): Promise<number | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("fuel_entries")
      .select("final_reading")
      .eq("truck_no", truckNo)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return Number(data.final_reading);
  } catch {
    return null;
  }
}

export async function createFuelEntry(formData: {
  truck_no: string;
  driver_name?: string;
  entry_date: string;
  initial_reading?: number;
  final_reading?: number;
  fuel_liters: number;
  amount: number;
  bank_account_id?: string;
  vehicle_type?: string;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const initReading = formData.initial_reading ?? 0;
  const finReading = formData.final_reading ?? 0;

  if (formData.initial_reading !== undefined && formData.final_reading !== undefined && finReading < initReading) {
    throw new Error("Final reading must be greater than or equal to initial reading.");
  }

  const payload: any = {
    tenant_id: tenantId,
    truck_no: formData.truck_no,
    driver_name: formData.driver_name,
    entry_date: formData.entry_date,
    initial_reading: initReading,
    final_reading: finReading,
    fuel_liters: formData.fuel_liters,
    amount: formData.amount,
    bank_account_id: formData.bank_account_id || null,
    vehicle_type: formData.vehicle_type || "delivery",
  };

  let { data, error } = await supabase
    .from("fuel_entries")
    .insert(payload)
    .select().single();

  if (error) {
    const { vehicle_type, ...fallbackPayload } = payload;
    const retry = await supabase
      .from("fuel_entries")
      .insert(fallbackPayload)
      .select().single();
    if (retry.error) throw new Error(retry.error.message);
    data = retry.data;
  }

  revalidatePath("/expenses/agency");
  revalidatePath("/cash-bank/bank-accounts");
  return data;
}

export async function updateFuelEntry(id: string, formData: {
  truck_no?: string;
  driver_name?: string;
  entry_date?: string;
  initial_reading?: number;
  final_reading?: number;
  fuel_liters?: number;
  amount?: number;
  bank_account_id?: string;
  vehicle_type?: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fuel_entries")
    .update(formData)
    .eq("id", id)
    .select().single();
  if (error) throw new Error(error.message);
  revalidatePath("/expenses/agency");
  revalidatePath("/cash-bank/bank-accounts");
  return data;
}

export async function deleteFuelEntry(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("fuel_entries").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/expenses/agency");
  revalidatePath("/cash-bank/bank-accounts");
}


/** Unique truck numbers for this tenant (for the truck dropdown) */
export async function getTruckNumbers(): Promise<string[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("fuel_entries")
      .select("truck_no")
      .order("truck_no");
    if (error || !data) return [];
    return [...new Set(data.map((r) => r.truck_no))];
  } catch {
    return [];
  }
}

export async function getDriverForTruck(truckNo: string): Promise<string> {
  try {
    const supabase = await createClient();
    const { data: routeData } = await supabase
      .from("dm_routes")
      .select("dm_name, personnel, dm:employees!dm_routes_dm_id_fkey(full_name)")
      .eq("truck_no", truckNo)
      .limit(1)
      .maybeSingle();

    if (routeData) {
      const name = (routeData.dm as any)?.full_name || (routeData as any).dm_name || (routeData as any).personnel || "";
      if (name) return name;
    }

    const { data: loaderData } = await supabase
      .from("loaders")
      .select("loader:employees!loaders_loader_id_fkey(full_name)")
      .eq("number", truckNo)
      .limit(1)
      .maybeSingle();

    if (loaderData?.loader && (loaderData.loader as any).full_name) {
      return (loaderData.loader as any).full_name;
    }

    const { data: fuelData } = await supabase
      .from("fuel_entries")
      .select("driver_name")
      .eq("truck_no", truckNo)
      .not("driver_name", "is", null)
      .neq("driver_name", "")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fuelData?.driver_name) {
      return fuelData.driver_name;
    }

    return "";
  } catch {
    return "";
  }
}




export async function deleteFuelEntries(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("fuel_entries").delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/expenses/agency");
  revalidatePath("/cash-bank/bank-accounts");
}