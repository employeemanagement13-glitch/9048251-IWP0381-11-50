"use server";

import { createClient, createAdminClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { ensureOverdueAlerts } from "@/lib/actions/alerts";

export interface ShopFormData {
  outlet_code?: string;
  shop_name?: string;
  owner_name?: string;
  phone?: string;
  shop_type?: "cash" | "credit";
  credit_limit?: number;
  credit_terms_days?: number;
  is_filer?: boolean;
  address?: string;
  main_channel_desc?: string;
  preseller_name?: string;
  segment_desc?: string;
  status?: string;
  tax_number?: string;
  sub_trade_channel?: string;
  trade_channel?: string;
  gps?: string;
  open_date?: string;
  filer_status?: string;
  outlet_type?: string;
}

// --------------------------------------------------------------------------
// LIST SHOPS
// --------------------------------------------------------------------------
export async function getShops(filters?: { search?: string; type?: "cash" | "credit" | "" }) {
  try {
    const supabase = await createClient();
    const PAGE_SIZE = 1000;
    let allShops: any[] = [];
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      let query = supabase
        .from("shops")
        .select("*")
        .order("shop_name")
        .range(from, from + PAGE_SIZE - 1);

      if (filters?.type) {
        query = query.eq("shop_type", filters.type);
      }

      const { data, error } = await query;
      if (error) {
        console.error("[getShops] error:", error.message);
        break;
      }

      if (data && data.length > 0) {
        allShops.push(...data);
        if (data.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          from += PAGE_SIZE;
        }
      } else {
        hasMore = false;
      }
    }

    if (filters?.search && allShops.length > 0) {
      const s = filters.search.toLowerCase();
      return allShops.filter(
        (shop) =>
          shop.shop_name?.toLowerCase().includes(s) ||
          shop.outlet_code?.toLowerCase().includes(s) ||
          shop.owner_name?.toLowerCase().includes(s) ||
          shop.phone?.toLowerCase().includes(s) ||
          shop.address?.toLowerCase().includes(s) ||
          shop.main_channel_desc?.toLowerCase().includes(s) ||
          shop.preseller_name?.toLowerCase().includes(s) ||
          shop.segment_desc?.toLowerCase().includes(s) ||
          shop.status?.toLowerCase().includes(s) ||
          shop.tax_number?.toLowerCase().includes(s) ||
          shop.sub_trade_channel?.toLowerCase().includes(s) ||
          shop.trade_channel?.toLowerCase().includes(s) ||
          shop.gps?.toLowerCase().includes(s) ||
          shop.open_date?.toLowerCase().includes(s) ||
          shop.filer_status?.toLowerCase().includes(s) ||
          shop.outlet_type?.toLowerCase().includes(s)
      );
    }

    return allShops;
  } catch (err: any) {
    console.error("[getShops] unexpected error:", err?.message ?? err);
    return [];
  }
}

// --------------------------------------------------------------------------
// SHOP DETAILS BY ID
// --------------------------------------------------------------------------
export async function getShopById(id: string) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("shops").select("*").eq("id", id).single();
    if (error) {
      console.error("[getShopById] error:", error.message);
      return null;
    }
    return data;
  } catch (err: any) {
    console.error("[getShopById] unexpected error:", err?.message ?? err);
    return null;
  }
}

// --------------------------------------------------------------------------
// BLOCKED ACCOUNTS LIST
// --------------------------------------------------------------------------
export async function getBlockedShops() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("blocked_shops").select("*");
    if (error) {
      console.error("[getBlockedShops] error:", error.message);
      return [];
    }
    return data || [];
  } catch (err: any) {
    console.error("[getBlockedShops] unexpected error:", err?.message ?? err);
    return [];
  }
}

