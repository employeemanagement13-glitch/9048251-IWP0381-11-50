"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/Input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { createEmployee, updateEmployee, deleteEmployee, deleteEmployees } from "@/lib/actions/employees";
import { useRouter } from "next/navigation";

const ROLES = [
  { value: "dm",                label: "Delivery Man",      color: "bg-red-100 text-red-700" },
  { value: "preseller",         label: "Preseller",         color: "bg-green-100 text-green-700" },
  { value: "operation_manager", label: "Operation Manager", color: "bg-blue-100 text-blue-700" },
  { value: "loader",            label: "Loader",            color: "bg-purple-100 text-purple-700" },
  { value: "lifter_operator",   label: "Lifter Operator",   color: "bg-teal-100 text-teal-700" },
  { value: "dvo",               label: "DVO",               color: "bg-zinc-100 text-zinc-700" },
] as const;

type RoleValue = typeof ROLES[number]["value"];

function getRoleConfig(roleValue: string) {
  return (
    ROLES.find((r) => r.value === roleValue) ?? {
      label: roleValue,
      color: "bg-zinc-100 text-zinc-500",
    }
  );
}

interface EmployeesClientProps {
  initialEmployees: any[];
}

export function EmployeesClient({ initialEmployees }: EmployeesClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | RoleValue>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<RoleValue>("dm");
  const [phone, setPhone] = useState("");

  const filteredEmployees = initialEmployees.filter((emp) => {
    const term = search.toLowerCase();
    const matchesSearch =
      emp.full_name?.toLowerCase().includes(term) ||
      emp.phone?.toLowerCase().includes(term);
    const matchesRole = roleFilter === "all" || emp.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const handleEdit = (emp: any) => {
    setEditingId(emp.id);
    setFullName(emp.full_name);
    setRole(emp.role);
    setPhone(emp.phone || "");
    setShowModal(true);
  };

    const isAllSelected = filteredEmployees.length > 0 && filteredEmployees.every((emp) => selectedIds.includes(emp.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(filteredEmployees.map((emp) => emp.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected employee(s)?`)) return;
    startTransition(async () => {
      try {
        await deleteEmployees(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this employee?")) return;
    startTransition(async () => {
      try {
        await deleteEmployee(id);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !role) {
      alert("Name and Role are required.");
      return;
    }

    startTransition(async () => {
      try {
        const payload = {
          full_name: fullName,
          role,
          phone: phone || undefined,
        };

        if (editingId) {
          await updateEmployee(editingId, payload);
        } else {
          await createEmployee(payload);
        }

        setShowModal(false);
        setEditingId(null);
        setFullName("");
        setRole("dm");
        setPhone("");
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Search + Role filter */}
      <div className="flex justify-between items-center gap-4">
        <div className="flex-1 flex gap-4 max-w-xl">
          <Input
            placeholder="Search by name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="w-56 h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
          >
            <option value="all">All Roles</option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
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
              disabled={isPending}
              className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 whitespace-nowrap"
            >
              <Trash2 className="h-4 w-4" />
              Delete ({selectedIds.length})
            </Button>
          )}
          <Button
            onClick={() => {
              setEditingId(null);
            setFullName("");
            setRole("dm");
            setPhone("");
            setShowModal(true);
          }}
        >
          + Add Employee
        </Button>
        </div>
      </div>

      {/* Role count summary pills */}
      <div className="flex flex-wrap gap-2">
        {ROLES.map((r) => {
          const count = initialEmployees.filter((e) => e.role === r.value).length;
          return (
            <button
              key={r.value}
              onClick={() =>
                setRoleFilter(roleFilter === r.value ? "all" : r.value)
              }
              className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all ${
                roleFilter === r.value
                  ? `${r.color} border-transparent`
                  : "bg-white border-zinc-200 text-zinc-600 hover:border-zinc-400"
              }`}
            >
              {r.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Employees Table */}
      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center"><input type="checkbox" checked={isAllSelected} onChange={handleToggleSelectAll} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Phone No</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEmployees.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-zinc-400 py-8">
                  No employees found
                </TableCell>
              </TableRow>
            ) : (
              filteredEmployees.map((emp) => {
                const cfg = getRoleConfig(emp.role);
                return (
                  <TableRow key={emp.id} className={selectedIds.includes(emp.id) ? "bg-red-50/50" : ""}>
                    <TableCell className="w-10 text-center"><input type="checkbox" checked={selectedIds.includes(emp.id)} onChange={() => setSelectedIds(prev => prev.includes(emp.id) ? prev.filter(id => id !== emp.id) : [...prev, emp.id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableCell>
                    <TableCell className="font-semibold">{emp.full_name}</TableCell>
                    <TableCell>
                      <span
                        className={`px-2 py-1 text-xs font-semibold rounded-full ${cfg.color}`}
                      >
                        {cfg.label}
                      </span>
                    </TableCell>
                    <TableCell>{emp.phone || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => handleEdit(emp)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-700"
                          onClick={() => handleDelete(emp.id)}
                          disabled={isPending}
                        >
                          Delete
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

      {/* ADD / EDIT EMPLOYEE MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
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
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Full Name *
                </label>
                <Input
                  placeholder="e.g. Ahmed Khan"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Role *
                </label>
                <select
                  className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white"
                  value={role}
                  onChange={(e) => setRole(e.target.value as RoleValue)}
                  required
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Phone Number
                </label>
                <Input
                  placeholder="e.g. 0321-1234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Employee"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowModal(false)}
                >
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

