"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { ExportButtons } from "@/components/export/ExportButtons";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/Table";
import { ArrowLeft, Pencil, Trash2, Plus, Banknote, Loader2, DollarSign, RefreshCw } from "lucide-react";
import { createLoan, updateLoan, deleteLoan, recoverEmployeeLoan } from "@/lib/actions/employees";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

interface Employee {
  id: string;
  employee_code?: string;
  full_name: string;
  role: string;
  phone?: string;
  basic_salary?: number;
  joining_date?: string;
  active?: boolean;
}

interface Loan {
  id: string;
  employee_id: string;
  principal_amount: number;
  monthly_installment: number;
  outstanding_balance?: number;
  status: string;
  reason?: string;
  issued_date: string;
  type?: string;
  created_at?: string;
  bank_account_id?: string;
  repayment_type?: string;
  override_reason?: string;
  is_unrecoverable?: boolean;
}

interface Props {
  employee: Employee;
  initialLoans: Loan[];
  runningBalance: number;
  bankAccounts?: any[];
}

const ROLES = [
  { value: "dm",                label: "Delivery Man",      color: "bg-red-100 text-red-700" },
  { value: "preseller",         label: "Preseller",         color: "bg-green-100 text-green-700" },
  { value: "operation_manager", label: "Operation Manager", color: "bg-blue-100 text-blue-700" },
  { value: "loader",            label: "Loader",            color: "bg-purple-100 text-purple-700" },
  { value: "lifter_operator",   label: "Lifter Operator",   color: "bg-teal-100 text-teal-700" },
  { value: "dvo",               label: "DVO",               color: "bg-zinc-100 text-zinc-700" },
  { value: "driver",            label: "Driver",            color: "bg-cyan-100 text-cyan-700" },
  { value: "guard",             label: "Guard",             color: "bg-yellow-100 text-yellow-700" },
  { value: "office",            label: "Office",            color: "bg-indigo-100 text-indigo-700" },
  { value: "other",             label: "Other",             color: "bg-gray-100 text-gray-600" },
] as const;

function getRoleConfig(val: string) {
  return ROLES.find((r) => r.value === val) ?? { label: val, color: "bg-zinc-100 text-zinc-500" };
}

