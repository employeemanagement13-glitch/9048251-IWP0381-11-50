"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// --------------------------------------------------------------------------
// TYPES
// --------------------------------------------------------------------------

export interface DmRouteFormData {
  dm_id?: string | null;
  truck_no: string;
  route_name?: string | null;
  code?: string | null;
  dm_name?: string | null;
  personnel?: string | null;
  category?: string | null;
  vehicle_type?: string | null;
  model?: string | null;
  brand?: string | null;
  year?: string | null;
  cap_weight?: string | null;
  cap_volume?: string | null;
}

export interface LoaderFormData {
  loader_id?: string;
  loader_name?: string;
  number: string;
  model: string;
}

export interface AssignmentFilters {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
}

export async function getDmRoutes() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("dm_routes")
      .select(`*, dm:employees!dm_routes_dm_id_fkey(full_name)`)
      .order("created_at", { ascending: false });
    if (error) {
      const fallback = await supabase
        .from("dm_routes")
        .select(`*`)
        .order("created_at", { ascending: false });
      if (fallback.error) return [];
      return fallback.data || [];
    }
    return data || [];
  } catch (err: any) {
    return [];
  }
}

export async function createDmRoute(formData: DmRouteFormData) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const payload: any = {
    tenant_id: tenantId,
    truck_no: formData.truck_no,
  };
  if (formData.dm_id) payload.dm_id = formData.dm_id;
  if (formData.route_name !== undefined) payload.route_name = formData.route_name;
  if (formData.code !== undefined) payload.code = formData.code;
  if (formData.dm_name !== undefined) payload.dm_name = formData.dm_name;
  if (formData.personnel !== undefined) payload.personnel = formData.personnel;
  if (formData.category !== undefined) payload.category = formData.category;
  if (formData.vehicle_type !== undefined) payload.vehicle_type = formData.vehicle_type;
  if (formData.model !== undefined) payload.model = formData.model;
  if (formData.brand !== undefined) payload.brand = formData.brand;
  if (formData.year !== undefined) payload.year = formData.year;
  if (formData.cap_weight !== undefined) payload.cap_weight = formData.cap_weight;
  if (formData.cap_volume !== undefined) payload.cap_volume = formData.cap_volume;

  let { data, error } = await supabase
    .from("dm_routes")
    .insert(payload)
    .select()
    .single();

  if (error) {
    const fallbackPayload: any = {
      tenant_id: tenantId,
      truck_no: formData.truck_no,
      route_name: formData.route_name || "General Route",
    };
    if (formData.dm_id) fallbackPayload.dm_id = formData.dm_id;
    const retry = await supabase.from("dm_routes").insert(fallbackPayload).select().single();
    if (retry.error) throw new Error(error.message);
    data = retry.data;
  }
  revalidatePath("/tab1/routes");
  revalidatePath("/prerequisites/dm-routes");
  return data;
}

export async function updateDmRoute(id: string, formData: Partial<DmRouteFormData>) {
  const supabase = await createClient();
  let { data, error } = await supabase
    .from("dm_routes")
    .update(formData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    const fallback: any = {};
    if (formData.dm_id !== undefined) fallback.dm_id = formData.dm_id;
    if (formData.truck_no !== undefined) fallback.truck_no = formData.truck_no;
    if (formData.route_name !== undefined) fallback.route_name = formData.route_name;
    const retry = await supabase.from("dm_routes").update(fallback).eq("id", id).select().single();
    if (retry.error) throw new Error(error.message);
    data = retry.data;
  }
  revalidatePath("/tab1/routes");
  revalidatePath("/prerequisites/dm-routes");
  return data;
}

