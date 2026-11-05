"use server";

import { createClient, createAdminClient, getTenantId } from "@/lib/supabase/server";

export async function ensureOverdueAlerts(options?: {
  forceRefresh?: boolean;
  limitOverride?: number;
}) {
  const tenantId = await getTenantId();
  if (!tenantId) return;

  const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : await createClient();

  // 1. Fetch credit_invoices_limit from tenant_settings (default = 1)
  const { data: tenantSettings } = await supabase
    .from("tenant_settings")
    .select("credit_invoices_limit")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const creditInvoicesLimit = Math.max(
    1,
    Number(options?.limitOverride ?? tenantSettings?.credit_invoices_limit ?? 1)
  );

  // 2. Fetch ALL invoices for this tenant (page past PostgREST 1000-row cap).
  // Do not use .or(...amount_received.lt.invoice_total...) — PostgREST treats the
  // right-hand side as a literal, which errors on numeric columns and aborts generation.
  const PAGE = 1000;
  const invoices: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: invError } = await supabase
      .from("invoices")
      .select(
        "id, tenant_id, invoice_no, shop_id, outlet_code, outlet_name, outlet_type, invoice_type, amount, invoice_total, grand_total, amount_received, record_date, delivery_date, invoice_date, scheduled_date"
      )
      .eq("tenant_id", tenantId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);

    if (invError) {
      console.error("[ensureOverdueAlerts] invoice fetch error:", invError.message);
      return;
    }
    const rows = data || [];
    invoices.push(...rows);
    if (rows.length < PAGE) break;
  }

  // 3. Fetch shops first so invoices can be attached the same way as /tab2/credit:
  //    match shop_id OR outlet_code, and only credit shops get overdue alerts.
  const { data: shopRows } = await supabase
    .from("shops")
    .select("id, shop_name, outlet_code, shop_type, outlet_type")
    .eq("tenant_id", tenantId);

  const shopById = new Map<string, any>();
  const shopByOutlet = new Map<string, any>();
  const shopMap = new Map<string, any>();
  for (const s of shopRows || []) {
    shopById.set(s.id, s);
    shopMap.set(s.id, s);
    if (s.outlet_code) {
      shopByOutlet.set(s.outlet_code, s);
      shopMap.set(s.outlet_code, s);
    }
  }

  // Group unpaid credit invoices by resolved shop id (one pile per shop).
  // Using only `shop_id || outlet_code` as the key used to split one shop's bills
  // across two buckets and miss overdue alerts that Credit still showed.
  const shopCreditInvsMap = new Map<string, any[]>();
  for (const inv of invoices) {
    if ((inv.invoice_type || "").toLowerCase() !== "credit") continue;
    const total = Number(inv.amount ?? inv.grand_total ?? inv.invoice_total ?? 0);
    const paid = Number(inv.amount_received || 0);
    const bal = total - paid;
    if (bal <= 0.01) continue;

    const shop =
      (inv.shop_id && shopById.get(inv.shop_id)) ||
      (inv.outlet_code && shopByOutlet.get(inv.outlet_code)) ||
      null;
    if (!shop) continue;

    const isCreditShop =
      (shop.shop_type || "").toLowerCase() === "credit" ||
      (shop.outlet_type || "").toLowerCase() === "credit";
    if (!isCreditShop) continue;

    const key = shop.id;
    if (!shopCreditInvsMap.has(key)) shopCreditInvsMap.set(key, []);
    shopCreditInvsMap.get(key)!.push({
      ...inv,
      balance: bal,
      date: inv.delivery_date || inv.invoice_date || inv.record_date || inv.scheduled_date || "",
    });
  }

  // 4. Fetch all existing overdue alerts for this tenant in ONE query (exclude System Restore alerts)
  const { data: existingAlertsRaw } = await supabase
    .from("alerts")
    .select("id, details, status, created_at, ref_id")
    .eq("tenant_id", tenantId)
    .eq("alert_type", "overdue_threshold");

  const existingAlerts = (existingAlertsRaw || []).filter(
    (a: any) => !a.details?.startsWith("Admin restored")
  );

  for (const [key, unpaidInvoices] of shopCreditInvsMap.entries()) {
    const shop = shopMap.get(key) || {
      id: key,
      shop_name: unpaidInvoices[0].outlet_name || `Shop ${key}`,
      outlet_code: unpaidInvoices[0].outlet_code || "",
    };

    // Prefer a real shop UUID for ref_id when the map key was an outlet_code
    const refId =
      shop.id && String(shop.id).length === 36
        ? shop.id
        : shopMap.get(unpaidInvoices[0]?.shop_id)?.id || shop.id;

    const isOverdue = unpaidInvoices.length > creditInvoicesLimit;

    // Find existing alert for this shop (match ref_id, outlet_code, or shop_name)
    const existing = (existingAlerts || []).filter(
      (a: any) =>
        (refId && a.ref_id === refId) ||
        (shop.id && a.ref_id === shop.id) ||
        (shop.outlet_code && a.details && a.details.includes(shop.outlet_code)) ||
        (shop.shop_name && a.details && a.details.includes(shop.shop_name))
    );
    existing.sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1));
    const prev = existing[0];

    if (!isOverdue) {
      // If the shop is safe and has an unread overdue alert, resolve it
      if (prev && prev.status === "unread") {
        const { error } = await supabase
          .from("alerts")
          .update({ status: "read" })
          .eq("id", prev.id);
        if (error) console.error("[ensureOverdueAlerts] mark read error:", error.message);
      }
      continue;
    }

    // Shop IS overdue — newest N are within limit; older unpaid bills are the overdue ones
    unpaidInvoices.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const overdueInvoices = unpaidInvoices.slice(0, Math.max(0, unpaidInvoices.length - creditInvoicesLimit));
    const overdueInvoiceNos = overdueInvoices.map((i) => i.invoice_no).filter(Boolean);
    const overdueBalance = overdueInvoices.reduce((acc, curr) => acc + curr.balance, 0);

    const invListStr = overdueInvoiceNos.join(", ");
    const details = `Outlet ${shop.shop_name} (${shop.outlet_code}) is overdue — exceeded credit invoices limit (${creditInvoicesLimit}). Unpaid previous invoice(s): ${invListStr} with overdue balance Rs.${overdueBalance.toLocaleString()}.`;

    if (prev && prev.status === "unread") {
      // Update unread alert details with current limit and balance
      if (prev.details !== details) {
        const { error } = await supabase
          .from("alerts")
          .update({
            details,
            severity: "HIGH",
            ref_table: "shops",
            ref_id: refId,
          })
          .eq("id", prev.id);
        if (error) console.error("[ensureOverdueAlerts] update error:", error.message);
      }
      continue;
    }

    if (prev && prev.status === "read") {
      const isRecent = new Date(prev.created_at).getTime() > Date.now() - 24 * 60 * 60 * 1000;
      const hasSameInvoices = invListStr.length > 0 && prev.details.includes(invListStr);
      const hasSameLimit = prev.details.includes(`limit (${creditInvoicesLimit})`);

      // Skip ONLY IF read within last 24h with exact same invoices and exact same limit, and not forced
      if (!options?.forceRefresh && isRecent && hasSameInvoices && hasSameLimit) {
        continue;
      }

      // Delete old read alert to prevent duplicates
      const { error: delErr } = await supabase.from("alerts").delete().eq("id", prev.id);
      if (delErr) console.error("[ensureOverdueAlerts] delete error:", delErr.message);
    }

    // Insert fresh unread alert (triggers real-time update in notification bell and Tab 7)
    const { error: insErr } = await supabase.from("alerts").insert({
      tenant_id: tenantId,
      alert_type: "overdue_threshold",
      details,
      severity: "HIGH",
      status: "unread",
      ref_table: "shops",
      ref_id: refId,
    });
    if (insErr) console.error("[ensureOverdueAlerts] insert error:", insErr.message);
  }
}

