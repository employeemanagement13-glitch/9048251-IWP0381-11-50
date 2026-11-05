"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { isLoanUnrecoverable } from "@/lib/utils/loan-utils";

const REVALIDATE_PATHS = [
  "/employee-management/directory",
  "/employee-management/payroll",
  "/employee-management/loans",
  "/employee-management/ledger",
  "/expenses/agency",
  "/expenses/sheet",
  "/income/statement",
  "/income/balance-sheet",
  "/cash-bank/bank-accounts",
];

export interface EmployeeFormData {
  employee_code?: string;
  full_name: string;
  role: "dm" | "preseller" | "operation_manager" | "loader" | "lifter_operator" | "dvo" | "driver" | "guard" | "office" | "other" | (string & {});
  phone?: string;
  nic?: string;
  address?: string;
  joining_date?: string;
  basic_salary?: number;
  bank_name?: string;
  bank_account?: string;
  house_owner?: boolean;
  emergency_contact?: string;
  emergency_phone?: string;
  reference_1_name?: string;
  reference_1_phone?: string;
  reference_2_name?: string;
  reference_2_phone?: string;
  linked_route_id?: string | null;
  active?: boolean;
}

export async function getEmployees(filters?: { search?: string; role?: string; active?: boolean }) {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("employees")
      .select("*")
      .order("employee_code", { ascending: true })
      .order("full_name");

    if (filters?.role) query = query.eq("role", filters.role);
    if (filters?.active !== undefined) query = query.eq("active", filters.active);

    const { data, error } = await query;
    if (error) { console.error("[getEmployees]", error.message); return []; }

    if (filters?.search && data) {
      const s = filters.search.toLowerCase();
      return data.filter(
        (e) =>
          e.full_name?.toLowerCase().includes(s) ||
          e.employee_code?.toLowerCase().includes(s) ||
          e.phone?.toLowerCase().includes(s) ||
          e.nic?.toLowerCase().includes(s)
      );
    }
    return data || [];
  } catch (err: any) {
    console.error("[getEmployees] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getEmployeeById(id: string) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("id", id)
      .single();
    if (error) { console.error("[getEmployeeById]", error.message); return null; }
    return data;
  } catch (err: any) {
    console.error("[getEmployeeById] unexpected:", err?.message ?? err);
    return null;
  }
}

export async function createEmployee(formData: EmployeeFormData) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const { data, error } = await supabase
    .from("employees")
    .insert({ ...formData, tenant_id: tenantId })
    .select()
    .single();

  if (error) throw new Error(error.message);
  REVALIDATE_PATHS.forEach(p => revalidatePath(p));
  return data;
}

