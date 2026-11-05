"use client";

import { useState, useTransition, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/Table";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { createPayrollRun, updatePayrollRun, deletePayrollRun, deletePayrollRuns } from "@/lib/actions/payroll";
import { getActiveLoan, getEmployeeRunningBalance } from "@/lib/actions/employees";
import { PayrollRunsExportButtons } from "@/components/export/PayrollRunsExportButtons";
import { FileText, Trash2, Pencil, Loader2 } from "lucide-react";

const fmt = (n: any) =>
  n != null ? `Rs. ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0 })}` : "—";

interface Props {
  initialRuns: any[];
  employees: any[];
  bankAccounts: any[];
  employeeBalances?: Record<string, number>;
  distributorName?: string;
}

export function PayrollRunsClient({
  initialRuns,
  employees,
  bankAccounts,
  employeeBalances = {},
  distributorName,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [monthFilter, setMonthFilter] = useState(
    new Date().toISOString().slice(0, 7)
  );
  const [showModal, setShowModal] = useState(false);
  const [empLedgerBalance, setEmpLedgerBalance] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [form, setForm] = useState({
    employee_id: "",
    salary_month: new Date().toISOString().slice(0, 7),
    expense_date: new Date().toISOString().split("T")[0],
    working_days: "26",
    bonus_amount: "0",
    absent_deduction: "0",
    loan_installment_due: "0",
    loan_installment_applied: "0",
    operator: "",
    computer_voucher: "",
    bank_account_id: "",
  });

  const [activeLoan, setActiveLoan] = useState<any>(null);
  const [loadingLoan, setLoadingLoan] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const selectedEmp = employees.find((e) => e.id === form.employee_id);
  const basicSalary = selectedEmp?.basic_salary ?? 0;

  const generateAutoVoucher = () => {
    let maxNum = 0;
    initialRuns.forEach((r) => {
      if (r.computer_voucher) {
        const match = String(r.computer_voucher).match(/CVR-?(\d+)/i);
        if (match) {
          const val = parseInt(match[1], 10);
          if (val > maxNum) maxNum = val;
        }
      }
    });
    return `CVR-${String(maxNum + 1).padStart(4, "0")}`;
  };

  const openAdd = () => {
    setEditingId(null);
    setForm({
      employee_id: "",
      salary_month: new Date().toISOString().slice(0, 7),
      expense_date: new Date().toISOString().split("T")[0],
      working_days: "26",
      bonus_amount: "0",
      absent_deduction: "0",
      loan_installment_due: "0",
      loan_installment_applied: "0",
      operator: "",
      computer_voucher: generateAutoVoucher(),
      bank_account_id: "",
    });
    setShowModal(true);
  };

  const openEdit = (run: any) => {
    setEditingId(run.id);
    setForm({
      employee_id: run.employee_id || "",
      salary_month: run.salary_month ? run.salary_month.slice(0, 7) : new Date().toISOString().slice(0, 7),
      expense_date: run.expense_date || (run.salary_month ? run.salary_month.slice(0, 10) : new Date().toISOString().split("T")[0]),
      working_days: String(run.working_days ?? 26),
      bonus_amount: String(run.bonus_amount ?? 0),
      absent_deduction: String(run.absent_deduction ?? 0),
      loan_installment_due: String(run.loan_installment_due ?? 0),
      loan_installment_applied: String(run.loan_installment_applied ?? 0),
      operator: run.operator || "",
      computer_voucher: run.computer_voucher || "",
      bank_account_id: run.bank_account_id || "",
    });
    setShowModal(true);
  };

  useEffect(() => {
    if (!form.employee_id) {
      setActiveLoan(null);
      setEmpLedgerBalance(null);
      if (!editingId) {
        setForm((f) => ({ ...f, loan_installment_due: "0", loan_installment_applied: "0" }));
      }
      return;
    }
    setLoadingLoan(true);
    getActiveLoan(form.employee_id).then((loan) => {
      setActiveLoan(loan ?? null);
      if (loan && !editingId) {
        setForm((f) => ({
          ...f,
          loan_installment_due: String(loan.monthly_installment ?? 0),
          loan_installment_applied: String(loan.monthly_installment ?? 0),
        }));
      } else if (!loan && !editingId) {
        setForm((f) => ({ ...f, loan_installment_due: "0", loan_installment_applied: "0" }));
      }
      setLoadingLoan(false);
    });
    getEmployeeRunningBalance(form.employee_id).then((bal) => {
      setEmpLedgerBalance(bal);
    });
  }, [form.employee_id, editingId]);

  const bonus       = parseFloat(form.bonus_amount) || 0;
  const absentDed   = parseFloat(form.absent_deduction) || 0;
  const loanDue     = parseFloat(form.loan_installment_due) || 0;
  const loanApplied = parseFloat(form.loan_installment_applied) || 0;
  const netSalary   = basicSalary + bonus - absentDed;
  const netPayable  = Math.max(netSalary - loanApplied, 0);
  const balCarried  = Math.max(loanDue - loanApplied, 0);

  const filtered = useMemo(() =>
    initialRuns.filter((r) => {
      if (!monthFilter) return true;
      return r.salary_month?.startsWith(monthFilter);
    }),
    [initialRuns, monthFilter]
  );

  const exportRows = useMemo(
    () =>
      filtered.map((run) => ({
        code: run.employee?.employee_code || "",
        name: run.employee?.full_name || "",
        date: run.expense_date || run.salary_month || "",
        basic: Number(run.basic_salary) || 0,
        bonus: Number(run.bonus_amount) || 0,
        absentDeduction: Number(run.absent_deduction) || 0,
        netSalary: Number(run.net_salary) || 0,
        loanDue: Number(run.loan_installment_due) || 0,
        loanApplied: Number(run.loan_installment_applied) || 0,
        netPayable: Number(run.net_payable) || 0,
        ledgerBalance: Number(employeeBalances[run.employee_id] ?? 0),
      })),
    [filtered, employeeBalances]
  );

  const isAllSelected = filtered.length > 0 && filtered.every((r) => selectedIds.includes(r.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(filtered.map((r) => r.id));
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Delete ${selectedIds.length} selected payroll run(s)?`)) return;
    setIsBulkDeleting(true);
    startTransition(async () => {
      try {
        await deletePayrollRuns(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (e: any) { alert(e.message); }
      finally { setIsBulkDeleting(false); }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this payroll run?")) return;
    setDeletingId(id);
    startTransition(async () => {
      try { await deletePayrollRun(id); router.refresh(); }
      catch (e: any) { alert(e.message); }
      finally { setDeletingId(null); }
    });
  };

  const handlePayslip = (runId: string) => {
    window.open(`/employee-management/payroll/payslip/${runId}`, "_blank");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.employee_id) { alert("Select an employee."); return; }
    if (!form.operator || !form.operator.trim()) { alert("Operator is required."); return; }
    startTransition(async () => {
      try {
        const payload = {
          employee_id: form.employee_id,
          loan_id: activeLoan?.id || undefined,
          salary_month: form.expense_date ? `${form.expense_date.slice(0, 7)}-01` : `${form.salary_month}-01`,
          expense_date: form.expense_date || undefined,
          working_days: parseInt(form.working_days),
          basic_salary: basicSalary,
          bonus_amount: bonus,
          absent_deduction: absentDed,
          loan_installment_due: loanDue,
          loan_installment_applied: loanApplied,
          balance_carried: balCarried,
          operator: form.operator || undefined,
          computer_voucher: form.computer_voucher || undefined,
          bank_account_id: form.bank_account_id || undefined,
        };
        if (editingId) {
          const { updatePayrollRun } = await import("@/lib/actions/payroll");
          await updatePayrollRun(editingId, payload);
        } else {
          await createPayrollRun(payload);
        }
        setShowModal(false);
        router.refresh();
      } catch (e: any) { alert(e.message); }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-zinc-600">Month:</label>
          <Input
            type="month"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PayrollRunsExportButtons
            rows={exportRows}
            month={monthFilter}
            distributorName={distributorName}
          />
          <Button
            type="button"
            variant={isAllSelected ? "ghost" : "outline"}
            size="sm"
            onClick={handleToggleSelectAll}
            className="whitespace-nowrap"
          >
            {isAllSelected ? "Deselect All" : "Select All"}
          </Button>
          {selectedIds.length > 0 && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={handleBulkDelete}
              disabled={isBulkDeleting || isPending}
              className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 whitespace-nowrap"
            >
              {isBulkDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete ({selectedIds.length})
            </Button>
          )}
          <Button onClick={openAdd}>+ New Payroll Run</Button>
        </div>
      </div>

      {filtered.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: "Total Net Payable", value: filtered.reduce((s, r) => s + (Number(r.net_payable) || 0), 0) },
            { label: "Total Loan Applied", value: filtered.reduce((s, r) => s + (Number(r.loan_installment_applied) || 0), 0) },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-lg border border-zinc-200 p-4">
              <p className="text-xs text-zinc-500 mb-1">{stat.label}</p>
              <p className="text-xl font-bold" style={{ color: "var(--primary)" }}>
                Rs. {stat.value.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center"><input type="checkbox" checked={isAllSelected} onChange={handleToggleSelectAll} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Basic</TableHead>
              <TableHead className="text-right">Bonus</TableHead>
              <TableHead className="text-right">Absent Ded.</TableHead>
              <TableHead className="text-right">Net Salary</TableHead>
              <TableHead className="text-right">Loan Due</TableHead>
              <TableHead className="text-right">Loan Applied</TableHead>
              <TableHead className="text-right">Net Payable</TableHead>
              <TableHead className="text-right">Ledger Balance</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center text-zinc-400 py-8">
                  No payroll runs for {monthFilter || "selected period"}
                </TableCell>
              </TableRow>
            ) : filtered.map((run) => (
              <TableRow key={run.id} className={selectedIds.includes(run.id) ? "bg-red-50/50" : ""}>
                <TableCell className="w-10 text-center"><input type="checkbox" checked={selectedIds.includes(run.id)} onChange={() => setSelectedIds(prev => prev.includes(run.id) ? prev.filter(id => id !== run.id) : [...prev, run.id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableCell>
                <TableCell className="font-mono text-xs">{run.employee?.employee_code || "—"}</TableCell>
                <TableCell className="font-semibold">{run.employee?.full_name || "—"}</TableCell>
                <TableCell className="text-xs font-mono">{run.expense_date || run.salary_month?.slice(0, 10)}</TableCell>
                <TableCell className="text-right">{fmt(run.basic_salary)}</TableCell>
                <TableCell className="text-right">{fmt(run.bonus_amount)}</TableCell>
                <TableCell className="text-right text-red-500">{fmt(run.absent_deduction)}</TableCell>
                <TableCell className="text-right font-medium">{fmt(run.net_salary)}</TableCell>
                <TableCell className="text-right text-zinc-500">{fmt(run.loan_installment_due)}</TableCell>
                <TableCell className="text-right text-red-500">{fmt(run.loan_installment_applied)}</TableCell>
                <TableCell className="text-right font-bold" style={{ color: "var(--primary)" }}>
                  {fmt(run.net_payable)}
                </TableCell>
                <TableCell className="text-right font-semibold text-zinc-800">
                  {fmt(employeeBalances[run.employee_id] ?? employeeBalances[run.employee?.id] ?? 0)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-zinc-600 hover:text-zinc-900"
                      onClick={() => openEdit(run)}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-zinc-600 hover:text-zinc-900"
                      onClick={() => handlePayslip(run.id)}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Payslip
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500 hover:text-red-700 min-w-[3.125rem] flex items-center justify-center gap-1"
                      onClick={() => handleDelete(run.id)}
                      disabled={deletingId === run.id || isPending}
                    >
                      {deletingId === run.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Delete"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl my-6 p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-5">{editingId ? "Edit Payroll Run" : "New Payroll Run"}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Employee *</label>
                <SearchableSelect
                  options={employees.map((e) => ({
                    value: e.id,
                    label: `${e.full_name} — Rs. ${Number(e.basic_salary || 0).toLocaleString()}`,
                    sub: e.employee_code || undefined,
                  }))}
                  value={form.employee_id}
                  onChange={(v) => set("employee_id", v)}
                  placeholder="— Select employee —"
                  searchPlaceholder="Search by name or code..."
                  required
                />
              </div>

              {form.employee_id && !loadingLoan && (
                <div className={`rounded-lg px-3 py-2 text-xs border ${activeLoan ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-zinc-50 border-zinc-200 text-zinc-500"}`}>
                  {activeLoan
                    ? `Active loan: Rs. ${Number(activeLoan.monthly_installment).toLocaleString()} / month · Outstanding: Rs. ${Number(activeLoan.outstanding_balance).toLocaleString()}`
                    : "No active loan for this employee"}
                </div>
              )}
              {loadingLoan && (
                <p className="text-xs text-zinc-400">Checking loan status…</p>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Date *</label>
                  <Input type="date" value={form.expense_date} onChange={(e) => set("expense_date", e.target.value)} required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Working Days</label>
                  <Input type="number" min="1" max="31" value={form.working_days} onChange={(e) => set("working_days", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Basic Salary (auto)</label>
                  <Input value={basicSalary ? `Rs. ${Number(basicSalary).toLocaleString()}` : "—"} readOnly className="bg-zinc-50 text-zinc-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Bonus (Rs.)</label>
                  <Input type="number" min="0" step="0.01" value={form.bonus_amount} onChange={(e) => set("bonus_amount", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Absent Deduction (Rs.)</label>
                  <Input type="number" min="0" step="0.01" value={form.absent_deduction} onChange={(e) => set("absent_deduction", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Loan Due This Month (Rs.)</label>
                  <Input type="number" min="0" step="0.01" value={form.loan_installment_due} onChange={(e) => set("loan_installment_due", e.target.value)} disabled={!activeLoan && Number(form.loan_installment_due) === 0} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Loan Applied (Rs.)</label>
                  <Input type="number" min="0" step="0.01" value={form.loan_installment_applied} onChange={(e) => set("loan_installment_applied", e.target.value)} disabled={!activeLoan && Number(form.loan_installment_applied) === 0} />
                </div>
              </div>

              {form.employee_id && (
                <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3 grid grid-cols-3 gap-2 text-xs">
                  <div><p className="text-zinc-400">Net Salary</p><p className="font-semibold">{fmt(netSalary)}</p></div>
                  <div><p className="text-zinc-400">Net Payable</p><p className="font-bold text-lg" style={{color:"var(--primary)"}}>{fmt(netPayable)}</p></div>
                  <div><p className="text-zinc-400">Ledger Balance</p>
                    <p className="font-semibold text-zinc-800">{fmt(empLedgerBalance ?? employeeBalances[form.employee_id] ?? 0)}</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Operator *</label>
                  <Input value={form.operator} onChange={(e) => set("operator", e.target.value)} placeholder="e.g. Admin" required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Computer Voucher #</label>
                  <Input value={form.computer_voucher} onChange={(e) => set("computer_voucher", e.target.value)} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Bank Account (for ledger)</label>
                <select
                  className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white"
                  value={form.bank_account_id}
                  onChange={(e) => set("bank_account_id", e.target.value)}
                >
                  <option value="">— No bank account —</option>
                  {bankAccounts.map((b: any) => (
                    <option key={b.id} value={b.id}>
                      {b.bank_name} — {b.account_title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1 flex items-center justify-center gap-1.5" disabled={isPending}>
                  {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>{isPending ? "Saving..." : editingId ? "Save Changes" : "Save Payroll Run"}</span>
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
