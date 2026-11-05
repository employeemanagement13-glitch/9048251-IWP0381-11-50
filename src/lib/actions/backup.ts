"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { checkAdmin } from "@/lib/actions/admin";
import {
  BACKUP_TABLES,
  DEFERRED_BACKUP_TABLES,
  FK_TABLES,
  EXTRA_WIPE_TABLES,
  RESTORE_SKIP_TABLES,
  prepareSafeRows,
  getServiceSupabase,
  collectTenantBackupPayload,
  pruneOldBackupsForTenant,
  unwrapBackupData,
  countBackupRows,
} from "@/lib/backup-utils";

async function ensureBackupBucket(supa: ReturnType<typeof getServiceSupabase>) {
  const { error } = await supa.storage.createBucket("backups", {
    public: false,
    fileSizeLimit: 52428800,
  });
  if (error && !error.message.toLowerCase().includes("already")) {
    throw new Error(`Backup bucket error: ${error.message}`);
  }
}

export async function executeTenantBackup(
  tenantId: string,
  triggeredBy: "auto" | "manual" = "auto",
  options?: {
    skipRevalidate?: boolean;
    onProgress?: (percent: number, stage: string) => Promise<void> | void;
  }
) {
  const serviceSupabase = getServiceSupabase();

  await options?.onProgress?.(3, "Initializing backup record...");

  const { data: backupRow, error: insertErr } = await serviceSupabase
    .from("backups")
    .insert({ status: "in_progress", tenant_id: tenantId, triggered_by: triggeredBy })
    .select()
    .single();

  if (insertErr || !backupRow) {
    throw new Error(insertErr?.message || "Failed to create backup row");
  }

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = `${tenantId}/${timestamp}.json`;
    const backup = await collectTenantBackupPayload(
      serviceSupabase,
      tenantId,
      async (percent, stage) => {
        await options?.onProgress?.(percent, stage.replace(/^Reading /, "Backing up "));
      }
    );

    await options?.onProgress?.(93, "Packaging snapshot archive...");
    await ensureBackupBucket(serviceSupabase);

    const json = JSON.stringify(backup);
    const bytes = new TextEncoder().encode(json);

    await options?.onProgress?.(96, "Uploading backup archive to secure storage...");
    const { error: uploadErr } = await serviceSupabase.storage
      .from("backups")
      .upload(filePath, bytes, { contentType: "application/json", upsert: false });

    if (uploadErr) throw new Error(uploadErr.message);

    const { error: completeErr } = await serviceSupabase
      .from("backups")
      .update({ status: "completed", file_path: filePath, backup_date: new Date().toISOString() })
      .eq("id", backupRow.id);

    if (completeErr) throw new Error(completeErr.message);

    await pruneOldBackupsForTenant(serviceSupabase, tenantId);

    await options?.onProgress?.(100, "Backup complete!");

    if (!options?.skipRevalidate) {
      try {
        revalidatePath("/tab5/backup");
        revalidatePath("/admin/backups");
      } catch {
        // Ignored when invoked during render
      }
    }
    return { id: backupRow.id, file_path: filePath, status: "completed" };
  } catch (err: any) {
    await serviceSupabase
      .from("backups")
      .update({ status: "failed" })
      .eq("id", backupRow.id);
    throw err;
  }
}

export async function ensureDailyBackupForTenant(tenantId: string) {
  const serviceSupabase = getServiceSupabase();
  const cutoff20h = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  const cutoff10m = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const { data: recentCompleted } = await serviceSupabase
    .from("backups")
    .select("id, backup_date, file_path")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .gt("backup_date", cutoff20h)
    .order("backup_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentCompleted) return recentCompleted;

  const { data: inProgress } = await serviceSupabase
    .from("backups")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "in_progress")
    .gt("created_at", cutoff10m)
    .limit(1)
    .maybeSingle();

  if (inProgress) return null;

  return await executeTenantBackup(tenantId, "auto", { skipRevalidate: true });
}

export async function ensureAllTenantsDailyBackup() {
  const serviceSupabase = getServiceSupabase();
  const { data: tenants, error } = await serviceSupabase.from("tenants").select("id");

  if (error || !tenants) return;

  for (const t of tenants) {
    try {
      await ensureDailyBackupForTenant(t.id);
    } catch (err: any) {
      console.error(`[ensureAllTenantsDailyBackup] tenant ${t.id}:`, err?.message);
    }
  }
}

export async function getBackups() {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    const { data, error } = await supabase
      .from("backups")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[getBackups] error:", error.message);
      return [];
    }
    return data || [];
  } catch (err: any) {
    console.error("[getBackups] unexpected error:", err?.message ?? err);
    return [];
  }
}

