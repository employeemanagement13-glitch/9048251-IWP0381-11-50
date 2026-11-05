import { createClient as createServiceClient } from "@supabase/supabase-js";

export const BACKUP_TABLES = [
  "tenant_settings",
  "tenant_alert_settings",
  "tenant_feature_flags",
  "ccbpl_limit_history",
  "product_categories",
  "products",
  "promo_invoices",
  "shops",
  "blocked_shops",
  "employees",
  "loaders",
  "bank_accounts",
  "vendor_accounts",
  "dm_routes",
  "route_assignments",
  "invoices",
  "sell_in_orders",
  "warehouse_stock",
  "damaged_stock",
  "returns_wayback",
  "stock_audits",
  "empties_log",
  "cash_deposits",
  "cash_movements",
  "scheme_income",
  "shop_payments",
  "sale_entries",
  "sale_entry_lines",
  "stock_movements",
  "stock_report_entries",
  "stock_snapshots",
  "employee_ledger",
  "payroll_runs",
  "payroll_sops",
  "employee_loans",
  "employee_loan_recoveries",
  "employee_increments",
  "expense_bills",
  "expense_entertainment",
  "expense_petty",
  "expense_penalties",
  "manual_income_statement_records",
  "fuel_entries",
  "vehicle_maintenance",
  "agency_expenses",
  "ccbpl_penalties",
  "ccbpl_purchases",
  "agency_ledger",
  "late_deliveries",
  "invoice_line_items",
  "invoice_returns",
  "leased_empties",
  "sold_empties",
  "discount_configs",
  "discount_config_products",
  "waybills",
  "ledger_entries",
  "alerts",
  "laborers",
  "laborer_expenses",
];

export const DEFERRED_BACKUP_TABLES = ["sell_in_return_entries"];

export const FK_TABLES: { table: string; fkCol: string; parentTable: string }[] = [
  { table: "sell_in_lines", fkCol: "sell_in_order_id", parentTable: "sell_in_orders" },
  { table: "stock_discrepancies", fkCol: "audit_id", parentTable: "stock_audits" },
  { table: "leased_empty_items", fkCol: "lease_id", parentTable: "leased_empties" }, // includes returned_date (v75)
  { table: "leased_empty_returns", fkCol: "lease_item_id", parentTable: "leased_empty_items" }, // multi-date returns (v76)
  { table: "sold_empty_items", fkCol: "sold_empty_id", parentTable: "sold_empties" },
  { table: "sell_in_arrived_lines", fkCol: "sell_in_line_id", parentTable: "sell_in_lines" },
  { table: "laborer_persons", fkCol: "laborer_id", parentTable: "laborers" },
  { table: "waybill_items", fkCol: "waybill_id", parentTable: "waybills" },
];

export const GENERATED_COLUMNS: Record<string, string[]> = {
  invoices: ["grand_total", "payment_status"],
  sale_entry_lines: ["amount"],
  warehouse_stock: ["qty_available"],
  stock_discrepancies: ["diff"],
  admin_logs: ["pages_visited"],
  sell_in_lines: [
    "bill_amount",
    "wh_tax_amount",
    "commission_amount",
    "scheme_amount",
    "net_bill_amount",
  ],
  fuel_entries: ["distance_covered", "efficiency_km_per_l"],
  payroll_runs: ["net_salary", "net_payable"],
};

export const KEEP_BACKUPS_PER_TENANT = 3;

/** Names that appear in backup JSON but are views (not insertable tables). */
export const RESTORE_SKIP_TABLES = new Set(["blocked_shops"]);

/** Tenant-scoped tables that must be wiped for FK safety but are not in backup JSON. */
export const EXTRA_WIPE_TABLES = ["fifo_batch_ledger"];

export function restoreTargetTables() {
  return [
    ...BACKUP_TABLES.filter((t) => !RESTORE_SKIP_TABLES.has(t)),
    ...FK_TABLES.map((f) => f.table),
    ...DEFERRED_BACKUP_TABLES,
  ];
}

export function unwrapBackupData(raw: any): Record<string, any[]> {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid backup data payload.");
  }
  if (Array.isArray(raw)) {
    throw new Error("Backup JSON must be an object mapping table names to row arrays.");
  }

  const known = new Set<string>([
    ...BACKUP_TABLES,
    ...DEFERRED_BACKUP_TABLES,
    ...FK_TABLES.map((f) => f.table),
    "tenant_global_feature_flags",
  ]);

  const asTableMap = (obj: any): Record<string, any[]> | null => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const hasKnownTable = Object.keys(obj).some((k) => known.has(k) && Array.isArray(obj[k]));
    return hasKnownTable ? obj : null;
  };

  return asTableMap(raw) || asTableMap(raw.backupData) || asTableMap(raw.data) || asTableMap(raw.tables) || raw;
}

export function countBackupRows(backupData: Record<string, any[]>) {
  const perTable: Record<string, number> = {};
  let total = 0;
  for (const table of restoreTargetTables()) {
    const n = Array.isArray(backupData[table]) ? backupData[table].length : 0;
    perTable[table] = n;
    total += n;
  }
  if (Array.isArray(backupData["tenant_global_feature_flags"])) {
    perTable["tenant_global_feature_flags"] = backupData["tenant_global_feature_flags"].length;
    total += backupData["tenant_global_feature_flags"].length;
  }
  return { total, perTable };
}