export async function bulkImportEmployees(employeesList: EmployeeFormData[]) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");
  if (!employeesList || employeesList.length === 0) {
    return { created: 0, updated: 0, total: 0 };
  }

  const { data: existingEmployeesData, error: fetchErr } = await supabase
    .from("employees")
    .select("id, employee_code, full_name, nic")
    .eq("tenant_id", tenantId);

  if (fetchErr) throw new Error(fetchErr.message);

  const existingEmps = existingEmployeesData || [];
  const codeMap = new Map<string, { id: string; full_name: string }>();
  const nameMap = new Map<string, { id: string; employee_code: string | null }>();
  const nicMap = new Map<string, { id: string; full_name: string }>();
  const existingCodeSet = new Set<string>();
  /** Highest numeric suffix seen per ROLE prefix (e.g. GUARD → 2). */
  const maxByPrefix = new Map<string, number>();

  const roleCodePrefix = (role: string) =>
    String(role || "dm")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "");

  const nextRoleCode = (role: string) => {
    const prefix = roleCodePrefix(role) || "DM";
    let n = (maxByPrefix.get(prefix) || 0) + 1;
    let code = `${prefix}-${String(n).padStart(2, "0")}`;
    while (existingCodeSet.has(code.toUpperCase())) {
      n += 1;
      code = `${prefix}-${String(n).padStart(2, "0")}`;
    }
    maxByPrefix.set(prefix, n);
    existingCodeSet.add(code.toUpperCase());
    return code;
  };

  existingEmps.forEach((emp) => {
    if (emp.employee_code) {
      const codeTrimmed = emp.employee_code.trim();
      codeMap.set(codeTrimmed.toLowerCase(), { id: emp.id, full_name: emp.full_name });
      existingCodeSet.add(codeTrimmed.toUpperCase());
      const match = codeTrimmed.match(/^([A-Za-z0-9]+)-(\d+)$/);
      if (match) {
        const prefix = match[1].toUpperCase();
        const val = parseInt(match[2], 10);
        if (!Number.isNaN(val) && val > (maxByPrefix.get(prefix) || 0)) {
          maxByPrefix.set(prefix, val);
        }
      }
    }
    if (emp.full_name) {
      nameMap.set(emp.full_name.trim().toLowerCase(), { id: emp.id, employee_code: emp.employee_code });
    }
    if (emp.nic) {
      nicMap.set(emp.nic.trim().toLowerCase(), { id: emp.id, full_name: emp.full_name });
    }
  });

  let createdCount = 0;
  let updatedCount = 0;

  const toInsert: any[] = [];
  const toUpdate: { id: string; payload: Record<string, any> }[] = [];

  for (const item of employeesList) {
    const rawName = (item.full_name || "").trim();
    if (!rawName) continue;

    const rawCode = (item.employee_code || "").trim();
    const rawNic = (item.nic || "").trim();
    const role = (item.role || "dm").toString().trim() || "dm";

    let existingId: string | null = null;
    if (rawCode && codeMap.has(rawCode.toLowerCase())) {
      existingId = codeMap.get(rawCode.toLowerCase())!.id;
    } else if (rawNic && nicMap.has(rawNic.toLowerCase())) {
      existingId = nicMap.get(rawNic.toLowerCase())!.id;
    } else if (nameMap.has(rawName.toLowerCase())) {
      existingId = nameMap.get(rawName.toLowerCase())!.id;
    }

    const payload: Record<string, any> = {
      full_name: rawName,
      role,
      phone: item.phone?.trim() || null,
      nic: rawNic || null,
      address: item.address?.trim() || null,
      joining_date: item.joining_date || null,
      basic_salary: typeof item.basic_salary === "number" && !isNaN(item.basic_salary) ? item.basic_salary : 0,
      bank_name: item.bank_name?.trim() || null,
      bank_account: item.bank_account?.trim() || null,
      house_owner: Boolean(item.house_owner),
      emergency_contact: item.emergency_contact?.trim() || null,
      emergency_phone: item.emergency_phone?.trim() || null,
      reference_1_name: item.reference_1_name?.trim() || null,
      reference_1_phone: item.reference_1_phone?.trim() || null,
      reference_2_name: item.reference_2_name?.trim() || null,
      reference_2_phone: item.reference_2_phone?.trim() || null,
      active: item.active !== undefined ? item.active : true,
    };

    if (existingId) {
      if (rawCode) payload.employee_code = rawCode;
      toUpdate.push({ id: existingId, payload });
    } else {
      let employee_code = rawCode;
      if (!employee_code || existingCodeSet.has(employee_code.toUpperCase())) {
        employee_code = nextRoleCode(role);
      } else {
        existingCodeSet.add(employee_code.toUpperCase());
      }
      toInsert.push({ ...payload, employee_code, tenant_id: tenantId });
    }
  }

  const BATCH = 50;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const chunk = toInsert.slice(i, i + BATCH);
    const { error: insErr } = await supabase.from("employees").insert(chunk);
    if (insErr) {
      if (insErr.message.includes("employees_role_check")) {
        throw new Error(`Database role constraint error. Run migration "supabase/mdos_v69_employee_role_lifter_operator.sql" in Supabase SQL editor.`);
      }
      for (const row of chunk) {
        const { error: sErr } = await supabase.from("employees").insert(row);
        if (!sErr) createdCount++;
        else console.error("[bulkImportEmployees] single insert error:", sErr.message);
      }
    } else {
      createdCount += chunk.length;
    }
  }

  const UPDATE_CONCURRENCY = 10;
  for (let i = 0; i < toUpdate.length; i += UPDATE_CONCURRENCY) {
    const chunk = toUpdate.slice(i, i + UPDATE_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(({ id, payload }) =>
        supabase.from("employees").update(payload).eq("id", id)
      )
    );
    for (const res of results) {
      if (!res.error) {
        updatedCount++;
      } else {
        if (res.error.message.includes("employees_role_check")) {
          throw new Error(`Database role constraint error. Run migration "supabase/mdos_v69_employee_role_lifter_operator.sql" in Supabase SQL editor.`);
        }
        console.error("[bulkImportEmployees] update error:", res.error.message);
      }
    }
  }

  REVALIDATE_PATHS.forEach(p => revalidatePath(p));
  return {
    created: createdCount,
    updated: updatedCount,
    total: employeesList.length,
  };
}

export async function updateEmployee(id: string, formData: Partial<EmployeeFormData>) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .update(formData)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  REVALIDATE_PATHS.forEach(p => revalidatePath(p));
  return data;
}

export async function deleteEmployee(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("employees").delete().eq("id", id);
  if (error) throw new Error(error.message);
  REVALIDATE_PATHS.forEach(p => revalidatePath(p));
}

export async function deleteEmployees(ids: string[]) {
  if (!ids.length) return;
  const supabase = await createClient();
  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("employees").delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }
  REVALIDATE_PATHS.forEach(p => revalidatePath(p));
}

