"use client";

import { useState, useRef, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Trash2, FileSpreadsheet, Upload, CheckCircle2, AlertCircle, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { ExportButtons } from "@/components/export/ExportButtons";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/Table";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { createEmployee, updateEmployee, deleteEmployee, deleteEmployees, createLoan, bulkImportEmployees } from "@/lib/actions/employees";
import type { EmployeeFormData } from "@/lib/actions/employees";
import { parseEmployeeExcel } from "@/lib/parsers/employeeImport";

const ROLES = [
  { value: "dm",                label: "Delivery Man",      color: "bg-red-100 text-red-700" },
  { value: "preseller",         label: "Preseller",         color: "bg-green-100 text-green-700" },
  { value: "operation_manager", label: "Operation Manager", color: "bg-blue-100 text-blue-700" },
  { value: "loader",            label: "Loader",            color: "bg-purple-100 text-purple-700" },
  { value: "lifter_operator",   label: "Lifter Operator",   color: "bg-teal-100 text-teal-700" },
  { value: "dvo",               label: "DVO",               color: "bg-zinc-100 text-zinc-700" },
  { value: "guard",             label: "Guard",             color: "bg-yellow-100 text-yellow-700" },
  { value: "other",             label: "Other",             color: "bg-gray-100 text-gray-600" },
] as const;

type RoleValue = typeof ROLES[number]["value"];

const BLANK_FORM = {
  employee_code: "", full_name: "", role: "dm" as RoleValue, phone: "",
  nic: "", address: "", joining_date: "",
  basic_salary: "", bank_name: "", bank_account: "",
  house_owner: false, emergency_contact: "", emergency_phone: "",
  reference_1_name: "", reference_1_phone: "",
  reference_2_name: "", reference_2_phone: "",
  active: true,
};

function humanizeRoleSlug(val: string) {
  return String(val || "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function getRoleConfig(val: string) {
  return (
    ROLES.find((r) => r.value === val) ?? {
      value: val,
      label: humanizeRoleSlug(val) || val,
      color: "bg-zinc-100 text-zinc-500",
    }
  );
}

interface Props { initialEmployees: any[]; bankAccounts?: any[]; }

export function EmployeeDirectoryClient({ initialEmployees, bankAccounts = [] }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch]       = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [showModal, setShowModal]  = useState(false);
  const [editingId, setEditingId]  = useState<string | null>(null);
  const [form, setForm]            = useState({ ...BLANK_FORM });
  const [loanEmployee, setLoanEmployee] = useState<any | null>(null);
  const [loanForm, setLoanForm] = useState({
    principal_amount: "",
    monthly_installment: "",
    issued_date: new Date().toISOString().split("T")[0],
    reason: "",
    bank_account_id: "",
    repayment_type: "",
    is_unrecoverable: false,
  });
  const [loanError, setLoanError] = useState("");

  const bankOptions = useMemo(() => {
    return (bankAccounts || []).map((b: any) => ({
      value: b.id,
      label: `${b.bank_name || ""} — ${b.account_title || ""}`.trim().replace(/^—\s*|\s*—$/g, ""),
      sub: b.account_number || undefined,
    }));
  }, [bankAccounts]);
  const [importPreview, setImportPreview] = useState<EmployeeFormData[] | null>(null);
  const [importFeedback, setImportFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const rolePills = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of initialEmployees) {
      const r = (e.role || "dm").toString();
      counts.set(r, (counts.get(r) || 0) + 1);
    }
    const knownOrder = ROLES.map((r) => r.value);
    const known = knownOrder
      .filter((v) => (counts.get(v) || 0) > 0)
      .map((v) => ({ value: v, count: counts.get(v) || 0, cfg: getRoleConfig(v) }));
    const custom = Array.from(counts.entries())
      .filter(([v]) => !knownOrder.includes(v as any) && v)
      .map(([v, count]) => ({ value: v, count, cfg: getRoleConfig(v) }))
      .sort((a, b) => a.cfg.label.localeCompare(b.cfg.label));
    return [...known, ...custom];
  }, [initialEmployees]);

  const filtered = initialEmployees.filter((e) => {
    const t = search.toLowerCase();
    const matchSearch = !t
      || e.full_name?.toLowerCase().includes(t)
      || e.employee_code?.toLowerCase().includes(t)
      || e.phone?.toLowerCase().includes(t)
      || e.nic?.toLowerCase().includes(t);
    const matchRole = roleFilter === "all" || e.role === roleFilter;
    return matchSearch && matchRole;
  });

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...BLANK_FORM, employee_code: "" });
    setShowModal(true);
  };

  const handleImportEmployees = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const parsedList = await parseEmployeeExcel(file);
      if (!parsedList || parsedList.length === 0) {
        alert("No valid employee records found in the uploaded file.");
        return;
      }
      setImportPreview(parsedList);
      setImportFeedback(null);
    } catch (err: any) {
      alert(`Failed to parse file: ${err.message}`);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleConfirmImport = () => {
    if (!importPreview || importPreview.length === 0) return;
    startTransition(async () => {
      try {
        const res = await bulkImportEmployees(importPreview);
        setImportPreview(null);
        setImportFeedback({
          type: "success",
          message: `Successfully imported ${res.total} employees (${res.created} created, ${res.updated} updated).`,
        });
        router.refresh();
      } catch (err: any) {
        setImportFeedback({
          type: "error",
          message: `Import failed: ${err.message}`,
        });
      }
    });
  };

  const importRoleSummary = useMemo(() => {
    if (!importPreview) return [];
    const counts = new Map<string, number>();
    importPreview.forEach((emp) => {
      const r = emp.role || "dm";
      counts.set(r, (counts.get(r) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([roleVal, count]) => ({
      role: roleVal,
      cfg: getRoleConfig(roleVal),
      count,
    }));
  }, [importPreview]);

  const exportData = filtered.map((e) => ({
    "Employee Code (Auto)": e.employee_code || "",
    "Full Name": e.full_name || "",
    "Role": getRoleConfig(e.role).label,
    "Phone": e.phone || "",
    "NIC": e.nic || "",
    "Address": e.address || "",
    "Joining Date": e.joining_date || "",
    "Basic Salary (Rs.)": Number(e.basic_salary || 0),
    "Bank Name": e.bank_name || "",
    "Account Number": e.bank_account || "",
    "Emergency Contact": e.emergency_contact || "",
    "Emergency Phone": e.emergency_phone || "",
    "1st Reference Name": e.reference_1_name || "",
    "1st Reference Phone": e.reference_1_phone || "",
    "2nd Reference Name": e.reference_2_name || "",
    "2nd Reference Phone": e.reference_2_phone || "",
    "House Owner": e.house_owner ? "Yes" : "No",
    "Status": e.active ? "Active" : "Inactive",
  }));

  const openEdit = (emp: any) => {
    setEditingId(emp.id);
    setForm({
      employee_code:   emp.employee_code || "",
      full_name:       emp.full_name || "",
      role:            emp.role || "dm",
      phone:           emp.phone || "",
      nic:             emp.nic || "",
      address:         emp.address || "",
      joining_date:    emp.joining_date || "",
      basic_salary:    emp.basic_salary != null ? String(emp.basic_salary) : "",
      bank_name:       emp.bank_name || "",
      bank_account:    emp.bank_account || "",
      house_owner:     emp.house_owner ?? false,
      emergency_contact: emp.emergency_contact || "",
      emergency_phone:   emp.emergency_phone || "",
      reference_1_name:  emp.reference_1_name || "",
      reference_1_phone: emp.reference_1_phone || "",
      reference_2_name:  emp.reference_2_name || "",
      reference_2_phone: emp.reference_2_phone || "",
      active:          emp.active ?? true,
    });
    setShowModal(true);
  };

    const isAllSelected = filtered.length > 0 && filtered.every((e) => selectedIds.includes(e.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(filtered.map((e) => e.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Delete ${selectedIds.length} selected employee(s)?`)) return;
    setIsBulkDeleting(true);
    startTransition(async () => {
      try {
        await deleteEmployees(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (err: any) { alert(err.message); }
      finally { setIsBulkDeleting(false); }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this employee? This cannot be undone.")) return;
    setDeletingId(id);
    startTransition(async () => {
      try { await deleteEmployee(id); router.refresh(); }
      catch (err: any) { alert(err.message); }
      finally { setDeletingId(null); }
    });
  };

  const openLoanModal = (emp: any) => {
    setLoanEmployee(emp);
    setLoanForm({
      principal_amount: "",
      monthly_installment: "",
      issued_date: new Date().toISOString().split("T")[0],
      reason: "",
      bank_account_id: "",
      repayment_type: "",
      is_unrecoverable: false,
    });
    setLoanError("");
  };

  const handleLoanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loanEmployee) return;
    if (!loanForm.principal_amount) {
      setLoanError("Principal amount is required.");
      return;
    }
    if (loanForm.repayment_type === "monthly_installments" && !loanForm.monthly_installment) {
      setLoanError("Monthly installment is required.");
      return;
    }
    startTransition(async () => {
      try {
        await createLoan(loanEmployee.id, {
          principal_amount: Number(loanForm.principal_amount),
          monthly_installment: loanForm.repayment_type === "monthly_installments" ? Number(loanForm.monthly_installment) : 0,
          issued_date: loanForm.issued_date,
          reason: loanForm.reason || undefined,
          bank_account_id: loanForm.bank_account_id || undefined,
          repayment_type: loanForm.repayment_type || "scheduled_returns",
          is_unrecoverable: loanForm.is_unrecoverable,
        });
        setLoanEmployee(null);
        setLoanForm({
          principal_amount: "",
          monthly_installment: "",
          issued_date: new Date().toISOString().split("T")[0],
          reason: "",
          bank_account_id: "",
          repayment_type: "",
          is_unrecoverable: false,
        });
        setLoanError("");
        router.refresh();
      } catch (err: any) {
        setLoanError(err.message);
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) { alert("Full Name is required."); return; }
    startTransition(async () => {
      try {
        const payload: any = {
          ...form,
          basic_salary: form.basic_salary ? parseFloat(form.basic_salary) : 0,
          joining_date: form.joining_date || undefined,
        };
        if (editingId) await updateEmployee(editingId, payload);
        else           await createEmployee(payload);
        setShowModal(false);
        router.refresh();
      } catch (err: any) { alert(err.message); }
    });
  };

  const field = (label: string, key: keyof typeof BLANK_FORM, type = "text", required = false, disabled = false) => (
    <div>
      <label className="block text-xs font-medium text-zinc-600 mb-1">{label}{required && " *"}</label>
      <Input
        type={type}
        value={String(form[key])}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        required={required}
        disabled={disabled}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Filters & Actions */}
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex-1 max-w-xl">
          <Input
            placeholder="Search name, code, phone, NIC..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv, .xlsx, .xls"
            className="hidden"
            onChange={handleImportEmployees}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="flex items-center gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
          >
            {isImporting ? (
              <>
                <svg className="animate-spin h-4 w-4 text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span className="text-red-600 font-semibold">Importing...</span>
              </>
            ) : (
              <>
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                Import Excel
              </>
            )}
          </Button>
                    <div className="flex items-center gap-2">
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
                disabled={isBulkDeleting || !!deletingId}
                className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 whitespace-nowrap"
              >
                {isBulkDeleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Delete ({selectedIds.length})
              </Button>
            )}
          </div>
          <ExportButtons data={exportData} filename="employee_directory" />
          <Button size="sm" onClick={openAdd}>+ Add Employee</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setRoleFilter("all")}
          className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all ${
            roleFilter === "all"
              ? "bg-zinc-900 text-white border-transparent"
              : "bg-white border-zinc-200 text-zinc-600 hover:border-zinc-400"
          }`}
        >
          All ({initialEmployees.length})
        </button>
        {rolePills.map(({ value, count, cfg }) => (
          <button
            key={value}
            type="button"
            onClick={() => setRoleFilter(roleFilter === value ? "all" : value)}
            className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all ${
              roleFilter === value ? `${cfg.color} border-transparent` : "bg-white border-zinc-200 text-zinc-600 hover:border-zinc-400"
            }`}
          >
            {cfg.label} ({count})
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center"><input type="checkbox" checked={isAllSelected} onChange={handleToggleSelectAll} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Phone / NIC</TableHead>
              <TableHead className="text-right">Basic Salary</TableHead>
              <TableHead>Bank / Account</TableHead>
              <TableHead>References</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-zinc-400 py-8">No employees found</TableCell>
              </TableRow>
            ) : filtered.map((emp) => {
              const cfg = getRoleConfig(emp.role);
              return (
                <TableRow key={emp.id} className={selectedIds.includes(emp.id) ? "bg-red-50/50" : ""}>
                  <TableCell className="w-10 text-center"><input type="checkbox" checked={selectedIds.includes(emp.id)} onChange={() => setSelectedIds(prev => prev.includes(emp.id) ? prev.filter(id => id !== emp.id) : [...prev, emp.id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableCell>
                  <TableCell className="font-mono text-xs font-bold">{emp.employee_code || "—"}</TableCell>
                  <TableCell className="font-semibold text-zinc-900">{emp.full_name}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${cfg.color}`}>{cfg.label}</span>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{emp.phone || "—"}</div>
                    {emp.nic && <div className="text-zinc-400 font-mono">{emp.nic}</div>}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {emp.basic_salary != null ? `Rs. ${Number(emp.basic_salary).toLocaleString()}` : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {emp.bank_name || emp.bank_account ? (
                      <div>
                        <div className="font-medium">{emp.bank_name || "Bank"}</div>
                        <div className="text-zinc-400 font-mono">{emp.bank_account || "—"}</div>
                      </div>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {emp.reference_1_name ? (
                      <div>
                        <span className="font-medium">1st:</span> {emp.reference_1_name} {emp.reference_1_phone ? `(${emp.reference_1_phone})` : ""}
                      </div>
                    ) : null}
                    {emp.reference_2_name ? (
                      <div>
                        <span className="font-medium">2nd:</span> {emp.reference_2_name} {emp.reference_2_phone ? `(${emp.reference_2_phone})` : ""}
                      </div>
                    ) : null}
                    {!emp.reference_1_name && !emp.reference_2_name && "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={emp.active ? "success" : "secondary"}>
                      {emp.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end flex-wrap">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(emp)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => openLoanModal(emp)}>Give Loan</Button>
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/employee-management/ledger/${emp.id}`}>Ledger</Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-700"
                        onClick={() => handleDelete(emp.id)}
                        disabled={deletingId === emp.id || isBulkDeleting}
                      >
                        {deletingId === emp.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-red-600" />
                        ) : (
                          "Delete"
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Loan Modal */}
      {loanEmployee && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-zinc-900">Give Loan —  {loanEmployee.full_name}</h3>
              <button
                type="button"
                onClick={() => setLoanEmployee(null)}
                className="p-1 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors"
                title="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleLoanSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Principal Amount *</label>
                <Input type="number" min="0" step="0.01" value={loanForm.principal_amount} onChange={(e) => setLoanForm((f) => ({ ...f, principal_amount: e.target.value }))} />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1.5">Repayment Type</label>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={loanForm.repayment_type === "monthly_installments"}
                      onChange={(e) => {
                        const isChecked = e.target.checked;
                        setLoanForm((f) => ({
                          ...f,
                          repayment_type: isChecked ? "monthly_installments" : "",
                          monthly_installment: isChecked ? f.monthly_installment : "0",
                        }));
                      }}
                      className="rounded border-zinc-300 accent-red-600 h-4 w-4 cursor-pointer"
                    />
                    Monthly installments
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={loanForm.repayment_type === "scheduled_returns"}
                      onChange={(e) => {
                        const isChecked = e.target.checked;
                        setLoanForm((f) => ({
                          ...f,
                          repayment_type: isChecked ? "scheduled_returns" : "",
                          monthly_installment: isChecked ? "0" : f.monthly_installment,
                        }));
                      }}
                      className="rounded border-zinc-300 accent-red-600 h-4 w-4 cursor-pointer"
                    />
                    Scheduled Returns
                  </label>
                </div>
              </div>

              {loanForm.repayment_type === "monthly_installments" && (
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Monthly Installment *</label>
                  <Input type="number" min="0" step="0.01" value={loanForm.monthly_installment} onChange={(e) => setLoanForm((f) => ({ ...f, monthly_installment: e.target.value }))} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Issue Date</label>
                  <Input type="date" value={loanForm.issued_date} onChange={(e) => setLoanForm((f) => ({ ...f, issued_date: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Purpose / Reason</label>
                  <Input value={loanForm.reason} onChange={(e) => setLoanForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Medical emergency, house repair..." />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Linked Account (for transaction entry)</label>
                <SearchableSelect
                  options={bankOptions}
                  value={loanForm.bank_account_id}
                  onChange={(val) => setLoanForm((f) => ({ ...f, bank_account_id: val }))}
                  placeholder="— Select Linked Account —"
                  searchPlaceholder="Search accounts..."
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={loanForm.is_unrecoverable}
                    onChange={(e) => setLoanForm((f) => ({ ...f, is_unrecoverable: e.target.checked }))}
                    className="rounded border-zinc-300 accent-red-600 h-4 w-4 cursor-pointer"
                  />
                  Unrecoverable
                </label>
              </div>
              {loanError && <div className="text-xs text-red-600">{loanError}</div>}
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setLoanEmployee(null)}>Cancel</Button>
                <Button type="submit" disabled={isPending} className="flex items-center gap-1.5">
                  {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>{isPending ? "Saving..." : "Save Loan"}</span>
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl my-6 p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-zinc-900">
                {editingId ? "Edit Employee" : "Add Employee"}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors"
                title="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Row 1 */}
              <div className="grid grid-cols-2 gap-4">
                {field("Employee Code", "employee_code", "text", false, false)}
                {field("Full Name", "full_name", "text", true)}
              </div>
              {/* Role */}
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Role *</label>
                <select
                  className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as RoleValue }))}
                  required
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                  {form.role && !ROLES.some((r) => r.value === form.role) && (
                    <option value={form.role}>{getRoleConfig(form.role).label}</option>
                  )}
                </select>
              </div>
              {/* Row 2 */}
              <div className="grid grid-cols-2 gap-4">
                {field("Phone", "phone")}
                {field("NIC", "nic")}
              </div>
              {field("Address", "address")}
              <div className="grid grid-cols-2 gap-4">
                {field("Joining Date", "joining_date", "date")}
                {field("Basic Salary (Rs.)", "basic_salary", "number")}
              </div>
              {/* Bank */}
              <div className="grid grid-cols-2 gap-4">
                {field("Bank Name", "bank_name")}
                {field("Account Number", "bank_account")}
              </div>
              {/* Contact */}
              <div className="grid grid-cols-2 gap-4">
                {field("Emergency Contact", "emergency_contact")}
                {field("Emergency Phone", "emergency_phone")}
              </div>
              {/* References */}
              <div className="border-t border-zinc-100 pt-3">
                <p className="text-xs font-semibold text-zinc-500 mb-3 uppercase tracking-wide">References</p>
                <div className="grid grid-cols-2 gap-4">
                  {field("1st Reference Name", "reference_1_name")}
                  {field("1st Reference Phone", "reference_1_phone")}
                  {field("2nd Reference Name", "reference_2_name")}
                  {field("2nd Reference Phone", "reference_2_phone")}
                </div>
              </div>
              {/* Toggles */}
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.house_owner}
                    onChange={(e) => setForm((f) => ({ ...f, house_owner: e.target.checked }))}
                    className="w-4 h-4 rounded"
                  />
                  House Owner
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                    className="w-4 h-4 rounded"
                  />
                  Active
                </label>
              </div>
              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1 flex items-center justify-center gap-1.5" disabled={isPending}>
                  {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>{isPending ? "Saving..." : "Save Employee"}</span>
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Preview Modal */}
      {importPreview && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
              <h3 className="text-[0.9375rem] font-bold text-zinc-900">Import Employees Preview</h3>
              <button
                onClick={() => !isPending && setImportPreview(null)}
                className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors text-lg leading-none"
              >
                ×
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-zinc-700">
                    Found {importPreview.length} employee record{importPreview.length !== 1 ? "s" : ""} across {importRoleSummary.length} role{importRoleSummary.length !== 1 ? "s" : ""}:
                  </span>
                  <span className="text-[0.6875rem] text-zinc-500 font-medium">
                    Auto-matching by Code, NIC, or Name
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {importRoleSummary.map(({ role, cfg, count }) => (
                    <span
                      key={role}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${cfg.color}`}
                    >
                      <span>{cfg.label}</span>
                      <span className="bg-white/80 rounded-full px-1.5 py-0.2 text-[0.625rem] font-bold shadow-xs">
                        {count}
                      </span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="border border-zinc-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Code</TableHead>
                      <TableHead>Full Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Phone / NIC</TableHead>
                      <TableHead className="text-right">Salary (Rs.)</TableHead>
                      <TableHead>Joining Date</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importPreview.map((emp, idx) => {
                      const cfg = getRoleConfig(emp.role);
                      return (
                        <TableRow key={idx} className="hover:bg-zinc-50/50">
                          <TableCell className="font-mono text-[0.6875rem] font-bold text-red-600">
                            {emp.employee_code || <span className="text-zinc-300">Auto</span>}
                          </TableCell>
                          <TableCell className="font-semibold text-xs text-zinc-900">
                            {emp.full_name}
                          </TableCell>
                          <TableCell>
                            <span className={`px-2 py-0.5 text-[0.65625rem] font-semibold rounded-full ${cfg.color}`}>
                              {cfg.label}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs">
                            <div>{emp.phone || "—"}</div>
                            {emp.nic && <div className="text-zinc-400 font-mono text-[0.65625rem]">{emp.nic}</div>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {emp.basic_salary ? `Rs. ${Number(emp.basic_salary).toLocaleString()}` : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-zinc-600">
                            {emp.joining_date || "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant={emp.active ? "success" : "secondary"}>
                              {emp.active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-zinc-100">
                <p className="text-xs text-zinc-500">
                  Existing employees will be updated with file details; new employees will be added.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setImportPreview(null)}
                    disabled={isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleConfirmImport}
                    disabled={isPending}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5"
                  >
                    <Upload className="h-4 w-4" />
                    {isPending ? "Importing..." : `Confirm Import (${importPreview.length} Employees)`}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Banner */}
      {importFeedback && (
        <div
          className={`flex items-center justify-between p-3.5 rounded-xl border text-xs font-medium ${
            importFeedback.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          <div className="flex items-center gap-2">
            {importFeedback.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
            )}
            <span>{importFeedback.message}</span>
          </div>
          <button
            onClick={() => setImportFeedback(null)}
            className="text-zinc-400 hover:text-zinc-600 text-sm font-bold ml-2 leading-none"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