// --------------------------------------------------------------------------
// BLOCK SHOP
// --------------------------------------------------------------------------
export async function blockShop(id: string, reason: string) {
  if (!reason.trim()) throw new Error("A reason is required to block a shop.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shops")
    .update({
      is_blocked: true,
      block_reason: reason,
      blocked_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/tab2/credit");
  revalidatePath("/tab2/blocked");
  return data;
}

// --------------------------------------------------------------------------
// UNBLOCK SHOP
// --------------------------------------------------------------------------
export async function unblockShop(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shops")
    .update({
      is_blocked: false,
      block_reason: null,
      blocked_at: null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/tab2/credit");
  revalidatePath("/tab2/blocked");
  return data;
}

// --------------------------------------------------------------------------
// CREATE / UPDATE SHOP
// --------------------------------------------------------------------------
export async function createShop(formData: Partial<ShopFormData>) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const payload: any = {
    tenant_id: tenantId,
    outlet_code: (formData.outlet_code || "").trim() || `OUT-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`,
    shop_name: (formData.shop_name || "").trim(),
    owner_name: (formData.owner_name || "").trim() || null,
    phone: (formData.phone || "").trim(),
    is_filer: formData.filer_status ? formData.filer_status === "Yes" : !!formData.is_filer,
    shop_type: (formData.outlet_type || "").toLowerCase() === "credit" || formData.shop_type === "credit" ? "credit" : "cash",
    credit_limit: formData.credit_limit ?? 0,
    credit_terms_days: formData.credit_terms_days ?? 0,
    address: (formData.address || "").trim() || null,
    main_channel_desc: (formData.main_channel_desc || "").trim() || null,
    preseller_name: (formData.preseller_name || "").trim() || null,
    segment_desc: (formData.segment_desc || "").trim() || null,
    status: (formData.status || "Active").trim(),
    tax_number: (formData.tax_number || "").trim() || null,
    sub_trade_channel: (formData.sub_trade_channel || "").trim() || null,
    trade_channel: (formData.trade_channel || "").trim() || null,
    gps: (formData.gps || "").trim() || null,
    open_date: (formData.open_date || "").trim() || null,
    filer_status: formData.filer_status || (formData.is_filer ? "Yes" : "No"),
    outlet_type: (formData.outlet_type || "").trim() || null,
  };

  let { data, error } = await supabase
    .from("shops")
    .insert(payload)
    .select()
    .single();

  if (error) {
    const fallbackPayload: Record<string, any> = { ...payload };
    delete fallbackPayload.address;
    delete fallbackPayload.main_channel_desc;
    delete fallbackPayload.preseller_name;
    delete fallbackPayload.segment_desc;
    delete fallbackPayload.status;
    delete fallbackPayload.tax_number;
    delete fallbackPayload.sub_trade_channel;
    delete fallbackPayload.trade_channel;
    delete fallbackPayload.gps;
    delete fallbackPayload.open_date;
    delete fallbackPayload.filer_status;
    delete fallbackPayload.outlet_type;
    const retry = await supabase.from("shops").insert(fallbackPayload).select().single();
    if (retry.error) throw new Error(retry.error.message);
    data = retry.data;
  }

  revalidatePath("/tab2/credit");
  revalidatePath("/shop-details");
  return data;
}

export async function updateShop(id: string, formData: Partial<ShopFormData>) {
  const supabase = await createClient();
  const payload: any = {};
  if (formData.outlet_code !== undefined) payload.outlet_code = (formData.outlet_code || "").trim();
  if (formData.shop_name !== undefined) payload.shop_name = (formData.shop_name || "").trim();
  if (formData.owner_name !== undefined) payload.owner_name = (formData.owner_name || "").trim() || null;
  if (formData.phone !== undefined) payload.phone = (formData.phone || "").trim();
  if (formData.shop_type !== undefined) payload.shop_type = formData.shop_type;
  if (formData.credit_limit !== undefined) payload.credit_limit = formData.credit_limit;
  if (formData.credit_terms_days !== undefined) payload.credit_terms_days = formData.credit_terms_days;
  if (formData.address !== undefined) payload.address = (formData.address || "").trim() || null;
  if (formData.main_channel_desc !== undefined) payload.main_channel_desc = (formData.main_channel_desc || "").trim() || null;
  if (formData.preseller_name !== undefined) payload.preseller_name = (formData.preseller_name || "").trim() || null;
  if (formData.segment_desc !== undefined) payload.segment_desc = (formData.segment_desc || "").trim() || null;
  if (formData.status !== undefined) payload.status = (formData.status || "Active").trim();
  if (formData.tax_number !== undefined) payload.tax_number = (formData.tax_number || "").trim() || null;
  if (formData.sub_trade_channel !== undefined) payload.sub_trade_channel = (formData.sub_trade_channel || "").trim() || null;
  if (formData.trade_channel !== undefined) payload.trade_channel = (formData.trade_channel || "").trim() || null;
  if (formData.gps !== undefined) payload.gps = (formData.gps || "").trim() || null;
  if (formData.open_date !== undefined) payload.open_date = (formData.open_date || "").trim() || null;
  if (formData.outlet_type !== undefined) {
    payload.outlet_type = (formData.outlet_type || "").trim() || null;
    if (payload.outlet_type) {
      payload.shop_type = payload.outlet_type.toLowerCase() === "credit" ? "credit" : "cash";
    }
  }
  if (formData.filer_status !== undefined) {
    payload.filer_status = formData.filer_status;
    payload.is_filer = formData.filer_status === "Yes";
  } else if (formData.is_filer !== undefined) {
    payload.is_filer = !!formData.is_filer;
    payload.filer_status = formData.is_filer ? "Yes" : "No";
  }

  let { data, error } = await supabase
    .from("shops")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    const fallbackPayload: Record<string, any> = { ...payload };
    delete fallbackPayload.address;
    delete fallbackPayload.main_channel_desc;
    delete fallbackPayload.preseller_name;
    delete fallbackPayload.segment_desc;
    delete fallbackPayload.status;
    delete fallbackPayload.tax_number;
    delete fallbackPayload.sub_trade_channel;
    delete fallbackPayload.trade_channel;
    delete fallbackPayload.gps;
    delete fallbackPayload.open_date;
    delete fallbackPayload.filer_status;
    delete fallbackPayload.outlet_type;
    const retry = await supabase.from("shops").update(fallbackPayload).eq("id", id).select().single();
    if (retry.error) throw new Error(retry.error.message);
    data = retry.data;
  }

  revalidatePath("/tab2/credit");
  revalidatePath("/shop-details");
  return data;
}

async function cleanupDependentShopData(supabase: any, shopIds: string[]) {
  if (!shopIds.length) return;
  try {
    // 1. Invoices for these shops
    const { data: invs } = await supabase.from("invoices").select("id").in("shop_id", shopIds);
    const invIds = (invs || []).map((r: any) => r.id);
    if (invIds.length > 0) {
      await supabase.from("invoice_line_items").delete().in("invoice_id", invIds);
      await supabase.from("invoice_returns").delete().in("invoice_id", invIds);
      await supabase.from("late_deliveries").delete().in("invoice_id", invIds);
      await supabase.from("shop_payments").delete().in("invoice_id", invIds);
      await supabase.from("invoices").delete().in("id", invIds);
    }

    // 2. Leased empties for these shops
    const { data: leases } = await supabase.from("leased_empties").select("id").in("shop_id", shopIds);
    const leaseIds = (leases || []).map((r: any) => r.id);
    if (leaseIds.length > 0) {
      await supabase.from("leased_empty_items").delete().in("lease_id", leaseIds);
      await supabase.from("leased_empties").delete().in("id", leaseIds);
    }

    // 3. Direct references to shop_id
    await supabase.from("late_deliveries").delete().in("shop_id", shopIds);
    await supabase.from("shop_payments").delete().in("shop_id", shopIds);
    await supabase.from("discount_configs").delete().in("shop_id", shopIds);
    try {
      await supabase.from("empties_log").delete().in("shop_id", shopIds);
    } catch {}
  } catch (err: any) {
    console.error("[cleanupDependentShopData]", err?.message);
  }
}

export async function deleteShop(id: string) {
  const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : await createClient();
  await cleanupDependentShopData(supabase, [id]);
  const { error } = await supabase.from("shops").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/tab2/credit");
  revalidatePath("/shop-details");
}

export async function deleteShops(ids: string[]) {
  if (!ids.length) return;
  const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : await createClient();
  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    await cleanupDependentShopData(supabase, chunk);
    const { error } = await supabase.from("shops").delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/tab2/credit");
  revalidatePath("/shop-details");
}

// --------------------------------------------------------------------------
// RECORD PAYMENT (Record payment per row)
// Increments amount_received on a credit invoice.
// --------------------------------------------------------------------------
export async function recordShopPayment(
  invoiceId: string,
  amount: number,
  description?: string,
  bankAccountId?: string,
  paymentDate?: string
) {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");
  const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : await createClient();

  const { data: invoice, error: getErr } = await supabase
    .from("invoices")
    .select("amount_received, grand_total, amount, shop_id")
    .eq("id", invoiceId)
    .single();

  if (getErr) throw new Error(getErr.message);

  const newAmount = Number(invoice.amount_received || 0) + amount;

  const { data, error } = await supabase
    .from("invoices")
    .update({ amount_received: newAmount })
    .eq("id", invoiceId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  const finalPaymentDate = paymentDate || new Date().toISOString().split("T")[0];

  const { error: payErr } = await supabase.from("shop_payments").insert({
    tenant_id: tenantId,
    shop_id: invoice.shop_id,
    invoice_id: invoiceId,
    bank_account_id: bankAccountId || null,
    amount,
    description: description || null,
    payment_date: finalPaymentDate,
  });

  if (payErr) throw new Error(`shop_payments insert failed: ${payErr.message}. Run the DB migration mdos_v32_shop_payments.sql in Supabase first.`);

  if (invoice?.shop_id) {
    revalidatePath(`/shop-details/${invoice.shop_id}`);
  }
  revalidatePath("/shop-details/[id]", "page");
  revalidatePath("/shop-details");
  revalidatePath("/tab2/credit");
  revalidatePath("/cash-bank/bank-accounts");
  try { await ensureOverdueAlerts(); } catch {}
  return data;
}

export async function updateInvoiceType(
  invoiceId: string,
  newType: "cash" | "credit",
  paid: number
) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("No tenant");

  const { data: invoice, error: fetchErr } = await supabase
    .from("invoices")
    .select("id, shop_id, invoice_no")
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .single();
  if (fetchErr || !invoice) throw new Error(fetchErr?.message || "Invoice not found");

  const { error: updateErr } = await supabase
    .from("invoices")
    .update({ invoice_type: newType, amount_received: paid })
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId);
  if (updateErr) throw new Error(updateErr.message);

  // Clean up any legacy "Initial payment on type change" rows in shop_payments for this invoice
  await supabase
    .from("shop_payments")
    .delete()
    .eq("invoice_id", invoiceId)
    .eq("description", "Initial payment on type change");

  if (invoice?.shop_id) {
    revalidatePath(`/shop-details/${invoice.shop_id}`);
  }
  revalidatePath("/shop-details/[id]", "page");
  revalidatePath("/shop-details");
  revalidatePath("/tab2/credit");
  revalidatePath("/reports/financial");
  revalidatePath("/income/statement");
  try { await ensureOverdueAlerts(); } catch {}
}

export async function getAllShopPayments() {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    const { data, error } = await supabase
      .from("shop_payments")
      .select("id, shop_id, invoice_id, amount, payment_date, created_at")
      .eq("tenant_id", tenantId)
      .order("payment_date", { ascending: false });

    if (error) {
      console.error("[getAllShopPayments] error:", error.message);
      return [];
    }
    return data || [];
  } catch (err: any) {
    console.error("[getAllShopPayments] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getShopLedger(shopId: string, fromDate?: string, toDate?: string) {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();

    const { data: shopRow } = await supabase
      .from("shops")
      .select("id, outlet_code")
      .eq("id", shopId)
      .maybeSingle();
    const outletCode = (shopRow?.outlet_code || "").trim();

    // Match invoices the same way as the shop Invoices tab: shop_id OR outlet_code.
    // Page past PostgREST's 1000-row default so large shops are complete.
    const PAGE = 1000;
    const invoiceRows: any[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = supabase
        .from("invoices")
        .select(
          "id, invoice_no, scheduled_date, record_date, delivery_date, invoice_date, invoice_type, amount, invoice_total, grand_total, amount_received, shop_id, outlet_code"
        )
        .order("scheduled_date", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (tenantId) q = q.eq("tenant_id", tenantId);
      if (outletCode) {
        q = q.or(`shop_id.eq.${shopId},outlet_code.eq.${outletCode}`);
      } else {
        q = q.eq("shop_id", shopId);
      }
      const { data, error } = await q;
      if (error) {
        console.error("[getShopLedger] invoices error:", error.message);
        break;
      }
      const rows = data || [];
      invoiceRows.push(...rows);
      if (rows.length < PAGE) break;
    }
    const invById = new Map<string, any>();
    for (const inv of invoiceRows) {
      if (inv?.id) invById.set(inv.id, inv);
    }
    const invoices = Array.from(invById.values());

    const paymentsRes = await supabase
      .from("shop_payments")
      .select(
        "id, invoice_id, amount, payment_date, description, bank_account:bank_accounts(bank_name, account_title), invoice:invoices(invoice_no)"
      )
      .eq("shop_id", shopId)
      .order("payment_date", { ascending: true });

    const rawPayments = paymentsRes.data || [];

    // Filter out any legacy "Initial payment on type change" rows
    const payments = rawPayments.filter(
      (p: any) => p.description !== "Initial payment on type change"
    );

    // Sum actual payments recorded in shop_payments for each invoice
    const actualPaymentsByInvoice: Record<string, number> = {};
    payments.forEach((p: any) => {
      if (p.invoice_id) {
        actualPaymentsByInvoice[p.invoice_id] =
          (actualPaymentsByInvoice[p.invoice_id] || 0) + Number(p.amount || 0);
      }
    });

    const entries: any[] = [];

    invoices.forEach((inv) => {
      const isCredit = inv.invoice_type === "credit";
      const invoiceAmt = Number(inv.amount ?? inv.invoice_total ?? inv.grand_total ?? 0);
      const invDate = inv.scheduled_date || inv.record_date || inv.delivery_date || inv.invoice_date || "";

      let creditAmount = invoiceAmt;
      if (isCredit) {
        const actualPayments = actualPaymentsByInvoice[inv.id] || 0;
        const initialPaid = Math.max(0, Number(inv.amount_received || 0) - actualPayments);
        creditAmount = Math.max(0, invoiceAmt - initialPaid);
      }

      entries.push({
        id: `inv-${inv.id}`,
        date: invDate,
        voucher_no: inv.invoice_no,
        description: isCredit ? "Credit Sale" : "Cash Sale",
        debit: 0,
        credit: creditAmount,
        affects_balance: isCredit,
        created_at: invDate + "T00:00:00",
      });
    });

    payments.forEach((p: any) => {
      const bankLabel = p.bank_account
        ? `${p.bank_account.bank_name} (${p.bank_account.account_title})`
        : "";
      entries.push({
        id: `pay-${p.id}`,
        date: p.payment_date,
        voucher_no: p.invoice?.invoice_no ? `REC/${p.invoice.invoice_no}` : "REC/PAYMENT",
        description: [p.description || "Online Rec", bankLabel].filter(Boolean).join(" - "),
        debit: Number(p.amount || 0),
        credit: 0,
        affects_balance: true,
        created_at: p.payment_date + "T12:00:00",
      });
    });

    entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    let running = 0;
    const computed = entries.map((e) => {
      if (e.affects_balance) {
        running = running + e.credit - e.debit;
      }
      const rounded = Math.round(running * 100) / 100;
      return { ...e, balance: Math.abs(rounded) < 0.001 ? 0 : rounded };
    });

    if (fromDate || toDate) {
      return computed.filter((e) => {
        if (fromDate && e.date < fromDate) return false;
        if (toDate && e.date > toDate) return false;
        return true;
      });
    }

    return computed;
  } catch (err: any) {
    console.error("[getShopLedger] error:", err?.message ?? err);
    return [];
  }
}

export async function getShopInvoices(shopId: string, filters?: { year?: string; month?: string; type?: "cash" | "credit" | "" }) {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("invoices")
      .select(`
        *,
        dm:employees!invoices_dm_id_fkey(full_name),
        preseller:employees!invoices_preseller_id_fkey(full_name)
      `)
      .eq("shop_id", shopId)
      .order("scheduled_date", { ascending: false });

    if (filters?.type) {
      query = query.eq("invoice_type", filters.type);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[getShopInvoices] error:", error.message);
      return [];
    }

    let result = data || [];
    if (filters?.year) {
      result = result.filter((inv) => inv.scheduled_date.startsWith(filters.year!));
    }
    if (filters?.month) {
      result = result.filter((inv) => inv.scheduled_date.split("-")[1] === filters.month);
    }

    return result;
  } catch (err: any) {
    console.error("[getShopInvoices] unexpected error:", err?.message ?? err);
    return [];
  }
}

// --------------------------------------------------------------------------
// BULK IMPORT SHOPS [matched on outlet_code]
// --------------------------------------------------------------------------
export async function bulkImportShops(shopsList: Partial<ShopFormData>[]) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const BATCH_SIZE = 100;
  const insertedData: any[] = [];

  for (let i = 0; i < shopsList.length; i += BATCH_SIZE) {
    const chunk = shopsList.slice(i, i + BATCH_SIZE);
    const shopsWithTenant = chunk.map((shop, idx) => ({
      tenant_id: tenantId,
      outlet_code: (shop.outlet_code || "").toString().trim() || `OUT-${Date.now().toString().slice(-6)}-${i + idx}`,
      shop_name: (shop.shop_name || "").toString().trim(),
      owner_name: (shop.owner_name || "").toString().trim() || null,
      phone: (shop.phone || "").toString().trim(),
      is_filer: !!shop.is_filer,
      shop_type: shop.shop_type || "cash",
      credit_limit: shop.credit_limit ?? 0,
      credit_terms_days: shop.credit_terms_days ?? 0,
      address: (shop.address || "").toString().trim() || null,
      main_channel_desc: (shop.main_channel_desc || "").toString().trim() || null,
      preseller_name: (shop.preseller_name || "").toString().trim() || null,
      segment_desc: (shop.segment_desc || "").toString().trim() || null,
    }));

    let { data, error } = await supabase
      .from("shops")
      .upsert(shopsWithTenant, { onConflict: "tenant_id,outlet_code" })
      .select();

    if (error && (error.message.includes("address") || error.message.includes("main_channel_desc") || error.message.includes("preseller_name") || error.message.includes("segment_desc"))) {
      const fallbackList = shopsWithTenant.map((s) => {
        const copy: Record<string, any> = { ...s };
        delete copy.address;
        delete copy.main_channel_desc;
        delete copy.preseller_name;
        delete copy.segment_desc;
        return copy;
      });
      const retry = await supabase.from("shops").upsert(fallbackList, { onConflict: "tenant_id,outlet_code" }).select();
      if (retry.error) throw new Error(retry.error.message);
      if (retry.data) insertedData.push(...retry.data);
    } else if (error) {
      throw new Error(error.message);
    } else if (data) {
      insertedData.push(...data);
    }
  }

  revalidatePath("/tab2/credit");
  revalidatePath("/shop-details");
  return insertedData;
}

