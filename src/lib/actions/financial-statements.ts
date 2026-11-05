"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { getCalculatedEmployeeLoans } from "@/lib/actions/employees";
import { isLoanUnrecoverable } from "@/lib/utils/loan-utils";
import { getBankAccounts, getVendorAccounts } from "@/lib/actions/bank-accounts";
import { runFifo, round2 } from "@/lib/fifo/engine";
import { buildFifoEvents, classifyProducts, getOrderEffDate } from "@/lib/fifo/events";
import { leaseOutstandingAsOf } from "@/lib/empties/lease-as-of";

/**
 * Expense / Income Statement amount for an unrecoverable loan = outstanding
 * at the report end date (principal − payroll − recoveries), never the full
 * principal. Balance Sheet dead-asset fallback to principal when balance is 0
 * is intentionally NOT copied here.
 */
async function withUnrecoverableExpenseAmounts(
  loans: any[],
  tenantId: string,
  asOfDate: string
): Promise<any[]> {
  const filtered = (loans || []).filter(isLoanUnrecoverable);
  if (filtered.length === 0) return [];

  const calculated = await getCalculatedEmployeeLoans(tenantId, asOfDate);
  const balById = new Map<string, number>(
    (calculated.loans || []).map((l: any) => [l.id, Math.max(0, Number(l.outstanding_balance) || 0)])
  );

  return filtered.map((l: any) => {
    const emp = Array.isArray(l.employees) ? l.employees[0] : l.employees;
    const outstanding = balById.has(l.id)
      ? (balById.get(l.id) as number)
      : Math.max(0, Number(l.principal_amount) || 0);
    return {
      ...l,
      employee_name: emp?.full_name || "Employee",
      outstanding_balance: outstanding,
      expense_amount: outstanding,
    };
  });
}

/**
 * snapshotWarehouseValue
 * ─────────────────────
 * Computes the current total warehouse cost value
 * (warehouse_standard_levels + warehouse_empties_levels) × products.purchase_rate,
 * then upserts a row into stock_snapshots for today.
 *
 * Called automatically when a sell_in PO is marked Stock Arrived so that
 * the Income Statement always has a reliable Opening Stock anchor — even on
 * localhost where the nightly pg_cron job never runs.
 *
 * Uses UPSERT so if two POs arrive on the same day, or the nightly cron already
 * ran, the latest value simply overwrites (most-recent wins, still one row/day).
 *
 * triggered_by: 'po_arrival' — distinguishes from the nightly 'auto' cron.
 */
export async function snapshotWarehouseValue(): Promise<void> {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();
    if (!tenantId) return;

    // 1. Fetch products, stock reports & confirmed POs to resolve locked acquisition rates
    const today = new Date().toISOString().split("T")[0];
    const [{ data: products }, { data: sreRows }, { data: poRows }, { data: stdRows }, { data: empRows }] = await Promise.all([
      supabase
        .from("products")
        .select("id, purchase_rate, product_name, product_code, product_categories(id, is_implied)")
        .eq("tenant_id", tenantId),
      supabase
        .from("stock_report_entries")
        .select("product_id, ph_case, amount, report_date")
        .eq("tenant_id", tenantId)
        .lte("report_date", today)
        .order("report_date", { ascending: true }),
      supabase
        .from("sell_in_orders")
        .select("transaction_date, billed_date, created_at, status, sell_in_lines(product_id, bill_amount, net_bill_amount, qty, rate, invoice_type)")
        .eq("tenant_id", tenantId)
        .neq("status", "in_progress"),
      supabase
        .from("warehouse_standard_levels")
        .select("product_id, total_qty")
        .eq("tenant_id", tenantId),
      supabase
        .from("warehouse_empties_levels")
        .select("product_id, total_qty")
        .eq("tenant_id", tenantId),
    ]);

    const impliedIds = new Set<string>();
    const rateMap = new Map<string, number>();
    for (const p of products || []) {
      const isImplied =
        Boolean((p.product_categories as any)?.is_implied) ||
        (p.product_name || "").toUpperCase().includes("IMPLIED") ||
        (p.product_code || "").startsWith("80000");
      if (isImplied) {
        impliedIds.add(p.id);
        rateMap.set(p.id, 0);
      } else {
        rateMap.set(p.id, Number(p.purchase_rate) || 0);
      }
    }

    // Tier 2: Stock Report entries
    for (const e of sreRows || []) {
      const ph = Number(e.ph_case) || 0;
      const amt = Number(e.amount) || 0;
      if (ph > 0 && amt > 0 && !impliedIds.has(e.product_id)) {
        rateMap.set(e.product_id, amt / ph);
      }
    }

    // Tier 1: Confirmed POs
    const getEffDate = (o: any) => o.transaction_date || (o.billed_date ? o.billed_date.split("T")[0] : (o.created_at ? o.created_at.split("T")[0] : null));
    const sortedPOs = [...(poRows || [])].sort((a: any, b: any) => (getEffDate(a) || "").localeCompare(getEffDate(b) || ""));
    for (const o of sortedPOs) {
      if (["stock_arrived", "on_credit", "billed"].includes(o.status)) {
        for (const l of (o.sell_in_lines || [])) {
          if (!l.invoice_type || l.invoice_type.toLowerCase() === "purchase") {
            if (!impliedIds.has(l.product_id)) {
              const r = Number(l.rate) || (Number(l.qty) > 0 ? (Number(l.bill_amount) || Number(l.net_bill_amount)) / Number(l.qty) : 0);
              if (r > 0) rateMap.set(l.product_id, r);
            }
          }
        }
      }
    }

    // Deduplicate by product_id (same as Closing Stock calculation)
    const qtyMap = new Map<string, number>();
    for (const row of stdRows || []) {
      if (row.product_id && !qtyMap.has(row.product_id))
        qtyMap.set(row.product_id, Number(row.total_qty) || 0);
    }
    for (const row of empRows || []) {
      if (row.product_id && !qtyMap.has(row.product_id))
        qtyMap.set(row.product_id, Number(row.total_qty) || 0);
    }

    // 3. Compute total cost value (exclude implied empties — same rule as Closing Stock)
    let totalCostValue = 0;
    let totalQty = 0;
    for (const [prodId, qty] of qtyMap.entries()) {
      if (impliedIds.has(prodId)) continue;
      const rate = rateMap.get(prodId) || 0;
      totalCostValue += qty * rate;
      totalQty += qty;
    }

    // 4. Upsert — one row per tenant per day; po_arrival overwrites if cron already ran
    await supabase.from("stock_snapshots").upsert(
      {
        tenant_id:        tenantId,
        snapshot_date:    today,
        total_cost_value: totalCostValue,
        total_qty:        totalQty,
        triggered_by:     "po_arrival",
      },
      { onConflict: "tenant_id,snapshot_date" }
    );
  } catch (err: any) {
    // Non-fatal — log and continue. A snapshot failure must never block the PO workflow.
    console.error("[snapshotWarehouseValue] failed:", err?.message ?? err);
  }
}


