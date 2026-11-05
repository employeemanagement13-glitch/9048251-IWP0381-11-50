"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { ExportButtons } from "@/components/export/ExportButtons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { updateLateDeliveryStatus } from "@/lib/actions/late-delivery";
import { useRouter } from "next/navigation";

interface LateDeliveryClientProps {
  initialData: any[];
}

export function LateDeliveryClient({ initialData }: LateDeliveryClientProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = initialData.filter((item) => {
    const matchSearch =
      !search ||
      item.invoice?.invoice_no?.toLowerCase().includes(search.toLowerCase()) ||
      item.invoice?.shop?.shop_name?.toLowerCase().includes(search.toLowerCase()) ||
      item.invoice?.dm?.full_name?.toLowerCase().includes(search.toLowerCase());
    
    const matchStatus = !statusFilter || item.status === statusFilter;
    
    return matchSearch && matchStatus;
  });

  const handleUpdateStatus = (id: string, status: "resolved" | "disputed") => {
    let reason = undefined;
    if (status === "disputed") {
      const input = prompt("Please provide a reason for the dispute:");
      if (!input) return; // reason is required for dispute
      reason = input;
    } else {
      if (!confirm("Mark this late delivery as resolved?")) return;
    }

    startTransition(async () => {
      try {
        await updateLateDeliveryStatus(id, status, reason);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const exportData = filtered.map((item) => ({
    "Invoice No": item.invoice?.invoice_no || "",
    "Shop Name": item.invoice?.shop?.shop_name || "",
    "DM Name": item.invoice?.dm?.full_name || "",
    "Scheduled Date": item.invoice?.scheduled_date || "",
    "Days Late": item.days_late,
    "Status": item.status,
    "Reason": item.reason || "",
  }));

  const statusBadge = (status: string) => {
    switch (status) {
      case "resolved": return <Badge variant="success">Resolved</Badge>;
      case "disputed": return <Badge variant="destructive">Disputed</Badge>;
      default: return <Badge variant="warning">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[12.5rem]">
          <Input
            placeholder="Search by Invoice, Shop, or DM..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="undelivered">Undelivered</option>
          <option value="resolved">Resolved</option>
          <option value="disputed">Disputed</option>
        </select>
        <ExportButtons data={exportData} filename="late_deliveries" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice No</TableHead>
              <TableHead>Shop</TableHead>
              <TableHead>DM</TableHead>
              <TableHead>Sched. Date</TableHead>
              <TableHead className="text-right">Days Late</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-zinc-400 py-8">No late deliveries found.</TableCell></TableRow>
            ) : (
              filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.invoice?.invoice_no}</TableCell>
                  <TableCell>
                    <div>{item.invoice?.shop?.shop_name}</div>
                    <div className="text-xs text-zinc-400">{item.invoice?.shop?.outlet_code}</div>
                  </TableCell>
                  <TableCell>{item.invoice?.dm?.full_name}</TableCell>
                  <TableCell>{item.invoice?.scheduled_date}</TableCell>
                  <TableCell className="text-right font-bold text-red-500">
                    {item.days_late}
                  </TableCell>
                  <TableCell>{statusBadge(item.status)}</TableCell>
                  <TableCell className="max-w-[9.375rem] truncate text-xs text-zinc-500">
                    {item.reason || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        className="text-green-600"
                        onClick={() => handleUpdateStatus(item.id, "resolved")}
                        disabled={isPending || item.status === "resolved"}
                      >
                        Resolve
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        className="text-red-600"
                        onClick={() => handleUpdateStatus(item.id, "disputed")}
                        disabled={isPending || item.status === "disputed"}
                      >
                        Dispute
                      </Button>
                    </div>
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