// --------------------------------------------------------------------------
// 1. BULK IMPORT OUTLETS [From Outlets Reports.xlsx]
// --------------------------------------------------------------------------
export async function bulkImportOutlets(outletsList: Partial<ShopFormData>[]) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const BATCH_SIZE = 100;
  const insertedData: any[] = [];

  for (let i = 0; i < outletsList.length; i += BATCH_SIZE) {
    const chunk = outletsList.slice(i, i + BATCH_SIZE);
    const shopsWithTenant = chunk.map((shop, idx) => ({
      tenant_id: tenantId,
      outlet_code: (shop.outlet_code || "").toString().trim() || `OUT-${Date.now().toString().slice(-6)}-${i + idx}`,
      shop_name: (shop.shop_name || "").toString().trim(),
      owner_name: (shop.owner_name || "").toString().trim() || null,
      phone: (shop.phone || "").toString().trim(),
      status: (shop.status || "Active").toString().trim(),
      tax_number: (shop.tax_number || "").toString().trim() || null,
      sub_trade_channel: (shop.sub_trade_channel || "").toString().trim() || null,
      trade_channel: (shop.trade_channel || "").toString().trim() || null,
      gps: (shop.gps || "").toString().trim() || null,
      open_date: (shop.open_date || "").toString().trim() || null,
      is_filer: shop.filer_status ? shop.filer_status === "Yes" : !!shop.is_filer,
      filer_status: shop.filer_status || (shop.is_filer ? "Yes" : "No"),
      outlet_type: (shop.outlet_type || "").toString().trim() || null,
      shop_type: (shop.outlet_type || "").toString().toLowerCase() === "credit" || shop.shop_type === "credit" ? "credit" : "cash",
      credit_limit: shop.credit_limit ?? 0,
      credit_terms_days: shop.credit_terms_days ?? 0,
    }));

    let { data, error } = await supabase
      .from("shops")
      .upsert(shopsWithTenant, { onConflict: "tenant_id,outlet_code" })
      .select();

    if (error) {
      const fallbackList = shopsWithTenant.map((s) => {
        const copy: Record<string, any> = { ...s };
        delete copy.status;
        delete copy.tax_number;
        delete copy.sub_trade_channel;
        delete copy.trade_channel;
        delete copy.gps;
        delete copy.open_date;
        delete copy.filer_status;
        delete copy.outlet_type;
        return copy;
      });
      const retry = await supabase.from("shops").upsert(fallbackList, { onConflict: "tenant_id,outlet_code" }).select();
      if (retry.error) throw new Error(retry.error.message);
      if (retry.data) insertedData.push(...retry.data);
    } else if (data) {
      insertedData.push(...data);
    }
  }

  revalidatePath("/tab2/credit");
  revalidatePath("/shop-details");
  return insertedData;
}

