"use server";

import { createClient, createAdminClient, getTenantId } from "@/lib/supabase/server";
import { checkAdmin } from "@/lib/actions/admin";
import { revalidatePath, unstable_noStore as noStore } from "next/cache";

export interface COGSLineItem {
  id: string;
  product_id: string;
  code: string;
  name: string;
  purchase_rate: number;
  sold_qty: number;
  amount: number;
}

export interface ManualStatementRecord {
  id: string;
  tenant_id: string;
  month_year: string;
  section: "revenue" | "cogs" | "other_income" | "opex";
  description: string;
  amount: number;
  entry_date?: string | null;
  line_items?: COGSLineItem[] | null;
}

export interface ManualStatementData {
  revenue: ManualStatementRecord | null;
  cogs: ManualStatementRecord | null;
  otherIncome: ManualStatementRecord[];
  opex: ManualStatementRecord[];
}

export async function getEnabledManualMonthsForCurrentTenant(): Promise<string[]> {
  noStore();
  try {
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    const supabase = createAdminClient();
    const { data: globalFlags } = await supabase
      .from("global_feature_flags")
      .select("flag_key, label, enabled");

    const { data: tenantFlags } = await supabase
      .from("tenant_feature_flags")
      .select("flag_key, enabled")
      .eq("tenant_id", tenantId);

    const globalMap = new Map<string, boolean>();
    const monthNames = new Set<string>();

    for (const gf of globalFlags || []) {
      if (gf.flag_key === "manual_income_statement" && gf.label) {
        monthNames.add(gf.label);
        globalMap.set(gf.label, gf.enabled);
      } else if (gf.flag_key.startsWith("manual_income_statement:")) {
        const my = gf.flag_key.replace("manual_income_statement:", "").trim();
        if (my) {
          monthNames.add(my);
          globalMap.set(my, gf.enabled);
        }
      }
    }

    const tenantMap = new Map<string, boolean>();
    for (const tf of tenantFlags || []) {
      if (tf.flag_key === "manual_income_statement") {
        for (const my of monthNames) {
          if (!tenantMap.has(my)) tenantMap.set(my, tf.enabled);
        }
      } else if (tf.flag_key.startsWith("manual_income_statement:")) {
        const my = tf.flag_key.replace("manual_income_statement:", "").trim();
        if (my) {
          monthNames.add(my);
          tenantMap.set(my, tf.enabled);
        }
      }
    }

    const activeMonths: string[] = [];
    for (const my of monthNames) {
      const isTenantOverridden = tenantMap.has(my);
      const isEnabled = isTenantOverridden ? tenantMap.get(my)! : (globalMap.get(my) ?? false);
      if (isEnabled) {
        activeMonths.push(my);
      }
    }

    return activeMonths;
  } catch {
    return [];
  }
}

export async function getGlobalManualMonths(): Promise<{ month_year: string; enabled: boolean }[]> {
  noStore();
  await checkAdmin();
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("global_feature_flags")
      .select("flag_key, label, enabled");

    const map = new Map<string, boolean>();
    for (const row of data || []) {
      if (row.flag_key === "manual_income_statement" && row.label) {
        map.set(row.label, row.enabled);
      } else if (row.flag_key.startsWith("manual_income_statement:")) {
        const my = row.flag_key.replace("manual_income_statement:", "").trim();
        if (my) map.set(my, row.enabled);
      }
    }

    return Array.from(map.entries()).map(([month_year, enabled]) => ({
      month_year,
      enabled,
    }));
  } catch {
    return [];
  }
}

export async function getTenantManualMonths(tenantId: string): Promise<{
  month_year: string;
  global_enabled: boolean;
  tenant_enabled: boolean | null;
}[]> {
  noStore();
  await checkAdmin();
  try {
    const supabase = createAdminClient();
    const { data: globalFlags } = await supabase
      .from("global_feature_flags")
      .select("flag_key, label, enabled");

    const { data: tenantFlags } = await supabase
      .from("tenant_feature_flags")
      .select("flag_key, enabled")
      .eq("tenant_id", tenantId);

    const globalMap = new Map<string, boolean>();
    const monthNames = new Set<string>();

    for (const gf of globalFlags || []) {
      if (gf.flag_key === "manual_income_statement" && gf.label) {
        monthNames.add(gf.label);
        globalMap.set(gf.label, gf.enabled);
      } else if (gf.flag_key.startsWith("manual_income_statement:")) {
        const my = gf.flag_key.replace("manual_income_statement:", "").trim();
        if (my) {
          monthNames.add(my);
          globalMap.set(my, gf.enabled);
        }
      }
    }

    const tenantMap = new Map<string, boolean>();
    for (const tf of tenantFlags || []) {
      if (tf.flag_key.startsWith("manual_income_statement:")) {
        const my = tf.flag_key.replace("manual_income_statement:", "").trim();
        if (my) {
          monthNames.add(my);
          tenantMap.set(my, tf.enabled);
        }
      }
    }

    return Array.from(monthNames).map((my) => ({
      month_year: my,
      global_enabled: globalMap.get(my) ?? false,
      tenant_enabled: tenantMap.has(my) ? tenantMap.get(my)! : null,
    }));
  } catch {
    return [];
  }
}

