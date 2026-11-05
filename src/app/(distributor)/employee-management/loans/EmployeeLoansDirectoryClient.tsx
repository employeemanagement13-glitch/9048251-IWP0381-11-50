"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { ExportButtons } from "@/components/export/ExportButtons";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Search, Banknote, RefreshCw } from "lucide-react";

interface Employee {
  id: string;
  employee_code?: string;
  full_name: string;
  role: string;
  phone?: string;
  active?: boolean;
}

interface Props {
  employees: Employee[];
  employeeBalances: Record<string, number>;
}

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

function getRoleConfig(val: string) {
  return ROLES.find((r) => r.value === val) ?? { label: val, color: "bg-zinc-100 text-zinc-500" };
}

export function EmployeeLoansDirectoryClient({ employees, employeeBalances }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    router.refresh();
    setTimeout(() => {
      setIsRefreshing(false);
    }, 700);
  };

  const rows = useMemo(() => {
    return employees.map((emp) => {
      const balance = employeeBalances[emp.id] ?? 0;
      return {
        ...emp,
        balance,
      };
    });
  }, [employees, employeeBalances]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (roleFilter !== "all" && r.role !== roleFilter) return false;
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        r.full_name?.toLowerCase().includes(s) ||
        r.employee_code?.toLowerCase().includes(s) ||
        r.phone?.toLowerCase().includes(s) ||
        getRoleConfig(r.role).label.toLowerCase().includes(s)
      );
    });
  }, [rows, roleFilter, search]);

  const totalOutstanding = useMemo(() => {
    return filtered.reduce((acc, r) => acc + (r.balance > 0 ? r.balance : 0), 0);
  }, [filtered]);

  const exportData = filtered.map((r) => ({
    Code: r.employee_code || "—",
    Name: r.full_name,
    Role: getRoleConfig(r.role).label,
    Phone: r.phone || "—",
    "Balance (Rs.)": r.balance,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[17.5rem] max-w-lg">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by code, name, phone, role..."
              className="pl-8 text-sm"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400"
          >
            <option value="all">All Roles</option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-red-50 border border-red-200 rounded-lg px-3.5 py-1.5 flex items-center gap-2">
            <Banknote className="h-4 w-4 text-red-600" />
            <span className="text-xs font-semibold text-zinc-600">Total Outstanding:</span>
            <span className="text-sm font-bold text-red-700">
              Rs. {totalOutstanding.toLocaleString()}
            </span>
          </div>
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
          <ExportButtons data={exportData} filename="employee_loans_directory" />
        </div>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-zinc-400 py-10">
                  No employee records found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => {
                const roleConfig = getRoleConfig(r.role);
                return (
                  <TableRow
                    key={r.id}
                    className="hover:bg-zinc-50/70 transition-colors"
                  >
                    <TableCell className="font-mono text-xs text-zinc-500 font-semibold">
                      {r.employee_code || "—"}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/employee-management/loans/${r.id}`}
                        className="font-semibold text-zinc-900 hover:text-red-600 hover:underline transition-colors cursor-pointer inline-flex items-center gap-1.5"
                      >
                        {r.full_name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge className={roleConfig.color}>{roleConfig.label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-zinc-600 font-mono">
                      {r.phone || "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-sm">
                      {r.balance > 0 ? (
                        <span className="text-red-600">
                          Rs. {r.balance.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-zinc-400">Rs. 0</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