/**
 * getExpenseSheetData — fetches all expense data for the Expense Sheet.
 * Per FINANCIAL_ANALYSIS_AND_STATEMENTS.md spec.
 *
 * Verified table + column names (2026-09-23):
 *  - fuel_entries       → truck_no, driver_name, entry_date, amount, bank_account_id
 *  - vehicle_maintenance → vehicle_no, driver_name, entry_date, amount, bank_account_id
 *  - expense_bills      → bill_name, expense_date, amount, bank_account_id
 *  - laborer_expenses   → work, from_date, to_date, amount, bank_account_id
 *  - payroll_runs       → net_payable, expense_date, bank_account_id, employee_id → employees(full_name, role)
 *  - expense_entertainment → description, expense_date, amount, bank_account_id
 *  - expense_petty      → description, expense_date, amount, bank_account_id
 *  - ccbpl_penalties    → reason, penalty_date, amount, status  (hard delete; filter status != 'disputed')
 *  - invoices           → delivery_date, discount_amount, delivery_status (hard delete, no deleted_at)
 */
export async function getExpenseSheetData(fromDate: string, toDate: string) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) return null;

  const { getMonthlyAdditionalDiscountsTotal } = await import("@/lib/actions/discounts");

  const [
    billsRes,
    fuelRes,
    maintenanceRes,
    laborerRes,
    payrollRes,
    entertainmentRes,
    pettyRes,
    penaltiesRes,
    agencyPenaltiesRes,
    bankAccountsRes,
    vendorAccountsRes,
    unrecLoansRes,
  ] = await Promise.all([
    // Utility Bills
    supabase
      .from("expense_bills")
      .select("id, bill_name, amount, expense_date, bank_account_id")
      .eq("tenant_id", tenantId)
      .gte("expense_date", fromDate)
      .lte("expense_date", toDate)
      .order("expense_date"),

    // Vehicle Fuel — table: fuel_entries, date column: entry_date, vehicle: truck_no
    supabase
      .from("fuel_entries")
      .select("id, truck_no, driver_name, amount, entry_date, bank_account_id")
      .eq("tenant_id", tenantId)
      .gte("entry_date", fromDate)
      .lte("entry_date", toDate)
      .order("entry_date"),

    // Vehicle Maintenance — table: vehicle_maintenance, date column: entry_date
    supabase
      .from("vehicle_maintenance")
      .select("id, vehicle_no, driver_name, amount, entry_date, description, bank_account_id")
      .eq("tenant_id", tenantId)
      .gte("entry_date", fromDate)
      .lte("entry_date", toDate)
      .order("entry_date"),

    // Daily Laborers
    supabase
      .from("laborer_expenses")
      .select("id, work, amount, from_date, to_date, bank_account_id")
      .eq("tenant_id", tenantId)
      .gte("from_date", fromDate)
      .lte("from_date", toDate)
      .order("from_date"),

    // Salaries — payroll_runs joined with employees
    supabase
      .from("payroll_runs")
      .select("id, salary_month, net_payable, expense_date, bank_account_id, employee_id, employees(full_name, role)")
      .eq("tenant_id", tenantId)
      .gte("expense_date", fromDate)
      .lte("expense_date", toDate)
      .order("expense_date"),

    // Entertainment
    supabase
      .from("expense_entertainment")
      .select("id, description, amount, expense_date, bank_account_id")
      .eq("tenant_id", tenantId)
      .gte("expense_date", fromDate)
      .lte("expense_date", toDate)
      .order("expense_date"),

    // Petty Cash
    supabase
      .from("expense_petty")
      .select("id, description, amount, expense_date, bank_account_id")
      .eq("tenant_id", tenantId)
      .gte("expense_date", fromDate)
      .lte("expense_date", toDate)
      .order("expense_date"),

    // CCBPL Penalties — table: ccbpl_penalties (Tab 6 Penalties Register)
    // Paid Via: "Deducted by Co." — CCBPL deducts from vendor account, no bank outflow.
    // Exclude disputed penalties per spec (status != 'disputed').
    // ccbpl_penalties uses hard delete — no deleted_at filter needed.
    supabase
      .from("ccbpl_penalties")
      .select("id, reason, amount, penalty_date, status")
      .eq("tenant_id", tenantId)
      .gte("penalty_date", fromDate)
      .lte("penalty_date", toDate)
      .neq("status", "disputed")
      .order("penalty_date"),

    // Agency Penalties — table: expense_penalties (Agency Expenses)
    supabase
      .from("expense_penalties")
      .select("id, description, reason, amount, expense_date, created_at, bank_account_id, vendor_account_id")
      .eq("tenant_id", tenantId)
      .gte("expense_date", fromDate)
      .lte("expense_date", toDate)
      .order("expense_date"),


    // Bank accounts lookup for Paid Via labels
    supabase
      .from("bank_accounts")
      .select("id, bank_name")
      .eq("tenant_id", tenantId)
      .eq("active", true),

    // Vendor accounts lookup for Paid Via labels
    supabase
      .from("vendor_accounts")
      .select("id, vendor_name, account_title")
      .eq("tenant_id", tenantId),

    // Unrecoverable Loans
    supabase
      .from("employee_loans")
      .select("id, principal_amount, issued_date, reason, bank_account_id, override_reason, employees(full_name)")
      .eq("tenant_id", tenantId)
      .gte("issued_date", fromDate)
      .lte("issued_date", toDate)
      .order("issued_date"),
  ]);

  const additionalDiscountTotal = await getMonthlyAdditionalDiscountsTotal(fromDate, toDate);

  const bankMap = new Map<string, string>(
    (bankAccountsRes.data || []).map((b: any) => [b.id, b.bank_name])
  );

  const vendorMap = new Map<string, string>(
    (vendorAccountsRes.data || []).map((v: any) => [v.id, v.vendor_name || v.account_title || "CCBPL"])
  );

  const unrecoverableLoans = await withUnrecoverableExpenseAmounts(
    unrecLoansRes.data || [],
    tenantId,
    toDate
  );

  const combinedPenalties = [
    ...(penaltiesRes.data || []).map((p: any) => ({
      id: p.id,
      reason: p.reason || "CCBPL Penalty",
      description: p.reason || "CCBPL Penalty",
      amount: Number(p.amount) || 0,
      penalty_date: p.penalty_date,
      expense_date: p.penalty_date,
      bank_account_id: null,
      vendor_account_id: null,
      source: "ccbpl",
    })),
    ...(agencyPenaltiesRes.data || []).map((p: any) => ({
      id: p.id,
      reason: p.reason || p.description || "Penalty",
      description: p.description || p.reason || "Penalty",
      amount: Number(p.amount) || 0,
      penalty_date: p.expense_date || (p.created_at ? p.created_at.slice(0, 10) : ""),
      expense_date: p.expense_date || (p.created_at ? p.created_at.slice(0, 10) : ""),
      bank_account_id: p.bank_account_id,
      vendor_account_id: p.vendor_account_id,
      source: "agency",
    })),
  ].sort((a: any, b: any) => (a.expense_date || "").localeCompare(b.expense_date || ""));

  return {
    bills:            billsRes.data         || [],
    fuel:             fuelRes.data          || [],
    maintenance:      maintenanceRes.data   || [],
    laborers:         laborerRes.data       || [],
    payroll:          payrollRes.data       || [],
    entertainment:    entertainmentRes.data || [],
    petty:            pettyRes.data         || [],
    penalties:        combinedPenalties,
    additionalDiscountTotal,
    unrecoverableLoans,
    bankMap,
    vendorMap,
  };
}