export function EmployeeLoansDetailClient({ employee, initialLoans, runningBalance, bankAccounts = [] }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    router.refresh();
    setTimeout(() => setIsRefreshing(false), 700);
  };

  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
  const [editForm, setEditForm] = useState({
    principal_amount: "",
    monthly_installment: "",
    issued_date: "",
    reason: "",
    status: "active",
    bank_account_id: "",
    repayment_type: "monthly_installments",
    is_unrecoverable: false,
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    principal_amount: "",
    monthly_installment: "",
    issued_date: new Date().toISOString().split("T")[0],
    reason: "",
    bank_account_id: "",
    repayment_type: "",
    is_unrecoverable: false,
  });

  const [showRecoverModal, setShowRecoverModal] = useState(false);
  const [recoverLoanTarget, setRecoverLoanTarget] = useState<Loan | null>(null);
  const [recoverForm, setRecoverForm] = useState({
    recovery_date: new Date().toISOString().split("T")[0],
    amount: "",
    bank_account_id: "",
    notes: "",
  });

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const bankOptions = useMemo(() => {
    return (bankAccounts || []).map((b: any) => ({
      value: b.id,
      label: `${b.bank_name || ""} — ${b.account_title || ""}`.trim().replace(/^—\s*|\s*—$/g, ""),
      sub: b.account_number || undefined,
    }));
  }, [bankAccounts]);

  const handleOpenEdit = (loan: Loan) => {
    setErrorMsg("");
    setEditingLoan(loan);
    const repType = loan.repayment_type || (loan.override_reason?.includes("[repayment:scheduled_returns]") ? "scheduled_returns" : "monthly_installments");
    const bankId = loan.bank_account_id || loan.override_reason?.match(/\[bank:([a-f0-9\-]+)\]/i)?.[1] || "";
    const isUnrec = Boolean(loan.is_unrecoverable || loan.override_reason?.includes("[unrecoverable:true]"));
    setEditForm({
      principal_amount: String(loan.principal_amount ?? ""),
      monthly_installment: String(loan.monthly_installment ?? ""),
      issued_date: loan.issued_date ? loan.issued_date.slice(0, 10) : new Date().toISOString().split("T")[0],
      reason: loan.reason || "",
      status: loan.status || "active",
      bank_account_id: bankId,
      repayment_type: repType,
      is_unrecoverable: isUnrec,
    });
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLoan) return;
    setErrorMsg("");

    const principal = parseFloat(editForm.principal_amount);
    const isMonthly = editForm.repayment_type === "monthly_installments";
    const installment = parseFloat(editForm.monthly_installment);

    if (isNaN(principal) || principal <= 0) {
      setErrorMsg("Please enter a valid principal amount.");
      return;
    }
    if (isMonthly && (isNaN(installment) || installment <= 0)) {
      setErrorMsg("Please enter a valid monthly installment.");
      return;
    }

    startTransition(async () => {
      try {
        await updateLoan(editingLoan.id, {
          principal_amount: principal,
          monthly_installment: isMonthly ? installment : 0,
          reason: editForm.reason.trim() || undefined,
          issued_date: editForm.issued_date,
          status: editForm.status,
          bank_account_id: editForm.bank_account_id || undefined,
          repayment_type: editForm.repayment_type,
          is_unrecoverable: editForm.is_unrecoverable,
        });
        setEditingLoan(null);
        router.refresh();
      } catch (err: any) {
        setErrorMsg(err?.message || "Failed to update loan.");
      }
    });
  };

  const handleDelete = (loanId: string) => {
    if (!confirm("Are you sure you want to delete this loan? It will be permanently removed from the ledger and payroll tracking.")) {
      return;
    }
    setErrorMsg("");
    setDeletingId(loanId);
    startTransition(async () => {
      try {
        await deleteLoan(loanId);
        router.refresh();
      } catch (err: any) {
        alert(err?.message || "Failed to delete loan.");
      } finally {
        setDeletingId(null);
      }
    });
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    const principal = parseFloat(addForm.principal_amount);
    const isMonthly = addForm.repayment_type === "monthly_installments";
    const installment = parseFloat(addForm.monthly_installment);

    if (isNaN(principal) || principal <= 0) {
      setErrorMsg("Please enter a valid principal amount.");
      return;
    }
    if (isMonthly && (isNaN(installment) || installment <= 0)) {
      setErrorMsg("Please enter a valid monthly installment.");
      return;
    }

    startTransition(async () => {
      try {
        await createLoan(employee.id, {
          principal_amount: principal,
          monthly_installment: isMonthly ? installment : 0,
          issued_date: addForm.issued_date,
          reason: addForm.reason.trim() || undefined,
          bank_account_id: addForm.bank_account_id || undefined,
          repayment_type: addForm.repayment_type || "scheduled_returns",
          is_unrecoverable: addForm.is_unrecoverable,
        });
        setShowAddModal(false);
        setAddForm({
          principal_amount: "",
          monthly_installment: "",
          issued_date: new Date().toISOString().split("T")[0],
          reason: "",
          bank_account_id: "",
          repayment_type: "",
          is_unrecoverable: false,
        });
        router.refresh();
      } catch (err: any) {
        setErrorMsg(err?.message || "Failed to create loan.");
      }
    });
  };

  const handleRecoverSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoverLoanTarget) return;
    setErrorMsg("");
    const amt = parseFloat(recoverForm.amount);
    if (isNaN(amt) || amt <= 0) {
      setErrorMsg("Please enter a valid recovered amount.");
      return;
    }
    startTransition(async () => {
      try {
        await recoverEmployeeLoan(recoverLoanTarget.id, employee.id, {
          recovery_date: recoverForm.recovery_date,
          amount: amt,
          bank_account_id: recoverForm.bank_account_id || undefined,
          notes: recoverForm.notes.trim() || undefined,
        });
        setShowRecoverModal(false);
        setRecoverLoanTarget(null);
        setRecoverForm({
          recovery_date: new Date().toISOString().split("T")[0],
          amount: "",
          bank_account_id: "",
          notes: "",
        });
        router.refresh();
      } catch (err: any) {
        setErrorMsg(err?.message || "Failed to recover loan.");
      }
    });
  };

  const roleConfig = getRoleConfig(employee.role);

  const exportData = initialLoans.map((l) => ({
    "Issue Date": l.issued_date || (l.created_at ? l.created_at.slice(0, 10) : "—"),
    Type: l.type || "Loan",
    Reason: l.reason || "—",
    "Principal Amount (Rs.)": l.principal_amount,
    "Monthly Installment (Rs.)": l.monthly_installment,
    "Outstanding Balance (Rs.)": l.outstanding_balance ?? l.principal_amount,
    Status: l.status,
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/employee-management/loans")}
          className="text-zinc-600 hover:text-zinc-900 -ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to Loans
        </Button>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              setErrorMsg("");
              setAddForm({
                principal_amount: "",
                monthly_installment: "",
                issued_date: new Date().toISOString().split("T")[0],
                reason: "",
                bank_account_id: "",
                repayment_type: "",
                is_unrecoverable: false,
              });
              setShowAddModal(true);
            }}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Give Loan
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="gap-1.5 text-xs text-zinc-600 hover:text-zinc-900 border-zinc-200"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <ExportButtons data={exportData} filename={`loans_${employee.employee_code || employee.full_name}`} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-zinc-900">{employee.full_name}</h1>
            <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-zinc-100 text-zinc-600 border border-zinc-200">
              {employee.employee_code || "No Code"}
            </span>
            <Badge className={roleConfig.color}>{roleConfig.label}</Badge>
          </div>
          <div className="flex items-center gap-4 text-xs text-zinc-500 pt-1 flex-wrap">
            {employee.phone && <span>Phone: <strong className="text-zinc-700 font-mono">{employee.phone}</strong></span>}
            {employee.joining_date && <span>Joining: <strong className="text-zinc-700">{employee.joining_date}</strong></span>}
            {employee.basic_salary !== undefined && (
              <span>Basic Salary: <strong className="text-zinc-700 font-mono">Rs. {Number(employee.basic_salary).toLocaleString()}</strong></span>
            )}
          </div>
        </div>

        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-red-600">
            <Banknote className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Current Balance</p>
            <p className="text-lg font-bold text-red-700 font-mono">
              Rs. {runningBalance.toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Issue Date</TableHead>
              <TableHead className="w-36">Repayment</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Principal Amount</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead className="w-24 text-center">Status</TableHead>
              <TableHead className="w-44 text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialLoans.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-zinc-400 py-12">
                  No loans recorded for this employee
                </TableCell>
              </TableRow>
            ) : (
              initialLoans.map((l) => {
                const isScheduled = l.repayment_type === "scheduled_returns" || l.override_reason?.includes("[repayment:scheduled_returns]");
                const outBal = Number(l.outstanding_balance ?? l.principal_amount);
                return (
                  <TableRow key={l.id} className="hover:bg-zinc-50/70 transition-colors">
                    <TableCell className="font-mono text-xs text-zinc-700">
                      {l.issued_date ? l.issued_date.slice(0, 10) : l.created_at ? l.created_at.slice(0, 10) : "—"}
                    </TableCell>
                    <TableCell>
                      {isScheduled ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                          Scheduled Returns
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                          Monthly Installments
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-zinc-700 text-sm">
                      {l.reason || "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-sm text-zinc-900">
                      Rs. {Number(l.principal_amount).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-sm text-red-600">
                      Rs. {outBal.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          l.status === "closed" || l.status === "repaid" || l.status === "completed"
                            ? "bg-green-100 text-green-700"
                            : "bg-amber-100 text-amber-700"
                        }`}>
                          {l.status === "closed" ? "Repaid" : l.status}
                        </span>
                        {(l.is_unrecoverable || l.override_reason?.includes("[unrecoverable:true]")) && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.625rem] font-semibold bg-red-100 text-red-700 border border-red-200">
                            Unrecoverable
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setErrorMsg("");
                            setRecoverLoanTarget(l);
                            const bId = l.bank_account_id || l.override_reason?.match(/\[bank:([a-f0-9\-]+)\]/i)?.[1] || "";
                            setRecoverForm({
                              recovery_date: new Date().toISOString().split("T")[0],
                              amount: String(outBal || ""),
                              bank_account_id: bId,
                              notes: "",
                            });
                            setShowRecoverModal(true);
                          }}
                          className="h-8 px-2 text-xs font-semibold text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 whitespace-nowrap"
                          title="Recovered Loan"
                        >
                          <DollarSign className="h-3.5 w-3.5 mr-1" />
                          Recovered Loan
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenEdit(l)}
                          className="h-8 w-8 p-0 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
                          title="Edit Loan"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                          onClick={() => handleDelete(l.id)}
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 flex items-center justify-center"
                          title="Delete Loan"
                        >
                          {deletingId === l.id ? <Loader2 className="h-4 w-4 animate-spin text-red-500" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {editingLoan && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-4">Edit Employee Loan</h3>

            {errorMsg && (
              <div className="mb-4 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded p-2.5">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleUpdate} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Issue Date *</label>
                <Input
                  type="date"
                  value={editForm.issued_date}
                  onChange={(e) => setEditForm((f) => ({ ...f, issued_date: e.target.value }))}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Reason</label>
                <Input
                  value={editForm.reason}
                  onChange={(e) => setEditForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="e.g. Medical emergency, House repair"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Principal Amount (Rs.) *</label>
                <Input
                  type="number"
                  min="1"
                  step="any"
                  value={editForm.principal_amount}
                  onChange={(e) => setEditForm((f) => ({ ...f, principal_amount: e.target.value }))}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Repayment Method</label>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editForm.repayment_type === "monthly_installments"}
                      onChange={(e) => setEditForm((f) => ({ ...f, repayment_type: e.target.checked ? "monthly_installments" : "" }))}
                      className="rounded border-zinc-300 accent-red-600 h-4 w-4 cursor-pointer"
                    />
                    Monthly installments
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editForm.repayment_type === "scheduled_returns"}
                      onChange={(e) => setEditForm((f) => ({ ...f, repayment_type: e.target.checked ? "scheduled_returns" : "" }))}
                      className="rounded border-zinc-300 accent-red-600 h-4 w-4 cursor-pointer"
                    />
                    Scheduled Returns
                  </label>
                </div>
              </div>

              {editForm.repayment_type === "monthly_installments" && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Monthly Installment (Rs.) *</label>
                  <Input
                    type="number"
                    min="1"
                    step="any"
                    value={editForm.monthly_installment}
                    onChange={(e) => setEditForm((f) => ({ ...f, monthly_installment: e.target.value }))}
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Linked Account (for ledger)</label>
                <SearchableSelect
                  options={bankOptions}
                  value={editForm.bank_account_id}
                  onChange={(val) => setEditForm((f) => ({ ...f, bank_account_id: val }))}
                  placeholder="— Select Linked Account —"
                  searchPlaceholder="Search accounts..."
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Status</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                  className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-red-400"
                >
                  <option value="active">Active</option>
                  <option value="closed">Closed / Repaid</option>
                </select>
              </div>

              <div className="pt-1">
                <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editForm.is_unrecoverable}
                    onChange={(e) => setEditForm((f) => ({ ...f, is_unrecoverable: e.target.checked }))}
                    className="rounded border-zinc-300 accent-red-600 h-4 w-4 cursor-pointer"
                  />
                  Unrecoverable
                </label>
              </div>

              <div className="flex gap-2 pt-3">
                <Button type="submit" className="flex-1 bg-red-600 hover:bg-red-700 text-white" disabled={isPending}>
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                      Saving...
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditingLoan(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-4">Give Loan to {employee.full_name}</h3>

            {errorMsg && (
              <div className="mb-4 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded p-2.5">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleAddSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Issue Date *</label>
                <Input
                  type="date"
                  value={addForm.issued_date}
                  onChange={(e) => setAddForm((f) => ({ ...f, issued_date: e.target.value }))}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Reason</label>
                <Input
                  value={addForm.reason}
                  onChange={(e) => setAddForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="e.g. Medical emergency, House repair"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Principal Amount (Rs.) *</label>
                <Input
                  type="number"
                  min="1"
                  step="any"
                  value={addForm.principal_amount}
                  onChange={(e) => setAddForm((f) => ({ ...f, principal_amount: e.target.value }))}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Repayment Method</label>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addForm.repayment_type === "monthly_installments"}
                      onChange={(e) => setAddForm((f) => ({ ...f, repayment_type: e.target.checked ? "monthly_installments" : "" }))}
                      className="rounded border-zinc-300 accent-red-600 h-4 w-4 cursor-pointer"
                    />
                    Monthly installments
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addForm.repayment_type === "scheduled_returns"}
                      onChange={(e) => setAddForm((f) => ({ ...f, repayment_type: e.target.checked ? "scheduled_returns" : "" }))}
                      className="rounded border-zinc-300 accent-red-600 h-4 w-4 cursor-pointer"
                    />
                    Scheduled Returns
                  </label>
                </div>
              </div>

              {addForm.repayment_type === "monthly_installments" && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Monthly Installment (Rs.) *</label>
                  <Input
                    type="number"
                    min="1"
                    step="any"
                    value={addForm.monthly_installment}
                    onChange={(e) => setAddForm((f) => ({ ...f, monthly_installment: e.target.value }))}
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Linked Account (for ledger)</label>
                <SearchableSelect
                  options={bankOptions}
                  value={addForm.bank_account_id}
                  onChange={(val) => setAddForm((f) => ({ ...f, bank_account_id: val }))}
                  placeholder="— Select Linked Account —"
                  searchPlaceholder="Search accounts..."
                />
              </div>

              <div className="pt-1">
                <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={addForm.is_unrecoverable}
                    onChange={(e) => setAddForm((f) => ({ ...f, is_unrecoverable: e.target.checked }))}
                    className="rounded border-zinc-300 accent-red-600 h-4 w-4 cursor-pointer"
                  />
                  Unrecoverable
                </label>
              </div>

              <div className="flex gap-2 pt-3">
                <Button type="submit" className="flex-1 bg-red-600 hover:bg-red-700 text-white" disabled={isPending}>
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                      Saving...
                    </>
                  ) : (
                    "Confirm Loan"
                  )}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRecoverModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-1">Recover Loan — {employee.full_name}</h3>
            {recoverLoanTarget && (
              <p className="text-xs text-zinc-500 mb-4">
                Outstanding: <strong className="text-zinc-800 font-mono">Rs. {Number(recoverLoanTarget.outstanding_balance ?? recoverLoanTarget.principal_amount).toLocaleString()}</strong>
                {recoverLoanTarget.issued_date && ` (Issued: ${recoverLoanTarget.issued_date.slice(0, 10)})`}
              </p>
            )}

            {errorMsg && (
              <div className="mb-4 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded p-2.5">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleRecoverSubmit} className="space-y-3.5">
              {initialLoans.length > 1 && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Target Loan *</label>
                  <select
                    value={recoverLoanTarget?.id || ""}
                    onChange={(e) => {
                      const sel = initialLoans.find((l) => l.id === e.target.value) || null;
                      setRecoverLoanTarget(sel);
                      const bId = sel?.bank_account_id || sel?.override_reason?.match(/\[bank:([a-f0-9\-]+)\]/i)?.[1] || "";
                      setRecoverForm((f) => ({ ...f, bank_account_id: bId || f.bank_account_id }));
                    }}
                    className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    required
                  >
                    {initialLoans.map((l) => (
                      <option key={l.id} value={l.id}>
                        Rs. {Number(l.principal_amount).toLocaleString()} (Out: Rs. {Number(l.outstanding_balance ?? l.principal_amount).toLocaleString()}) - {l.issued_date?.slice(0, 10)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Date *</label>
                <Input
                  type="date"
                  value={recoverForm.recovery_date}
                  onChange={(e) => setRecoverForm((f) => ({ ...f, recovery_date: e.target.value }))}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Recovered Amount (Rs.) *</label>
                <Input
                  type="number"
                  min="1"
                  step="any"
                  value={recoverForm.amount}
                  onChange={(e) => setRecoverForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="e.g. 10000"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Linked Account (for ledger) *</label>
                <SearchableSelect
                  options={bankOptions}
                  value={recoverForm.bank_account_id}
                  onChange={(val) => setRecoverForm((f) => ({ ...f, bank_account_id: val }))}
                  placeholder="— Select Linked Account —"
                  searchPlaceholder="Search accounts..."
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Notes / Description</label>
                <Input
                  value={recoverForm.notes}
                  onChange={(e) => setRecoverForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. Cash returned by employee, Bank transfer"
                />
              </div>

              <div className="flex gap-2 pt-3">
                <Button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={isPending}>
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                      Saving...
                    </>
                  ) : (
                    "Confirm Recovery"
                  )}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowRecoverModal(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