export async function bulkImportVehicles(vehicles: {
  code?: string;
  personnel?: string;
  truck_no: string;
  category?: string;
  vehicle_type?: string;
  model?: string;
  brand?: string;
  year?: string;
  cap_weight?: string;
  cap_volume?: string;
}[]) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const BATCH_SIZE = 100;
  const insertedData: any[] = [];

  for (let i = 0; i < vehicles.length; i += BATCH_SIZE) {
    const chunk = vehicles.slice(i, i + BATCH_SIZE);
    const rows = chunk.map((v) => ({
      tenant_id: tenantId,
      truck_no: (v.truck_no || "").toString().trim(),
      code: (v.code || "").toString().trim() || null,
      personnel: (v.personnel || "").toString().trim() || null,
      category: (v.category || "").toString().trim() || null,
      vehicle_type: (v.vehicle_type || "").toString().trim() || null,
      model: (v.model || "").toString().trim() || null,
      brand: (v.brand || "").toString().trim() || null,
      year: (v.year || "").toString().trim() || null,
      cap_weight: (v.cap_weight || "").toString().trim() || null,
      cap_volume: (v.cap_volume || "").toString().trim() || null,
    })).filter((r) => !!r.truck_no);

    if (!rows.length) continue;

    let { data, error } = await supabase
      .from("dm_routes")
      .upsert(rows, { onConflict: "tenant_id,truck_no" })
      .select();

    if (error) {
      const fallbackRows = rows.map((r) => ({
        tenant_id: r.tenant_id,
        truck_no: r.truck_no,
        route_name: "Default Route",
      }));
      const retry = await supabase
        .from("dm_routes")
        .upsert(fallbackRows, { onConflict: "tenant_id,truck_no" })
        .select();
      if (retry.error) throw new Error(retry.error.message);
      if (retry.data) insertedData.push(...retry.data);
    } else if (data) {
      insertedData.push(...data);
    }
  }

  revalidatePath("/tab1/routes");
  revalidatePath("/prerequisites/dm-routes");
  return insertedData;
}

export async function bulkImportDms(dmList: {
  vehicle: string;
  name: string;
}[]) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const { data: emps } = await supabase
    .from("employees")
    .select("id, full_name")
    .eq("tenant_id", tenantId);

  const empMap = new Map<string, string>();
  if (emps) {
    for (const e of emps) {
      if (e.full_name) empMap.set(e.full_name.trim().toLowerCase(), e.id);
    }
  }

  const BATCH_SIZE = 25;
  let updatedCount = 0;

  for (let i = 0; i < dmList.length; i += BATCH_SIZE) {
    const chunk = dmList.slice(i, i + BATCH_SIZE);
    await Promise.all(
      chunk.map(async (item) => {
        const vehicle = (item.vehicle || "").toString().trim();
        const name = (item.name || "").toString().trim();
        if (!vehicle) return;

        const matchedEmpId = empMap.get(name.toLowerCase()) || null;
        const payload: any = { dm_name: name || null };
        if (matchedEmpId) payload.dm_id = matchedEmpId;

        const { error } = await supabase
          .from("dm_routes")
          .update(payload)
          .ilike("truck_no", vehicle)
          .eq("tenant_id", tenantId);

        if (!error) updatedCount++;
      })
    );
  }

  revalidatePath("/tab1/routes");
  revalidatePath("/prerequisites/dm-routes");
  return { updatedCount };
}

export async function deleteDmRoute(id: string) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const { data: route } = await supabase
    .from("dm_routes")
    .select("truck_no")
    .eq("id", id)
    .single();

  const { error } = await supabase.from("dm_routes").delete().eq("id", id);
  if (error) throw new Error(error.message);

  if (route?.truck_no) {
    await supabase.from("fuel_entries").delete().eq("tenant_id", tenantId).eq("truck_no", route.truck_no);
    await supabase.from("vehicle_maintenance").delete().eq("tenant_id", tenantId).eq("vehicle_no", route.truck_no);
  }

  revalidatePath("/tab1/routes");
  revalidatePath("/prerequisites/dm-routes");
  revalidatePath("/expenses/agency");
}

export async function deleteDmRoutes(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const { data: routes } = await supabase
    .from("dm_routes")
    .select("truck_no")
    .in("id", ids);

  const truckNos = (routes || []).map((r: any) => r.truck_no).filter(Boolean);

  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("dm_routes").delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }

  if (truckNos.length > 0) {
    await supabase.from("fuel_entries").delete().eq("tenant_id", tenantId).in("truck_no", truckNos);
    await supabase.from("vehicle_maintenance").delete().eq("tenant_id", tenantId).in("vehicle_no", truckNos);
  }

  revalidatePath("/tab1/routes");
  revalidatePath("/prerequisites/dm-routes");
  revalidatePath("/expenses/agency");
}

// --------------------------------------------------------------------------
// LOADERS REGISTRY (permanent setup)
// --------------------------------------------------------------------------

