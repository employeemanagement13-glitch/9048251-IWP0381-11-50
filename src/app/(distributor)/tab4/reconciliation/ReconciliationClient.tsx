"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { ExportButtons } from "@/components/export/ExportButtons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";

interface Props {
  initialData: any[];
  currentDate: string;
  currentStatus: string;
}

export function ReconciliationClient({ initialData, currentDate, currentStatus }: Props) {
  const router = useRouter();
  const [dateFilter, setDateFilter] = useState(currentDate);
  const [statusFilter, setStatusFilter] = useState(currentStatus);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const d = e.target.value;
    setDateFilter(d);
    router.push(`/tab4/reconciliation?date=${d}&status=${statusFilter}`);
  };

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const s = e.target.value;
    setStatusFilter(s);
    router.push(`/tab4/reconciliation?date=${dateFilter}&status=${s}`);
  };

  const filteredData = initialData.filter((row) => {
    if (statusFilter === "shortfall") {
      return row.status === "SHORTFALL";
    }
    return true;
  });

  const exportData = filteredData.map((row) => ({
    "Step in Chain": row.step,
    Date: row.date,
    "This Week": row.this_week,
    Month: row.month,
    Gap: row.gap ?? "",
    Status: row.status || "",
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 items-end justify-between bg-zinc-50 p-4 rounded-lg border border-zinc-200">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-1 uppercase tracking-wider">
              Date Filter
            </label>
            <Input type="date" value={dateFilter} onChange={handleDateChange} className="w-48" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-1 uppercase tracking-wider">
              Status Filter
            </label>
            <select
              value={statusFilter}
              onChange={handleStatusChange}
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500 h-9"
            >
              <option value="all">All Rows</option>
              <option value="shortfall">SHORTFALL Only</option>
            </select>
          </div>
        </div>
        <ExportButtons data={exportData} filename={`cash_reconciliation_${dateFilter}`} />
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Step in Chain</TableHead>
              <TableHead className="text-right">For Date</TableHead>
              <TableHead className="text-right">This Week</TableHead>
              <TableHead className="text-right">This Month</TableHead>
              <TableHead className="text-right">Gap</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-zinc-400 py-8">
                  No reconciliation data matching filters
                </TableCell>
              </TableRow>
            ) : (
              filteredData.map((item, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-semibold text-zinc-700">{item.step}</TableCell>
                  <TableCell className="text-right font-medium">
                    Rs. {Number(item.date).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    Rs. {Number(item.this_week).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    Rs. {Number(item.month).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </TableCell>
                  <TableCell className="text-right text-red-600 font-semibold">
                    {item.gap !== null && item.gap !== undefined ? (
                      `Rs. ${Number(item.gap).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {item.status ? (
                      <Badge variant={item.status === "SHORTFALL" ? "destructive" : "success"}>
                        {item.status}
                      </Badge>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