export async function pruneOldBackupsForTenant(
  serviceSupabase: ReturnType<typeof getServiceSupabase>,
  tenantId: string
) {
  const { data: rows, error } = await serviceSupabase
    .from("backups")
    .select("id, file_path")
    .eq("tenant_id", tenantId)
    .order("backup_date", { ascending: false });

  if (error) {
    console.error("[pruneOldBackupsForTenant] list:", error.message);
    return;
  }
  if (!rows || rows.length <= KEEP_BACKUPS_PER_TENANT) return;

  const stale = rows.slice(KEEP_BACKUPS_PER_TENANT);
  const paths = stale
    .map((r) => r.file_path)
    .filter((p): p is string => !!p && p.startsWith(`${tenantId}/`));

  if (paths.length > 0) {
    const { error: storageErr } = await serviceSupabase.storage.from("backups").remove(paths);
    if (storageErr) {
      console.error("[pruneOldBackupsForTenant] storage:", storageErr.message);
    }
  }

  const { error: delErr } = await serviceSupabase
    .from("backups")
    .delete()
    .in("id", stale.map((r) => r.id))
    .eq("tenant_id", tenantId);

  if (delErr) {
    console.error("[pruneOldBackupsForTenant] delete:", delErr.message);
  }
}

export async function collectTenantBackupPayload(
  serviceSupabase: ReturnType<typeof getServiceSupabase>,
  tenantId: string,
  onProgress?: (percent: number, stage: string) => Promise<void> | void
): Promise<Record<string, any[]>> {
  const backup: Record<string, any[]> = {};
  const allBaseTables = [...BACKUP_TABLES, ...DEFERRED_BACKUP_TABLES];
  const CONCURRENCY = 5;
  let completedCount = 0;

  for (let i = 0; i < allBaseTables.length; i += CONCURRENCY) {
    const batch = allBaseTables.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (table) => {
        try {
          const rows = await fetchAllRowsForTable(serviceSupabase, table, tenantId);
          backup[table] = rows;
          completedCount++;
          const pct = Math.round(5 + (completedCount / allBaseTables.length) * 75);
          const friendly = table.replace(/_/g, " ");
          await onProgress?.(pct, `Reading ${friendly} (${rows.length} rows)...`);
        } catch {
          backup[table] = [];
        }
      })
    );
  }

  let fkCount = 0;
  for (const { table, fkCol, parentTable } of FK_TABLES) {
    try {
      const parentIds = (backup[parentTable] || []).map((r: any) => r.id).filter(Boolean);
      if (parentIds.length === 0) {
        backup[table] = [];
        continue;
      }
      const rows = await fetchAllRowsForFkTable(serviceSupabase, table, fkCol, parentIds);
      backup[table] = rows;
      fkCount++;
      const pct = Math.round(80 + (fkCount / FK_TABLES.length) * 12);
      const friendly = table.replace(/_/g, " ");
      await onProgress?.(pct, `Reading related ${friendly} (${rows.length} rows)...`);
    } catch {
      backup[table] = [];
    }
  }

  try {
    const { data: gffRows } = await serviceSupabase
      .from("global_feature_flags")
      .select("*")
      .like("flag_key", `%${tenantId}%`);
    if (gffRows && gffRows.length > 0) {
      backup["tenant_global_feature_flags"] = gffRows;
    }
  } catch {}

  return backup;
}

export function prepareSafeRows(table: string, rows: any[], tenantId: string) {
  const genCols = GENERATED_COLUMNS[table] || [];
  return rows.map((r: any) => {
    const row = { ...r, tenant_id: tenantId };
    for (const col of genCols) {
      delete row[col];
    }
    // Cleanse empty strings for nullable UUID foreign keys
    for (const k of Object.keys(row)) {
      if ((k.endsWith("_id") || k === "id") && row[k] === "") {
        row[k] = null;
      }
    }
    return row;
  });
}

export function getServiceSupabase() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Paginates through Supabase PostgREST table queries so tables with > 1,000 rows
 * (e.g. 1,200+ shops or thousands of invoices/sale lines) are fetched completely
 * without any truncation or capping.
 */
export async function fetchAllRowsForTable(
  supabase: ReturnType<typeof getServiceSupabase>,
  table: string,
  tenantId: string
): Promise<any[]> {
  const PAGE_SIZE = 1000;
  let allRows: any[] = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("tenant_id", tenantId)
        .range(from, from + PAGE_SIZE - 1);

      if (error || !data || data.length === 0) {
        break;
      }

      allRows.push(...data);
      if (data.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        from += PAGE_SIZE;
      }
    } catch {
      break;
    }
  }

  return allRows;
}

/**
 * Paginates through foreign key child tables in batches of parent IDs so that
 * no child rows are omitted even when there are thousands of lines.
 */
export async function fetchAllRowsForFkTable(
  supabase: ReturnType<typeof getServiceSupabase>,
  table: string,
  fkCol: string,
  parentIds: string[]
): Promise<any[]> {
  if (!parentIds.length) return [];
  const BATCH = 300;
  let allRows: any[] = [];

  for (let i = 0; i < parentIds.length; i += BATCH) {
    const chunkIds = parentIds.slice(i, i + BATCH);
    const PAGE_SIZE = 1000;
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select("*")
          .in(fkCol, chunkIds)
          .range(from, from + PAGE_SIZE - 1);

        if (error || !data || data.length === 0) {
          break;
        }

        allRows.push(...data);
        if (data.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          from += PAGE_SIZE;
        }
      } catch {
        break;
      }
    }
  }

  return allRows;
}