export async function getLoaders() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("loaders")
      .select(`*, loader:employees!loaders_loader_id_fkey(full_name)`)
      .order("created_at", { ascending: false });
    if (error) {
      const fallback = await supabase
        .from("loaders")
        .select(`*, loader:employees(full_name)`)
        .order("created_at", { ascending: false });
      if (fallback.error) {
        console.error("[getLoaders] error:", fallback.error.message);
        return [];
      }
      return fallback.data || [];
    }
    return data || [];
  } catch (err: any) {
    console.error("[getLoaders] unexpected error:", err?.message ?? err);
    return [];
  }
}

export async function createLoader(formData: LoaderFormData) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  // Check if an existing employee matches the name to link loader_id if possible
  let loaderId = formData.loader_id || null;
  if (!loaderId && formData.loader_name?.trim()) {
    const trimmed = formData.loader_name.trim();
    const { data: matchedEmp } = await supabase
      .from("employees")
      .select("id")
      .ilike("full_name", trimmed)
      .limit(1)
      .maybeSingle();
    if (matchedEmp) {
      loaderId = matchedEmp.id;
    }
  }

  const insertPayload: any = {
    tenant_id: tenantId,
    loader_id: loaderId,
    number: formData.number.trim(),
    model: formData.model.trim(),
  };
  if (formData.loader_name?.trim()) {
    insertPayload.loader_name = formData.loader_name.trim();
  }

  let { data, error } = await supabase
    .from("loaders")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    // If loader_name column is not in the schema cache yet, retry without it
    if (error.message?.includes("loader_name") || error.code === "PGRST204" || error.code === "42703") {
      delete insertPayload.loader_name;
      const retry = await supabase.from("loaders").insert(insertPayload).select().single();
      if (retry.error) throw new Error(retry.error.message);
      data = retry.data;
    } else {
      throw new Error(error.message);
    }
  }

  revalidatePath("/prerequisites/dm-routes");
  revalidatePath("/expenses/agency");
  return data;
}


export async function updateLoader(id: string, formData: Partial<LoaderFormData>) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  let loaderId = formData.loader_id || null;
  if (!loaderId && formData.loader_name?.trim()) {
    const trimmed = formData.loader_name.trim();
    const { data: matchedEmp } = await supabase
      .from("employees")
      .select("id")
      .ilike("full_name", trimmed)
      .limit(1)
      .maybeSingle();
    if (matchedEmp) {
      loaderId = matchedEmp.id;
    }
  }

  const updateData: any = {};
  if (formData.loader_id !== undefined || formData.loader_name !== undefined) {
    updateData.loader_id = loaderId;
  }
  if (formData.loader_name !== undefined) updateData.loader_name = formData.loader_name?.trim() || null;
  if (formData.number) updateData.number = formData.number.trim();
  if (formData.model) updateData.model = formData.model.trim();

  let { data, error } = await supabase
    .from("loaders")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    // If loader_name column is not in the schema cache yet, retry without it
    if (error.message?.includes("loader_name") || error.code === "PGRST204" || error.code === "42703") {
      delete updateData.loader_name;
      const retry = await supabase.from("loaders").update(updateData).eq("id", id).select().single();
      if (retry.error) throw new Error(retry.error.message);
      data = retry.data;
    } else {
      throw new Error(error.message);
    }
  }

  revalidatePath("/prerequisites/dm-routes");
  revalidatePath("/expenses/agency");
  return data;
}

export async function deleteLoader(id: string) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const { data: loader } = await supabase
    .from("loaders")
    .select("number")
    .eq("id", id)
    .single();

  const { error } = await supabase.from("loaders").delete().eq("id", id);
  if (error) throw new Error(error.message);

  if (loader?.number) {
    await supabase.from("fuel_entries").delete().eq("tenant_id", tenantId).eq("truck_no", loader.number);
    await supabase.from("vehicle_maintenance").delete().eq("tenant_id", tenantId).eq("vehicle_no", loader.number);
  }

  revalidatePath("/prerequisites/dm-routes");
  revalidatePath("/expenses/agency");
}

export async function deleteLoaders(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const { data: loaders } = await supabase
    .from("loaders")
    .select("number")
    .in("id", ids);

  const numbers = (loaders || []).map((l: any) => l.number).filter(Boolean);

  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("loaders").delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }

  if (numbers.length > 0) {
    await supabase.from("fuel_entries").delete().eq("tenant_id", tenantId).in("truck_no", numbers);
    await supabase.from("vehicle_maintenance").delete().eq("tenant_id", tenantId).in("vehicle_no", numbers);
  }

  revalidatePath("/prerequisites/dm-routes");
  revalidatePath("/expenses/agency");
}


