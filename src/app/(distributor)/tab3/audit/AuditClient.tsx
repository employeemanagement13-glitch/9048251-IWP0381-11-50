"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Trash2 } from "lucide-react";
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
import {
  scheduleStockAudit,
  startStockAudit,
  completeStockAudit,
  getStockDiscrepanciesForAudit,
  deleteStockAudit, deleteAuditStocks,
} from "@/lib/actions/inventory";
import { useRouter } from "next/navigation";

interface AuditClientProps {
  initialAudits: any[];
  warehouseProducts: any[]; // currently active products
}

export function AuditClient({ initialAudits, warehouseProducts }: AuditClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Schedule Modal
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");

  // Start Count active state
  const [countingAuditId, setCountingAuditId] = useState<string | null>(null);
  const [physicalCounts, setPhysicalCounts] = useState<{ [productName: string]: number }>({});

  // View Report Modal
  const [reportAuditId, setReportAuditId] = useState<string | null>(null);
  const [reportData, setReportData] = useState<any[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // --- Handlers ---
  const handleSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduledDate) return;
    startTransition(async () => {
      try {
        await scheduleStockAudit(scheduledDate);
        setShowScheduleModal(false);
        setScheduledDate("");
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleStartCount = (id: string) => {
    startTransition(async () => {
      try {
        await startStockAudit(id);
        // Pre-fill physical counts state with current system quantities
        const initialCounts: { [product: string]: number } = {};
        warehouseProducts.forEach((item) => {
          initialCounts[item.product_name] = item.qty_total;
        });
        setPhysicalCounts(initialCounts);
        setCountingAuditId(id);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleCompleteAudit = () => {
    if (!countingAuditId) return;
    startTransition(async () => {
      try {
        await completeStockAudit(countingAuditId, physicalCounts);
        setCountingAuditId(null);
        setPhysicalCounts({});
        router.refresh();
        alert("Stock audit completed successfully. Warehouse inventory corrected.");
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleViewReport = async (id: string) => {
    setReportAuditId(id);
    setLoadingReport(true);
    try {
      const discrepancies = await getStockDiscrepanciesForAudit(id);
      setReportData(discrepancies || []);
    } catch (err: any) {
      alert("Failed to load audit report details.");
    } finally {
      setLoadingReport(false);
    }
  };

    const isAllSelected = initialAudits.length > 0 && initialAudits.every((a) => selectedIds.includes(a.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(initialAudits.map((a) => a.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected audit schedule(s)?`)) return;
    startTransition(async () => {
      try {
        await deleteAuditStocks(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this stock audit schedule?")) return;
    startTransition(async () => {
      try {
        await deleteStockAudit(id);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const statusBadge = (s: string) => {
    switch (s) {
      case "completed":
        return <Badge variant="success">Completed</Badge>;
      case "in_progress":
        return <Badge variant="warning">In Progress</Badge>;
      default:
        return <Badge variant="secondary">Scheduled</Badge>;
    }
  };

  const exportData = initialAudits.map((item) => ({
    "Audit Date": item.audit_date || "—",
    "Scheduled Date": item.scheduled_date,
    "Products Counted": item.products_counted,
    "Status": item.status,
  }));

  return (
    <div className="space-y-4">
      {/* Schedule Audit action */}
      <div className="flex justify-between items-center">
        <div className="text-sm text-zinc-500">
          Double check physical counts against system logs to correct inventory leaks
        </div>
        <div className="flex gap-2">
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
          </div>
          <ExportButtons data={exportData} filename="stock_audits" />
          <Button onClick={() => setShowScheduleModal(true)}>
            Schedule Audit
          </Button>
        </div>
      </div>

      {/* Main Audit Schedule Table */}
      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center"><input type="checkbox" checked={isAllSelected} onChange={handleToggleSelectAll} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableHead>
              <TableHead>Audit Date</TableHead>
              <TableHead>Scheduled Date</TableHead>
              <TableHead>Products Counted</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialAudits.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-zinc-400 py-8">
                  No stock audits scheduled.
                </TableCell>
              </TableRow>
            ) : (
              initialAudits.map((audit) => (
                <TableRow key={audit.id} className={selectedIds.includes(audit.id) ? "bg-red-50/50" : ""}>
                  <TableCell className="w-10 text-center"><input type="checkbox" checked={selectedIds.includes(audit.id)} onChange={() => setSelectedIds(prev => prev.includes(audit.id) ? prev.filter(id => id !== audit.id) : [...prev, audit.id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableCell>
                  <TableCell className="font-medium">{audit.audit_date || "—"}</TableCell>
                  <TableCell>{audit.scheduled_date}</TableCell>
                  <TableCell className="font-semibold">{audit.products_counted || "—"}</TableCell>
                  <TableCell>{statusBadge(audit.status)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      {audit.status === "scheduled" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleStartCount(audit.id)}
                          disabled={isPending}
                        >
                          Start Count
                        </Button>
                      )}
                      {audit.status === "in_progress" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setCountingAuditId(audit.id)}
                        >
                          Resume Count
                        </Button>
                      )}
                      {audit.status === "completed" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleViewReport(audit.id)}
                        >
                          View Report
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-700"
                        onClick={() => handleDelete(audit.id)}
                        disabled={isPending}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* SCHEDULE AUDIT MODAL */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-4">Schedule Inventory Audit</h3>
            <form onSubmit={handleSchedule} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Scheduled Date *
                </label>
                <Input
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  required
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1" disabled={isPending}>
                  {isPending ? "Scheduling..." : "Schedule Audit"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowScheduleModal(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* START COUNT INTERACTIVE SCREEN */}
      {countingAuditId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-zinc-200 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-zinc-900">Physical Stock Count</h3>
                <p className="text-sm text-zinc-500 mt-1">
                  Enter real-world physical stock levels. Uncounted items default to current system levels.
                </p>
              </div>
              <Button variant="ghost" onClick={() => { setCountingAuditId(null); setPhysicalCounts({}); }}>
                Close
              </Button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product Name</TableHead>
                    <TableHead>System Qty</TableHead>
                    <TableHead className="w-40">Physical Count *</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {warehouseProducts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.product_name}</TableCell>
                      <TableCell className="text-zinc-500 font-semibold">{Number(p.qty_total ?? 0).toLocaleString()}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          className="text-right"
                          value={physicalCounts[p.product_name] ?? p.qty_total}
                          onChange={(e) => setPhysicalCounts({
                            ...physicalCounts,
                            [p.product_name]: parseInt(e.target.value) || 0
                          })}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="p-6 border-t border-zinc-200 flex gap-3 bg-zinc-50">
              <Button className="flex-1" onClick={handleCompleteAudit} disabled={isPending}>
                {isPending ? "Applying Audits..." : "Complete Audit & Correct Stock"}
              </Button>
              <Button variant="outline" onClick={() => { setCountingAuditId(null); setPhysicalCounts({}); }}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW REPORT DETAILS MODAL */}
      {reportAuditId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-zinc-200 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-zinc-900">Audit Discrepancy Report</h3>
                <p className="text-sm text-zinc-500 mt-1">
                  Comparison report of count discrepancies found during this audit
                </p>
              </div>
              <Button variant="ghost" onClick={() => { setReportAuditId(null); setReportData([]); }}>
                Close
              </Button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              {loadingReport ? (
                <div className="text-center py-8 text-zinc-400">Loading discrepancies...</div>
              ) : reportData.length === 0 ? (
                <div className="text-center py-8 text-green-600 font-medium">
                  No discrepancies found! Physical counts matched system logs perfectly.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product Name</TableHead>
                      <TableHead>System Qty</TableHead>
                      <TableHead>Physical Qty</TableHead>
                      <TableHead>Difference</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportData.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.product_name}</TableCell>
                        <TableCell>{item.system_qty.toLocaleString()}</TableCell>
                        <TableCell>{item.physical_qty.toLocaleString()}</TableCell>
                        <TableCell className={`font-bold ${item.diff < 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {item.diff > 0 ? `+${item.diff}` : item.diff}
                        </TableCell>
                        <TableCell className="capitalize">
                          <Badge variant={item.status === 'pending' ? 'warning' : item.status === 'resolved' ? 'success' : 'destructive'}>
                            {item.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

