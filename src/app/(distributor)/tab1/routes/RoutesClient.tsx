"use client";

import { useState, useTransition, useCallback } from "react";
import { Button } from "@/components/ui/Button";
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
import {
  createDmRoute,
  deleteDmRoute,
  updateDmRoute,
  deleteRouteAssignment,
  getRouteDateSummaries,
  getInvoicesForDmOnDate,
  type DispatchSummary,
  type RouteDateSummary,
} from "@/lib/actions/routes";
import { useRouter } from "next/navigation";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

interface RoutesClientProps {
  registry: any[];
  assignments: any[];
  employees: any[];
  dispatchSummaries: Record<string, DispatchSummary>;
  fromDate: string;
  toDate: string;
}

export function RoutesClient({
  registry,
  assignments,
  employees,
  dispatchSummaries,
  fromDate,
  toDate,
}: RoutesClientProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useRealtimeTable("dm_routes", () => router.refresh());
  useRealtimeTable("route_assignments", () => router.refresh());
  useRealtimeTable("invoices", () => router.refresh());

  // --- Date filter state (local, URL-driven on submit) ---
  const [localFrom, setLocalFrom] = useState(fromDate);
  const [localTo, setLocalTo] = useState(toDate);

  const applyFilter = () => {
    const params = new URLSearchParams({ head: "dispatch", from: localFrom, to: localTo });
    router.push(`?${params.toString()}`);
  };

  // --- Registry Form State ---
  const [showRegistryForm, setShowRegistryForm] = useState(false);
  const [editingRegistryId, setEditingRegistryId] = useState<string | null>(null);
  const [dmId, setDmId] = useState("");
  const [truckNo, setTruckNo] = useState("");
  const [routeName, setRouteName] = useState("");

  // --- View Modal State (two-level drill-down) ---
  const [viewingRoute, setViewingRoute] = useState<any>(null);
  const [dateSummaries, setDateSummaries] = useState<RouteDateSummary[]>([]);
  const [loadingDateSummaries, setLoadingDateSummaries] = useState(false);

  // Second level: view invoices for a specific date
  const [viewingDate, setViewingDate] = useState<string | null>(null);
  const [dateInvoices, setDateInvoices] = useState<any[]>([]);
  const [loadingDateInvoices, setLoadingDateInvoices] = useState(false);

  const dms = employees.filter((e) => e.role === "dm");


  // --- Registry Handlers ---
  const openAddForm = () => {
    setEditingRegistryId(null);
    setDmId(""); setTruckNo(""); setRouteName("");
    setShowRegistryForm(true);
  };

  const openEditForm = (r: any) => {
    setEditingRegistryId(r.id);
    setDmId(r.dm_id);
    setTruckNo(r.truck_no);
    setRouteName(r.route_name);
    setShowRegistryForm(true);
  };

  const handleSaveRegistry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dmId || !truckNo || !routeName) return;
    startTransition(async () => {
      if (editingRegistryId) {
        await updateDmRoute(editingRegistryId, { dm_id: dmId, truck_no: truckNo, route_name: routeName });
      } else {
        await createDmRoute({ dm_id: dmId, truck_no: truckNo, route_name: routeName });
      }
      setShowRegistryForm(false);
      setEditingRegistryId(null);
      setDmId(""); setTruckNo(""); setRouteName("");
      router.refresh();
    });
  };

  const handleDeleteRegistry = async (id: string) => {
    if (!confirm("Remove this entry from the permanent registry?")) return;
    startTransition(async () => {
      await deleteDmRoute(id);
      router.refresh();
    });
  };

  const handleDeleteAssignment = async (id: string) => {
    if (!confirm("Delete this daily assignment?")) return;
    startTransition(async () => {
      await deleteRouteAssignment(id);
      router.refresh();
    });
  };

  // --- View drill-down ---
  const handleViewRoute = useCallback(async (route: any) => {
    setViewingRoute(route);
    setViewingDate(null);
    setDateInvoices([]);
    setLoadingDateSummaries(true);
    try {
      const data = await getRouteDateSummaries(route.dm_id, fromDate, toDate);
      setDateSummaries(data || []);
    } catch {
      alert("Failed to load route detail");
    } finally {
      setLoadingDateSummaries(false);
    }
  }, [fromDate, toDate]);

  const handleViewDateInvoices = useCallback(async (date: string) => {
    if (!viewingRoute) return;
    setViewingDate(date);
    setLoadingDateInvoices(true);
    try {
      const data = await getInvoicesForDmOnDate(viewingRoute.dm_id, date);
      setDateInvoices(data || []);
    } catch {
      alert("Failed to load invoices for this date");
    } finally {
      setLoadingDateInvoices(false);
    }
  }, [viewingRoute]);

  // Build dispatch rows from invoice-derived summaries joined with registry for truck/route info.
  // This ensures every DM with invoices in the date range appears regardless of route_assignments.
  const dispatchRows = Object.values(dispatchSummaries).map((s) => {
    const reg = registry.find((r: any) => r.dm_id === s.dmId);
    const dm = employees.find((e: any) => e.id === s.dmId);
    return {
      dm_id: s.dmId,
      dm_name: dm?.full_name || reg?.dm?.full_name || "—",
      truck_no: reg?.truck_no || "—",
      route_name: reg?.route_name || "—",
      totalInvoices: s.totalInvoices,
      revenue: s.revenue,
      returnAmt: s.returnAmt,
    };
  });

  const dispatchExport = dispatchRows.map((r) => ({
    "Truck No": r.truck_no,
    "DM Name": r.dm_name,
    "Route / Beat": r.route_name,
    "Total Invoices": r.totalInvoices,
    "Revenue": r.revenue,
    "Return Amt": r.returnAmt,
  }));

  return (
    <div className="space-y-8">
      {/* SECTION 1: DAILY DISPATCH TABLE */}
      <div>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-lg font-bold text-zinc-900">Daily Dispatch</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-sm text-zinc-500 font-medium">From</label>
            <Input
              type="date"
              value={localFrom}
              onChange={(e) => setLocalFrom(e.target.value)}
              className="w-40 text-sm"
            />
            <label className="text-sm text-zinc-500 font-medium">To</label>
            <Input
              type="date"
              value={localTo}
              onChange={(e) => setLocalTo(e.target.value)}
              className="w-40 text-sm"
            />
            <Button variant="outline" onClick={applyFilter} disabled={isPending}>
              Apply
            </Button>
            <ExportButtons data={dispatchExport} filename="dispatch_summary" />
          </div>
        </div>

        <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Truck No</TableHead>
                <TableHead>DM Name</TableHead>
                <TableHead>Route / Beat</TableHead>
                <TableHead className="text-right">Total Invoices</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Return Amt</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dispatchRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-zinc-400 py-6">
                    No routes found for the selected date range
                  </TableCell>
                </TableRow>
              ) : (
                dispatchRows.map((r) => (
                  <TableRow key={r.dm_id}>
                    <TableCell className="font-medium">{r.truck_no}</TableCell>
                    <TableCell>{r.dm_name}</TableCell>
                    <TableCell>{r.route_name}</TableCell>
                    <TableCell className="text-right">{r.totalInvoices}</TableCell>
                    <TableCell className="text-right font-semibold">
                      Rs.{r.revenue.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-amber-600">
                      Rs.{r.returnAmt.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => handleViewRoute({ dm_id: r.dm_id, truck_no: r.truck_no, route_name: r.route_name, dm: { full_name: r.dm_name } })}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* SECTION 2: DM ROUTE REGISTRY */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-zinc-900">DM / Truck Registry</h2>
          <div className="flex gap-2">
            <Button variant="outline" onClick={openAddForm} disabled={isPending}>
              + Add Route
            </Button>
          </div>
        </div>

        {showRegistryForm && (
          <form
            onSubmit={handleSaveRegistry}
            className="mb-4 p-4 bg-zinc-50 border border-zinc-200 rounded-lg flex flex-wrap gap-3 items-end"
          >
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">DM</label>
              <select
                className="border border-zinc-300 rounded px-2 py-1.5 text-sm"
                value={dmId}
                onChange={(e) => setDmId(e.target.value)}
                required
              >
                <option value="">Select DM</option>
                {dms.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Truck No</label>
              <Input value={truckNo} onChange={(e) => setTruckNo(e.target.value)} placeholder="e.g. ABC-123" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Route / Beat</label>
              <Input value={routeName} onChange={(e) => setRouteName(e.target.value)} placeholder="e.g. Route A" required />
            </div>
            <Button type="submit" disabled={isPending}>
              {editingRegistryId ? "Update" : "Save"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowRegistryForm(false)}>
              Cancel
            </Button>
          </form>
        )}

        <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Truck No</TableHead>
                <TableHead>DM Name</TableHead>
                <TableHead>Route / Beat</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {registry.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-zinc-400 py-6">
                    No routes registered yet
                  </TableCell>
                </TableRow>
              ) : (
                registry.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.truck_no}</TableCell>
                    <TableCell>{r.dm?.full_name}</TableCell>
                    <TableCell>{r.route_name}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEditForm(r)}>Edit</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-700"
                          onClick={() => handleDeleteRegistry(r.id)}
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
      </div>

      {/* VIEW ROUTE MODAL - Level 1: Date-grouped summaries */}
      {viewingRoute && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-zinc-200 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold">
                  {viewingRoute.truck_no} — {viewingRoute.route_name}
                </h2>
                <p className="text-sm text-zinc-500">
                  {viewingRoute.dm?.full_name} &nbsp;|&nbsp; {fromDate} to {toDate}
                </p>
              </div>
              <Button variant="ghost" onClick={() => { setViewingRoute(null); setViewingDate(null); }}>
                Close
              </Button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {loadingDateSummaries ? (
                <div className="text-center py-8 text-zinc-400">Loading...</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Invoices #</TableHead>
                      <TableHead className="text-right">Invoice Total</TableHead>
                      <TableHead className="text-right">Total Cash</TableHead>
                      <TableHead className="text-right">Total Credit</TableHead>
                      <TableHead className="text-right">Return Amt</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dateSummaries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-6 text-zinc-400">
                          No invoices in this date range
                        </TableCell>
                      </TableRow>
                    ) : (
                      dateSummaries.map((ds) => (
                        <TableRow key={ds.date}>
                          <TableCell className="font-medium whitespace-nowrap">{ds.date}</TableCell>
                          <TableCell className="text-right">{ds.invoiceCount}</TableCell>
                          <TableCell className="text-right font-semibold">
                            Rs.{ds.invoiceTotal.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right text-green-600">
                            Rs.{ds.cashTotal.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right text-red-600">
                            Rs.{ds.creditTotal.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right text-amber-600">
                            Rs.{ds.returnAmt.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="ghost" onClick={() => handleViewDateInvoices(ds.date)}>
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW INVOICES MODAL - Level 2: All invoices for a specific date */}
      {viewingDate && viewingRoute && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-zinc-200 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold">
                  Invoices — {viewingDate}
                </h2>
                <p className="text-sm text-zinc-500">
                  {viewingRoute.dm?.full_name} &middot; {viewingRoute.route_name}
                </p>
              </div>
              <Button variant="ghost" onClick={() => setViewingDate(null)}>
                &larr; Back
              </Button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {loadingDateInvoices ? (
                <div className="text-center py-8 text-zinc-400">Loading invoices...</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice No</TableHead>
                      <TableHead>Shop</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dateInvoices.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-6 text-zinc-400">
                          No invoices found
                        </TableCell>
                      </TableRow>
                    ) : (
                      dateInvoices.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell className="font-medium">{inv.invoice_no}</TableCell>
                          <TableCell>{inv.shop?.shop_name}</TableCell>
                          <TableCell>
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-semibold ${inv.invoice_type === "cash"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-amber-100 text-amber-700"
                                }`}
                            >
                              {inv.invoice_type}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            Rs.{Number(inv.grand_total ?? inv.invoice_total ?? 0).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
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
