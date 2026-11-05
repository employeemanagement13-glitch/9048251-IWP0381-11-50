"use client";

import { useState, useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { ExportButtons } from "@/components/export/ExportButtons";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/Table";
import { getEmployeeLedger } from "@/lib/actions/employees";

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

interface Props {
  employee: Employee;
}

const ROLES = [
  { value: "dm", label: "Delivery Man", color: "bg-red-100 text-red-700" },
  { value: "preseller", label: "Preseller", color: "bg-green-100 text-green-700" },
  { value: "operation_manager", label: "Operation Manager", color: "bg-blue-100 text-blue-700" },
  { value: "loader", label: "Loader", color: "bg-purple-100 text-purple-700" },
  { value: "lifter_operator", label: "Lifter Operator", color: "bg-teal-100 text-teal-700" },
  { value: "dvo", label: "DVO", color: "bg-zinc-100 text-zinc-700" },
  { value: "driver", label: "Driver", color: "bg-cyan-100 text-cyan-700" },
  { value: "guard", label: "Guard", color: "bg-yellow-100 text-yellow-700" },
  { value: "office", label: "Office", color: "bg-indigo-100 text-indigo-700" },
  { value: "other", label: "Other", color: "bg-gray-100 text-gray-600" },
] as const;

function getRoleConfig(val: string) {
  return ROLES.find((r) => r.value === val) ?? { label: val, color: "bg-zinc-100 text-zinc-500" };
}

export function EmployeeLedgerClient({ employee }: Props) {
  const router = useRouter();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [ledgerRows, setLedgerRows] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [, startTransition] = useTransition();

  const loadLedger = async (from?: string, to?: string) => {
    setIsLoading(true);
    try {
      const rows = await getEmployeeLedger(employee.id, {
        fromDate: from !== undefined ? from : fromDate || undefined,
        toDate: to !== undefined ? to : toDate || undefined,
      });
      setLedgerRows(rows || []);
    } catch (err: any) {
      alert(err.message || "Failed to load ledger entries.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLedger();
  }, [employee.id]);

  const handleReset = () => {
    setFromDate("");
    setToDate("");
    loadLedger("", "");
  };

  const exportData = useMemo(() => {
    return ledgerRows.map((r) => ({
      "Date": r.entry_date || "",
      "Type": r.type || "",
      "In (Rs.)": r.in_amount != null ? Number(r.in_amount) : "",
      "Out (Rs.)": r.out_amount != null ? Number(r.out_amount) : "",
      "Running Balance": Number(r.running_balance || 0),
      "Description": r.description || "",
    }));
  }, [ledgerRows]);

  const roleConfig = getRoleConfig(employee.role);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/employee-management/directory")}
            className="flex items-center gap-1.5 text-zinc-600 hover:text-zinc-900 -ml-2"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Directory</span>
          </Button>
          <div className="h-4 w-px bg-zinc-200" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-zinc-900">{employee.full_name}</h1>
              {employee.employee_code && (
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-zinc-100 text-zinc-600">
                  {employee.employee_code}
                </span>
              )}
              <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${roleConfig.color}`}>
                {roleConfig.label}
              </span>
              <Badge variant={employee.active ? "success" : "secondary"}>
                {employee.active ? "Active" : "Inactive"}
              </Badge>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              Employee Ledger & Balance Tracking
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ExportButtons
            data={exportData}
            filename={`employee_ledger_${employee.full_name?.toLowerCase().replace(/\s+/g, "_") || "emp"}`}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-lg border border-zinc-200 shadow-sm">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-zinc-600">From:</label>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-8 text-xs w-36"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-zinc-600">To:</label>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-8 text-xs w-36"
          />
        </div>

        <Button
          size="sm"
          onClick={() => loadLedger()}
          disabled={isLoading}
          className="h-8 px-3 text-xs bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5"
        >
          {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          <span>Load</span>
        </Button>

        {(fromDate || toDate) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleReset}
            disabled={isLoading}
            className="h-8 px-2 text-xs text-zinc-500 hover:text-zinc-800 flex items-center gap-1"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset</span>
          </Button>
        )}
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Date</TableHead>
              <TableHead className="min-w-[12.5rem]">Type</TableHead>
              <TableHead className="text-right w-32">In (Rs.)</TableHead>
              <TableHead className="text-right w-32">Out (Rs.)</TableHead>
              <TableHead className="text-right w-36">Running Balance</TableHead>
              <TableHead className="min-w-[15rem]">Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-zinc-600" />
                    <span className="text-xs text-zinc-500 font-medium">Loading ledger entries...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : ledgerRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-zinc-400 py-10 text-xs">
                  No ledger entries found for the selected period.
                </TableCell>
              </TableRow>
            ) : (
              ledgerRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.entry_date}</TableCell>
                  <TableCell className="text-xs font-medium text-zinc-800">{row.type}</TableCell>
                  <TableCell className="text-xs text-right font-medium text-emerald-700">
                    {row.in_amount != null ? `Rs. ${Number(row.in_amount).toLocaleString()}` : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right font-medium text-red-700">
                    {row.out_amount != null ? `Rs. ${Number(row.out_amount).toLocaleString()}` : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right font-bold text-zinc-900">
                    Rs. {Number(row.running_balance || 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs text-zinc-600">{row.description || "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-xs text-zinc-400">
        Showing {ledgerRows.length} ledger {ledgerRows.length === 1 ? "entry" : "entries"}
      </div>
    </div>
  );
}
