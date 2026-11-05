"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const PATHS = ["/expenses/agency", "/expenses/sheet"];
const revalidateAll = () => PATHS.forEach((p) => revalidatePath(p));
const revalidateWithLedger = () => { revalidateAll(); revalidatePath("/cash-bank/bank-accounts"); };

export async function getBills(filters?: { month?: string; year?: string; dateFrom?: string; dateTo?: string }) {
  try {
    const supabase = await createClient();
    let q = supabase.from("expense_bills").select("*").order("created_at", { ascending: false });
    if (filters?.month) q = q.eq("month", filters.month);
    if (filters?.year)  q = q.eq("year",  filters.year);
    if (filters?.dateFrom) q = q.gte("expense_date", filters.dateFrom);
    if (filters?.dateTo)   q = q.lte("expense_date", filters.dateTo);
    const { data, error } = await q;
    if (error) { console.error("[getBills]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getBills] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function createBill(formData: { bill_name: string; month: string; year: string; amount: number; expense_date?: string; bank_account_id?: string }) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");
  let { data, error } = await supabase.from("expense_bills").insert({ ...formData, tenant_id: tenantId }).select().single();
  if (error && (error.message.includes("schema cache") || error.message.includes("column"))) {
    const { expense_date, bank_account_id, ...safePayload } = formData;
    const retry = await supabase.from("expense_bills").insert({ ...safePayload, tenant_id: tenantId }).select().single();
    if (retry.error) throw new Error(retry.error.message);
    data = retry.data;
  } else if (error) {
    throw new Error(error.message);
  }
  revalidateWithLedger();
  return data;
}

export async function updateBill(id: string, formData: Partial<{ bill_name: string; month: string; year: string; amount: number; expense_date?: string; bank_account_id?: string | null }>) {
  const supabase = await createClient();
  const payload: any = {};
  if (formData.bill_name !== undefined) payload.bill_name = formData.bill_name;
  if (formData.month !== undefined) payload.month = formData.month;
  if (formData.year !== undefined) payload.year = formData.year;
  if (formData.amount !== undefined) payload.amount = formData.amount;
  if (formData.expense_date !== undefined) payload.expense_date = formData.expense_date;
  if (formData.bank_account_id !== undefined) payload.bank_account_id = formData.bank_account_id || null;

  const { data, error } = await supabase.from("expense_bills").update(payload).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  revalidateWithLedger();
  return data;
}

export async function deleteBill(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("expense_bills").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidateWithLedger();
}

export async function getEntertainment(filters?: { month?: string; year?: string; dateFrom?: string; dateTo?: string }) {
  try {
    const supabase = await createClient();
    let q = supabase.from("expense_entertainment").select("*").order("created_at", { ascending: false });
    if (filters?.month) q = q.eq("month", filters.month);
    if (filters?.year)  q = q.eq("year",  filters.year);
    if (filters?.dateFrom) q = q.gte("expense_date", filters.dateFrom);
    if (filters?.dateTo)   q = q.lte("expense_date", filters.dateTo);
    const { data, error } = await q;
    if (error) { console.error("[getEntertainment]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getEntertainment] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function createEntertainment(formData: { month: string; year: string; description: string; amount: number; expense_date?: string; bank_account_id?: string }) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");
  let { data, error } = await supabase.from("expense_entertainment").insert({ ...formData, tenant_id: tenantId }).select().single();
  if (error && (error.message.includes("schema cache") || error.message.includes("column"))) {
    const { expense_date, bank_account_id, ...safePayload } = formData;
    const retry = await supabase.from("expense_entertainment").insert({ ...safePayload, tenant_id: tenantId }).select().single();
    if (retry.error) throw new Error(retry.error.message);
    data = retry.data;
  } else if (error) {
    throw new Error(error.message);
  }
  revalidateWithLedger();
  return data;
}

export async function updateEntertainment(id: string, formData: Partial<{ month: string; year: string; description: string; amount: number; expense_date?: string; bank_account_id?: string | null }>) {
  const supabase = await createClient();
  const payload: any = {};
  if (formData.month !== undefined) payload.month = formData.month;
  if (formData.year !== undefined) payload.year = formData.year;
  if (formData.description !== undefined) payload.description = formData.description;
  if (formData.amount !== undefined) payload.amount = formData.amount;
  if (formData.expense_date !== undefined) payload.expense_date = formData.expense_date;
  if (formData.bank_account_id !== undefined) payload.bank_account_id = formData.bank_account_id || null;

  const { data, error } = await supabase.from("expense_entertainment").update(payload).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  revalidateWithLedger();
  return data;
}

export async function deleteEntertainment(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("expense_entertainment").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidateWithLedger();
}

export async function getPetty(filters?: { month?: string; year?: string; dateFrom?: string; dateTo?: string }) {
  try {
    const supabase = await createClient();
    let q = supabase.from("expense_petty").select("*").order("created_at", { ascending: false });
    if (filters?.month) q = q.eq("month", filters.month);
    if (filters?.year)  q = q.eq("year",  filters.year);
    if (filters?.dateFrom) q = q.gte("expense_date", filters.dateFrom);
    if (filters?.dateTo)   q = q.lte("expense_date", filters.dateTo);
    const { data, error } = await q;
    if (error) { console.error("[getPetty]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getPetty] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function createPetty(formData: { month: string; year: string; description: string; amount: number; expense_date?: string; bank_account_id?: string }) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");
  let { data, error } = await supabase.from("expense_petty").insert({ ...formData, tenant_id: tenantId }).select().single();
  if (error && (error.message.includes("schema cache") || error.message.includes("column"))) {
    const { expense_date, bank_account_id, ...safePayload } = formData;
    const retry = await supabase.from("expense_petty").insert({ ...safePayload, tenant_id: tenantId }).select().single();
    if (retry.error) throw new Error(retry.error.message);
    data = retry.data;
  } else if (error) {
    throw new Error(error.message);
  }
  revalidateWithLedger();
  return data;
}

export async function updatePetty(id: string, formData: Partial<{ month: string; year: string; description: string; amount: number; expense_date?: string; bank_account_id?: string | null }>) {
  const supabase = await createClient();
  const payload: any = {};
  if (formData.month !== undefined) payload.month = formData.month;
  if (formData.year !== undefined) payload.year = formData.year;
  if (formData.description !== undefined) payload.description = formData.description;
  if (formData.amount !== undefined) payload.amount = formData.amount;
  if (formData.expense_date !== undefined) payload.expense_date = formData.expense_date;
  if (formData.bank_account_id !== undefined) payload.bank_account_id = formData.bank_account_id || null;

  const { data, error } = await supabase.from("expense_petty").update(payload).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  revalidateWithLedger();
  return data;
}

export async function deletePetty(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("expense_petty").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidateWithLedger();
}

export async function getPenalties(filters?: { month?: string; year?: string; dateFrom?: string; dateTo?: string }) {
  try {
    const supabase = await createClient();
    let q = supabase.from("expense_penalties").select("*").order("created_at", { ascending: false });
    if (filters?.month) q = q.eq("month", filters.month);
    if (filters?.year)  q = q.eq("year",  filters.year);
    if (filters?.dateFrom) q = q.gte("expense_date", filters.dateFrom);
    if (filters?.dateTo)   q = q.lte("expense_date", filters.dateTo);
    const { data, error } = await q;
    if (error) { console.error("[getPenalties]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getPenalties] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function createPenalty(formData: { month: string; year: string; description: string; reason?: string; amount: number; expense_date?: string; bank_account_id?: string; vendor_account_id?: string }) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");
  let { data, error } = await supabase.from("expense_penalties").insert({ ...formData, tenant_id: tenantId }).select().single();
  if (error && (error.message.includes("schema cache") || error.message.includes("column"))) {
    const { expense_date, bank_account_id, vendor_account_id, ...safePayload } = formData;
    const retry = await supabase.from("expense_penalties").insert({ ...safePayload, tenant_id: tenantId }).select().single();
    if (retry.error) throw new Error(retry.error.message);
    data = retry.data;
  } else if (error) {
    throw new Error(error.message);
  }
  revalidateWithLedger();
  return data;
}

export async function updatePenalty(id: string, formData: Partial<{ month: string; year: string; description: string; reason?: string | null; amount: number; expense_date?: string; bank_account_id?: string | null; vendor_account_id?: string | null }>) {
  const supabase = await createClient();
  const payload: any = {};
  if (formData.month !== undefined) payload.month = formData.month;
  if (formData.year !== undefined) payload.year = formData.year;
  if (formData.description !== undefined) payload.description = formData.description;
  if (formData.reason !== undefined) payload.reason = formData.reason || null;
  if (formData.amount !== undefined) payload.amount = formData.amount;
  if (formData.expense_date !== undefined) payload.expense_date = formData.expense_date;
  if (formData.bank_account_id !== undefined) payload.bank_account_id = formData.bank_account_id || null;
  if (formData.vendor_account_id !== undefined) payload.vendor_account_id = formData.vendor_account_id || null;

  const { data, error } = await supabase.from("expense_penalties").update(payload).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  revalidateWithLedger();
  return data;
}

export async function deletePenalty(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("expense_penalties").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidateWithLedger();
}

export async function deleteBills(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("expense_bills").delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }
  revalidateWithLedger();
}

export async function deleteEntertainments(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("expense_entertainment").delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }
  revalidateWithLedger();
}

export async function deletePetties(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("expense_petty").delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }
  revalidateWithLedger();
}

export async function deleteAgencyPenalties(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("expense_penalties").delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }
  revalidateWithLedger();
}