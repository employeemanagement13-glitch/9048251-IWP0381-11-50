"use client";

import { useState, useEffect, useTransition } from "react";
import { useSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Loader2 } from "lucide-react";
import { ExportButtons } from "@/components/export/ExportButtons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { markAlertRead } from "@/lib/actions/alerts";

interface Props {
  initialAlerts: any[];
  cashEnabled: boolean;
  overdueEnabled: boolean;
}

const formatAlertTime = (value: string) => {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
};

export function AlertsClient({ initialAlerts, cashEnabled, overdueEnabled }: Props) {
  const [alerts, setAlerts] = useState<any[]>(initialAlerts);
  const [, startTransition] = useTransition();
  const [markingId, setMarkingId] = useState<string | null>(null);
  const supabase = useSupabase();

  useEffect(() => {
    setAlerts(initialAlerts);
  }, [initialAlerts]);

  useEffect(() => {
    const channel = supabase
      .channel("realtime-alerts-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts" },
        (payload) => {
          const newRow = payload.new as any;
          const oldRow = payload.old as any;

          if (newRow && newRow.alert_type === "cash_not_deposited") return;
          if (
            newRow &&
            newRow.alert_type === "overdue_threshold" &&
            !overdueEnabled &&
            !newRow.details?.startsWith("Admin restored")
          ) {
            return;
          }

          if (payload.eventType === "INSERT") {
            setAlerts((prev) => [newRow, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setAlerts((prev) =>
              prev.map((item) => (item.id === newRow.id ? newRow : item))
            );
          } else if (payload.eventType === "DELETE") {
            setAlerts((prev) => prev.filter((item) => item.id !== oldRow.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, overdueEnabled]);

  useEffect(() => {
    const handleAlertReadEvent = (e: any) => {
      const id = e.detail?.id;
      if (id) {
        setAlerts((prev) =>
          prev.map((item) => (item.id === id ? { ...item, status: "read" } : item))
        );
      }
    };
    window.addEventListener("mdos:alert-read", handleAlertReadEvent);
    return () => {
      window.removeEventListener("mdos:alert-read", handleAlertReadEvent);
    };
  }, []);

  const handleMarkRead = (id: string) => {
    // Optimistic update — UI flips immediately; DB write is fire-and-forget light.
    setAlerts((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: "read" } : item))
    );
    window.dispatchEvent(new CustomEvent("mdos:alert-read", { detail: { id } }));
    setMarkingId(id);

    startTransition(async () => {
      try {
        await markAlertRead(id);
      } catch (err: any) {
        // Roll back this row if the write failed
        setAlerts((prev) =>
          prev.map((item) => (item.id === id ? { ...item, status: "unread" } : item))
        );
        alert(err.message);
      } finally {
        setMarkingId((cur) => (cur === id ? null : cur));
      }
    });
  };

  const getAlertBadge = (_type: string, details?: string) => {
    if (details?.startsWith("Admin restored")) {
      return <Badge className="bg-blue-600 text-white hover:bg-blue-700">System Restore</Badge>;
    }
    return <Badge variant="destructive">Overdue Threshold</Badge>;
  };

  const getSeverityBadge = (severity: string, details?: string) => {
    if (details?.startsWith("Admin restored")) {
      return <Badge variant="secondary">RESTORE</Badge>;
    }
    switch (severity) {
      case "HIGH":
        return <Badge variant="destructive">HIGH</Badge>;
      case "MEDIUM":
        return <Badge variant="warning">MEDIUM</Badge>;
      default:
        return <Badge variant="secondary">LOW</Badge>;
    }
  };

  const exportData = alerts.map((a) => ({
    Time: formatAlertTime(a.created_at),
    Type: a.details?.startsWith("Admin restored") ? "System Restore" : "Overdue Threshold",
    Details: a.details || "",
    Severity: a.severity,
    Status: a.status,
  }));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <ExportButtons data={exportData} filename="realtime_alerts_feed" />
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Alert Type</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {alerts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-zinc-400 py-8">
                  No active alerts in the feed
                </TableCell>
              </TableRow>
            ) : (
              alerts.map((item) => (
                <TableRow
                  key={item.id}
                  className={`hover:bg-zinc-50/50 ${
                    item.status === "unread" ? "bg-indigo-50/20 font-medium" : ""
                  }`}
                >
                  <TableCell>
                    {new Date(item.created_at).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    })}
                  </TableCell>
                  <TableCell>{getAlertBadge(item.alert_type, item.details)}</TableCell>
                  <TableCell className="text-zinc-800">{item.details}</TableCell>
                  <TableCell>{getSeverityBadge(item.severity, item.details)}</TableCell>
                  <TableCell>
                    <Badge variant={item.status === "unread" ? "warning" : "secondary"}>
                      {item.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {item.status === "unread" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleMarkRead(item.id)}
                        disabled={markingId === item.id}
                        className="whitespace-nowrap inline-flex items-center gap-1.5"
                      >
                        {markingId === item.id && <Loader2 className="h-3 w-3 animate-spin" />}
                        <span>Mark Read</span>
                      </Button>
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