/**
 * Helper to fetch all rows from Supabase, overcoming the default PostgREST 1000-row limit.
 */
async function fetchAllSupabaseRows<T = any>(queryBuilder: any): Promise<{ data: T[]; error: any }> {
  const PAGE_SIZE = 1000;
  let allRows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryBuilder.range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("[fetchAllSupabaseRows] query error:", error.message);
      return { data: allRows, error };
    }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: allRows, error: null };
}

/**
 * getIncomeStatementData — fetches all data for the Income Statement.
 * Per FINANCIAL_ANALYSIS_AND_STATEMENTS.md spec.
 *
 * Inventory figures come from the perpetual FIFO engine in `src/lib/fifo/engine.ts`.
 * This action's job is to translate the database into that engine's event stream:
 *
 *   stock_report_entries  → `opening_count` inflows (physical counts, start of their date)
 *   sell_in_orders        → `purchase` inflows at their arrival date
 *   delivered invoices    → `sale` outflows at their delivery date
 *
 * The engine replays the whole stream once and measures Opening Stock and Closing Stock
 * from the same ledger, so `Opening + Purchases + Adjustments − COGS = Closing` is an
 * identity rather than an assumption.
 *
 * Revenue = SUM(invoices.amount) — advance_tax is a pass-through to FBR, shown separately.
 */
