"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function getCashDeposits(filters?: string | { forDate?: string; dateFrom?: string; dateTo?: string }) {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();
    let q = supabase
      .from("cash_deposits")
      .select("*")
      .order("deposit_date", { ascending: false });
    if (tenantId) q = q.eq("tenant_id", tenantId);
    if (typeof filters === "string") {
      q = q.eq("for_date", filters);
    } else if (filters) {
      if (filters.forDate) q = q.eq("for_date", filters.forDate);
      if (filters.dateFrom) q = q.gte("deposit_date", filters.dateFrom);
      if (filters.dateTo)   q = q.lte("deposit_date", filters.dateTo);
    }
    const { data, error } = await q;
    if (error) {
      console.error("[getCashDeposits] error:", error.message);
      return [];
    }
    return data || [];
  } catch (err: any) {
    console.error("[getCashDeposits] unexpected error:", err?.message ?? err);
    return [];
  }
}

export async function addDeposit(formData: {
  deposit_date: string;
  amount: number;
  description?: string;
  bank_account_id?: string;
  for_date?: string;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  const payload: any = {
    deposit_date: formData.deposit_date,
    amount: formData.amount,
    description: formData.description?.trim() || null,
    bank_account_id: formData.bank_account_id || null,
    for_date: formData.deposit_date,
    status: "deposited",
    ...(tenantId ? { tenant_id: tenantId } : {}),
  };

  const { data, error } = await supabase
    .from("cash_deposits")
    .insert(payload)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/cash-bank/deposits");
  revalidatePath("/tab4/deposits");
  return data;
}

export async function updateDeposit(
  id: string,
  formData: {
    deposit_date?: string;
    amount?: number;
    description?: string;
    bank_account_id?: string;
    for_date?: string;
  }
) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  const payload: any = { ...formData, status: "deposited" };
  let q = supabase.from("cash_deposits").update(payload).eq("id", id);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data, error } = await q.select().single();
  if (error) throw new Error(error.message);
  revalidatePath("/cash-bank/deposits");
  revalidatePath("/tab4/deposits");
  return data;
}

export async function deleteDeposit(id: string) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  let q = supabase.from("cash_deposits").delete().eq("id", id);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { error } = await q;
  if (error) throw new Error(error.message);
  revalidatePath("/cash-bank/deposits");
  revalidatePath("/tab4/deposits");
}

// --------------------------------------------------------------------------
// DAILY SUMMARY (Tab 4 Page 1)
// --------------------------------------------------------------------------
export async function getDailySummary(date?: string) {
  try {
    const supabase = await createClient();
    const targetDate = date || new Date().toISOString().split("T")[0];

    // Get route assignments for the date
    const { data: routes, error: routesError } = await supabase
      .from("route_assignments")
      .select(
        `
      id, dm_id, route_name, assignment_date, status,
      employee:employees(full_name)
    `
      )
      .eq("assignment_date", targetDate);

    if (routesError) {
      console.error("[getDailySummary] routes error:", routesError.message);
      return [];
    }

    // Get invoices for the same date
    const { data: invoices, error: invoicesError } = await supabase
      .from("invoices")
      .select(
        `
      id, invoice_no, invoice_type, grand_total, amount_received, delivery_status, visit_status, reason, dm_id, scheduled_date, shop:shops(shop_name)
    `
      )
      .eq("scheduled_date", targetDate);

    if (invoicesError) {
      console.error("[getDailySummary] invoices error:", invoicesError.message);
      return [];
    }

    // Group invoices by dm_id and match with route assignments
    const invoicesByDm = (invoices || []).reduce((acc: any, inv: any) => {
      if (!acc[inv.dm_id]) acc[inv.dm_id] = [];
      acc[inv.dm_id].push(inv);
      return acc;
    }, {});

    return (routes || []).map((r: any) => {
      const dmInvoices = invoicesByDm[r.dm_id] || [];
      const cashInvoices = dmInvoices.filter(
        (i: any) => i.invoice_type === "cash"
      );
      const expected = cashInvoices.reduce(
        (s: number, i: any) => s + (i.grand_total || 0),
        0
      );
      const submitted = cashInvoices.reduce(
        (s: number, i: any) => s + (i.amount_received || 0),
        0
      );
      return {
        id: r.id,
        date: r.assignment_date,
        dm_name: r.employee?.full_name || "—",
        dm_id: r.dm_id,
        route: r.route_name,
        cash_invoice_count: cashInvoices.length,
        expected,
        submitted,
        difference: expected - submitted,
        status: expected - submitted > 0 ? "SHORTFALL" : "OK",
        invoices: dmInvoices || [],
      };
    });
  } catch (err: any) {
    console.error("[getDailySummary] unexpected error:", err?.message ?? err);
    return [];
  }
}

export async function getDrillDownInvoices(routeAssignmentId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, invoice_no, shop:shops(shop_name), invoice_type, grand_total, visit_status, delivery_status, reason, amount_received"
    )
    .eq("route_assignment_id", routeAssignmentId)
    .order("invoice_no");
  if (error) throw new Error(error.message);
  return data || [];
}