export async function getIncrements(employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_increments")
    .select("*")
    .eq("employee_id", employeeId)
    .order("effective_date", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createIncrement(employeeId: string, formData: {
  reason: string; amount: number; effective_date: string; operator?: string;
}) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const { data: incData, error: incError } = await supabase
    .from("employee_increments")
    .insert({ ...formData, employee_id: employeeId, tenant_id: tenantId })
    .select().single();
  if (incError) throw new Error(incError.message);

  const { data: emp, error: empFetchErr } = await supabase
    .from("employees")
    .select("basic_salary")
    .eq("id", employeeId)
    .single();
  if (empFetchErr) throw new Error(empFetchErr.message);

  const newSalary = Number(emp.basic_salary || 0) + Number(formData.amount);
  const { error: updateErr } = await supabase
    .from("employees")
    .update({ basic_salary: newSalary })
    .eq("id", employeeId);
  if (updateErr) throw new Error(updateErr.message);

  revalidatePath("/employee-management/directory");
  return incData;
}

export async function deleteIncrement(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("employee_increments").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/employee-management/directory");
}

export async function getLoans(employeeId: string) {
  const supabase = await createClient();
  const [loansRes, payrollRes, directRecRes] = await Promise.all([
    supabase
      .from("employee_loans")
      .select("*")
      .eq("employee_id", employeeId)
      .order("issued_date", { ascending: false }),
    supabase
      .from("payroll_runs")
      .select("id, loan_id, loan_installment_applied")
      .eq("employee_id", employeeId)
      .gt("loan_installment_applied", 0),
    supabase
      .from("employee_loan_recoveries")
      .select("id, loan_id, amount")
      .eq("employee_id", employeeId),
  ]);

  if (loansRes.error) throw new Error(loansRes.error.message);

  const empLoans = loansRes.data || [];
  const defaultLoanId = empLoans.find((l: any) => l.status === "active")?.id || empLoans[0]?.id;

  const payrollByLoan: Record<string, number> = {};
  for (const p of payrollRes.data || []) {
    const lid = p.loan_id || defaultLoanId;
    if (lid) payrollByLoan[lid] = (payrollByLoan[lid] || 0) + (Number(p.loan_installment_applied) || 0);
  }
  const recoveryByLoan: Record<string, number> = {};
  for (const r of directRecRes.data || []) {
    const lid = r.loan_id || defaultLoanId;
    if (lid) recoveryByLoan[lid] = (recoveryByLoan[lid] || 0) + (Number(r.amount) || 0);
  }

  return empLoans.map((l: any) => {
    const principal = Number(l.principal_amount) || 0;
    const deducted = (payrollByLoan[l.id] || 0) + (recoveryByLoan[l.id] || 0);
    const calculatedBalance = Math.max(0, principal - deducted);
    const calculatedStatus = calculatedBalance === 0 ? "closed" : (l.status === "closed" ? "active" : (l.status || "active"));

    if (Number(l.outstanding_balance) !== calculatedBalance || l.status !== calculatedStatus) {
      void supabase
        .from("employee_loans")
        .update({
          outstanding_balance: calculatedBalance,
          status: calculatedStatus,
        })
        .eq("id", l.id)
        .then(() => {}, () => {});
    }

    return {
      ...l,
      outstanding_balance: calculatedBalance,
      status: calculatedStatus,
    };
  });
}

export async function getActiveLoan(employeeId: string) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("employee_loans")
      .select("*")
      .eq("employee_id", employeeId)
      .in("status", ["active", "override_active"])
      .order("issued_date", { ascending: false });
    if (error) { console.error("[getActiveLoan]", error.message); return null; }
    if (!data || data.length === 0) return null;
    const active = data.find((l: any) => {
      const repType = l.repayment_type || (l.override_reason?.includes("[repayment:scheduled_returns]") ? "scheduled_returns" : "monthly_installments");
      return repType !== "scheduled_returns";
    });
    return active ?? null;
  } catch (err: any) {
    console.error("[getActiveLoan] unexpected:", err?.message ?? err);
    return null;
  }
}


