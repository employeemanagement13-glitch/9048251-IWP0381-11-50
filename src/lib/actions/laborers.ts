"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface LaborerPerson {
  id?: string;
  name: string;
  phone?: string;
}

export interface LaborerRecord {
  id: string;
  work: string;
  from_date: string;
  to_date: string;
  days: number;
  created_at: string;
  persons: LaborerPerson[];
  persons_count: number;
}

export interface LaborerExpenseRecord {
  id: string;
  laborer_id?: string | null;
  work: string;
  from_date: string;
  to_date: string;
  days: number;
  amount: number;
  bank_account_id?: string | null;
  created_at: string;
  bank_account?: {
    id: string;
    account_title: string;
  } | null;
}

const REVALIDATE_PATHS = [
  "/employee-management/laborers",
  "/expenses/agency",
  "/cash-bank/bank-accounts",
  "/expenses/sheet",
];

function revalidateAll() {
  REVALIDATE_PATHS.forEach((p) => revalidatePath(p));
}

function calculateDays(fromDate: string, toDate: string): number {
  if (!fromDate || !toDate) return 1;
  const d1 = new Date(fromDate);
  const d2 = new Date(toDate);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return isNaN(diffDays) || diffDays < 1 ? 1 : diffDays;
}

export async function getLaborers(filters?: { fromDate?: string; toDate?: string }): Promise<LaborerRecord[]> {
  try {
    const supabase = await createClient();
    let q = supabase
      .from("laborers")
      .select("*, laborer_persons(id, name, phone)")
      .order("created_at", { ascending: false });

    if (filters?.fromDate) {
      q = q.gte("to_date", filters.fromDate);
    }
    if (filters?.toDate) {
      q = q.lte("from_date", filters.toDate);
    }

    const { data, error } = await q;
    if (error) {
      console.error("[getLaborers] error:", error.message);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      work: row.work,
      from_date: row.from_date,
      to_date: row.to_date,
      days: Number(row.days || 1),
      created_at: row.created_at,
      persons: Array.isArray(row.laborer_persons) ? row.laborer_persons : [],
      persons_count: Array.isArray(row.laborer_persons) ? row.laborer_persons.length : 0,
    }));
  } catch (err: any) {
    console.error("[getLaborers] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function createLaborer(formData: {
  work: string;
  from_date: string;
  to_date: string;
  days?: number;
  persons: { name: string; phone?: string }[];
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  if (!formData.work?.trim()) throw new Error("Work description is required");
  if (!formData.from_date) throw new Error("From date is required");
  if (!formData.to_date) throw new Error("To date is required");

  const days = formData.days && formData.days > 0
    ? formData.days
    : calculateDays(formData.from_date, formData.to_date);

  const { data: laborer, error: laborerError } = await supabase
    .from("laborers")
    .insert({
      tenant_id: tenantId,
      work: formData.work.trim(),
      from_date: formData.from_date,
      to_date: formData.to_date,
      days,
    })
    .select()
    .single();

  if (laborerError) throw new Error(laborerError.message);

  const validPersons = (formData.persons || []).filter((p) => p.name?.trim());
  if (validPersons.length > 0) {
    const personsPayload = validPersons.map((p) => ({
      tenant_id: tenantId,
      laborer_id: laborer.id,
      name: p.name.trim(),
      phone: p.phone?.trim() || null,
    }));

    const { error: personsError } = await supabase
      .from("laborer_persons")
      .insert(personsPayload);

    if (personsError) {
      console.error("[createLaborer] persons error:", personsError.message);
    }
  }

  revalidateAll();
  return laborer;
}

export async function updateLaborer(
  id: string,
  formData: {
    work: string;
    from_date: string;
    to_date: string;
    days?: number;
    persons: { id?: string; name: string; phone?: string }[];
  }
) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  if (!formData.work?.trim()) throw new Error("Work description is required");
  if (!formData.from_date) throw new Error("From date is required");
  if (!formData.to_date) throw new Error("To date is required");

  const days = formData.days && formData.days > 0
    ? formData.days
    : calculateDays(formData.from_date, formData.to_date);

  const { data: laborer, error: laborerError } = await supabase
    .from("laborers")
    .update({
      work: formData.work.trim(),
      from_date: formData.from_date,
      to_date: formData.to_date,
      days,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (laborerError) throw new Error(laborerError.message);

  // Sync persons: delete existing and re-insert
  await supabase.from("laborer_persons").delete().eq("laborer_id", id);

  const validPersons = (formData.persons || []).filter((p) => p.name?.trim());
  if (validPersons.length > 0) {
    const personsPayload = validPersons.map((p) => ({
      tenant_id: tenantId,
      laborer_id: id,
      name: p.name.trim(),
      phone: p.phone?.trim() || null,
    }));

    const { error: personsError } = await supabase
      .from("laborer_persons")
      .insert(personsPayload);

    if (personsError) {
      console.error("[updateLaborer] persons sync error:", personsError.message);
    }
  }

  // Also keep any linked laborer_expenses in sync with the new work / dates
  await supabase
    .from("laborer_expenses")
    .update({
      work: formData.work.trim(),
      from_date: formData.from_date,
      to_date: formData.to_date,
      days,
      updated_at: new Date().toISOString(),
    })
    .eq("laborer_id", id);

  revalidateAll();
  return laborer;
}

export async function deleteLaborer(id: string) {
  const supabase = await createClient();

  // 1. Fetch laborer details first to clean up any associated or matching expenses
  const { data: laborer } = await supabase
    .from("laborers")
    .select("id, work, from_date, to_date")
    .eq("id", id)
    .maybeSingle();

  // 2. Delete linked laborer expenses by laborer_id
  await supabase.from("laborer_expenses").delete().eq("laborer_id", id);

  // 3. Also delete any matching expenses by work and dates
  if (laborer) {
    await supabase
      .from("laborer_expenses")
      .delete()
      .eq("work", laborer.work)
      .eq("from_date", laborer.from_date)
      .eq("to_date", laborer.to_date);
  }

  // 4. Delete the laborer record (cascade deletes persons)
  const { error } = await supabase.from("laborers").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidateAll();
}

export async function getLaborerExpenses(filters?: { fromDate?: string; toDate?: string }): Promise<LaborerExpenseRecord[]> {
  try {
    const supabase = await createClient();
    let q = supabase
      .from("laborer_expenses")
      .select("*, bank_accounts(id, account_title)")
      .order("from_date", { ascending: false });

    if (filters?.fromDate) {
      q = q.gte("to_date", filters.fromDate);
    }
    if (filters?.toDate) {
      q = q.lte("from_date", filters.toDate);
    }

    const { data, error } = await q;
    if (error) {
      console.error("[getLaborerExpenses] error:", error.message);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      laborer_id: row.laborer_id,
      work: row.work,
      from_date: row.from_date,
      to_date: row.to_date,
      days: Number(row.days || 1),
      amount: Number(row.amount || 0),
      bank_account_id: row.bank_account_id,
      created_at: row.created_at,
      bank_account: row.bank_accounts ? {
        id: row.bank_accounts.id,
        account_title: row.bank_accounts.account_title,
      } : null,
    }));
  } catch (err: any) {
    console.error("[getLaborerExpenses] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function recordLaborerExpense(formData: {
  laborer_id?: string;
  work: string;
  from_date: string;
  to_date: string;
  days: number;
  amount: number;
  bank_account_id?: string;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  if (!formData.work?.trim()) throw new Error("Work description is required");
  if (!formData.from_date) throw new Error("From date is required");
  if (!formData.to_date) throw new Error("To date is required");
  if (formData.amount === undefined || isNaN(formData.amount)) throw new Error("Amount is required");

  // Check if an expense record already exists for this laborer_id
  let existingId: string | null = null;
  if (formData.laborer_id) {
    const { data: existing } = await supabase
      .from("laborer_expenses")
      .select("id")
      .eq("laborer_id", formData.laborer_id)
      .maybeSingle();
    if (existing?.id) {
      existingId = existing.id;
    }
  }

  let result;
  if (existingId) {
    const { data, error } = await supabase
      .from("laborer_expenses")
      .update({
        work: formData.work.trim(),
        from_date: formData.from_date,
        to_date: formData.to_date,
        days: formData.days || calculateDays(formData.from_date, formData.to_date),
        amount: Number(formData.amount),
        bank_account_id: formData.bank_account_id || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    result = data;
  } else {
    const { data, error } = await supabase
      .from("laborer_expenses")
      .insert({
        tenant_id: tenantId,
        laborer_id: formData.laborer_id || null,
        work: formData.work.trim(),
        from_date: formData.from_date,
        to_date: formData.to_date,
        days: formData.days || calculateDays(formData.from_date, formData.to_date),
        amount: Number(formData.amount),
        bank_account_id: formData.bank_account_id || null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    result = data;
  }

  revalidateAll();
  return result;
}

export async function updateLaborerExpense(
  id: string,
  formData: {
    laborer_id?: string;
    work: string;
    from_date: string;
    to_date: string;
    days: number;
    amount: number;
    bank_account_id?: string;
  }
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("laborer_expenses")
    .update({
      work: formData.work.trim(),
      from_date: formData.from_date,
      to_date: formData.to_date,
      days: formData.days || calculateDays(formData.from_date, formData.to_date),
      amount: Number(formData.amount),
      bank_account_id: formData.bank_account_id || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidateAll();
  return data;
}

export async function deleteLaborerExpense(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("laborer_expenses").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidateAll();
}
