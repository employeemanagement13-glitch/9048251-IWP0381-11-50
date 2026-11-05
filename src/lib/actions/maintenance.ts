"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface MaintenanceEntry {
  id: string;
  tenant_id: string;
  vehicle_no: string;
  driver_name: string | null;
  entry_date: string;
  description: string;
  amount: number;
  bank_account_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function getMaintenanceEntries(filters?: {
  vehicle_no?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<MaintenanceEntry[]> {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("vehicle_maintenance")
      .select("*")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (filters?.vehicle_no) query = query.eq("vehicle_no", filters.vehicle_no);
    if (filters?.dateFrom)   query = query.gte("entry_date", filters.dateFrom);
    if (filters?.dateTo)     query = query.lte("entry_date", filters.dateTo);

    const { data, error } = await query;
    if (error) {
      return [];
    }
    return (data || []) as MaintenanceEntry[];
  } catch {
    return [];
  }
}

export async function createMaintenanceEntry(formData: {
  vehicle_no: string;
  driver_name?: string;
  entry_date: string;
  description: string;
  amount: number;
  bank_account_id?: string;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const payload: any = {
    tenant_id: tenantId,
    vehicle_no: formData.vehicle_no.trim(),
    driver_name: formData.driver_name?.trim() || null,
    entry_date: formData.entry_date,
    description: formData.description.trim(),
    amount: formData.amount,
    bank_account_id: formData.bank_account_id || null,
  };

  const { data, error } = await supabase
    .from("vehicle_maintenance")
    .insert(payload)
    .select()
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/expenses/agency");
  revalidatePath("/expenses/sheet");
  revalidatePath("/income/statement");
  revalidatePath("/cash-bank/bank-accounts");
  return data;
}

export async function updateMaintenanceEntry(
  id: string,
  formData: {
    vehicle_no?: string;
    driver_name?: string;
    entry_date?: string;
    description?: string;
    amount?: number;
    bank_account_id?: string;
  }
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicle_maintenance")
    .update(formData)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/expenses/agency");
  revalidatePath("/expenses/sheet");
  revalidatePath("/income/statement");
  revalidatePath("/cash-bank/bank-accounts");
  return data;
}

export async function deleteMaintenanceEntry(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("vehicle_maintenance").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/expenses/agency");
  revalidatePath("/expenses/sheet");
  revalidatePath("/income/statement");
  revalidatePath("/cash-bank/bank-accounts");
}

export async function deleteMaintenanceEntries(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("vehicle_maintenance").delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/expenses/agency");
  revalidatePath("/expenses/sheet");
  revalidatePath("/income/statement");
  revalidatePath("/cash-bank/bank-accounts");
}

export async function getDriverForVehicle(vehicleNo: string): Promise<string> {
  try {
    const supabase = await createClient();
    const { data: routeData } = await supabase
      .from("dm_routes")
      .select("dm_name, personnel, dm:employees!dm_routes_dm_id_fkey(full_name)")
      .eq("truck_no", vehicleNo)
      .limit(1)
      .maybeSingle();

    if (routeData) {
      const name = (routeData.dm as any)?.full_name || routeData.dm_name || routeData.personnel || "";
      if (name) return name;
    }

    const { data: loaderData } = await supabase
      .from("loaders")
      .select("loader:employees!loaders_loader_id_fkey(full_name)")
      .eq("number", vehicleNo)
      .limit(1)
      .maybeSingle();

    if (loaderData?.loader && (loaderData.loader as any).full_name) {
      return (loaderData.loader as any).full_name;
    }

    const { data: maintData } = await supabase
      .from("vehicle_maintenance")
      .select("driver_name")
      .eq("vehicle_no", vehicleNo)
      .not("driver_name", "is", null)
      .neq("driver_name", "")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (maintData?.driver_name) {
      return maintData.driver_name;
    }

    const { data: fuelData } = await supabase
      .from("fuel_entries")
      .select("driver_name")
      .eq("truck_no", vehicleNo)
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