export async function createLoan(
  employeeId: string,
  formData: {
    principal_amount: number;
    monthly_installment?: number;
    installment_cap_pct?: number;
    reason?: string;
    issued_date?: string;
    status?: string;
    override_reason?: string;
    bank_account_id?: string;
    repayment_type?: "monthly_installments" | "scheduled_returns" | string;
    is_unrecoverable?: boolean;
  }
) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const isUnrec = Boolean(formData.is_unrecoverable);
  const repaymentType = formData.repayment_type || "monthly_installments";
  const overrideTag = `[repayment:${repaymentType}]${formData.bank_account_id ? `[bank:${formData.bank_account_id}]` : ""}${isUnrec ? "[unrecoverable:true]" : ""}`;
  const baseOverrideReason = formData.override_reason || "Direct installment";
  const combinedOverrideReason = `${baseOverrideReason} ${overrideTag}`.trim();

  const insertPayload: Record<string, any> = {
    ...formData,
    monthly_installment: Math.max(0, Number(formData.monthly_installment) || 0),
    installment_cap_pct: formData.installment_cap_pct ?? 100,
    employee_id: employeeId,
    tenant_id: tenantId,
    outstanding_balance: formData.principal_amount,
    status: formData.status || "active",
    reason: formData.reason || null,
    override_reason: combinedOverrideReason,
    bank_account_id: formData.bank_account_id || null,
    repayment_type: repaymentType,
    is_unrecoverable: isUnrec,
  };

  let data: any;
  let { data: inserted, error } = await supabase
    .from("employee_loans")
    .insert(insertPayload)
    .select()
    .single();

  if (error && (error.message.includes("monthly_installment") || error.message.includes("check"))) {
    insertPayload.monthly_installment = 0.01;
    const retry = await supabase
      .from("employee_loans")
      .insert(insertPayload)
      .select()
      .single();
    if (!retry.error) {
      inserted = retry.data;
      error = null;
    }
  }

  if (error && (error.message.includes("column") || error.message.includes("schema cache"))) {
    delete insertPayload.bank_account_id;
    delete insertPayload.repayment_type;
    delete insertPayload.is_unrecoverable;
    const retry = await supabase
      .from("employee_loans")
      .insert(insertPayload)
      .select()
      .single();
    if (retry.error) throw new Error(retry.error.message);
    data = retry.data;
  } else if (error) {
    throw new Error(error.message);
  } else {
    data = inserted;
  }

  try {
    await supabase.from("employee_ledger").insert({
      tenant_id: tenantId,
      employee_id: employeeId,
      entry_date: formData.issued_date || new Date().toISOString().split("T")[0],
      type: "loan",
      direction: "in",
      amount: formData.principal_amount,
      source_table: "employee_loans",
      source_id: data.id,
      description: formData.reason ? `Loan Disbursed (${formData.reason})` : "Loan Disbursed",
    });
  } catch (_) {}

  REVALIDATE_PATHS.forEach((p) => revalidatePath(p));
  revalidatePath(`/employee-management/loans/${employeeId}`);
  revalidatePath(`/employee-management/ledger/${employeeId}`);
  return data;
}

export async function updateLoan(
  loanId: string,
  formData: {
    principal_amount: number;
    monthly_installment: number;
    reason?: string;
    issued_date: string;
    status?: string;
    bank_account_id?: string;
    repayment_type?: "monthly_installments" | "scheduled_returns" | string;
    is_unrecoverable?: boolean;
  }
) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const { data: oldLoan, error: fetchErr } = await supabase
    .from("employee_loans")
    .select("*")
    .eq("id", loanId)
    .single();
  if (fetchErr || !oldLoan) throw new Error("Loan not found");

  const oldPrincipal = Number(oldLoan.principal_amount) || 0;
  const newPrincipal = Number(formData.principal_amount) || 0;
  const diff = newPrincipal - oldPrincipal;
  const currentOutstanding = Number(oldLoan.outstanding_balance) ?? oldPrincipal;
  const newOutstanding = Math.max(0, currentOutstanding + diff);

  const isUnrec = formData.is_unrecoverable !== undefined ? Boolean(formData.is_unrecoverable) : isLoanUnrecoverable(oldLoan);
  const repaymentType = formData.repayment_type || oldLoan.repayment_type || "monthly_installments";
  const bankAccId = formData.bank_account_id !== undefined ? formData.bank_account_id : (oldLoan.bank_account_id || null);
  const overrideTag = `[repayment:${repaymentType}]${bankAccId ? `[bank:${bankAccId}]` : ""}${isUnrec ? "[unrecoverable:true]" : ""}`;
  const cleanOverride = (oldLoan.override_reason || "Direct installment")
    .replace(/\[repayment:[^\]]+\]/g, "")
    .replace(/\[bank:[^\]]+\]/g, "")
    .replace(/\[unrecoverable:[^\]]+\]/g, "")
    .trim();
  const combinedOverride = `${cleanOverride} ${overrideTag}`.trim();

  const updatePayload: Record<string, any> = {
    principal_amount: newPrincipal,
    monthly_installment: Number(formData.monthly_installment) || 0,
    reason: formData.reason ?? null,
    issued_date: formData.issued_date,
    outstanding_balance: newOutstanding,
    installment_cap_pct: 100,
    override_reason: combinedOverride,
    bank_account_id: bankAccId || null,
    repayment_type: repaymentType,
    is_unrecoverable: isUnrec,
    ...(formData.status ? { status: formData.status } : {}),
  };

  let updatedLoan: any;
  const { data: updated, error: updateErr } = await supabase
    .from("employee_loans")
    .update(updatePayload)
    .eq("id", loanId)
    .select()
    .single();

  if (updateErr && (updateErr.message.includes("column") || updateErr.message.includes("schema cache"))) {
    delete updatePayload.bank_account_id;
    delete updatePayload.repayment_type;
    delete updatePayload.is_unrecoverable;
    const retry = await supabase
      .from("employee_loans")
      .update(updatePayload)
      .eq("id", loanId)
      .select()
      .single();
    if (retry.error) throw new Error(retry.error.message);
    updatedLoan = retry.data;
  } else if (updateErr) {
    throw new Error(updateErr.message);
  } else {
    updatedLoan = updated;
  }

  const { error: ledgerErr } = await supabase
    .from("employee_ledger")
    .update({
      amount: newPrincipal,
      entry_date: formData.issued_date,
      description: formData.reason ? `Loan Disbursed (${formData.reason})` : "Loan Disbursed",
    })
    .eq("source_table", "employee_loans")
    .eq("source_id", loanId);
  if (ledgerErr) console.error("[updateLoan] ledger update error:", ledgerErr.message);

  await supabase
    .from("payroll_runs")
    .update({
      loan_installment_due: Number(formData.monthly_installment) || 0,
    })
    .eq("loan_id", loanId);

  REVALIDATE_PATHS.forEach((p) => revalidatePath(p));
  revalidatePath(`/employee-management/loans/${oldLoan.employee_id}`);
  revalidatePath(`/employee-management/ledger/${oldLoan.employee_id}`);
  return updatedLoan;
}

