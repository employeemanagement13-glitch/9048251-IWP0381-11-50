"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const REVALIDATE = [
  "/employee-management/directory",
  "/employee-management/payroll",
  "/employee-management/loans",
  "/employee-management/ledger",
  "/cash-bank/bank-accounts",
  "/expenses/sheet",
  "/income/statement",
  "/income/balance-sheet",
];

export async function getPayrollSOPs() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("payroll_sops")
      .select("*")
      .order("date_from", { ascending: false });
    if (error) { console.error("[getPayrollSOPs]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getPayrollSOPs] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function createPayrollSOP(formData: {
  name: string;
  date_from: string;
  date_to: string;
  shift_start: string;
  shift_end: string;
  morning_grace_minutes?: number;
  grace_limit_days?: number;
  grace_deduction_days?: number;
  grace_limit_repeats_monthly?: boolean;
  after_grace_deduct_days?: number;
  stack_deductions?: boolean;
  holiday_bonus_days?: number;
  thumb_miss_deduct_days?: number;
  biometric_enabled?: boolean;
  short_leave_start?: string;
  before_sl_deduct_days?: number;
  short_leave_limit_days?: number;
  after_sl_deduct_days?: number;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const { data, error } = await supabase
    .from("payroll_sops")
    .insert({ ...formData, tenant_id: tenantId })
    .select().single();
  if (error) throw new Error(error.message);
  REVALIDATE.forEach(p => revalidatePath(p));
  return data;
}

export async function updatePayrollSOP(id: string, formData: Record<string, any>) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payroll_sops")
    .update(formData)
    .eq("id", id)
    .select().single();
  if (error) throw new Error(error.message);
  REVALIDATE.forEach(p => revalidatePath(p));
  return data;
}

export async function deletePayrollSOP(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("payroll_sops").delete().eq("id", id);
  if (error) throw new Error(error.message);
  REVALIDATE.forEach(p => revalidatePath(p));
}