export async function getAlerts() {
  try {
    await ensureOverdueAlerts();

    const supabase = await createClient();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    // Overdue alerts: no age cutoff (shop can stay overdue for weeks)
    const [overdueRes, otherRes] = await Promise.all([
      supabase
        .from("alerts")
        .select("*")
        .eq("alert_type", "overdue_threshold")
        .order("created_at", { ascending: false }),
      supabase
        .from("alerts")
        .select("*")
        .neq("alert_type", "cash_not_deposited")
        .neq("alert_type", "overdue_threshold")
        .gte("created_at", twoDaysAgo)
        .order("created_at", { ascending: false }),
    ]);

    if (overdueRes.error) {
      console.error("[getAlerts] overdue error:", overdueRes.error.message);
    }
    if (otherRes.error) {
      console.error("[getAlerts] other error:", otherRes.error.message);
    }

    const merged = [...(overdueRes.data || []), ...(otherRes.data || [])];
    merged.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    return merged;
  } catch (err: any) {
    console.error("[getAlerts] unexpected error:", err?.message ?? err);
    return [];
  }
}

export async function getRecentAlerts(limit = 15) {
  try {
    await ensureOverdueAlerts();

    const supabase = await createClient();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const [overdueRes, otherRes] = await Promise.all([
      supabase
        .from("alerts")
        .select("*")
        .eq("alert_type", "overdue_threshold")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("alerts")
        .select("*")
        .neq("alert_type", "cash_not_deposited")
        .neq("alert_type", "overdue_threshold")
        .gte("created_at", twoDaysAgo)
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    if (overdueRes.error) {
      console.error("[getRecentAlerts] overdue error:", overdueRes.error.message);
    }
    if (otherRes.error) {
      console.error("[getRecentAlerts] other error:", otherRes.error.message);
    }

    const merged = [...(overdueRes.data || []), ...(otherRes.data || [])];
    merged.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    const alerts = merged.slice(0, limit);
    const unreadCount = alerts.filter((a: any) => a.status === "unread").length;
    return { alerts, unreadCount };
  } catch (err: any) {
    console.error("[getRecentAlerts] unexpected error:", err?.message ?? err);
    return { alerts: [], unreadCount: 0 };
  }
}

export async function markAlertRead(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("alerts")
    .update({ status: "read" })
    .eq("id", id);
  if (error) throw new Error(error.message);
  // Do not revalidatePath here. Refreshing /tab7/alerts re-runs getAlerts →
  // ensureOverdueAlerts (full invoice scan), which made Mark Read feel stuck.
  // The alerts page and bell already update optimistically and via realtime.
}