export async function deleteLoan(loanId: string) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const { data: loan, error: fetchErr } = await supabase
    .from("employee_loans")
    .select("employee_id")
    .eq("id", loanId)
    .single();
  if (fetchErr || !loan) throw new Error("Loan not found");

  const employeeId = loan.employee_id;

  await supabase
    .from("employee_ledger")
    .delete()
    .eq("source_table", "employee_loans")
    .eq("source_id", loanId);

  const { data: linkedRuns } = await supabase
    .from("payroll_runs")
    .select("id, basic_salary, bonus_amount, absent_deduction, sop_violation_deduction, loan_installment_applied")
    .eq("loan_id", loanId);

  if (linkedRuns && linkedRuns.length > 0) {
    for (const run of linkedRuns) {
      await supabase
        .from("employee_ledger")
        .delete()
        .eq("source_table", "payroll_runs")
        .eq("source_id", run.id)
        .eq("type", "loan");

      const basic = Number(run.basic_salary) || 0;
      const bonus = Number(run.bonus_amount) || 0;
      const absent = Number(run.absent_deduction) || 0;
      const sopD = Number(run.sop_violation_deduction) || 0;
      const netSalary = Math.max(0, basic + bonus - absent - sopD);
      const newNetPayable = netSalary;

      await supabase
        .from("payroll_runs")
        .update({
          loan_id: null,
          loan_installment_due: 0,
          loan_installment_applied: 0,
          balance_carried: 0,
          net_payable: newNetPayable,
        })
        .eq("id", run.id);

      await supabase
        .from("employee_ledger")
        .update({ amount: newNetPayable })
        .eq("source_table", "payroll_runs")
        .eq("source_id", run.id)
        .eq("type", "salary");
    }
  }

  const { error: delErr } = await supabase
    .from("employee_loans")
    .delete()
    .eq("id", loanId);
  if (delErr) throw new Error(delErr.message);

  REVALIDATE_PATHS.forEach((p) => revalidatePath(p));
  revalidatePath(`/employee-management/loans/${employeeId}`);
  revalidatePath(`/employee-management/ledger/${employeeId}`);
}

