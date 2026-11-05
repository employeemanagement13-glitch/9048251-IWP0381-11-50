"use client";

import { useState, useTransition, Fragment, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
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
import { deleteLog } from "@/lib/actions/admin";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

interface Props {
  initialLogs: any[];
}

// Consistent date formatting to avoid hydration mismatch
function formatDate(dateString: string) {
  if (!dateString) return "—";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "Invalid Date";
  const day = date.getDate();
  const month = date.toLocaleString('en-US', { month: 'short' });
  const year = date.getFullYear();
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  const hours12 = hours % 12 || 12;
  return `${day} ${month} ${year}, ${hours12}:${minutes} ${ampm}`;
}

export function LogsClient({ initialLogs }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [logs, setLogs] = useState(initialLogs);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Tracks new entries that arrived via realtime (before router.refresh completes)
  // so the optimistic row can be deduped once the server re-render returns.
  const [realtimeKeys, setRealtimeKeys] = useState<Set<string>>(new Set());

  // Sync with server re-renders (e.g. after delete, or router.refresh)
  useEffect(() => {
    setLogs(initialLogs);
    // Clear realtime-only keys — server data now includes them
    setRealtimeKeys(new Set());
  }, [initialLogs]);

  // ── Real-time sync ──────────────────────────────────────────────────────
  // When any distributor accesses a page, a row is INSERTed into admin_logs.
  // We:
  //   1. Optimistically prepend the new entry from the realtime payload so it
  //      appears instantly (tenant.distro_name will be null until step 2).
  //   2. Call router.refresh() to reload server data and hydrate the tenant join.
  const handleNewLog = useCallback((payload: any) => {
    if (payload.eventType === 'DELETE') return;
    
    const newRow = payload?.new;
    if (!newRow || !newRow.pk_timestamp) return;

    // Deduplicate: if it exists, update it (to handle UPDATE events), else prepend
    setLogs((prev) => {
      const existsIndex = prev.findIndex((l) => l.pk_timestamp === newRow.pk_timestamp);
      if (existsIndex >= 0) {
        const updated = [...prev];
        updated[existsIndex] = { ...newRow, tenant: prev[existsIndex].tenant };
        return updated;
      }
      return [{ ...newRow, tenant: null }, ...prev];
    });
    setRealtimeKeys((prev) => new Set(prev).add(newRow.pk_timestamp));

    // Background refresh to hydrate the tenant join field
    router.refresh();
  }, [router]);

  useRealtimeTable('admin_logs', handleNewLog);
  // ─────────────────────────────────────────────────────────────────────
  const handleDelete = (pkTimestamp: string) => {
    if (!confirm("Are you sure you want to delete this log entry?")) return;
    startTransition(async () => {
      try {
        await deleteLog(pkTimestamp);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const filteredLogs = logs.filter((log) => {
    const ip = String(log.ip_address || "");
    const distro = String(log.tenant?.distro_name || "");
    const time = new Date(log.pk_timestamp).toLocaleTimeString();
    const query = search.toLowerCase();
    
    // Text search filter
    const textMatch = (
      ip.toLowerCase().includes(query) ||
      distro.toLowerCase().includes(query) ||
      time.toLowerCase().includes(query) ||
      String(log.user_email || "").toLowerCase().includes(query) ||
      String(log.user_name || "").toLowerCase().includes(query) ||
      (log.is_mdos_user && "yes".includes(query)) ||
      (!log.is_mdos_user && "no".includes(query))
    );
    
    // Date range filter
    let dateMatch = true;
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      fromDate.setHours(0, 0, 0, 0);
      const logDate = new Date(log.pk_timestamp);
      dateMatch = dateMatch && logDate >= fromDate;
    }
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      const logDate = new Date(log.pk_timestamp);
      dateMatch = dateMatch && logDate <= toDate;
    }
    
    return textMatch && dateMatch;
  });

  const exportData = filteredLogs.map((l) => ({
    "Session Start": new Date(l.pk_timestamp).toLocaleString(),
    "Pages Count": (l.visited_pages || []).length,
    "IP Address": l.ip_address === "::1" ? "127.0.0.1" : (l.ip_address || ""),
    "MDOS User": l.is_mdos_user ? "Yes" : "No",
    "User Email": l.user_email || "—",
    Distribution: l.tenant?.distro_name || "—",
    "Visited Pages": (l.visited_pages || []).map((p: any) => {
      let path: string;
      let timestamp: string;
      
      let parsedVisit = p;
      if (typeof p === 'string') {
        try {
          parsedVisit = JSON.parse(p);
        } catch (e) {
          // not json
        }
      }
      
      if (typeof parsedVisit === 'string') {
        path = parsedVisit;
        timestamp = l.pk_timestamp;
      } else if (parsedVisit && typeof parsedVisit === 'object') {
        path = parsedVisit.path || JSON.stringify(parsedVisit);
        timestamp = parsedVisit.timestamp || l.pk_timestamp;
      } else {
        path = JSON.stringify(parsedVisit);
        timestamp = l.pk_timestamp;
      }
      
      return `${path} (${formatDate(timestamp)})`;
    }).join("; "),
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex-1 max-w-md">
          <Input
            placeholder="Search by IP, distribution, or PKT time..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            placeholder="From"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-auto"
          />
          <span className="text-zinc-500">to</span>
          <Input
            type="date"
            placeholder="To"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-auto"
          />
          <ExportButtons data={exportData} filename="access_logs" />
        </div>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PK</TableHead>
              <TableHead>Session Start</TableHead>
              <TableHead>Pages Visited</TableHead>
              <TableHead>IP Address</TableHead>
              <TableHead>MDOS User</TableHead>
              <TableHead>Distribution</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredLogs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-zinc-400 py-8">
                  No log records found
                </TableCell>
              </TableRow>
            ) : (
              filteredLogs.map((item, index) => {
                const isExpanded = expandedLogId === item.pk_timestamp;
                const pageCount = (item.visited_pages || []).length;
                return (
                  <Fragment key={item.pk_timestamp}>
                    <TableRow className="hover:bg-zinc-50/50">
                      <TableCell className="font-mono text-xs text-zinc-500">
                        {filteredLogs.length - index}
                      </TableCell>
                      <TableCell>
                        {formatDate(item.pk_timestamp)}
                      </TableCell>
                      <TableCell>
                        {pageCount > 0 ? (
                          <button
                            onClick={() =>
                              setExpandedLogId(isExpanded ? null : item.pk_timestamp)
                            }
                            className="text-red-600 hover:underline flex items-center gap-1 font-medium"
                          >
                            {pageCount} {pageCount === 1 ? "page" : "pages"}{" "}
                            <span>{isExpanded ? "▴" : "▾"}</span>
                          </button>
                        ) : (
                          <span className="text-zinc-400">0 pages</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-zinc-700">
                        {item.ip_address === "::1" || item.ip_address === "127.0.0.1" ? "127.0.0.1" : (item.ip_address || "—")}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span
                            className={`inline-flex items-center w-fit px-2 py-0.5 rounded text-xs font-semibold ${
                              item.is_mdos_user ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-700"
                            }`}
                          >
                            {item.is_mdos_user ? "Yes" : "No"}
                          </span>
                          {item.user_email && (
                            <span className="text-[0.6875rem] text-zinc-500 font-mono mt-0.5" title={item.user_name || undefined}>
                              {item.user_email}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{item.tenant?.distro_name || <span className="text-zinc-400">—</span>}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-700"
                          onClick={() => handleDelete(item.pk_timestamp)}
                          disabled={isPending}
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                    {isExpanded && pageCount > 0 && (
                      <TableRow className="bg-zinc-50/50">
                        <TableCell colSpan={7} className="px-6 py-3">
                          <div className="text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-wider">
                            Visited Pages ({pageCount}):
                          </div>
                          <div className="space-y-1">
                            {(item.visited_pages || []).map((visit: any, idx: number) => {
                              // Handle both old format (string) and new format (object with path/timestamp)
                              let path: string;
                              let timestamp: string;
                              
                              let parsedVisit = visit;
                              if (typeof visit === 'string') {
                                try {
                                  parsedVisit = JSON.parse(visit);
                                } catch (e) {
                                  // not json
                                }
                              }
                              
                              if (typeof parsedVisit === 'string') {
                                path = parsedVisit;
                                timestamp = item.pk_timestamp;
                              } else if (parsedVisit && typeof parsedVisit === 'object') {
                                path = parsedVisit.path || JSON.stringify(parsedVisit);
                                timestamp = parsedVisit.timestamp || item.pk_timestamp;
                              } else {
                                path = JSON.stringify(parsedVisit);
                                timestamp = item.pk_timestamp;
                              }
                              
                              return (
                                <div key={idx} className="flex items-center gap-3 text-sm">
                                  <span className="font-mono text-zinc-600 w-6">{idx + 1}.</span>
                                  <span className="font-mono text-zinc-800 flex-1">{path}</span>
                                  <span className="text-xs text-zinc-500">{formatDate(timestamp)}</span>
                                </div>
                              );
                            })}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