export async function createBackupRecord() {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const { data, error } = await supabase
    .from("backups")
    .insert({ status: "in_progress", tenant_id: tenantId, triggered_by: "manual" })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateBackupRecord(
  id: string,
  update: { status: "completed" | "failed"; file_path?: string }
) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const { error } = await supabase
    .from("backups")
    .update(update)
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  revalidatePath("/tab5/backup");
}

export async function getBackupSignedUrl(filePath: string) {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  if (!filePath || !filePath.startsWith(`${tenantId}/`)) {
    throw new Error("Unauthorized: Cannot access backup file of another tenant.");
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase.storage
    .from("backups")
    .createSignedUrl(filePath, 60 * 60 * 24);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function getAdminBackupSignedUrl(filePath: string) {
  await checkAdmin();
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.storage
    .from("backups")
    .createSignedUrl(filePath, 60 * 60 * 24);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function getAdminTenantsWithLatestBackup() {
  await checkAdmin();
  const supabase = getServiceSupabase();

  const { data: tenants, error: tErr } = await supabase
    .from("tenants")
    .select("id, distro_name, email")
    .order("created_at", { ascending: false });

  if (tErr) throw new Error(tErr.message);
  if (!tenants || tenants.length === 0) return [];

  const { data: backups, error: bErr } = await supabase
    .from("backups")
    .select("*")
    .eq("status", "completed")
    .order("backup_date", { ascending: false });

  if (bErr) throw new Error(bErr.message);

  const latestBackupMap = new Map<string, any>();
  (backups || []).forEach((b) => {
    if (!latestBackupMap.has(b.tenant_id)) {
      latestBackupMap.set(b.tenant_id, b);
    }
  });

  return tenants.map((t) => {
    const b = latestBackupMap.get(t.id);
    return {
      tenant_id: t.id,
      distro_name: t.distro_name,
      email: t.email,
      backup_id: b?.id || null,
      backup_date: b?.backup_date || null,
      file_path: b?.file_path || null,
      status: b?.status || "none",
    };
  });
}

async function assertOk(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

async function wipeTenantOperationalData(
  serviceSupabase: ReturnType<typeof getServiceSupabase>,
  tenantId: string,
  onProgress?: (percent: number, stage: string) => Promise<void> | void
) {
  const { data: audits, error: auditErr } = await serviceSupabase
    .from("stock_audits")
    .select("id")
    .eq("tenant_id", tenantId);
  await assertOk(auditErr, "stock_audits lookup");
  const auditIds = (audits || []).map((r: any) => r.id);
  if (auditIds.length > 0) {
    const { error } = await serviceSupabase.from("stock_discrepancies").delete().in("audit_id", auditIds);
    await assertOk(error, "delete stock_discrepancies");
  }

  for (const table of EXTRA_WIPE_TABLES) {
    const { error } = await serviceSupabase.from(table).delete().eq("tenant_id", tenantId);
    if (error && !/does not exist|schema cache|could not find/i.test(error.message)) {
      throw new Error(`delete ${table}: ${error.message}`);
    }
  }

  for (const { table } of [...FK_TABLES].reverse()) {
    const { error } = await serviceSupabase.from(table).delete().eq("tenant_id", tenantId);
    if (error && !/does not exist|schema cache|could not find/i.test(error.message)) {
      throw new Error(`delete FK ${table}: ${error.message}`);
    }
  }

  const deleteOrder = [...BACKUP_TABLES, ...DEFERRED_BACKUP_TABLES]
    .reverse()
    .filter((table) => !RESTORE_SKIP_TABLES.has(table));
  for (let i = 0; i < deleteOrder.length; i++) {
    const table = deleteOrder[i];
    const pct = Math.round(5 + ((i + 1) / deleteOrder.length) * 15);
    await onProgress?.(pct, `Purging existing records (${table.replace(/_/g, " ")})...`);
    const { error } = await serviceSupabase.from(table).delete().eq("tenant_id", tenantId);
    if (error && !/does not exist|schema cache|could not find/i.test(error.message)) {
      throw new Error(`delete ${table}: ${error.message}`);
    }
  }
}

async function insertBackupTables(
  serviceSupabase: ReturnType<typeof getServiceSupabase>,
  tenantId: string,
  backupData: Record<string, any[]>,
  onProgress?: (percent: number, stage: string) => Promise<void> | void
) {
  const CHUNK = 100;
  const inserted: Record<string, number> = {};

  const insertTable = async (table: string, rows: any[], pct: number, label: string) => {
    const friendlyName = table.replace(/_/g, " ");
    if (RESTORE_SKIP_TABLES.has(table) || !Array.isArray(rows) || rows.length === 0) {
      inserted[table] = 0;
      await onProgress?.(pct, `Restoring ${friendlyName} (0 records)...`);
      return;
    }

    await onProgress?.(pct, `Restoring ${friendlyName} (${rows.length} records)...`);
    let safeRows = prepareSafeRows(table, rows, tenantId);

    if (table === "employee_ledger") {
      const seen = new Set<string>();
      safeRows = safeRows.filter((r: any) => {
        const key = `${r.tenant_id}|${r.source_table}|${r.source_id}|${r.type}|${r.direction}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    if (table === "shop_payments") {
      const { data: validBanks, error: bankErr } = await serviceSupabase
        .from("bank_accounts")
        .select("id")
        .eq("tenant_id", tenantId);
      await assertOk(bankErr, "bank_accounts lookup");
      const validBankIds = new Set((validBanks || []).map((b: any) => b.id));
      safeRows.forEach((r: any) => {
        if (r.bank_account_id && !validBankIds.has(r.bank_account_id)) {
          r.bank_account_id = null;
        }
      });
    }

    let count = 0;
    for (let c = 0; c < safeRows.length; c += CHUNK) {
      const chunk = safeRows.slice(c, c + CHUNK);
      if (table === "employee_ledger") {
        const { error } = await serviceSupabase
          .from(table)
          .upsert(chunk, {
            onConflict: "tenant_id,source_table,source_id,type,direction",
            ignoreDuplicates: true,
          });
        await assertOk(error, `${label} insert ${table}`);
        count += chunk.length;
      } else {
        const { error } = await serviceSupabase.from(table).insert(chunk);
        await assertOk(error, `${label} insert ${table}`);
        count += chunk.length;
      }
    }
    inserted[table] = count;
  };

  const baseTables = BACKUP_TABLES.filter((t) => !RESTORE_SKIP_TABLES.has(t));
  for (let i = 0; i < baseTables.length; i++) {
    const table = baseTables[i];
    const pct = Math.round(20 + ((i + 1) / baseTables.length) * 55);
    await insertTable(table, backupData[table], pct, "base");
  }

  for (let i = 0; i < FK_TABLES.length; i++) {
    const { table } = FK_TABLES[i];
    const pct = Math.round(75 + ((i + 1) / FK_TABLES.length) * 13);
    await insertTable(table, backupData[table], pct, "FK");
  }

  for (let i = 0; i < DEFERRED_BACKUP_TABLES.length; i++) {
    const table = DEFERRED_BACKUP_TABLES[i];
    const pct = Math.round(88 + ((i + 1) / DEFERRED_BACKUP_TABLES.length) * 6);
    await insertTable(table, backupData[table], pct, "deferred");
  }

  const { data: payRows, error: payErr } = await serviceSupabase
    .from("shop_payments")
    .select("invoice_id, amount")
    .eq("tenant_id", tenantId);
  await assertOk(payErr, "shop_payments sync lookup");
  if (payRows && payRows.length > 0) {
    const invSums: Record<string, number> = {};
    payRows.forEach((p: any) => {
      if (p.invoice_id) {
        invSums[p.invoice_id] = (invSums[p.invoice_id] || 0) + Number(p.amount || 0);
      }
    });
    for (const [invId, sumAmt] of Object.entries(invSums)) {
      const { error } = await serviceSupabase
        .from("invoices")
        .update({ amount_received: sumAmt })
        .eq("id", invId)
        .eq("tenant_id", tenantId);
      await assertOk(error, `sync invoice ${invId}`);
    }
  }

  const gffRows = backupData["tenant_global_feature_flags"];
  if (Array.isArray(gffRows) && gffRows.length > 0) {
    for (const row of gffRows) {
      const { error } = await serviceSupabase
        .from("global_feature_flags")
        .upsert(row, { onConflict: "flag_key" });
      await assertOk(error, "upsert tenant_global_feature_flags");
    }
    inserted["tenant_global_feature_flags"] = gffRows.length;
  }

  return inserted;
}

export async function getAdminRestoreUploadUrl(tenantId: string) {
  await checkAdmin();
  if (!tenantId) throw new Error("Tenant ID is required.");
  const serviceSupabase = getServiceSupabase();
  await ensureBackupBucket(serviceSupabase);
  const filePath = `${tenantId}/restore-inbox/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const { data, error } = await serviceSupabase.storage
    .from("backups")
    .createSignedUploadUrl(filePath);
  if (error || !data) throw new Error(error?.message || "Failed to create restore upload URL");
  return { path: data.path, signedUrl: data.signedUrl, token: data.token };
}

export async function loadBackupPayloadFromStorage(filePath: string) {
  await checkAdmin();
  if (!filePath) throw new Error("Backup file path is required.");
  const serviceSupabase = getServiceSupabase();
  const { data, error } = await serviceSupabase.storage.from("backups").download(filePath);
  if (error || !data) throw new Error(error?.message || "Failed to download backup file");
  const text = await data.text();
  return unwrapBackupData(JSON.parse(text));
}

export async function restoreTenantBackup(
  tenantId: string,
  backupData: Record<string, any[]>,
  options?: {
    onProgress?: (percent: number, stage: string, extra?: Record<string, any>) => Promise<void> | void;
    skipRevalidate?: boolean;
    skipAdminCheck?: boolean;
  }
) {
  if (!options?.skipAdminCheck) {
    await checkAdmin();
  }
  if (!tenantId) throw new Error("Tenant ID is required.");

  const payload = unwrapBackupData(backupData);
  const expected = countBackupRows(payload);
  if (expected.total === 0) {
    throw new Error(
      "Backup JSON contains no table rows to restore. Check that the file is a Distroline backup dump (table name → row arrays)."
    );
  }

  const serviceSupabase = getServiceSupabase();
  const onProgress = options?.onProgress;

  await onProgress?.(2, "Saving current tenant data for rollback...");
  const snapshot = await collectTenantBackupPayload(serviceSupabase, tenantId, async (pct, stage) => {
    await onProgress?.(2 + Math.round((pct / 100) * 3), `Safeguard snapshot: ${stage}`);
  });

  const apply = async (data: Record<string, any[]>, withProgress: boolean) => {
    await wipeTenantOperationalData(serviceSupabase, tenantId, withProgress ? onProgress : undefined);
    return await insertBackupTables(serviceSupabase, tenantId, data, withProgress ? onProgress : undefined);
  };

  let inserted: Record<string, number>;
  try {
    inserted = await apply(payload, true);
  } catch (err: any) {
    console.error("[restore] failed, rolling back snapshot:", err?.message);
    try {
      await apply(snapshot, false);
    } catch (rollbackErr: any) {
      throw new Error(
        `Restore failed (${err?.message || err}) and rollback also failed (${rollbackErr?.message || rollbackErr}).`
      );
    }
    throw new Error(`Restore failed; previous tenant data was restored. ${err?.message || err}`);
  }

  const totalInserted = Object.values(inserted).reduce((sum, n) => sum + n, 0);
  if (totalInserted === 0) {
    try {
      await apply(snapshot, false);
    } catch (rollbackErr: any) {
      throw new Error(
        `Restore inserted 0 rows and rollback also failed (${rollbackErr?.message || rollbackErr}).`
      );
    }
    throw new Error("Restore inserted 0 rows; previous tenant data was restored.");
  }

  const restoreTime = new Date().toLocaleString("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  await serviceSupabase.from("alerts").insert({
    tenant_id: tenantId,
    alert_type: "overdue_threshold",
    details: `Admin restored your data with backup file at ${restoreTime}`,
    severity: "LOW",
    status: "unread",
  });

  if (!options?.skipRevalidate) {
    try {
      revalidatePath("/admin/backups");
      revalidatePath("/admin/dashboard");
      revalidatePath("/tab5/backup");
    } catch {}
  }

  return { success: true as const, inserted, totalInserted };
}

export async function deleteBackup(id: string, filePath?: string) {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  if (filePath && !filePath.startsWith(`${tenantId}/`)) {
    throw new Error("Unauthorized: Cannot delete backup file of another tenant.");
  }

  const serviceSupabase = getServiceSupabase();
  if (filePath) {
    await serviceSupabase.storage.from("backups").remove([filePath]);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("backups")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  revalidatePath("/tab5/backup");
}

export async function deleteBackups(items: { id: string; file_path?: string }[]) {
  if (!items.length) return;
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const serviceSupabase = getServiceSupabase();
  const filePathsToRemove = items
    .map((i) => i.file_path)
    .filter((fp): fp is string => !!fp && fp.startsWith(`${tenantId}/`));

  if (filePathsToRemove.length > 0) {
    await serviceSupabase.storage.from("backups").remove(filePathsToRemove);
  }

  const ids = items.map((i) => i.id);
  const supabase = await createClient();
  const { error } = await supabase
    .from("backups")
    .delete()
    .in("id", ids)
    .eq("tenant_id", tenantId);

  if (error) throw new Error(error.message);
  revalidatePath("/tab5/backup");
}