export async function getEmployeeLedger(
  employeeId: string,
  filters?: { fromDate?: string; toDate?: string; type?: "all" | "salary" | "loan" }
) {
  const supabase = await createClient();

  const [loansRes, payrollRes, recoveriesRes, bankAccountsRes] = await Promise.all([
    supabase
      .from("employee_loans")
      .select("id, principal_amount, monthly_installment, issued_date, reason, repayment_type, bank_account_id, created_at, override_reason")
      .eq("employee_id", employeeId),
    supabase
      .from("payroll_runs")
      .select("id, expense_date, salary_month, basic_salary, bonus_amount, absent_deduction, sop_violation_deduction, loan_installment_applied, net_payable, loan_id, created_at")
      .eq("employee_id", employeeId),
    supabase
      .from("employee_loan_recoveries")
      .select("id, loan_id, amount, recovery_date, notes, bank_account_id, created_at")
      .eq("employee_id", employeeId),
    supabase
      .from("bank_accounts")
      .select("id, bank_name, account_title"),
  ]);

  const bankMap = new Map<string, string>();
  (bankAccountsRes.data || []).forEach((b: any) => {
    bankMap.set(b.id, b.account_title || b.bank_name || "Bank Account");
  });

  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const formatSalaryMonthLabel = (salaryMonth?: string) => {
    if (!salaryMonth) return "";
    const parts = salaryMonth.split("-");
    if (parts.length >= 2) {
      const y = parts[0];
      const mIdx = parseInt(parts[1], 10) - 1;
      const mName = MONTH_NAMES[mIdx] || parts[1];
      return `${mName} ${y}`;
    }
    return salaryMonth;
  };

  const rawEvents: Array<{
    id: string;
    date: string;
    createdAt: string;
    category: "loan_disbursed" | "payroll" | "recovery";
    typeDisplay: string;
    inAmount: number | null;
    outAmount: number | null;
    balanceDelta: number;
    description: string;
  }> = [];

  (loansRes.data || []).forEach((l: any) => {
    const principal = Number(l.principal_amount) || 0;
    const date = (l.issued_date || l.created_at || "").slice(0, 10);
    const isUnrec = isLoanUnrecoverable(l);
    const typeDisplay = isUnrec
      ? `loan (Rs. ${principal.toLocaleString()}) | Unrecoverable`
      : `loan (Rs. ${principal.toLocaleString()})`;
    rawEvents.push({
      id: `loan_${l.id}`,
      date,
      createdAt: l.created_at || date,
      category: "loan_disbursed",
      typeDisplay,
      inAmount: principal,
      outAmount: null,
      balanceDelta: principal,
      description: l.reason ? `Loan Disbursed (${l.reason})` : "Loan Disbursed",
    });
  });

  (payrollRes.data || []).forEach((p: any) => {
    const netPayable = Number(p.net_payable) || 0;
    const loanApplied = Number(p.loan_installment_applied) || 0;
    const date = (p.expense_date || p.salary_month || p.created_at || "").slice(0, 10);
    const monthLabel = formatSalaryMonthLabel(p.salary_month);

    let typeDisplay: string;
    let outAmount: number | null = null;
    let description: string;
    let balanceDelta = 0;

    if (loanApplied > 0) {
      typeDisplay = `salary (Rs. ${netPayable.toLocaleString()}) | loan (Rs. ${loanApplied.toLocaleString()})`;
      outAmount = loanApplied;
      balanceDelta = -loanApplied;
      description = `Loan Installment Recovered from ${monthLabel} Salary`;
    } else {
      typeDisplay = `salary (Rs. ${netPayable.toLocaleString()})`;
      outAmount = null;
      balanceDelta = 0;
      description = `Salary paid for ${monthLabel}`;
    }

    rawEvents.push({
      id: `payroll_${p.id}`,
      date,
      createdAt: p.created_at || date,
      category: "payroll",
      typeDisplay,
      inAmount: null,
      outAmount,
      balanceDelta,
      description,
    });
  });

  (recoveriesRes.data || []).forEach((r: any) => {
    const amt = Number(r.amount) || 0;
    const date = (r.recovery_date || r.created_at || "").slice(0, 10);
    const accountName = r.bank_account_id ? bankMap.get(r.bank_account_id) || "Linked Account" : "";
    const notesPart = r.notes?.trim() || "";
    let desc = "";
    if (notesPart && accountName) desc = `${notesPart} | ${accountName}`;
    else if (notesPart) desc = notesPart;
    else if (accountName) desc = accountName;
    else desc = "Loan Recovery";

    rawEvents.push({
      id: `rec_${r.id}`,
      date,
      createdAt: r.created_at || date,
      category: "recovery",
      typeDisplay: `loan recovery (Rs. ${amt.toLocaleString()})`,
      inAmount: null,
      outAmount: amt,
      balanceDelta: -amt,
      description: desc,
    });
  });

  rawEvents.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  });

  let running = 0;
  const processed = rawEvents.map((ev) => {
    running = Math.max(0, running + ev.balanceDelta);
    return {
      id: ev.id,
      entry_date: ev.date,
      type: ev.typeDisplay,
      direction: ev.inAmount ? "in" : ev.outAmount ? "out" : "none",
      amount: ev.inAmount ?? ev.outAmount ?? 0,
      in_amount: ev.inAmount,
      out_amount: ev.outAmount,
      running_balance: running,
      description: ev.description,
      category: ev.category,
    };
  });

  let filtered = processed;
  if (filters?.fromDate) {
    filtered = filtered.filter((r) => r.entry_date >= filters.fromDate!);
  }
  if (filters?.toDate) {
    filtered = filtered.filter((r) => r.entry_date <= filters.toDate!);
  }
  if (filters?.type && filters.type !== "all") {
    if (filters.type === "salary") {
      filtered = filtered.filter((r) => r.category === "payroll");
    } else if (filters.type === "loan") {
      filtered = filtered.filter((r) => r.category === "loan_disbursed" || r.category === "recovery");
    }
  }

  return filtered;
}