export async function getPayrollRuns(filters?: { month?: string; employeeId?: string }) {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("payroll_runs")
      .select(`
        *,
        employee:employees(id, employee_code, full_name, role, basic_salary, bank_name, bank_account, joining_date),
        sop:payroll_sops(id, name, biometric_enabled, shift_start, shift_end),
        loan:employee_loans(id, principal_amount, outstanding_balance, installment_cap_pct, status, override_reason)
      `)
      .order("salary_month", { ascending: false })
      .order("created_at", { ascending: false });

    if (filters?.month) {
      query = query.gte("salary_month", `${filters.month}-01`)
                   .lt("salary_month", `${filters.month}-32`);
    }
    if (filters?.employeeId) {
      query = query.eq("employee_id", filters.employeeId);
    }

    const { data, error } = await query;
    if (error) { console.error("[getPayrollRuns]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getPayrollRuns] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getPayrollRunById(id: string) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("payroll_runs")
      .select(`
        *,
        employee:employees(id, employee_code, full_name, role, bank_name, bank_account, joining_date),
        sop:payroll_sops(id, name, biometric_enabled, shift_start, shift_end, morning_grace_minutes, grace_limit_days),
        loan:employee_loans(id, principal_amount, outstanding_balance, installment_cap_pct, status, override_reason)
      `)
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  } catch (err: any) {
    console.error("[getPayrollRunById] unexpected:", err?.message ?? err);
    return null;
  }
}

export async function createPayrollRun(formData: {
  employee_id: string;
  sop_id?: string;
  loan_id?: string;
  salary_month: string;
  expense_date?: string;
  working_days: number;
  basic_salary: number;
  bonus_amount?: number;
  absent_deduction?: number;
  sop_violation_deduction?: number;
  loan_installment_due?: number;
  loan_installment_applied?: number;
  balance_carried?: number;
  operator?: string;
  computer_voucher?: string;
  bank_account_id?: string;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const { net_salary, net_payable, ...safeData } = formData as any;

  let { data, error } = await supabase
    .from("payroll_runs")
    .insert({ ...safeData, tenant_id: tenantId })
    .select(`
      *,
      employee:employees(id, employee_code, full_name, role)
    `)
    .single();

  if (error && (error.message.includes("schema cache") || error.message.includes("column"))) {
    const { expense_date, bank_account_id, ...safePayload } = safeData;
    const retry = await supabase
      .from("payroll_runs")
      .insert({ ...safePayload, tenant_id: tenantId })
      .select(`
        *,
        employee:employees(id, employee_code, full_name, role)
      `)
      .single();
    if (retry.error) throw new Error(retry.error.message);
    data = retry.data;
  } else if (error) {
    throw new Error(error.message);
  }

  if (data && formData.loan_installment_applied && formData.loan_installment_applied > 0) {
    try {
      let targetLoanId = formData.loan_id;
      if (!targetLoanId && formData.employee_id) {
        const { data: actLoans } = await supabase
          .from("employee_loans")
          .select("id")
          .eq("employee_id", formData.employee_id)
          .eq("status", "active")
          .order("issued_date", { ascending: false });
        if (actLoans && actLoans.length > 0) {
          targetLoanId = actLoans[0].id;
          await supabase.from("payroll_runs").update({ loan_id: targetLoanId }).eq("id", data.id);
        }
      }
      if (targetLoanId) {
        const { data: currentLoan } = await supabase
          .from("employee_loans")
          .select("outstanding_balance, principal_amount")
          .eq("id", targetLoanId)
          .single();
        if (currentLoan) {
          // Fall back to principal_amount for old loans where outstanding_balance was never set
          const curBal = currentLoan.outstanding_balance !== null && currentLoan.outstanding_balance !== undefined
            ? Number(currentLoan.outstanding_balance)
            : Number(currentLoan.principal_amount) || 0;
          const newBal = Math.max(0, curBal - formData.loan_installment_applied);
          await supabase
            .from("employee_loans")
            .update({
              outstanding_balance: newBal,
              status: newBal === 0 ? "closed" : "active",
            })
            .eq("id", targetLoanId);
        }
      }
      await supabase.from("employee_ledger").insert({
        tenant_id: tenantId,
        employee_id: formData.employee_id,
        entry_date: formData.expense_date || new Date().toISOString().split("T")[0],
        type: "loan",
        direction: "out",
        amount: formData.loan_installment_applied,
        source_table: "payroll_runs",
        source_id: data.id,
        description: `Loan Installment Recovered — ${formData.salary_month || ""}`,
      });
    } catch (_) {}
  }

  REVALIDATE.forEach(p => revalidatePath(p));
  revalidatePath("/expenses/agency");
  revalidatePath("/cash-bank/bank-accounts");
  if (formData.employee_id) {
    revalidatePath(`/employee-management/loans/${formData.employee_id}`);
    revalidatePath(`/employee-management/ledger/${formData.employee_id}`);
  }
  return data;
}

export async function updatePayrollRun(id: string, formData: Record<string, any>) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const { data: oldRun } = await supabase
    .from("payroll_runs")
    .select("*")
    .eq("id", id)
    .single();

  if (!oldRun) throw new Error("Payroll run not found");

  const oldApplied = Number(oldRun.loan_installment_applied) || 0;
  const newApplied = formData.loan_installment_applied !== undefined ? Number(formData.loan_installment_applied) : oldApplied;
  let loanId = formData.loan_id || oldRun.loan_id;
  if (!loanId && (formData.employee_id || oldRun.employee_id)) {
    const empId = formData.employee_id || oldRun.employee_id;
    const { data: actLoans } = await supabase
      .from("employee_loans")
      .select("id")
      .eq("employee_id", empId)
      .eq("status", "active")
      .order("issued_date", { ascending: false });
    if (actLoans && actLoans.length > 0) {
      loanId = actLoans[0].id;
    }
  }

  if (loanId && newApplied !== oldApplied) {
    const diff = newApplied - oldApplied;
    const { data: currentLoan } = await supabase
      .from("employee_loans")
      .select("outstanding_balance, principal_amount, status")
      .eq("id", loanId)
      .single();

    if (currentLoan) {
      const curBal = currentLoan.outstanding_balance !== null && currentLoan.outstanding_balance !== undefined
        ? Number(currentLoan.outstanding_balance)
        : Number(currentLoan.principal_amount) || 0;
      const newBal = Math.max(0, curBal - diff);
      await supabase
        .from("employee_loans")
        .update({
          outstanding_balance: newBal,
          status: newBal === 0 ? "closed" : "active",
        })
        .eq("id", loanId);
    }
  }

  const { net_salary, net_payable, ...safeUpdateData } = formData as any;
  const { data, error } = await supabase
    .from("payroll_runs")
    .update(safeUpdateData)
    .eq("id", id)
    .select().single();
  if (error) throw new Error(error.message);

  const entryDate = formData.expense_date || oldRun.expense_date || formData.salary_month || oldRun.salary_month || new Date().toISOString().split("T")[0];
  const empId = formData.employee_id || oldRun.employee_id;

  if (newApplied > 0) {
    const { data: existingLedger } = await supabase
      .from("employee_ledger")
      .select("id")
      .eq("source_table", "payroll_runs")
      .eq("source_id", id)
      .eq("type", "loan")
      .maybeSingle();

    if (existingLedger) {
      await supabase
        .from("employee_ledger")
        .update({
          amount: newApplied,
          entry_date: entryDate,
        })
        .eq("id", existingLedger.id);
    } else {
      await supabase.from("employee_ledger").insert({
        tenant_id: tenantId,
        employee_id: empId,
        entry_date: entryDate,
        type: "loan",
        direction: "out",
        amount: newApplied,
        source_table: "payroll_runs",
        source_id: id,
        description: `Loan Installment Recovered — ${formData.salary_month || oldRun.salary_month || ""}`,
      });
    }
  } else {
    await supabase
      .from("employee_ledger")
      .delete()
      .eq("source_table", "payroll_runs")
      .eq("source_id", id)
      .eq("type", "loan");
  }

  const newNetPayable = formData.net_payable !== undefined ? Number(formData.net_payable) : Number(oldRun.net_payable);
  await supabase
    .from("employee_ledger")
    .update({
      amount: newNetPayable,
      entry_date: entryDate,
    })
    .eq("source_table", "payroll_runs")
    .eq("source_id", id)
    .eq("type", "salary");

  REVALIDATE.forEach(p => revalidatePath(p));
  revalidatePath(`/employee-management/loans/${empId}`);
  revalidatePath(`/employee-management/ledger/${empId}`);
  return data;
}

export async function deletePayrollRun(id: string) {
  const supabase = await createClient();
  const { data: run } = await supabase
    .from("payroll_runs")
    .select("*")
    .eq("id", id)
    .single();

  if (run) {
    const empId = run.employee_id;
    let targetLoanId = run.loan_id;
    if (!targetLoanId && run.employee_id) {
      const { data: actLoans } = await supabase
        .from("employee_loans")
        .select("id")
        .eq("employee_id", run.employee_id)
        .order("issued_date", { ascending: false });
      if (actLoans && actLoans.length > 0) {
        targetLoanId = actLoans[0].id;
      }
    }

    if (run.loan_installment_applied > 0 && targetLoanId) {
      try {
        const { data: currentLoan } = await supabase
          .from("employee_loans")
          .select("outstanding_balance, principal_amount")
          .eq("id", targetLoanId)
          .single();
        if (currentLoan) {
          const curBal = currentLoan.outstanding_balance !== null && currentLoan.outstanding_balance !== undefined
            ? Number(currentLoan.outstanding_balance)
            : Number(currentLoan.principal_amount) || 0;
          await supabase
            .from("employee_loans")
            .update({
              outstanding_balance: curBal + Number(run.loan_installment_applied),
              status: "active",
            })
            .eq("id", run.loan_id);
        }
      } catch (_) {}
    }

    try {
      await supabase
        .from("employee_ledger")
        .delete()
        .eq("source_table", "payroll_runs")
        .eq("source_id", id);
    } catch (_) {}

    const { error } = await supabase.from("payroll_runs").delete().eq("id", id);
    if (error) throw new Error(error.message);

    REVALIDATE.forEach(p => revalidatePath(p));
    revalidatePath(`/employee-management/loans/${empId}`);
    revalidatePath(`/employee-management/ledger/${empId}`);
  }
}

export async function getSalaryHeadView(monthOrFilters?: string | { month?: string; dateFrom?: string; dateTo?: string }) {
  try {
    const month = typeof monthOrFilters === "string" ? monthOrFilters : monthOrFilters?.month;
    const dateFrom = typeof monthOrFilters === "object" ? monthOrFilters?.dateFrom : undefined;
    const dateTo = typeof monthOrFilters === "object" ? monthOrFilters?.dateTo : undefined;

    const supabase = await createClient();
    let query = supabase
      .from("salary_head_view")
      .select("*")
      .order("year", { ascending: false })
      .order("month");

    const { data, error } = await query;

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    if (!error && data && data.length > 0) {
      let mapped = data.map((r: any) => {
        const mIdx = monthNames.findIndex((m) => m.toLowerCase() === r.month?.trim().toLowerCase());
        const mStr = mIdx >= 0 ? String(mIdx + 1).padStart(2, "0") : "01";
        const dateStr = r.salary_month || r.expense_date || (r.year && r.month ? `${r.year}-${mStr}-01` : "");
        return {
          ...r,
          date: dateStr,
          expense_date: r.expense_date || dateStr,
          salary_month: r.salary_month || dateStr,
          name: r.name || r.employee_name || r.full_name || "",
          employee_name: r.name || r.employee_name || r.full_name || "",
        };
      });
      if (month) {
        mapped = mapped.filter((r) => r.month?.trim().toLowerCase() === month.toLowerCase());
      }
      if (dateFrom) mapped = mapped.filter((r) => !r.date || r.date >= dateFrom);
      if (dateTo) mapped = mapped.filter((r) => !r.date || r.date <= dateTo);
      return mapped;
    }

    const { data: runs, error: runsErr } = await supabase
      .from("payroll_runs")
      .select(`
        id,
        tenant_id,
        salary_month,
        expense_date,
        net_payable,
        employee:employees(employee_code, full_name, role)
      `)
      .order("salary_month", { ascending: false });

    if (runsErr || !runs) return [];

    let fallbackData = runs.map((r: any) => {
      const d = r.salary_month ? new Date(r.salary_month) : new Date();
      const mName = monthNames[d.getUTCMonth()] || "";
      const yr = d.getUTCFullYear();
      const emp = Array.isArray(r.employee) ? r.employee[0] : r.employee;
      const empName = emp?.full_name || "";
      const dateStr = r.expense_date || (r.salary_month ? String(r.salary_month).slice(0, 10) : `${yr}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`);
      return {
        tenant_id: r.tenant_id,
        employee_code: emp?.employee_code || "",
        name: empName,
        employee_name: empName,
        role: emp?.role || "",
        date: dateStr,
        expense_date: dateStr,
        salary_month: r.salary_month,
        month: mName,
        year: yr,
        net_payable: r.net_payable,
        source: "Payroll Run auto",
      };
    });

    if (month) {
      fallbackData = fallbackData.filter((r) => r.month?.trim().toLowerCase() === month.toLowerCase());
    }
    if (dateFrom) fallbackData = fallbackData.filter((r) => !r.date || r.date >= dateFrom);
    if (dateTo) fallbackData = fallbackData.filter((r) => !r.date || r.date <= dateTo);
    return fallbackData;
  } catch (err: any) {
    console.error("[getSalaryHeadView] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function deletePayrollRuns(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("payroll_runs").delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }
  REVALIDATE.forEach(p => revalidatePath(p));
  revalidatePath("/cash-bank/bank-accounts");
}