// --------------------------------------------------------------------------
// DAILY ROUTE ASSIGNMENTS
// --------------------------------------------------------------------------

export async function getRouteAssignments(filters?: AssignmentFilters) {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("route_assignments")
      .select(`*, dm:employees!route_assignments_dm_id_fkey(full_name)`)
      .order("created_at", { ascending: false });

    if (filters?.date) {
      query = query.eq("assignment_date", filters.date);
    }
    if (filters?.dateFrom) {
      query = query.gte("assignment_date", filters.dateFrom);
    }
    if (filters?.dateTo) {
      query = query.lte("assignment_date", filters.dateTo);
    }
    if (filters?.status) {
      query = query.eq("status", filters.status);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[getRouteAssignments] error:", error.message);
      return [];
    }
    return data || [];
  } catch (err: any) {
    console.error("[getRouteAssignments] unexpected error:", err?.message ?? err);
    return [];
  }
}

export async function createRouteAssignment(data: {
  truck_no: string;
  dm_id: string;
  route_name: string;
  assignment_date: string;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const { data: result, error } = await supabase
    .from("route_assignments")
    .insert({
      tenant_id: tenantId,
      truck_no: data.truck_no,
      dm_id: data.dm_id,
      route_name: data.route_name,
      assignment_date: data.assignment_date,
      status: "not_started",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/tab1/routes");
  return result;
}

// --------------------------------------------------------------------------
// AUTO-ASSIGN: Copy from dm_routes registry into today's assignments
// --------------------------------------------------------------------------

export async function autoAssignRoutes(date: string) {
  const supabase = await createClient();

  // Get all registered DM/Truck/Routes
  const { data: registry, error: regErr } = await supabase
    .from("dm_routes")
    .select("dm_id, truck_no, route_name");
  if (regErr) throw new Error(regErr.message);
  if (!registry?.length) throw new Error("No DM/Truck/Route entries registered yet");

  // Upsert into route_assignments for the given date
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const assignments = registry.map((r) => ({
    tenant_id: tenantId,
    truck_no: r.truck_no,
    dm_id: r.dm_id,
    route_name: r.route_name,
    assignment_date: date,
    status: "not_started" as const,
  }));

  const { data, error } = await supabase
    .from("route_assignments")
    .upsert(assignments, { onConflict: "tenant_id,truck_no,assignment_date", ignoreDuplicates: true })
    .select();
  if (error) throw new Error(error.message);

  revalidatePath("/tab1/routes");
  return data;
}

// --------------------------------------------------------------------------
// MARK TRUCK RETURNED
// --------------------------------------------------------------------------

export async function markTruckReturned(assignmentId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("route_assignments")
    .update({ status: "returned" })
    .eq("id", assignmentId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/tab1/routes");
  return data;
}

export async function deleteRouteAssignment(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("route_assignments").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/tab1/routes");
}

export async function deleteRouteAssignments(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("route_assignments").delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/tab1/routes");
}

// --------------------------------------------------------------------------
// GET INVOICES FOR A ROUTE/DM (daily assignment sub-page)
// --------------------------------------------------------------------------

export async function getInvoicesForAssignment(dmId: string, date: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(`*, shop:shops(shop_name, outlet_code)`)
    .eq("dm_id", dmId)
    .eq("scheduled_date", date)
    .order("created_at");
  if (error) throw new Error(error.message);
  return data;
}

// --------------------------------------------------------------------------
// IMPORT DM ROUTES (bulk)
// --------------------------------------------------------------------------

export async function bulkImportDmRoutes(routes: DmRouteFormData[]) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const routesWithTenant = routes.map(r => ({ ...r, tenant_id: tenantId }));

  const { data, error } = await supabase
    .from("dm_routes")
    .insert(routesWithTenant)
    .select();
  if (error) throw new Error(error.message);
  revalidatePath("/tab1/routes");
  return data;
}

// --------------------------------------------------------------------------
// GET INVOICE SUMMARIES PER ASSIGNMENT (for route table columns)
// --------------------------------------------------------------------------

export async function getInvoiceSummariesForDate(date?: string) {
  const supabase = await createClient();
  // Fetch all invoices for today by default
  let query = supabase
    .from("invoices")
    .select("dm_id, invoice_total, invoice_type, grand_total");
  if (date) {
    query = query.eq("scheduled_date", date);
  } else {
    query = query.eq("scheduled_date", new Date().toISOString().split("T")[0]);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  // Aggregate per dm_id
  const map: Record<
    string,
    { count: number; total: number; cashTotal: number; creditTotal: number }
  > = {};
  for (const inv of data || []) {
    if (!inv.dm_id) continue;
    if (!map[inv.dm_id]) map[inv.dm_id] = { count: 0, total: 0, cashTotal: 0, creditTotal: 0 };
    map[inv.dm_id].count += 1;
    const val = Number(inv.grand_total ?? inv.invoice_total ?? 0);
    map[inv.dm_id].total += val;
    if (inv.invoice_type === "cash") map[inv.dm_id].cashTotal += val;
    else map[inv.dm_id].creditTotal += val;
  }
  return map;
}

// --------------------------------------------------------------------------
// GET DISPATCH SUMMARIES (aggregated per DM over a date range)
// Fields: totalInvoices, revenue (sum grand_total), returnAmt (returned_qty * sale_rate)
// --------------------------------------------------------------------------

export interface DispatchSummary {
  dmId: string;
  totalInvoices: number;
  revenue: number;
  returnAmt: number;
}

/** Fetch invoice_returns in batches to avoid PostgREST URL-length limits on large .in() lists */
async function fetchReturnsBatched(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invoiceIds: string[]
): Promise<{ invoice_id: string; product_name: string; returned_qty: number }[]> {
  const BATCH = 200;
  const results: { invoice_id: string; product_name: string; returned_qty: number }[] = [];
  for (let i = 0; i < invoiceIds.length; i += BATCH) {
    const chunk = invoiceIds.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("invoice_returns")
      .select("invoice_id, product_name, returned_qty")
      .in("invoice_id", chunk);
    if (error) {
      console.error("[fetchReturnsBatched] error:", error.message);
      continue; // partial failure Ã¯¿½ skip this batch but don't crash
    }
    if (data) results.push(...data);
  }
  return results;
}

export async function getDispatchSummaries(
  fromDate?: string,
  toDate?: string
): Promise<Record<string, DispatchSummary>> {
  try {
    const supabase = await createClient();

    const today = new Date().toISOString().split("T")[0];
    const from = fromDate || today;
    const to = toDate || today;

    // 1. Fetch invoices in date range
    const { data: invoices, error: invErr } = await supabase
      .from("invoices")
      .select("id, dm_id, grand_total, invoice_total, invoice_type")
      .gte("scheduled_date", from)
      .lte("scheduled_date", to);

    if (invErr) {
      console.error("[getDispatchSummaries] invoices error:", invErr.message);
      return {};
    }

    // Build a map of invoice_id -> dm_id and aggregate revenue
    const invoiceMap: Record<string, string> = {}; // invoice_id -> dm_id
    const map: Record<string, DispatchSummary> = {};

    for (const inv of invoices || []) {
      if (!inv.dm_id) continue;
      invoiceMap[inv.id] = inv.dm_id;
      if (!map[inv.dm_id]) {
        map[inv.dm_id] = { dmId: inv.dm_id, totalInvoices: 0, revenue: 0, returnAmt: 0 };
      }
      map[inv.dm_id].totalInvoices += 1;
      map[inv.dm_id].revenue += Number(inv.grand_total ?? inv.invoice_total ?? 0);
    }

    const invoiceIds = Object.keys(invoiceMap);
    if (invoiceIds.length === 0) return map;

    // 2. Fetch all returns Ã¯¿½ batched to avoid URL-length limits (the previous fetch failed error)
    const returns = await fetchReturnsBatched(supabase, invoiceIds);
    if (returns.length === 0) return map;

    // 3. Fetch sale_rate for products involved in returns
    const productNames = [...new Set(returns.map((r) => r.product_name))];
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("product_name, sale_rate")
      .in("product_name", productNames);

    if (prodErr) {
      console.error("[getDispatchSummaries] products error:", prodErr.message);
      return map;
    }

    const saleRateMap: Record<string, number> = {};
    for (const p of products || []) {
      saleRateMap[p.product_name] = Number(p.sale_rate) || 0;
    }

    // 4. Aggregate return amounts per DM
    for (const ret of returns) {
      const dmId = invoiceMap[ret.invoice_id];
      if (!dmId || !map[dmId]) continue;
      const rate = saleRateMap[ret.product_name] || 0;
      map[dmId].returnAmt += rate * Number(ret.returned_qty || 0);
    }

    return map;
  } catch (err: any) {
    console.error("[getDispatchSummaries] unexpected error:", err?.message ?? err);
    return {};
  }
}

// --------------------------------------------------------------------------
// GET DATE-GROUPED INVOICE DETAIL FOR A DM ROUTE (for the View drill-down)
// Fields per date: date, invoiceCount, invoiceTotal, cashTotal, creditTotal, returnAmt
// --------------------------------------------------------------------------

export interface RouteDateSummary {
  date: string;
  invoiceCount: number;
  invoiceTotal: number;
  cashTotal: number;
  creditTotal: number;
  returnAmt: number;
}

export async function getRouteDateSummaries(
  dmId: string,
  fromDate?: string,
  toDate?: string
): Promise<RouteDateSummary[]> {
  const supabase = await createClient();

  const today = new Date().toISOString().split("T")[0];
  const from = fromDate || today;
  const to = toDate || today;

  // 1. Fetch invoices for this DM in the date range
  const { data: invoices, error: invErr } = await supabase
    .from("invoices")
    .select("id, scheduled_date, grand_total, invoice_total, invoice_type")
    .eq("dm_id", dmId)
    .gte("scheduled_date", from)
    .lte("scheduled_date", to)
    .order("scheduled_date", { ascending: false });

  if (invErr) throw new Error(invErr.message);
  if (!invoices || invoices.length === 0) return [];

  // Build invoice id -> date map and per-date aggregates
  const invoiceMap: Record<string, string> = {}; // invoice_id -> date
  const dateMap: Record<string, RouteDateSummary> = {};

  for (const inv of invoices) {
    if (!inv.scheduled_date) continue;
    const d = inv.scheduled_date;
    invoiceMap[inv.id] = d;
    if (!dateMap[d]) {
      dateMap[d] = { date: d, invoiceCount: 0, invoiceTotal: 0, cashTotal: 0, creditTotal: 0, returnAmt: 0 };
    }
    const val = Number(inv.grand_total ?? inv.invoice_total ?? 0);
    dateMap[d].invoiceCount += 1;
    dateMap[d].invoiceTotal += val;
    if (inv.invoice_type === "cash") dateMap[d].cashTotal += val;
    else dateMap[d].creditTotal += val;
  }

  const invoiceIds = Object.keys(invoiceMap);
  if (invoiceIds.length === 0) return Object.values(dateMap);

  // 2. Fetch returns Ã¯¿½ batched to avoid URL-length limits
  const returns = await fetchReturnsBatched(supabase, invoiceIds);

  if (returns.length === 0) return Object.values(dateMap).sort((a, b) => b.date.localeCompare(a.date));

  // 3. Fetch sale_rates
  const productNames = [...new Set(returns.map((r) => r.product_name))];
  const { data: products } = await supabase
    .from("products")
    .select("product_name, sale_rate")
    .in("product_name", productNames);

  const saleRateMap: Record<string, number> = {};
  for (const p of products || []) {
    saleRateMap[p.product_name] = Number(p.sale_rate) || 0;
  }

  // 4. Aggregate return amounts per date
  for (const ret of returns) {
    const d = invoiceMap[ret.invoice_id];
    if (!d || !dateMap[d]) continue;
    const rate = saleRateMap[ret.product_name] || 0;
    dateMap[d].returnAmt += rate * Number(ret.returned_qty || 0);
  }

  return Object.values(dateMap).sort((a, b) => b.date.localeCompare(a.date));
}

// --------------------------------------------------------------------------
// GET ALL INVOICES FOR A DM ON A SPECIFIC DATE (for inner View drill-down)
// --------------------------------------------------------------------------

export async function getInvoicesForDmOnDate(dmId: string, date: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(`id, invoice_no, grand_total, invoice_total, invoice_type, shop:shops(shop_name, outlet_code)`)
    .eq("dm_id", dmId)
    .eq("scheduled_date", date)
    .order("created_at");
  if (error) throw new Error(error.message);
  return data || [];
}