export async function toggleGlobalManualMonth(monthYear: string, enabled: boolean) {
  await checkAdmin();
  const supabase = createAdminClient();
  const cleanMY = monthYear.trim();
  const flagKey = `manual_income_statement:${cleanMY}`;

  await supabase
    .from("global_feature_flags")
    .upsert({ flag_key: flagKey, label: cleanMY, enabled }, { onConflict: "flag_key" });

  await supabase
    .from("global_feature_flags")
    .upsert({ flag_key: "manual_income_statement", label: cleanMY, enabled }, { onConflict: "flag_key" });

  if (enabled) {
    await supabase
      .from("tenant_feature_flags")
      .delete()
      .eq("flag_key", flagKey);
  }

  try {
    const bc = supabase.channel("broadcast_channel_global_feature_flags");
    bc.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        bc.send({
          type: "broadcast",
          event: "change",
          payload: { flag_key: flagKey, enabled },
        });
      }
    });
  } catch (_) {}

  revalidatePath("/admin/settings");
  revalidatePath("/admin/tenants");
  revalidatePath("/income/statement");
}

export async function toggleTenantManualMonth(
  tenantId: string,
  monthYear: string,
  enabled: boolean | null
) {
  await checkAdmin();
  const supabase = createAdminClient();
  const cleanMY = monthYear.trim();
  const flagKey = `manual_income_statement:${cleanMY}`;

  const { data: gf } = await supabase
    .from("global_feature_flags")
    .select("flag_key")
    .eq("flag_key", flagKey)
    .single();

  if (!gf) {
    await supabase.from("global_feature_flags").insert({
      flag_key: flagKey,
      label: cleanMY,
      enabled: false,
    });
  }

  if (enabled === null) {
    await supabase
      .from("tenant_feature_flags")
      .delete()
      .match({ tenant_id: tenantId, flag_key: flagKey });
  } else {
    await supabase
      .from("tenant_feature_flags")
      .upsert(
        { tenant_id: tenantId, flag_key: flagKey, enabled },
        { onConflict: "tenant_id,flag_key" }
      );
  }

  try {
    const bc = supabase.channel("broadcast_channel_tenant_feature_flags");
    bc.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        bc.send({
          type: "broadcast",
          event: "change",
          payload: { tenant_id: tenantId, flag_key: flagKey, enabled },
        });
      }
    });
  } catch (_) {}

  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/income/statement");
}

export async function getManualStatementData(monthYear: string): Promise<ManualStatementData> {
  noStore();
  const tenantId = await getTenantId();
  if (!tenantId) {
    return { revenue: null, cogs: null, otherIncome: [], opex: [] };
  }

  const cleanMY = monthYear.trim();
  const supabase = createAdminClient();

  try {
    const { data: records, error } = await supabase
      .from("manual_income_statement_records")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("month_year", cleanMY);

    if (!error && records) {
      let revenue: ManualStatementRecord | null = null;
      let cogs: ManualStatementRecord | null = null;
      const otherIncome: ManualStatementRecord[] = [];
      const opex: ManualStatementRecord[] = [];

      for (const r of records) {
        const item: ManualStatementRecord = {
          id: r.id,
          tenant_id: r.tenant_id,
          month_year: r.month_year,
          section: r.section,
          description: r.description || "",
          amount: Number(r.amount) || 0,
          entry_date: r.entry_date,
          line_items: r.line_items,
        };
        if (r.section === "revenue") revenue = item;
        else if (r.section === "cogs") cogs = item;
        else if (r.section === "other_income") otherIncome.push(item);
        else if (r.section === "opex") opex.push(item);
      }

      return { revenue, cogs, otherIncome, opex };
    }
  } catch (_) {}

  try {
    const prefix = `manual_is_entry:${tenantId}:${cleanMY}:`;
    const { data: flagEntries } = await supabase
      .from("global_feature_flags")
      .select("flag_key, label")
      .like("flag_key", `${prefix}%`);

    let revenue: ManualStatementRecord | null = null;
    let cogs: ManualStatementRecord | null = null;
    const otherIncome: ManualStatementRecord[] = [];
    const opex: ManualStatementRecord[] = [];

    for (const fe of flagEntries || []) {
      try {
        const parsed = JSON.parse(fe.label);
        const item: ManualStatementRecord = {
          id: parsed.id,
          tenant_id: parsed.tenant_id,
          month_year: parsed.month_year,
          section: parsed.section,
          description: parsed.description || "",
          amount: Number(parsed.amount) || 0,
          entry_date: parsed.entry_date,
          line_items: parsed.line_items,
        };
        if (item.section === "revenue") revenue = item;
        else if (item.section === "cogs") cogs = item;
        else if (item.section === "other_income") otherIncome.push(item);
        else if (item.section === "opex") opex.push(item);
      } catch (_) {}
    }

    return { revenue, cogs, otherIncome, opex };
  } catch (_) {
    return { revenue: null, cogs: null, otherIncome: [], opex: [] };
  }
}