export async function recoverEmployeeLoan(
  loanId: string,
  employeeId: string,
  formData: {
    recovery_date: string;
    amount: number;
    bank_account_id?: string;
    notes?: string;
  }
) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const { data: loan, error: fetchErr } = await supabase
    .from("employee_loans")
    .select("*")
    .eq("id", loanId)
    .single();
  if (fetchErr || !loan) throw new Error("Loan not found");

  const recoveryAmt = Number(formData.amount) || 0;
  if (recoveryAmt <= 0) throw new Error("Recovered amount must be greater than zero");

  const [payrollRes, previousRecsRes] = await Promise.all([
    supabase.from("payroll_runs").select("loan_installment_applied").eq("loan_id", loanId).gt("loan_installment_applied", 0),
    supabase.from("employee_loan_recoveries").select("amount").eq("loan_id", loanId),
  ]);
  const prevPayrollDeducted = (payrollRes.data || []).reduce((s, p: any) => s + (Number(p.loan_installment_applied) || 0), 0);
  const prevRecovered = (previousRecsRes.data || []).reduce((s, r: any) => s + (Number(r.amount) || 0), 0);
  const principal = Number(loan.principal_amount) || 0;
  const currentBal = Math.max(0, principal - prevPayrollDeducted - prevRecovered);
  const newBal = Math.max(0, currentBal - recoveryAmt);

  const bankAccId = formData.bank_account_id || loan.bank_account_id || null;

    await supabase
      .from("employee_loans")
      .update({
        outstanding_balance: newBal,
        status: newBal === 0 ? "closed" : (loan.status === "closed" ? "active" : loan.status),
      })
      .eq("id", loanId);

  let recoveryId = crypto.randomUUID();
  try {
    const { data: rec } = await supabase
      .from("employee_loan_recoveries")
      .insert({
        tenant_id: tenantId,
        loan_id: loanId,
        employee_id: employeeId,
        bank_account_id: bankAccId,
        amount: recoveryAmt,
        recovery_date: formData.recovery_date,
        notes: formData.notes || null,
      })
      .select("id")
      .single();
    if (rec?.id) recoveryId = rec.id;
  } catch (_) {}

  try {
    const descNote = formData.notes ? ` (${formData.notes})` : "";
    const bankTag = bankAccId ? ` [bank:${bankAccId}]` : "";
    await supabase.from("employee_ledger").insert({
      tenant_id: tenantId,
      employee_id: employeeId,
      entry_date: formData.recovery_date,
      type: "loan",
      direction: "out",
      amount: recoveryAmt,
      source_table: "employee_loan_recoveries",
      source_id: recoveryId,
      description: `Loan Recovery${descNote}${bankTag}`,
    });
  } catch (_) {}

  REVALIDATE_PATHS.forEach((p) => revalidatePath(p));
  revalidatePath(`/employee-management/loans/${employeeId}`);
  revalidatePath(`/employee-management/ledger/${employeeId}`);
  return { success: true, newBal };
}