// --------------------------------------------------------------------------
// 2. BULK IMPORT TRADE OUTLETS [From Outlet Trade.xlsx]
// --------------------------------------------------------------------------
export async function bulkImportTradeOutlets(tradeList: {
  outlet_code: string;
  outlet_name?: string;
  address?: string;
  main_channel_desc?: string;
  preseller_name?: string;
  segment_desc?: string;
  phone?: string;
  outlet_type?: string;
}[]) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  if (!tradeList || tradeList.length === 0) return { updated: 0 };

  // 1. Fetch ALL existing shops for tenant in paginated chunks (no 1,000 row ceiling)
  const existingMap = new Map<string, any>();
  const FETCH_PAGE_SIZE = 1000;
  let from = 0;

  while (true) {
    const { data: chunkShops, error: fetchErr } = await supabase
      .from("shops")
      .select("id, outlet_code, shop_name, shop_type, outlet_type, address, main_channel_desc, preseller_name, segment_desc, phone")
      .eq("tenant_id", tenantId)
      .range(from, from + FETCH_PAGE_SIZE - 1);

    if (fetchErr) {
      console.error("[bulkImportTradeOutlets] fetch error:", fetchErr.message);
      throw new Error(fetchErr.message);
    }
    if (!chunkShops || chunkShops.length === 0) break;

    for (const s of chunkShops) {
      if (s.outlet_code) {
        const raw = String(s.outlet_code).trim();
        existingMap.set(raw.toLowerCase(), s);
        existingMap.set(raw.toUpperCase(), s);
        const noZeros = raw.replace(/^0+/, "");
        if (noZeros) {
          existingMap.set(noZeros.toLowerCase(), s);
          existingMap.set(noZeros.toUpperCase(), s);
        }
        const numericOnly = raw.replace(/\D/g, "");
        if (numericOnly && numericOnly !== raw) {
          existingMap.set(numericOnly, s);
          const numNoZeros = numericOnly.replace(/^0+/, "");
          if (numNoZeros) existingMap.set(numNoZeros, s);
        }
      }
    }

    if (chunkShops.length < FETCH_PAGE_SIZE) break;
    from += FETCH_PAGE_SIZE;
  }

  // 2. Prepare merged list (de-duplicated by outlet_code; later rows win)
  const mergedMap = new Map<string, any>();
  for (const item of tradeList) {
    const code = (item.outlet_code || "").toString().trim();
    if (!code) continue;
    const noZeros = code.replace(/^0+/, "");
    const numericOnly = code.replace(/\D/g, "");
    const numNoZeros = numericOnly.replace(/^0+/, "");
    const existing =
      existingMap.get(code.toLowerCase()) ||
      existingMap.get(code.toUpperCase()) ||
      (noZeros ? existingMap.get(noZeros.toLowerCase()) : null) ||
      (noZeros ? existingMap.get(noZeros.toUpperCase()) : null) ||
      (numericOnly ? existingMap.get(numericOnly) : null) ||
      (numNoZeros ? existingMap.get(numNoZeros) : null) ||
      null;

    const payload: any = {
      tenant_id: tenantId,
      outlet_code: existing?.outlet_code || code,
      shop_name: existing?.shop_name || item.outlet_name || `Outlet ${code}`,
      address: item.address !== undefined ? (item.address || "").toString().trim() || null : (existing?.address || null),
      main_channel_desc: item.main_channel_desc !== undefined ? (item.main_channel_desc || "").toString().trim() || null : (existing?.main_channel_desc || null),
      preseller_name: item.preseller_name !== undefined ? (item.preseller_name || "").toString().trim() || null : (existing?.preseller_name || null),
      segment_desc: item.segment_desc !== undefined ? (item.segment_desc || "").toString().trim() || null : (existing?.segment_desc || null),
      phone: item.phone !== undefined && item.phone !== "" ? (item.phone || "").toString().trim() : (existing?.phone || ""),
      outlet_type: item.outlet_type !== undefined && item.outlet_type !== "" ? (item.outlet_type || "").toString().trim() : (existing?.outlet_type || null),
      shop_type: item.outlet_type !== undefined && item.outlet_type !== ""
        ? (item.outlet_type.toLowerCase() === "credit" ? "credit" : "cash")
        : (existing?.shop_type || "cash"),
    };

    // NOTE: never send `id` here. Mixing rows that have an id with new rows that don't makes
    // PostgREST send id=NULL for the latter and the whole batch fails (not-null violation).
    // Rows are matched by the (tenant_id, outlet_code) unique key via onConflict instead.
    mergedMap.set(payload.outlet_code, payload);
  }
  const mergedList = Array.from(mergedMap.values());

  // 3. Upsert in batches of 500 (with per-row fallback so one bad row can't sink a batch)
  const BATCH_SIZE = 500;
  let updatedCount = 0;
  const failures: { outlet_code: string; error: string }[] = [];

  const upsertChunk = async (chunk: any[]) => {
    let { error } = await supabase.from("shops").upsert(chunk, { onConflict: "tenant_id,outlet_code" });
    if (error && error.message.includes("outlet_type")) {
      const fallbackChunk = chunk.map((s) => {
        const copy = { ...s };
        delete copy.outlet_type;
        return copy;
      });
      ({ error } = await supabase.from("shops").upsert(fallbackChunk, { onConflict: "tenant_id,outlet_code" }));
    }
    return error;
  };

  for (let i = 0; i < mergedList.length; i += BATCH_SIZE) {
    const chunk = mergedList.slice(i, i + BATCH_SIZE);
    const batchErr = await upsertChunk(chunk);
    if (!batchErr) {
      updatedCount += chunk.length;
      continue;
    }
    console.error("[bulkImportTradeOutlets] batch upsert error, retrying row-by-row:", batchErr.message);
    for (const row of chunk) {
      const rowErr = await upsertChunk([row]);
      if (rowErr) {
        failures.push({ outlet_code: row.outlet_code, error: rowErr.message });
        console.error("[bulkImportTradeOutlets] row failed:", row.outlet_code, rowErr.message);
      } else {
        updatedCount++;
      }
    }
  }

  revalidatePath("/tab2/credit");
  revalidatePath("/shop-details");
  return { updated: updatedCount, failed: failures.length, failures: failures.slice(0, 10) };
}