async function persistRecord(record: ManualStatementRecord) {
  const supabase = createAdminClient();
  try {
    const { error } = await supabase
      .from("manual_income_statement_records")
      .upsert({
        id: record.id,
        tenant_id: record.tenant_id,
        month_year: record.month_year,
        section: record.section,
        description: record.description,
        amount: record.amount,
        entry_date: record.entry_date || null,
        line_items: record.line_items || null,
        updated_at: new Date().toISOString(),
      });
    if (!error) return;
  } catch (_) {}

  const flagKey = `manual_is_entry:${record.tenant_id}:${record.month_year}:${record.section}:${record.id}`;
  await supabase.from("global_feature_flags").upsert({
    flag_key: flagKey,
    label: JSON.stringify(record),
    enabled: true,
  });
}

export async function saveSalesRevenueRecord(
  monthYear: string,
  description: string,
  amount: number,
  id?: string
): Promise<ManualStatementRecord> {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const record: ManualStatementRecord = {
    id: id || crypto.randomUUID(),
    tenant_id: tenantId,
    month_year: monthYear.trim(),
    section: "revenue",
    description: description.trim(),
    amount: Number(amount) || 0,
  };

  await persistRecord(record);
  revalidatePath("/income/statement");
  return record;
}

export async function saveCOGSRecord(
  monthYear: string,
  lineItems: COGSLineItem[],
  id?: string
): Promise<ManualStatementRecord> {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const totalAmount = lineItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const record: ManualStatementRecord = {
    id: id || crypto.randomUUID(),
    tenant_id: tenantId,
    month_year: monthYear.trim(),
    section: "cogs",
    description: "TOTAL COGS",
    amount: totalAmount,
    line_items: lineItems,
  };

  await persistRecord(record);
  revalidatePath("/income/statement");
  return record;
}

export async function saveOtherIncomeRecord(
  monthYear: string,
  description: string,
  amount: number,
  id?: string
): Promise<ManualStatementRecord> {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const record: ManualStatementRecord = {
    id: id || crypto.randomUUID(),
    tenant_id: tenantId,
    month_year: monthYear.trim(),
    section: "other_income",
    description: description.trim(),
    amount: Number(amount) || 0,
  };

  await persistRecord(record);
  revalidatePath("/income/statement");
  return record;
}

export async function saveExpenseRecord(
  monthYear: string,
  description: string,
  amount: number,
  entryDate: string,
  id?: string
): Promise<ManualStatementRecord> {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const record: ManualStatementRecord = {
    id: id || crypto.randomUUID(),
    tenant_id: tenantId,
    month_year: monthYear.trim(),
    section: "opex",
    description: description.trim(),
    amount: Number(amount) || 0,
    entry_date: entryDate,
  };

  await persistRecord(record);
  revalidatePath("/income/statement");
  return record;
}

export async function deleteManualRecord(id: string, monthYear: string, section: string) {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const supabase = createAdminClient();
  try {
    await supabase
      .from("manual_income_statement_records")
      .delete()
      .match({ id, tenant_id: tenantId });
  } catch (_) {}

  const flagKey = `manual_is_entry:${tenantId}:${monthYear.trim()}:${section}:${id}`;
  try {
    await supabase.from("global_feature_flags").delete().eq("flag_key", flagKey);
  } catch (_) {}

  revalidatePath("/income/statement");
}