export async function getAllEmployeeLoans(filters?: { fromDate?: string; toDate?: string }) {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("employee_loans")
      .select("*, employee:employees(id, full_name, employee_code)")
      .order("issued_date", { ascending: true });
    if (filters?.fromDate) query = query.gte("issued_date", filters.fromDate);
    if (filters?.toDate) query = query.lte("issued_date", filters.toDate);
    const { data, error } = await query;
    if (error) { console.error("[getAllEmployeeLoans]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getAllEmployeeLoans] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getAllLoanRecoveries(filters?: { fromDate?: string; toDate?: string }) {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("employee_loan_recoveries")
      .select("id, amount, recovery_date, notes, created_at, employee:employees(id, full_name, employee_code)")
      .order("recovery_date", { ascending: true });

    if (filters?.fromDate) query = query.gte("recovery_date", filters.fromDate);
    if (filters?.toDate) query = query.lte("recovery_date", filters.toDate);

    const { data, error } = await query;
    if (error) {
      console.error("[getAllLoanRecoveries]", error.message);
      return [];
    }

    return (data || []).map((r: any) => ({
      ...r,
      entry_date: r.recovery_date,
      direction: "out",
      type: "loan",
    }));
  } catch (err: any) {
    console.error("[getAllLoanRecoveries] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getCalculatedEmployeeLoans(targetTenantId?: string, asOfDate?: string) {
  try {
    const supabase = await createClient();
    const tenantId = targetTenantId || (await getTenantId());
    if (!tenantId) {
      return {
        loans: [],
        employeeBalances: {} as Record<string, number>,
        totalOutstanding: 0,
        activeLoansCount: 0,
        totalDeadAssets: 0,
        deadLoansCount: 0,
      };
    }

    const [loansRes, payrollRes, directRecRes] = await Promise.all([
      supabase
        .from("employee_loans")
        .select("*, employee:employees(id, full_name, role, employee_code)")
        .eq("tenant_id", tenantId)
        .order("issued_date", { ascending: false }),
      supabase
        .from("payroll_runs")
        .select("id, employee_id, loan_id, loan_installment_applied, expense_date, salary_month, created_at")
        .eq("tenant_id", tenantId)
        .gt("loan_installment_applied", 0),
      supabase
        .from("employee_loan_recoveries")
        .select("id, employee_id, loan_id, amount, recovery_date, created_at")
        .eq("tenant_id", tenantId),
    ]);

    let loans = loansRes.data || [];
    let payrollRuns = payrollRes.data || [];
    let recoveries = directRecRes.data || [];

    if (asOfDate) {
      loans = loans.filter((l: any) => !l.issued_date || l.issued_date <= asOfDate);
      payrollRuns = payrollRuns.filter((p: any) => {
        const d = (p.expense_date || p.salary_month || "").slice(0, 10);
        return !d || d <= asOfDate;
      });
      recoveries = recoveries.filter((r: any) => {
        const d = (r.recovery_date || "").slice(0, 10);
        return !d || d <= asOfDate;
      });
    }

    const loansByEmp: Record<string, any[]> = {};
    loans.forEach((l: any) => {
      if (l.employee_id) {
        if (!loansByEmp[l.employee_id]) loansByEmp[l.employee_id] = [];
        loansByEmp[l.employee_id].push(l);
      }
    });

    const findLoanForEmp = (empId: string) => {
      const empLoans = loansByEmp[empId] || [];
      const active = empLoans.find((l) => l.status === "active");
      return active || empLoans[0] || null;
    };

    const payrollByLoan: Record<string, number> = {};
    for (const p of payrollRuns) {
      let targetLoanId = p.loan_id;
      if (!targetLoanId && p.employee_id) {
        const matched = findLoanForEmp(p.employee_id);
        if (matched) {
          targetLoanId = matched.id;
          if (!asOfDate) {
            void supabase
              .from("payroll_runs")
              .update({ loan_id: targetLoanId })
              .eq("id", p.id)
              .then(() => {}, () => {});
          }
        }
      }
      if (targetLoanId) {
        payrollByLoan[targetLoanId] = (payrollByLoan[targetLoanId] || 0) + (Number(p.loan_installment_applied) || 0);
      }
    }

    const recoveryByLoan: Record<string, number> = {};
    for (const r of recoveries) {
      let targetLoanId = r.loan_id;
      if (!targetLoanId && r.employee_id) {
        const matched = findLoanForEmp(r.employee_id);
        if (matched) targetLoanId = matched.id;
      }
      if (targetLoanId) {
        recoveryByLoan[targetLoanId] = (recoveryByLoan[targetLoanId] || 0) + (Number(r.amount) || 0);
      }
    }

    const employeeBalances: Record<string, number> = {};
    const calculatedLoans: any[] = [];
    let totalOutstanding = 0;
    let activeLoansCount = 0;
    let totalDeadAssets = 0;
    let deadLoansCount = 0;

    for (const l of loans) {
      const principal = Number(l.principal_amount) || 0;
      const deducted = (payrollByLoan[l.id] || 0) + (recoveryByLoan[l.id] || 0);
      const calculatedBalance = Math.max(0, principal - deducted);
      const calculatedStatus = calculatedBalance === 0 ? "closed" : "active";

      if (
        !asOfDate &&
        (Number(l.outstanding_balance) !== calculatedBalance ||
        l.status !== calculatedStatus)
      ) {
        void supabase
          .from("employee_loans")
          .update({
            outstanding_balance: calculatedBalance,
            status: calculatedStatus,
          })
          .eq("id", l.id)
          .then(() => {}, () => {});
      }

      const isUnrec = isLoanUnrecoverable(l);

      if (isUnrec) {
        const deadAmt = calculatedBalance > 0 ? calculatedBalance : principal;
        if (deadAmt > 0) {
          totalDeadAssets += deadAmt;
          deadLoansCount += 1;
        }
      } else {
        if (calculatedBalance > 0) {
          totalOutstanding += calculatedBalance;
          activeLoansCount += 1;
        }
      }

      if (l.employee_id) {
        employeeBalances[l.employee_id] = (employeeBalances[l.employee_id] || 0) + calculatedBalance;
      }

      calculatedLoans.push({
        ...l,
        is_unrecoverable: isUnrec,
        outstanding_balance: calculatedBalance,
        status: calculatedStatus,
      });
    }

    return {
      loans: calculatedLoans,
      employeeBalances,
      totalOutstanding,
      activeLoansCount,
      totalDeadAssets,
      deadLoansCount,
    };
  } catch (err: any) {
    console.error("[getCalculatedEmployeeLoans] error:", err?.message ?? err);
    return {
      loans: [],
      employeeBalances: {},
      totalOutstanding: 0,
      activeLoansCount: 0,
      totalDeadAssets: 0,
      deadLoansCount: 0,
    };
  }
}

export async function getLatestEmployeeBalances(): Promise<Record<string, number>> {
  try {
    const data = await getCalculatedEmployeeLoans();
    return data.employeeBalances;
  } catch {
    return {};
  }
}

export async function getEmployeeRunningBalance(employeeId: string): Promise<number> {
  try {
    const data = await getCalculatedEmployeeLoans();
    return data.employeeBalances[employeeId] ?? 0;
  } catch {
    return 0;
  }
}