export async function updateInvoiceDelivery(
  id: string,
  formData: {
    visit_status?: string;
    delivery_status?: string;
    reason?: string | null;   // null = explicitly clear it, undefined = don't touch it
    amount_received?: number;
  }
) {
  const supabase = await createClient();

  // Build payload explicitly so that null values are included in the UPDATE
  // (spreading formData would drop undefined keys and miss null ones from TS perspective)
  const payload: Record<string, unknown> = {};
  if (formData.visit_status !== undefined)    payload.visit_status    = formData.visit_status;
  if (formData.delivery_status !== undefined) payload.delivery_status = formData.delivery_status;
  if (formData.amount_received !== undefined) payload.amount_received = formData.amount_received;
  // reason must always be included when provided so NULL writes to the DB
  if ("reason" in formData)                   payload.reason          = formData.reason ?? null;

  // Auto-clear reason if marked as delivered
  if (payload.delivery_status === "delivered") {
    payload.reason = null;
  }

  const { data, error } = await supabase
    .from("invoices")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/tab4/daily-summary");
  return data;
}

export async function deleteInvoiceFromSummary(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/tab4/daily-summary");
}

// --------------------------------------------------------------------------
// RECONCILIATION (Tab 4 Page 3)
// --------------------------------------------------------------------------
export async function getReconciliation(date?: string) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  const targetDate = date || new Date().toISOString().split("T")[0];
  const weekStart = new Date(targetDate);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const monthStart = targetDate.substring(0, 7) + "-01";
  const weekStartStr = weekStart.toISOString().split("T")[0];

  const inv = (q: any) => tenantId ? q.eq("tenant_id", tenantId) : q;
  const dep = (q: any) => tenantId ? q.eq("tenant_id", tenantId) : q;

  const [
    cashInvDay,   cashInvWeek,   cashInvMonth,
    creditInvDay, creditInvWeek, creditInvMonth,
    depDay,       depWeek,       depMonth,
  ] = await Promise.all([
    inv(supabase.from("invoices").select("grand_total")
      .eq("invoice_type", "cash").eq("delivery_status", "delivered")
      .gte("scheduled_date", targetDate).lte("scheduled_date", targetDate)),
    inv(supabase.from("invoices").select("grand_total")
      .eq("invoice_type", "cash").eq("delivery_status", "delivered")
      .gte("scheduled_date", weekStartStr).lte("scheduled_date", targetDate)),
    inv(supabase.from("invoices").select("grand_total")
      .eq("invoice_type", "cash").eq("delivery_status", "delivered")
      .gte("scheduled_date", monthStart).lte("scheduled_date", targetDate)),

    inv(supabase.from("invoices").select("amount_received")
      .eq("invoice_type", "credit").eq("delivery_status", "delivered")
      .gt("amount_received", 0)
      .gte("scheduled_date", targetDate).lte("scheduled_date", targetDate)),
    inv(supabase.from("invoices").select("amount_received")
      .eq("invoice_type", "credit").eq("delivery_status", "delivered")
      .gt("amount_received", 0)
      .gte("scheduled_date", weekStartStr).lte("scheduled_date", targetDate)),
    inv(supabase.from("invoices").select("amount_received")
      .eq("invoice_type", "credit").eq("delivery_status", "delivered")
      .gt("amount_received", 0)
      .gte("scheduled_date", monthStart).lte("scheduled_date", targetDate)),

    dep(supabase.from("cash_deposits").select("amount")
      .eq("status", "deposited").eq("for_date", targetDate)),
    dep(supabase.from("cash_deposits").select("amount")
      .eq("status", "deposited")
      .gte("for_date", weekStartStr).lte("for_date", targetDate)),
    dep(supabase.from("cash_deposits").select("amount")
      .eq("status", "deposited")
      .gte("for_date", monthStart).lte("for_date", targetDate)),
  ]);

  const sumField = (rows: any[] | null, field: string) =>
    (rows || []).reduce((s: number, r: any) => s + (Number(r[field]) || 0), 0);

  const collectedDay   = sumField(cashInvDay.data,   "grand_total")   + sumField(creditInvDay.data,   "amount_received");
  const collectedWeek  = sumField(cashInvWeek.data,  "grand_total")   + sumField(creditInvWeek.data,  "amount_received");
  const collectedMonth = sumField(cashInvMonth.data, "grand_total")   + sumField(creditInvMonth.data, "amount_received");
  const bankDay        = sumField(depDay.data,   "amount");
  const bankWeek       = sumField(depWeek.data,  "amount");
  const bankMonth      = sumField(depMonth.data, "amount");

  return [
    {
      step:      "Cash Collected",
      date:      collectedDay,
      this_week: collectedWeek,
      month:     collectedMonth,
      gap:       null,
      status:    null,
    },
    {
      step:      "Bank Deposited",
      date:      bankDay,
      this_week: bankWeek,
      month:     bankMonth,
      gap:       collectedMonth - bankMonth,
      status:    collectedMonth - bankMonth > 0 ? "SHORTFALL" : "OK",
    },
  ];
}


export async function deleteDeposits(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const tenantId = await getTenantId();
  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    let q = supabase.from("cash_deposits").delete().in("id", chunk);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { error } = await q;
    if (error) throw new Error(error.message);
  }
  revalidatePath("/cash-bank/deposits");
  revalidatePath("/tab4/deposits");
}