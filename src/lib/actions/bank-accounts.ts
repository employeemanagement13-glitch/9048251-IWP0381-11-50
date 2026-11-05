"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const REVALIDATE = ["/cash-bank/bank-accounts", "/cash-bank/deposits", "/inventory/sell-in"];

export async function getBankAccounts(targetTenantId?: string, asOfDate?: string) {
  try {
    const supabase = await createClient();
    const tenantId = targetTenantId || await getTenantId();

    let accQuery = supabase.from("bank_accounts").select("*").order("account_title");
    if (tenantId) accQuery = accQuery.eq("tenant_id", tenantId);
    const { data: accounts, error } = await accQuery;
    if (error) { console.error("[getBankAccounts]", error.message); return []; }
    if (!accounts || accounts.length === 0) return [];

    const accCreationMap = new Map<string, string | null>(
      accounts.map((a: any) => [
        a.id,
        a.created_at ? new Date(a.created_at).toISOString().split("T")[0] : null,
      ])
    );

    let ledgerQuery = supabase
      .from("bank_account_ledger")
      .select("bank_account_id, reference, amount_in, amount_out, txn_date");
    if (tenantId) ledgerQuery = ledgerQuery.eq("tenant_id", tenantId);
    if (asOfDate) ledgerQuery = ledgerQuery.lte("txn_date", asOfDate);
    const { data: ledgerData } = await ledgerQuery;

    const totalsMap: Record<string, number> = {};
    const ledgerRefs = new Set<string>();

    (ledgerData || []).forEach((row: any) => {
      const bId = row.bank_account_id;
      const accDate = accCreationMap.get(bId);
      if (accDate && row.txn_date && row.txn_date < accDate) return;

      const net = Number(row.amount_in || 0) - Number(row.amount_out || 0);
      totalsMap[bId] = (totalsMap[bId] || 0) + net;
      if (row.reference) ledgerRefs.add(row.reference);
    });

    try {
      let leQuery = supabase
        .from("laborer_expenses")
        .select("bank_account_id, from_date, to_date, work, amount")
        .not("bank_account_id", "is", null);
      if (tenantId) leQuery = leQuery.eq("tenant_id", tenantId);
      if (asOfDate) leQuery = leQuery.lte("from_date", asOfDate);
      const { data: laborerExpenses } = await leQuery;

      (laborerExpenses || []).forEach((le: any) => {
        const accDate = accCreationMap.get(le.bank_account_id);
        if (accDate && le.from_date && le.from_date < accDate) return;

        const expectedRef = `${le.from_date} - ${le.to_date} | ${le.work || ""}`;
        if (!ledgerRefs.has(expectedRef) && le.bank_account_id) {
          const amt = Number(le.amount || 0);
          totalsMap[le.bank_account_id] = (totalsMap[le.bank_account_id] || 0) - amt;
        }
      });
    } catch {}

    try {
      let loansQuery = supabase
        .from("employee_loans")
        .select("id, principal_amount, issued_date, override_reason, bank_account_id, employee:employees(full_name)");
      if (tenantId) loansQuery = loansQuery.eq("tenant_id", tenantId);
      if (asOfDate) loansQuery = loansQuery.lte("issued_date", asOfDate);
      const { data: loans } = await loansQuery;

      (loans || []).forEach((l: any) => {
        const bankId = l.bank_account_id || l.override_reason?.match(/\[bank:([a-f0-9\-]+)\]/i)?.[1];
        if (bankId) {
          const accDate = accCreationMap.get(bankId);
          if (accDate && l.issued_date && l.issued_date < accDate) return;

          const emp = Array.isArray(l.employee) ? l.employee[0] : l.employee;
          const expectedRef = `${emp?.full_name || "Employee"} | Loan`;
          if (!ledgerRefs.has(expectedRef)) {
            const amt = Number(l.principal_amount || 0);
            totalsMap[bankId] = (totalsMap[bankId] || 0) - amt;
          }
        }
      });
    } catch {}

    try {
      let directRecsQuery = supabase
        .from("employee_loan_recoveries")
        .select(`
          id, amount, bank_account_id, recovery_date,
          loan:employee_loans(outstanding_balance, override_reason, bank_account_id)
        `);
      if (tenantId) directRecsQuery = directRecsQuery.eq("tenant_id", tenantId);
      if (asOfDate) directRecsQuery = directRecsQuery.lte("recovery_date", asOfDate);
      const { data: directRecs } = await directRecsQuery;

      const addedRecIds = new Set<string>();
      (directRecs || []).forEach((dr: any) => {
        if (addedRecIds.has(dr.id)) return;
        addedRecIds.add(dr.id);
        const loan = Array.isArray(dr.loan) ? dr.loan[0] : dr.loan;
        const targetBankId = dr.bank_account_id || loan?.bank_account_id || loan?.override_reason?.match(/\[bank:([a-f0-9\-]+)\]/i)?.[1];
        if (targetBankId) {
          const accDate = accCreationMap.get(targetBankId);
          const rDate = (dr.recovery_date || "").slice(0, 10);
          if (accDate && rDate && rDate < accDate) return;

          const amt = Number(dr.amount || 0);
          totalsMap[targetBankId] = (totalsMap[targetBankId] || 0) + amt;
        }
      });
    } catch {}

    return accounts.map((acc: any) => {
      const accDate = accCreationMap.get(acc.id);
      if (asOfDate && accDate && asOfDate < accDate) {
        return {
          ...acc,
          current_balance: 0,
        };
      }
      return {
        ...acc,
        current_balance: Number(acc.current_balance || 0) + (totalsMap[acc.id] || 0),
      };
    });
  } catch (err: any) {
    console.error("[getBankAccounts] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function createBankAccount(formData: {
  account_title: string;
  description?: string;
  current_balance?: number;
  active?: boolean;
  account_date?: string;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const insertPayload: any = {
    bank_name: formData.account_title,
    account_title: formData.account_title,
    description: formData.description || null,
    current_balance: formData.current_balance ?? 0,
    active: formData.active ?? true,
    tenant_id: tenantId,
  };
  if (formData.account_date) insertPayload.created_at = new Date(formData.account_date + "T12:00:00Z").toISOString();

  const { data, error } = await supabase
    .from("bank_accounts")
    .insert(insertPayload)
    .select().single();
  if (error) throw new Error(error.message);
  REVALIDATE.forEach(p => revalidatePath(p));
  return data;
}

export async function updateBankAccount(id: string, formData: {
  account_title?: string;
  description?: string;
  current_balance?: number;
  active?: boolean;
  account_date?: string;
}) {
  const supabase = await createClient();
  const updatePayload: any = { ...formData };
  delete updatePayload.account_date;
  if (formData.account_title) updatePayload.bank_name = formData.account_title;
  if (formData.account_date) updatePayload.created_at = new Date(formData.account_date + "T12:00:00Z").toISOString();

  const { data, error } = await supabase
    .from("bank_accounts")
    .update(updatePayload)
    .eq("id", id)
    .select().single();
  if (error) throw new Error(error.message);
  REVALIDATE.forEach(p => revalidatePath(p));
  return data;
}

export async function deleteBankAccount(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("bank_accounts").delete().eq("id", id);
  if (error) throw new Error(error.message);
  REVALIDATE.forEach(p => revalidatePath(p));
}

export async function getBankAccountLedger(bankAccountId: string) {
  try {
    const supabase = await createClient();

    const { data: bankAccount, error: accError } = await supabase
      .from("bank_accounts")
      .select("current_balance, created_at")
      .eq("id", bankAccountId)
      .single();

    if (accError) {
      console.error("[getBankAccountLedger] Bank account error:", accError.message);
      return [];
    }

    const creationDate = bankAccount?.created_at
      ? new Date(bankAccount.created_at).toISOString().split("T")[0]
      : null;

    const { data, error } = await supabase
      .from("bank_account_ledger")
      .select("*")
      .eq("bank_account_id", bankAccountId)
      .order("txn_date", { ascending: true })
      .order("amount_in", { ascending: false });

    if (error) {
      console.error("[getBankAccountLedger]", error.message);
      return [];
    }

    let rows = (data || [])
      .filter((row: any) => !creationDate || !row.txn_date || row.txn_date >= creationDate)
      .map((row: any) => ({
        ...row,
        amount_in: Number(row.amount_in || 0),
        amount_out: Number(row.amount_out || 0),
      }));

    // Fallback: if bank_account_ledger view does not yet include laborer_expenses
    try {
      const existingRefs = new Set(rows.map((r: any) => r.reference));
      const { data: laborerExpenses } = await supabase
        .from("laborer_expenses")
        .select("from_date, to_date, work, amount")
        .eq("bank_account_id", bankAccountId);

      (laborerExpenses || []).forEach((le: any) => {
        if (creationDate && le.from_date && le.from_date < creationDate) return;
        const expectedRef = `${le.from_date} - ${le.to_date} | ${le.work || ""}`;
        if (!existingRefs.has(expectedRef)) {
          rows.push({
            bank_account_id: bankAccountId,
            txn_date: le.from_date,
            txn_type: "Expense",
            reference: expectedRef,
            amount_in: 0,
            amount_out: Number(le.amount || 0),
            po_no: null,
          });
        }
      });
    } catch {}

    try {
      const existingRefs = new Set(rows.map((r: any) => r.reference));

      const [loansRes, directRecsRes, payrollRes] = await Promise.all([
        supabase
          .from("employee_loans")
          .select("id, employee_id, principal_amount, outstanding_balance, override_reason, bank_account_id, issued_date, status, employee:employees(full_name)"),
        supabase
          .from("employee_loan_recoveries")
          .select(`
            id, loan_id, employee_id, recovery_date, amount, notes, bank_account_id, created_at,
            employee:employees(full_name)
          `)
          .order("recovery_date", { ascending: true })
          .order("created_at", { ascending: true }),
        supabase
          .from("payroll_runs")
          .select("id, loan_id, employee_id, loan_installment_applied, expense_date, salary_month, created_at")
          .gt("loan_installment_applied", 0),
      ]);

      const loansList: any[] = loansRes.data || [];
      const directRecs: any[] = directRecsRes.data || [];
      const payrollRuns: any[] = payrollRes.data || [];

      loansList.forEach((l: any) => {
        const bankId = l.bank_account_id || l.override_reason?.match(/\[bank:([a-f0-9\-]+)\]/i)?.[1];
        if (bankId === bankAccountId) {
          if (creationDate && l.issued_date && l.issued_date < creationDate) return;
          const emp = Array.isArray(l.employee) ? l.employee[0] : l.employee;
          const expectedRef = `${emp?.full_name || "Employee"} | Loan`;
          if (!existingRefs.has(expectedRef)) {
            rows.push({
              bank_account_id: bankAccountId,
              txn_date: l.issued_date,
              txn_type: "Expense",
              reference: expectedRef,
              amount_in: 0,
              amount_out: Number(l.principal_amount || 0),
              po_no: null,
            });
            existingRefs.add(expectedRef);
          }
        }
      });

      const loansMap = new Map<string, any>(loansList.map((l: any) => [l.id, l]));

      // Fallback map: active loan per employee if loan_id is missing
      const activeLoanByEmp = new Map<string, string>();
      loansList.forEach((l: any) => {
        if (l.employee_id && (!activeLoanByEmp.has(l.employee_id) || l.status === "active")) {
          activeLoanByEmp.set(l.employee_id, l.id);
        }
      });

      // Group all deduction events per loan to calculate chronological remaining balance
      const eventsByLoan = new Map<string, Array<{ id: string; date: string; createdAt: string; amount: number; isRecovery: boolean }>>();

      directRecs.forEach((dr: any) => {
        const loanId = dr.loan_id || activeLoanByEmp.get(dr.employee_id);
        if (!loanId) return;
        if (!eventsByLoan.has(loanId)) eventsByLoan.set(loanId, []);
        eventsByLoan.get(loanId)!.push({
          id: dr.id,
          date: (dr.recovery_date || "").slice(0, 10),
          createdAt: dr.created_at || "",
          amount: Number(dr.amount || 0),
          isRecovery: true,
        });
      });

      payrollRuns.forEach((pr: any) => {
        const loanId = pr.loan_id || activeLoanByEmp.get(pr.employee_id);
        if (!loanId) return;
        if (!eventsByLoan.has(loanId)) eventsByLoan.set(loanId, []);
        eventsByLoan.get(loanId)!.push({
          id: pr.id,
          date: (pr.expense_date || pr.salary_month || "").slice(0, 10),
          createdAt: pr.created_at || "",
          amount: Number(pr.loan_installment_applied || 0),
          isRecovery: false,
        });
      });

      const remainingByRecoveryId = new Map<string, number>();

      loansList.forEach((loan: any) => {
        const events = eventsByLoan.get(loan.id) || [];
        // Sort chronologically: date ascending, then createdAt ascending, then ID
        events.sort((a, b) => {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
          return a.id.localeCompare(b.id);
        });

        let running = Number(loan.principal_amount ?? loan.outstanding_balance) || 0;
        for (const ev of events) {
          running = Math.max(0, running - ev.amount);
          if (ev.isRecovery) {
            remainingByRecoveryId.set(ev.id, running);
          }
        }
      });

      const addedRecoveryIds = new Set<string>();

      (directRecs || []).forEach((dr: any) => {
        const loan = loansMap.get(dr.loan_id) || (dr.employee_id ? loansMap.get(activeLoanByEmp.get(dr.employee_id) || "") : null);
        const targetBankId = dr.bank_account_id || loan?.bank_account_id || loan?.override_reason?.match(/\[bank:([a-f0-9\-]+)\]/i)?.[1];
        if (targetBankId === bankAccountId) {
          const recDate = (dr.recovery_date || "").slice(0, 10);
          if (creationDate && recDate && recDate < creationDate) return;
          if (addedRecoveryIds.has(dr.id)) return;
          addedRecoveryIds.add(dr.id);

          const emp = Array.isArray(dr.employee) ? dr.employee[0] : (dr.employee || (loan ? (Array.isArray(loan.employee) ? loan.employee[0] : loan.employee) : null));
          const empName = emp?.full_name || "Employee";
          const rawNote = (dr.notes || "").trim();
          const cleanNotes = rawNote.replace(/\|\s*Remaining\s*[\d,]+/gi, "").trim();
          const noteText = cleanNotes || "Loan Recovery";
          const remBal = remainingByRecoveryId.has(dr.id)
            ? remainingByRecoveryId.get(dr.id)!
            : (loan?.outstanding_balance !== undefined ? Number(loan.outstanding_balance) : 0);
          const expectedRef = `${empName} | ${noteText} | Remaining ${remBal.toLocaleString()}`;

          rows.push({
            bank_account_id: bankAccountId,
            txn_date: recDate,
            txn_type: "Loan Recovery",
            reference: expectedRef,
            amount_in: Number(dr.amount || 0),
            amount_out: 0,
            po_no: null,
          });
        }
      });

      rows.sort((a: any, b: any) => {
        if (a.txn_date === b.txn_date) return (b.amount_in || 0) - (a.amount_in || 0);
        return a.txn_date.localeCompare(b.txn_date);
      });
    } catch {}

    const initialOpeningBalance = Number(bankAccount?.current_balance || 0);
    let accum = initialOpeningBalance;
    const computed = rows.map((row: any) => {
      accum = accum + row.amount_in - row.amount_out;
      return { ...row, running_balance: accum };
    });

    try {
      const invoiceNos = computed
        .map((r: any) => r.reference)
        .filter((ref: string) => ref && ref !== "—" && !ref.includes("|") && !ref.includes(" - "));
      if (invoiceNos.length > 0) {
        const { data: invData } = await supabase
          .from("invoices")
          .select("invoice_no, outlet_name, outlet_code, shop:shops(shop_name, outlet_code)")
          .in("invoice_no", invoiceNos);
        if (invData && invData.length > 0) {
          const invMap = new Map<string, string>();
          for (const inv of invData) {
            const shopName = inv.outlet_name || (inv.shop as any)?.shop_name || "";
            const outletCode = inv.outlet_code || (inv.shop as any)?.outlet_code || "";
            const suffix = [shopName, outletCode].filter(Boolean).join(" - ");
            if (suffix) invMap.set(inv.invoice_no, `${inv.invoice_no} | ${suffix}`);
          }
          computed.forEach((r: any) => {
            if (r.reference && invMap.has(r.reference)) r.reference = invMap.get(r.reference);
          });
        }
      }
    } catch {
      // enrichment failure is non-fatal
    }

    computed.unshift({
      txn_date: creationDate || new Date().toISOString().split("T")[0],
      txn_type: "Opening Balance",
      reference: "—",
      amount_in: 0,
      amount_out: 0,
      running_balance: initialOpeningBalance,
    });

    return computed;
  } catch (err: any) {
    console.error("[getBankAccountLedger] unexpected:", err?.message ?? err);
    return [];
  }
}

export interface CcbplLimitHistoryEntry {
  effective_date: string;
  limit_amount: number;
}

function resolveLimitForDate(
  history: CcbplLimitHistoryEntry[],
  dateStr: string,
  fallbackLimit = 40000000
): number {
  if (!history || history.length === 0) return fallbackLimit;
  let matched = history[0]?.limit_amount ?? fallbackLimit;
  for (const h of history) {
    if (h.effective_date <= dateStr) {
      matched = h.limit_amount;
    } else {
      break;
    }
  }
  return matched;
}

export async function getCcbplLimitHistory(targetTenantId?: string): Promise<CcbplLimitHistoryEntry[]> {
  try {
    const supabase = await createClient();
    const tenantId = targetTenantId || (await getTenantId());
    if (!tenantId) return [{ effective_date: "1970-01-01", limit_amount: 40000000 }];

    const historyMap = new Map<string, number>();

    try {
      const { data: tableData, error: tableErr } = await supabase
        .from("ccbpl_limit_history")
        .select("effective_date, limit_amount")
        .eq("tenant_id", tenantId)
        .order("effective_date", { ascending: true });

      if (!tableErr && tableData && tableData.length > 0) {
        tableData.forEach((row: any) => {
          if (row.effective_date) {
            historyMap.set(row.effective_date, Number(row.limit_amount || 0));
          }
        });
      }
    } catch {}

    try {
      const { data: flagData } = await supabase
        .from("global_feature_flags")
        .select("flag_key, label")
        .like("flag_key", `ccbpl_limit:${tenantId}:%`);

      if (flagData && flagData.length > 0) {
        flagData.forEach((f: any) => {
          try {
            const parsed = f.label ? JSON.parse(f.label) : null;
            if (parsed?.effective_date && parsed?.limit_amount !== undefined) {
              historyMap.set(parsed.effective_date, Number(parsed.limit_amount));
            } else {
              const parts = f.flag_key.split(":");
              if (parts.length >= 4) {
                historyMap.set(parts[2], Number(parts[3]));
              }
            }
          } catch {
            const parts = f.flag_key.split(":");
            if (parts.length >= 4) {
              historyMap.set(parts[2], Number(parts[3]));
            }
          }
        });
      }
    } catch {}

    let baselineLimit = 40000000;
    try {
      const { data: ts } = await supabase
        .from("tenant_settings")
        .select("ccbpl_deposit_floor")
        .eq("tenant_id", tenantId)
        .single();
      if (ts?.ccbpl_deposit_floor !== undefined && ts?.ccbpl_deposit_floor !== null) {
        baselineLimit = Number(ts.ccbpl_deposit_floor);
      }
    } catch {}

    if (historyMap.size === 0) {
      return [{ effective_date: "1970-01-01", limit_amount: baselineLimit }];
    }

    const sorted = Array.from(historyMap.entries())
      .map(([effective_date, limit_amount]) => ({ effective_date, limit_amount }))
      .sort((a, b) => a.effective_date.localeCompare(b.effective_date));

    if (sorted[0].effective_date > "1970-01-01") {
      sorted.unshift({
        effective_date: "1970-01-01",
        limit_amount: baselineLimit || sorted[0].limit_amount,
      });
    }

    return sorted;
  } catch (err: any) {
    console.error("[getCcbplLimitHistory] unexpected:", err?.message ?? err);
    return [{ effective_date: "1970-01-01", limit_amount: 40000000 }];
  }
}

export async function getVendorAccounts(targetTenantId?: string, asOfDate?: string) {
  try {
    const supabase = await createClient();
    const tenantId = targetTenantId || (await getTenantId());

    let accQuery = supabase.from("vendor_accounts").select("*").order("account_title");
    if (tenantId) accQuery = accQuery.eq("tenant_id", tenantId);
    const { data: accounts, error } = await accQuery;
    if (error) { console.error("[getVendorAccounts]", error.message); return []; }
    if (!accounts || accounts.length === 0) return [];

    const accCreationMap = new Map<string, string | null>(
      accounts.map((a: any) => [
        a.id,
        a.created_at ? new Date(a.created_at).toISOString().split("T")[0] : null,
      ])
    );

    let ledgerQuery = supabase
      .from("vendor_account_ledger")
      .select("vendor_account_id, amount_in, amount_out, txn_date");
    if (tenantId) ledgerQuery = ledgerQuery.eq("tenant_id", tenantId);
    if (asOfDate) ledgerQuery = ledgerQuery.lte("txn_date", asOfDate);
    const { data: ledgerData } = await ledgerQuery;

    const usedMap: Record<string, number> = {};
    (ledgerData || []).forEach((row: any) => {
      const vId = row.vendor_account_id;
      const accDate = accCreationMap.get(vId);
      if (accDate && row.txn_date && row.txn_date < accDate) return;

      const netDelta = Number(row.amount_out || 0) - Number(row.amount_in || 0);
      usedMap[vId] = (usedMap[vId] || 0) + netDelta;
    });

    const limitHistory = await getCcbplLimitHistory(tenantId);
    const effectiveLimit = resolveLimitForDate(
      limitHistory,
      asOfDate || new Date().toISOString().split("T")[0],
      40000000
    );

    return accounts.map((acc: any) => {
      const accDate = accCreationMap.get(acc.id);
      if (asOfDate && accDate && asOfDate < accDate) {
        return {
          ...acc,
          initial_used: 0,
          current_used: 0,
          limit: effectiveLimit,
          remaining: effectiveLimit,
          current_balance: effectiveLimit,
        };
      }
      const initialUsed = Number(acc.current_balance || 0);
      const totalUsed = initialUsed + (usedMap[acc.id] || 0);
      const remaining = effectiveLimit - totalUsed;
      return {
        ...acc,
        initial_used: initialUsed,
        current_used: totalUsed,
        limit: effectiveLimit,
        remaining: remaining,
        current_balance: remaining,
      };
    });
  } catch (err: any) {
    console.error("[getVendorAccounts] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function createVendorAccount(formData: {
  account_title: string;
  current_balance?: number;
  active?: boolean;
  account_date?: string;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const insertPayload: any = {
    vendor_name: formData.account_title,
    account_title: formData.account_title,
    current_balance: formData.current_balance ?? 0,
    active: formData.active ?? true,
    tenant_id: tenantId,
  };
  if (formData.account_date) insertPayload.created_at = new Date(formData.account_date + "T12:00:00Z").toISOString();

  const { data, error } = await supabase
    .from("vendor_accounts")
    .insert(insertPayload)
    .select().single();
  if (error) throw new Error(error.message);
  REVALIDATE.forEach(p => revalidatePath(p));
  return data;
}

export async function updateVendorAccount(id: string, formData: {
  account_title?: string;
  current_balance?: number;
  active?: boolean;
  account_date?: string;
}) {
  const supabase = await createClient();
  const updatePayload: any = { ...formData };
  delete updatePayload.account_date;
  if (formData.account_title) updatePayload.vendor_name = formData.account_title;
  if (formData.account_date) updatePayload.created_at = new Date(formData.account_date + "T12:00:00Z").toISOString();

  const { data, error } = await supabase
    .from("vendor_accounts")
    .update(updatePayload)
    .eq("id", id)
    .select().single();
  if (error) throw new Error(error.message);
  REVALIDATE.forEach(p => revalidatePath(p));
  return data;
}

export async function deleteVendorAccount(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("vendor_accounts").delete().eq("id", id);
  if (error) throw new Error(error.message);
  REVALIDATE.forEach(p => revalidatePath(p));
}

export async function getVendorAccountLedger(vendorAccountId: string) {
  try {
    const supabase = await createClient();

    const { data: vendorAccount, error: accError } = await supabase
      .from("vendor_accounts")
      .select("current_balance, created_at, tenant_id")
      .eq("id", vendorAccountId)
      .single();

    if (accError) {
      console.error("[getVendorAccountLedger] account error:", accError.message);
      return [];
    }

    const creationDate = vendorAccount?.created_at
      ? new Date(vendorAccount.created_at).toISOString().split("T")[0]
      : null;

    const limitHistory = await getCcbplLimitHistory(vendorAccount?.tenant_id);

    const { data, error } = await supabase
      .from("vendor_account_ledger")
      .select("*")
      .eq("vendor_account_id", vendorAccountId)
      .order("txn_date", { ascending: true })
      .order("amount_in", { ascending: false });

    if (error) {
      console.error("[getVendorAccountLedger]", error.message);
      return [];
    }

    const rows = (data || [])
      .filter((row: any) => !creationDate || !row.txn_date || row.txn_date >= creationDate)
      .map((row: any) => ({
        ...row,
        amount_in: Number(row.amount_in || 0),
        amount_out: Number(row.amount_out || 0),
      }));

    const initialOpeningUsed = Number(vendorAccount?.current_balance || 0);
    let accumUsed = initialOpeningUsed;
    const computed = rows.map((row: any) => {
      accumUsed = accumUsed + row.amount_out - row.amount_in;
      const rowDate = row.txn_date || creationDate || new Date().toISOString().split("T")[0];
      const rowLimit = resolveLimitForDate(limitHistory, rowDate, 40000000);
      const rowRemaining = rowLimit - accumUsed;
      return {
        ...row,
        limit: rowLimit,
        used: accumUsed,
        remaining: rowRemaining,
        running_balance: rowRemaining,
      };
    });

    const openingDate = creationDate || new Date().toISOString().split("T")[0];
    const openingLimit = resolveLimitForDate(limitHistory, openingDate, 40000000);
    const openingRemaining = openingLimit - initialOpeningUsed;

    computed.unshift({
      txn_date: openingDate,
      txn_type: "Opening Used",
      reference: "—",
      amount_in: 0,
      amount_out: 0,
      limit: openingLimit,
      used: initialOpeningUsed,
      remaining: openingRemaining,
      running_balance: openingRemaining,
    });

    (computed as any).limitHistory = limitHistory;
    return computed;
  } catch (err: any) {
    console.error("[getVendorAccountLedger] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getCashMovements(filters?: { dateFrom?: string; dateTo?: string }) {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();
    let q = supabase
      .from("cash_movements")
      .select("*")
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (tenantId) q = q.eq("tenant_id", tenantId);
    if (filters?.dateFrom) q = q.gte("movement_date", filters.dateFrom);
    if (filters?.dateTo)   q = q.lte("movement_date", filters.dateTo);
    const { data, error } = await q;
    if (error) { console.error("[getCashMovements]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getCashMovements] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function createCashMovement(formData: {
  movement_date: string;
  description?: string;
  from_account_id: string;
  from_account_type: "transaction" | "vendor";
  to_account_id: string;
  to_account_type: "transaction" | "vendor";
  amount: number;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const { data, error } = await supabase
    .from("cash_movements")
    .insert({ ...formData, tenant_id: tenantId })
    .select().single();
  if (error) throw new Error(error.message);
  REVALIDATE.forEach(p => revalidatePath(p));
  return data;
}

export async function updateCashMovement(id: string, formData: {
  movement_date?: string;
  description?: string;
  from_account_id?: string;
  from_account_type?: "transaction" | "vendor";
  to_account_id?: string;
  to_account_type?: "transaction" | "vendor";
  amount?: number;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cash_movements")
    .update(formData)
    .eq("id", id)
    .select().single();
  if (error) throw new Error(error.message);
  REVALIDATE.forEach(p => revalidatePath(p));
  return data;
}

export async function deleteCashMovement(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("cash_movements").delete().eq("id", id);
  if (error) throw new Error(error.message);
  REVALIDATE.forEach(p => revalidatePath(p));
}

export async function deleteCashMovements(ids: string[]) {
  if (!ids || ids.length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase.from("cash_movements").delete().in("id", ids);
  if (error) throw new Error(error.message);
  REVALIDATE.forEach(p => revalidatePath(p));
}