export async function getIncomeStatementData(fromDate: string, toDate: string) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) return null;

  // Date inputs reach this action from date pickers and from the Balance Sheet's
  // start-of-month derivation; normalise to a bare ISO date so lexicographic comparison
  // against DATE columns is always valid.
  const periodFrom = String(fromDate || "").slice(0, 10);
  const periodTo = String(toDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(periodTo)) return null;
  if (periodFrom > periodTo) return null;

  const [
    invoicesRes,
    openingStockRes,
    sellInRes,
    saleEntriesRes,
    damagedRes,
    waybillRes,
    leasedEmptiesRes,
    productsRes,
    schemeRes,
    billsRes,
    fuelRes,
    maintenanceRes,
    laborerRes,
    payrollRes,
    entertainmentRes,
    pettyRes,
    penaltiesRes,
    agencyPenaltiesRes,
    discountInvoicesRes,
    bankAccountsRes,
    unrecLoansRes,
  ] = await Promise.all([
    fetchAllSupabaseRows(
      supabase
        .from("invoices")
        // FMCG rule: only DELIVERED invoices with a delivery_date count as real sales.
        // Fetch up to toDate so we have both pre-period and in-period delivered goods.
        .select("id, invoice_no, amount, invoice_total, advance_tax, grand_total, discount_amount, delivery_date, delivery_status, products")
        .eq("tenant_id", tenantId)
        .eq("delivery_status", "delivered")
        .lte("delivery_date", toDate)
    ),

    fetchAllSupabaseRows(
      supabase
        .from("stock_report_entries")
        .select("product_id, ph_case, unit_case, report_date, amount")
        .eq("tenant_id", tenantId)
        .order("report_date", { ascending: false })
    ),

    fetchAllSupabaseRows(
      supabase
        .from("sell_in_orders")
        // Fetch ALL confirmed POs — no DB-level date filter here.
        // PostgreSQL returns NULL for (null_column <= date), which would silently drop POs
        // whose transaction_date is null but have a valid billed_date or created_at.
        // Client-side getOrderEffDate() handles the date routing safely.
        // sell_in_arrived_lines carries what actually came off the truck, which is what the
        // warehouse views count and therefore what the FIFO ledger must receive.
        .select("id, po_no, transaction_date, billed_date, created_at, status, sell_in_lines(product_id, bill_amount, net_bill_amount, qty, rate, invoice_type, sell_in_arrived_lines(arrived_qty, returned_qty))")
        .eq("tenant_id", tenantId)
        .neq("status", "in_progress")
    ),

    fetchAllSupabaseRows(
      supabase
        .from("sale_entries")
        .select("id, sale_no, sale_date, sale_entry_lines(product_id, qty)")
        .eq("tenant_id", tenantId)
    ),

    // ── Non-sale outflows ───────────────────────────────────────────────────
    // These reduce on-hand stock in warehouse_standard_levels, so they must reduce the FIFO
    // ledger too or Closing Stock reads high by their cost forever. They leave at FIFO cost
    // but are not cost of goods sold, so the engine reports them as write-offs.

    // Damaged stock at every status: both warehouse_standard_levels (v62) and
    // stock_balance_by_level (v37) subtract damaged cases whether or not the CCBPL claim has
    // been settled, because damaged cases are not saleable stock either way.
    fetchAllSupabaseRows(
      supabase
        .from("damaged_stock")
        .select("product_name, quantity, recorded_date")
        .eq("tenant_id", tenantId)
        .gt("quantity", 0)
        .lte("recorded_date", toDate)
    ),

    // Empties dispatched back to CCBPL.
    fetchAllSupabaseRows(
      supabase
        .from("waybill_items")
        .select("product_id, quantity, waybills!inner(date)")
        .eq("tenant_id", tenantId)
        .gt("quantity", 0)
        .lte("waybills.date", toDate)
    ),

    // Empties lent to outlets, net of what has come back.
    fetchAllSupabaseRows(
      supabase
        .from("leased_empty_items")
        .select("id, product_id, quantity, returned_qty, returned_date, leased_empties!inner(date), leased_empty_returns(return_date, quantity)")
        .eq("tenant_id", tenantId)
        .gt("quantity", 0)
        .lte("leased_empties.date", toDate)
    ),

    fetchAllSupabaseRows(
      supabase
        .from("products")
        .select("id, product_name, product_code, purchase_rate, is_returnable, product_categories(id, title, is_implied, is_rgb, is_returnable)")
        .eq("tenant_id", tenantId)
    ),

    supabase
      .from("scheme_income")
      .select("id, description, amount, income_date")
      .eq("tenant_id", tenantId)
      .gte("income_date", fromDate)
      .lte("income_date", toDate)
      .order("income_date"),

    supabase
      .from("expense_bills")
      .select("id, bill_name, amount, expense_date")
      .eq("tenant_id", tenantId)
      .gte("expense_date", fromDate)
      .lte("expense_date", toDate),

    supabase
      .from("fuel_entries")
      .select("id, truck_no, driver_name, amount, entry_date")
      .eq("tenant_id", tenantId)
      .gte("entry_date", fromDate)
      .lte("entry_date", toDate),

    supabase
      .from("vehicle_maintenance")
      .select("id, vehicle_no, driver_name, amount, entry_date, description")
      .eq("tenant_id", tenantId)
      .gte("entry_date", fromDate)
      .lte("entry_date", toDate),

    supabase
      .from("laborer_expenses")
      .select("id, work, amount, from_date, to_date")
      .eq("tenant_id", tenantId)
      .gte("from_date", fromDate)
      .lte("from_date", toDate),

    supabase
      .from("payroll_runs")
      .select("id, salary_month, net_payable, expense_date, bank_account_id, employee_id, employees(full_name, role)")
      .eq("tenant_id", tenantId)
      .gte("expense_date", fromDate)
      .lte("expense_date", toDate),

    supabase
      .from("expense_entertainment")
      .select("id, description, amount, expense_date")
      .eq("tenant_id", tenantId)
      .gte("expense_date", fromDate)
      .lte("expense_date", toDate),

    supabase
      .from("expense_petty")
      .select("id, description, amount, expense_date")
      .eq("tenant_id", tenantId)
      .gte("expense_date", fromDate)
      .lte("expense_date", toDate),

    // CCBPL Penalties — table: ccbpl_penalties; exclude disputed; hard delete
    supabase
      .from("ccbpl_penalties")
      .select("id, reason, amount, penalty_date, status")
      .eq("tenant_id", tenantId)
      .gte("penalty_date", fromDate)
      .lte("penalty_date", toDate)
      .neq("status", "disputed"),

    // Agency Penalties — table: expense_penalties (Agency Expenses)
    supabase
      .from("expense_penalties")
      .select("id, description, reason, amount, expense_date, created_at, bank_account_id, vendor_account_id")
      .eq("tenant_id", tenantId)
      .gte("expense_date", fromDate)
      .lte("expense_date", toDate),

    supabase
      .from("invoices")
      .select("id, delivery_date, discount_amount")
      .eq("tenant_id", tenantId)
      .gte("delivery_date", fromDate)
      .lte("delivery_date", toDate)
      .eq("delivery_status", "delivered")
      .gt("discount_amount", 0),

    supabase
      .from("bank_accounts")
      .select("id, bank_name")
      .eq("tenant_id", tenantId)
      .eq("active", true),

    // Unrecoverable Loans
    supabase
      .from("employee_loans")
      .select("id, principal_amount, issued_date, reason, bank_account_id, override_reason, employees(full_name)")
      .eq("tenant_id", tenantId)
      .gte("issued_date", fromDate)
      .lte("issued_date", toDate)
      .order("issued_date"),
  ]);

  const soldEmptiesRes = await supabase
    .from("sold_empties")
    .select("amount")
    .eq("tenant_id", tenantId)
    .gte("date", fromDate)
    .lte("date", toDate);
  const soldEmptiesTotal = (soldEmptiesRes.data || []).reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);

  const bankMap = new Map<string, string>(
    (bankAccountsRes.data || []).map((b: any) => [b.id, b.bank_name])
  );

  // A failed fetch on any of these three would silently zero out Opening Stock, Purchases or
  // COGS rather than showing an error, so surface it instead of reporting a confident wrong
  // number. `fetchAllSupabaseRows` returns whatever it managed to read plus the error.
  for (const [label, res] of [
    ["invoices", invoicesRes],
    ["sell_in_orders", sellInRes],
    ["stock_report_entries", openingStockRes],
    ["sale_entries", saleEntriesRes],
    ["damaged_stock", damagedRes],
    ["waybill_items", waybillRes],
    ["leased_empty_items", leasedEmptiesRes],
  ] as const) {
    if (res.error) {
      console.error(
        `[getIncomeStatementData] ${label} fetch failed — inventory figures would be ` +
        `understated: ${res.error.message}`
      );
      return null;
    }
  }

  const rawOrders = sellInRes.data || [];

  // ── Product classification and the stock-out fallback rate ────────────────
  // Costs always come from the batch a unit actually arrived in. `products.purchase_rate`
  // is only consulted when the ledger has no batch left to draw from, which is a data gap
  // rather than a valuation choice — the engine reports every such draw separately so an
  // edited purchase_rate can never quietly restate history.
  const productClassification = classifyProducts(productsRes.data || []);
  const { impliedProductIds, fallbackRates: fallbackProductRates } = productClassification;

  // Empties are identified by their category flag alone. Anything that merely reads like an
  // empty is costed as ordinary stock, which is the safe direction to be wrong in — an
  // over-costed product is visible in the figures, whereas an excluded one vanishes without
  // trace. Report the near-misses so a genuinely mis-categorised SKU can be fixed.
  if (productClassification.suspectedUnflaggedImplied.length > 0) {
    console.warn(
      `[getIncomeStatementData] ${productClassification.suspectedUnflaggedImplied.length} ` +
      `product(s) look like empties by name or code but their category does not set ` +
      `is_implied, so they are being costed as ordinary stock. Set is_implied in the ` +
      `Products menu if any of these is really an empty: ` +
      productClassification.suspectedUnflaggedImplied
        .slice(0, 15)
        .map((p) => `${p.product_code ?? "?"} ${p.product_name ?? p.id}`)
        .join(" | ")
    );
  }

  // ── Translate the database into one chronological inventory event stream ──
  const { events: fifoEvents, orderValueById, unlinkedInvoices, unmatchedDamagedNames } =
    buildFifoEvents({
      products: productClassification,
      stockReports: openingStockRes.data || [],
      sellInOrders: rawOrders,
      saleEntries: saleEntriesRes.data || [],
      invoices: invoicesRes.data || [],
      damagedStock: damagedRes.data || [],
      waybillItems: waybillRes.data || [],
      leasedEmptyItems: leasedEmptiesRes.data || [],
    });
  const unlinkedInvoiceCount = unlinkedInvoices.length;

  // ══════════════════════════════════════════════════════════════════════════
  // ── Replay the ledger ──────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  //
  // One chronological pass over the whole event stream produces every inventory figure.
  // Period classification is the engine's, and follows the business meaning of each source:
  //
  //   stock count dated on fromDate   → Opening Stock (it counts the warehouse at day open)
  //   PO arriving on fromDate         → a Purchase of the period, not Opening Stock
  //   delivery dated on fromDate      → an in-period sale
  //
  const fifo = runFifo(fifoEvents, {
    fromDate: periodFrom,
    toDate: periodTo,
    excludedProductIds: impliedProductIds,
    fallbackRates: fallbackProductRates,
  });

  const openingStockValue = fifo.openingStockValue;
  const closingStockValue = fifo.closingStockValue;
  const cogs = fifo.cogs;
  const totalPurchases = fifo.purchasesValue;

  // ── Purchases drill-down ──────────────────────────────────────────────────
  // Same quantity and rate the ledger received, so these lines always sum to totalPurchases.
  const purchaseLines: Array<{ po_no?: string; transaction_date: string; bill_amount: number }> = [];
  for (const order of rawOrders) {
    const effDate = getOrderEffDate(order);
    if (!effDate) continue;
    const effDay = effDate.slice(0, 10);
    if (effDay < periodFrom || effDay > periodTo) continue;
    const orderTotal = orderValueById.get(order.id);
    if (orderTotal === undefined || orderTotal === 0) continue;
    purchaseLines.push({
      po_no: order.po_no,
      transaction_date: effDate,
      bill_amount: round2(orderTotal),
    });
  }

  // ── Inventory adjustments ─────────────────────────────────────────────────
  // Movements that change stock value without being a sale or a purchase order:
  //   • stock counts dated inside the period (a count on fromDate is Opening Stock instead)
  //   • write-offs such as damaged stock, which leave at FIFO cost
  //   • goods sold that the ledger never received — a missing PO or stock report, surfaced
  //     as a figure instead of being allowed to unbalance the statement
  // Including this line is what keeps Opening + Purchases + Adjustments − Closing = COGS
  // exact when a stock report lands mid-period.
  const stockCountAdditions = fifo.adjustmentsInValue;
  const stockWriteOffs = fifo.writeOffsValue;
  const unrecordedPurchases = fifo.unrecordedPurchasesValue;
  const inventoryAdjustments = round2(stockCountAdditions + unrecordedPurchases - stockWriteOffs);

  const fifoDiagnostics = {
    stockCountAdditions,
    stockWriteOffs,
    unrecordedPurchases,
    shortfallQty: fifo.diagnostics.shortfallQty,
    shortfalls: fifo.diagnostics.shortfalls.slice(0, 25),
    unlinkedInvoiceCount,
    unmatchedDamagedCount: unmatchedDamagedNames.length,
    identityDelta: fifo.identityDelta,
    eventCount: fifo.diagnostics.processedEventCount,
    skippedEventCount: fifo.diagnostics.skippedEventCount,
  };

  // Development-only trace of every term in the inventory identity, so a figure that looks
  // wrong on screen can be attributed to a component without re-deriving it by hand.
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[FIFO ${periodFrom}..${periodTo}] ` +
      `opening=${openingStockValue.toFixed(2)} purchases=${totalPurchases.toFixed(2)} ` +
      `counts=${stockCountAdditions.toFixed(2)} writeOffs=${stockWriteOffs.toFixed(2)} ` +
      `unrecorded=${unrecordedPurchases.toFixed(2)} adjustments=${inventoryAdjustments.toFixed(2)} ` +
      `closing=${closingStockValue.toFixed(2)} cogs=${cogs.toFixed(2)} ` +
      `measuredCogs=${fifo.measuredCogs.toFixed(2)} delta=${fifo.identityDelta.toFixed(2)} ` +
      `events=${fifo.diagnostics.processedEventCount}/${fifo.diagnostics.eventCount} ` +
      `damagedRows=${(damagedRes.data || []).length} ` +
      `waybillRows=${(waybillRes.data || []).length} ` +
      `leasedRows=${(leasedEmptiesRes.data || []).length}`
    );
  }

  if (
    unlinkedInvoiceCount > 0 ||
    unmatchedDamagedNames.length > 0 ||
    fifo.diagnostics.shortfallQty > 0 ||
    Math.abs(fifo.identityDelta) > 0.05
  ) {
    console.warn(
      `[getIncomeStatementData] ${periodFrom}–${periodTo} data gaps: ` +
      `${unlinkedInvoiceCount} delivered invoice(s) with no sale_entry link and no parseable ` +
      `products text (costed at Rs 0); ${fifo.diagnostics.shortfallQty} case(s) removed without a ` +
      `matching purchase or stock report (valued at products.purchase_rate, ` +
      `Rs ${unrecordedPurchases.toFixed(2)}); ` +
      `${unmatchedDamagedNames.length} damaged-stock row(s) whose product_name matches no ` +
      `product` +
      (unmatchedDamagedNames.length
        ? ` (${[...new Set(unmatchedDamagedNames)].slice(0, 5).join(", ")})`
        : "") +
      `; ledger-vs-statement delta Rs ${fifo.identityDelta.toFixed(2)}.`
    );
  }

  const allDeliveredInvoices = invoicesRes.data || [];

  // ── Net Profit — computed ONCE here, used by both Income Statement and Balance Sheet ──
  // This is the single source of truth. The Balance Sheet imports this value directly
  // instead of re-implementing the formula, eliminating any drift between the two pages.
  const _invoices    = allDeliveredInvoices.filter((i: any) => {
    const d = (i.delivery_date || "").slice(0, 10);
    return d >= periodFrom && d <= periodTo;
  });
  const _schemes = schemeRes.data || [];
  const allSchemes = soldEmptiesTotal > 0
    ? [..._schemes, { description: "Sold Empties", amount: soldEmptiesTotal }]
    : _schemes;
  const _bills       = billsRes.data || [];
  const _fuel        = fuelRes.data || [];
  const _maintenance = maintenanceRes.data || [];
  const _laborers    = laborerRes.data || [];
  const _payroll     = payrollRes.data || [];
  const _ent         = entertainmentRes.data || [];
  const _petty       = pettyRes.data || [];
  const _penalties = [
    ...(penaltiesRes.data || []).map((p: any) => ({
      id: p.id,
      reason: p.reason || "CCBPL Penalty",
      description: p.reason || "CCBPL Penalty",
      amount: Number(p.amount) || 0,
      penalty_date: p.penalty_date,
      expense_date: p.penalty_date,
      bank_account_id: null,
      vendor_account_id: null,
      source: "ccbpl",
    })),
    ...(agencyPenaltiesRes.data || []).map((p: any) => ({
      id: p.id,
      reason: p.reason || p.description || "Penalty",
      description: p.description || p.reason || "Penalty",
      amount: Number(p.amount) || 0,
      penalty_date: p.expense_date || (p.created_at ? p.created_at.slice(0, 10) : ""),
      expense_date: p.expense_date || (p.created_at ? p.created_at.slice(0, 10) : ""),
      bank_account_id: p.bank_account_id,
      vendor_account_id: p.vendor_account_id,
      source: "agency",
    })),
  ].sort((a: any, b: any) => (a.expense_date || "").localeCompare(b.expense_date || ""));
  const _discounts   = discountInvoicesRes.data || [];
  const { getMonthlyAdditionalDiscountsTotal } = await import("@/lib/actions/discounts");
  const additionalDiscountTotal = await getMonthlyAdditionalDiscountsTotal(periodFrom, periodTo);
  const _unrecLoans = await withUnrecoverableExpenseAmounts(
    unrecLoansRes.data || [],
    tenantId,
    periodTo
  );

  // Revenue: SUM(amount ?? invoice_total) − SUM(advance_tax) − SUM(wh_tax)
  const totalSale   = _invoices.reduce((s: number, i: any) => s + (Number(i.amount ?? i.invoice_total) || 0), 0);
  const totalAdvTax = _invoices.reduce((s: number, i: any) => s + (Number(i.advance_tax) || 0), 0);
  const totalWHTax  = Math.round(totalSale * 0.001 * 100) / 100;
  const netRevenue  = totalSale - totalAdvTax - totalWHTax;
  const grossProfit = netRevenue - cogs;

  // Scheme income
  const schemesTotal = allSchemes.reduce((s: number, sc: any) => s + (Number(sc.amount) || 0), 0);
  const totalIncome  = grossProfit + schemesTotal;

  // OPEX
  const opexBills      = _bills.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
  const opexFuel       = _fuel.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
  const opexMaint      = _maintenance.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
  const opexLaborers   = _laborers.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
  const opexPayroll    = _payroll.reduce((s: number, r: any) => s + (Number(r.net_payable) || 0), 0);
  const opexEnt        = _ent.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
  const opexPetty      = _petty.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
  const opexPenalties  = _penalties.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);
  const opexDiscounts  = additionalDiscountTotal;
  const opexUnrecLoans = _unrecLoans.reduce(
    (s: number, r: any) => s + (Number(r.expense_amount ?? r.outstanding_balance ?? r.principal_amount) || 0),
    0
  );
  const totalOpex      = opexBills + opexFuel + opexMaint + opexLaborers + opexPayroll + opexEnt + opexPetty + opexPenalties + opexDiscounts + opexUnrecLoans;

  // Net Profit = Total Income − Total OPEX
  const netProfit = totalIncome - totalOpex;

  return {
    invoices: _invoices,
    openingStockValue,
    purchaseLines,
    totalPurchases,
    closingStockValue,
    cogs,
    // ── Inventory movements that are neither a sale nor a purchase order ──
    // Non-zero only when a stock report lands mid-period, stock is written off, or goods were
    // sold that the ledger never received. The Income Statement shows it as its own line so
    // Opening + Purchases + Adjustments − Closing = COGS always balances on screen.
    inventoryAdjustments,
    fifoDiagnostics,
    // ── Pre-computed P&L summary (single source of truth) ──
    totalSale,
    totalAdvTax,
    totalWHTax,
    netRevenue,
    grossProfit,
    schemesTotal,
    totalIncome,
    totalOpex,
    netProfit,                 // ← Balance Sheet uses this directly
    // Raw arrays (for detailed display in Income Statement client)
    schemes:           allSchemes,
    bills:             _bills,
    fuel:              _fuel,
    maintenance:       _maintenance,
    laborers:          _laborers,
    payroll:           _payroll,
    entertainment:     _ent,
    petty:             _petty,
    penalties:         _penalties,
    discountInvoices:  _discounts,
    additionalDiscountTotal,
    unrecoverableLoans: _unrecLoans,
    bankMap,
  };
}

// Bug #11 Fix: Added optional `periodFromDate` parameter.
// The Balance Sheet always called getIncomeStatementData(startOfMonth, targetDate), which
// was independent of the user's selected Income Statement filter. This caused the closing
// stock on the Balance Sheet to differ from the IS whenever the user's period didn't start
// on the 1st of the month. Pass the same fromDate used in the IS to keep them consistent.
export async function getBalanceSheetData(asOfDate?: string, periodFromDate?: string) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) return null;

  const targetDate  = asOfDate || new Date().toISOString().split("T")[0];
  const startOfMonth = `${targetDate.slice(0, 8)}01`;
  // Use caller-supplied period start if available; otherwise default to start-of-month.
  const isFromDate  = periodFromDate || startOfMonth;

  const [
    bankAccountsRes,
    vendorAccountsRes,
    settingsRes,
    paymentsRes,
    invoicesRes,
    employeeLoansRes,
    prodsRes,
    sellInRes,
    sreRes,
    saleRes,
    waybillRes,
    damagedRes,
    returnsRes,
    leasedEmptiesRes,
    incomeStatementData,
  ] = await Promise.all([
    getBankAccounts(tenantId, targetDate),
    getVendorAccounts(tenantId, targetDate),
    supabase
      .from("tenant_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    fetchAllSupabaseRows(
      supabase
        .from("shop_payments")
        .select("id, invoice_id, amount, payment_date")
        .eq("tenant_id", tenantId)
        .lte("payment_date", targetDate)
    ),
    fetchAllSupabaseRows(
      supabase
        .from("invoices")
        .select("id, invoice_no, invoice_type, grand_total, amount, amount_received, invoice_total, payment_status, shop_id, outlet_code, delivery_date, invoice_date, record_date, shop:shops(id, shop_name, shop_type, outlet_type)")
        .eq("tenant_id", tenantId)
    ),
    getCalculatedEmployeeLoans(tenantId, targetDate),
    fetchAllSupabaseRows(
      supabase
        .from("products")
        .select("id, product_name, product_code, purchase_rate, product_categories(id, title, is_returnable, is_rgb, is_implied)")
        .eq("tenant_id", tenantId)
    ),
    fetchAllSupabaseRows(
      supabase
        .from("sell_in_lines")
        .select("product_id, qty, invoice_type, sell_in_orders!inner(transaction_date, status), sell_in_arrived_lines(arrived_qty, returned_qty)")
        .eq("sell_in_orders.tenant_id", tenantId)
        .in("sell_in_orders.status", ["stock_arrived", "on_credit", "billed"])
        .lte("sell_in_orders.transaction_date", targetDate)
    ),
    fetchAllSupabaseRows(
      supabase
        .from("stock_report_entries")
        .select("product_id, ph_case, report_date")
        .eq("tenant_id", tenantId)
        .gt("ph_case", 0)
        .lte("report_date", targetDate)
    ),
    fetchAllSupabaseRows(
      supabase
        .from("sale_entry_lines")
        .select("product_id, qty, sale_entries!inner(sale_date)")
        .eq("sale_entries.tenant_id", tenantId)
        .lte("sale_entries.sale_date", targetDate)
    ),
    fetchAllSupabaseRows(
      supabase
        .from("waybill_items")
        .select("product_id, quantity, waybills!inner(date)")
        .eq("waybills.tenant_id", tenantId)
        .gt("quantity", 0)
        .lte("waybills.date", targetDate)
    ),
    fetchAllSupabaseRows(
      supabase
        .from("damaged_stock")
        // No status filter, matching warehouse_standard_levels (v62) and the FIFO ledger:
        // damaged cases are off the floor whether or not the CCBPL claim has settled.
        .select("product_name, quantity, recorded_date")
        .eq("tenant_id", tenantId)
        .gt("quantity", 0)
        .lte("recorded_date", targetDate)
    ),
    fetchAllSupabaseRows(
      supabase
        .from("invoice_returns")
        .select("product_name, returned_qty, return_date")
        .eq("tenant_id", tenantId)
        .gt("returned_qty", 0)
        .lte("return_date", targetDate)
    ),
    // Empties out on loan to outlets are off the floor until they come back.
    fetchAllSupabaseRows(
      supabase
        .from("leased_empty_items")
        .select("id, product_id, quantity, returned_qty, returned_date, leased_empties!inner(date), leased_empty_returns(return_date, quantity)")
        .eq("tenant_id", tenantId)
        .gt("quantity", 0)
        .lte("leased_empties.date", targetDate)
    ),
    getIncomeStatementData(isFromDate, targetDate), // Bug #11: uses caller-supplied period start
  ]);

  // ── A. Liquid Assets — Cash & Bank ──────────────────────────────────────────
  const bankAccounts = (bankAccountsRes || []).filter((b: any) => {
    if (b.active === false) return false;
    const accDate = b.created_at ? new Date(b.created_at).toISOString().split("T")[0] : null;
    if (targetDate && accDate && targetDate < accDate) return false;
    return true;
  });

  let cashInHand = 0;
  let bankBalancesTotal = 0;
  const liquidAccounts: Array<{ name: string; title: string; balance: number; isCash: boolean }> = [];

  for (const b of bankAccounts) {
    const bal = Number(b.current_balance) || 0;
    const isCash =
      (b.bank_name || "").toLowerCase().includes("cash") ||
      (b.account_title || "").toLowerCase().includes("cash");
    if (isCash) {
      cashInHand += bal;
    } else {
      bankBalancesTotal += bal;
    }
    liquidAccounts.push({
      name: b.bank_name || "Account",
      title: b.account_title || "",
      balance: bal,
      isCash,
    });
  }

  // ── B. CCBPL Account (Deposit & Surplus) & F. CCBPL Trade Payable ───────────
  const vendors = vendorAccountsRes || [];
  const ccbplVendor =
    vendors.find((v: any) => (v.vendor_name || "").toLowerCase().includes("ccbpl")) ||
    vendors[0] ||
    null;
  const ccbplCreationDate = ccbplVendor?.created_at ? new Date(ccbplVendor.created_at).toISOString().split("T")[0] : null;
  const ccbplExists = !targetDate || !ccbplCreationDate || targetDate >= ccbplCreationDate;
  const ccbplBalance = ccbplExists && ccbplVendor ? Number(ccbplVendor.current_balance) || 0 : 0;
  const depositFloor = Number((settingsRes.data as any)?.ccbpl_deposit_floor) || 40000000;

  let guaranteeAmount = Number((settingsRes.data as any)?.guaranteed_amount || 0);
  if (!guaranteeAmount && tenantId) {
    try {
      const { data: gff } = await supabase
        .from("global_feature_flags")
        .select("label")
        .eq("flag_key", `guaranteed_amount:${tenantId}`)
        .maybeSingle();
      if (gff?.label) {
        const parsed = JSON.parse(gff.label);
        if (parsed?.guaranteed_amount !== undefined) {
          guaranteeAmount = Number(parsed.guaranteed_amount);
        }
      }
    } catch {}
  }

  let ccbplDepositAsset = 0;
  let ccbplSurplusAsset = 0;
  if (ccbplExists && ccbplVendor) {
    if (ccbplBalance >= depositFloor) {
      ccbplDepositAsset = depositFloor;
      ccbplSurplusAsset = ccbplBalance > depositFloor ? ccbplBalance - depositFloor : 0;
    } else {
      ccbplDepositAsset = Math.max(0, ccbplBalance);
      ccbplSurplusAsset = 0;
    }
  }

  // ── F. Current Liabilities: CCBPL Trade Payable = Used - Guarantee ──────────
  const ccbplUsed = ccbplExists && ccbplVendor
    ? Number(ccbplVendor.current_used ?? ccbplVendor.initial_used ?? 0)
    : 0;
  const ccbplTradePayable = Math.max(0, ccbplUsed - guaranteeAmount);

  // ── C. Trade Receivables ──────────────────────────────────────────────────
  const paymentMap = new Map<string, number>();
  for (const p of (paymentsRes.data || [])) {
    if (p.invoice_id) {
      paymentMap.set(p.invoice_id, (paymentMap.get(p.invoice_id) || 0) + Number(p.amount || 0));
    }
  }

  const isToday = targetDate >= new Date().toISOString().split("T")[0];
  const rawInvoices = invoicesRes.data || [];
  const creditInvoices = rawInvoices.filter((i: any) => {
    const invDate = (i.delivery_date || i.invoice_date || i.record_date || "").split("T")[0];
    if (invDate && invDate > targetDate) return false;

    const isCreditType = (i.invoice_type || "").toLowerCase() === "credit";
    const shopType = (i.shop?.shop_type || "").toLowerCase();
    const outletType = (i.shop?.outlet_type || "").toLowerCase();
    const isCreditShop = shopType === "credit" || outletType === "credit";

    if (!isCreditType && !isCreditShop) return false;

    const total = Number(i.amount ?? i.invoice_total ?? i.grand_total ?? 0);
    const receivedOnOrBefore = paymentMap.has(i.id)
      ? paymentMap.get(i.id)!
      : (isToday ? Number(i.amount_received || 0) : 0);
    return (total - receivedOnOrBefore) > 0.01;
  });

  const tradeReceivables = creditInvoices.reduce((sum: number, i: any) => {
    const total = Number(i.amount ?? i.invoice_total ?? i.grand_total ?? 0);
    const receivedOnOrBefore = paymentMap.has(i.id)
      ? paymentMap.get(i.id)!
      : (isToday ? Number(i.amount_received || 0) : 0);
    return sum + Math.max(0, total - receivedOnOrBefore);
  }, 0);

  const debtorShopsCount = new Set(
    creditInvoices.map((i: any) => i.shop_id || i.outlet_code).filter(Boolean)
  ).size;

  // ── D. Staff Loans Receivable ─────────────────────────────────────────────
  const calculatedLoansData = employeeLoansRes;
  const loans = calculatedLoansData?.loans || [];
  const staffLoansReceivable = calculatedLoansData?.totalOutstanding || 0;
  const activeLoansCount = calculatedLoansData?.activeLoansCount || 0;
  const deadAssets = calculatedLoansData?.totalDeadAssets || 0;
  const deadLoansCount = calculatedLoansData?.deadLoansCount || 0;

  // ── E. Warehouse Inventory (Closing Stock) as of targetDate ────────────────
  const prods = prodsRes.data || [];
  const prodIdMap = new Map(prods.map((p: any) => [p.id, p]));
  const prodNameMap = new Map(prods.map((p: any) => [p.product_name.toLowerCase().trim(), p]));

  const inMap = new Map<string, number>();
  const outMap = new Map<string, number>();
  const addIn = (id: string, q: number) => inMap.set(id, (inMap.get(id) || 0) + q);
  const addOut = (id: string, q: number) => outMap.set(id, (outMap.get(id) || 0) + q);

  (sellInRes.data || []).forEach((l: any) => {
    if (!l.product_id) return;
    const arrived = Array.isArray(l.sell_in_arrived_lines) ? l.sell_in_arrived_lines[0] : l.sell_in_arrived_lines;
    const net = arrived ? (Number(arrived.arrived_qty || 0) - Number(arrived.returned_qty || 0)) : Number(l.qty || 0);
    if (l.invoice_type === "return") addOut(l.product_id, Math.abs(net));
    else addIn(l.product_id, Math.max(0, net));
  });

  (sreRes.data || []).forEach((r: any) => {
    if (r.product_id) addIn(r.product_id, Number(r.ph_case || 0));
  });

  (saleRes.data || []).forEach((l: any) => {
    if (!l.product_id) return;
    const q = Number(l.qty || 0);
    const p = prodIdMap.get(l.product_id);
    const isImplied = Boolean((p?.product_categories as any)?.is_implied);
    if (isImplied) {
      if (q < 0) addIn(l.product_id, Math.abs(q));
      else if (q > 0) addOut(l.product_id, q);
    } else {
      if (q > 0) addOut(l.product_id, q);
    }
  });

  (waybillRes.data || []).forEach((w: any) => {
    if (w.product_id) addOut(w.product_id, Number(w.quantity || 0));
  });

  (damagedRes.data || []).forEach((d: any) => {
    const p = prodNameMap.get((d.product_name || "").toLowerCase().trim());
    if (p) addOut(p.id, Number(d.quantity || 0));
  });

  (returnsRes.data || []).forEach((r: any) => {
    const p = prodNameMap.get((r.product_name || "").toLowerCase().trim());
    if (p) addIn(p.id, Number(r.returned_qty || 0));
  });

  (leasedEmptiesRes.data || []).forEach((l: any) => {
    const leaseDate = Array.isArray(l.leased_empties) ? l.leased_empties[0]?.date : l.leased_empties?.date;
    const returns = (l.leased_empty_returns || []).map((r: any) => ({
      date: String(r.return_date || "").slice(0, 10),
      quantity: Number(r.quantity || 0),
    }));
    const net = leaseOutstandingAsOf({
      quantity: Number(l.quantity || 0),
      returnedQty: Number(l.returned_qty || 0),
      returnedDate: l.returned_date,
      returns,
      leaseDate: leaseDate || "",
      asOfDate: targetDate,
    });
    if (l.product_id && net > 0) addOut(l.product_id, net);
  });

  // ── Empties Stock ─────────────────────────────────────────────────────────
  // Empties are valued at quantity × products.purchase_rate because they have no purchase
  // history of their own to run FIFO against — they arrive as part of a beverage load and
  // circulate between the warehouse and the trade rather than being bought and sold.
  //
  // Beverage stock is deliberately NOT computed here. It comes from the Income Statement's
  // FIFO ledger, which is the only code that knows which batch each case arrived in. Valuing
  // it the same way as empties would price pre-existing stock at today's purchase_rate, so
  // editing a rate in the Products menu would silently restate the Balance Sheet and put it
  // at odds with the Income Statement.
  let emptiesStockValue = 0;

  for (const p of prods) {
    const cat = (p.product_categories as any) || {};
    const isRgb = Boolean(cat.is_rgb);
    const isReturnable = Boolean(cat.is_returnable);
    const isImplied = Boolean(cat.is_implied);
    if (isRgb || !(isReturnable || isImplied)) continue;

    const netQty = Math.max(0, (inMap.get(p.id) || 0) - (outMap.get(p.id) || 0));
    emptiesStockValue += netQty * (Number(p.purchase_rate) || 0);
  }

  const finalClosingStockValue = incomeStatementData?.closingStockValue ?? 0;
  if (!incomeStatementData) {
    console.error(
      `[getBalanceSheetData] Income Statement unavailable for ${isFromDate}–${targetDate}; ` +
      `Beverage Closing Stock reported as 0 rather than guessed at current purchase rates.`
    );
  }

  // ── Current Period Net Profit & Retained Earnings ──────────────────────────
  const currentPeriodNetProfit = incomeStatementData?.netProfit ?? 0;

  const totalLiquidAssets = cashInHand + bankBalancesTotal;
  const totalAssets =
    totalLiquidAssets +
    tradeReceivables +
    staffLoansReceivable +
    finalClosingStockValue +
    emptiesStockValue +
    deadAssets;

  const totalLiabilities = ccbplTradePayable;
  const totalEquity = totalAssets - totalLiabilities;
  const capitalAndRetainedEarnings = totalEquity - currentPeriodNetProfit;

  return {
    asOfDate: targetDate,
    periodFromDate: isFromDate,
    cashInHand,
    bankBalancesTotal,
    totalLiquidAssets,
    liquidAccounts,
    ccbplBalance,
    depositFloor,
    ccbplDepositAsset,
    ccbplSurplusAsset,
    tradeReceivables,
    debtorShopsCount,
    staffLoansReceivable,
    activeLoansCount,
    deadAssets,
    deadLoansCount,
    loans,
    closingStockValue: finalClosingStockValue,      // Beverage Stock only, FIFO-valued by the Income Statement
    emptiesStockValue,                             // Recoverable Empties Stock (is_rgb=false, is_returnable/is_implied=true)
    totalAssets,
    ccbplUsed,
    guaranteeAmount,
    ccbplTradePayable,
    totalLiabilities,
    totalEquity,
    currentPeriodNetProfit,
    capitalAndRetainedEarnings,
  };
}
