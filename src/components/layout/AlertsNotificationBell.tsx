"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { Bell, Check, ExternalLink } from "lucide-react";
import { useSupabase } from "@/lib/supabase/client";
import { getRecentAlerts, markAlertRead } from "@/lib/actions/alerts";

export function AlertsNotificationBell() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const supabase = useSupabase();

  // Load initial alerts
  useEffect(() => {
    let isMounted = true;
    getRecentAlerts(15).then((res) => {
      if (isMounted && res) {
        setAlerts(res.alerts || []);
        setUnreadCount(res.unreadCount || 0);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Real-time subscription to alerts table
  useEffect(() => {
    const channel = supabase
      .channel("topbar-alerts-bell")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts" },
        (payload) => {
          const newRow = payload.new as any;
          const oldRow = payload.old as any;

          if (newRow && newRow.alert_type === "cash_not_deposited") return;

          if (payload.eventType === "INSERT") {
            setAlerts((prev) => [newRow, ...prev.filter((a) => a.id !== newRow.id)].slice(0, 15));
            if (newRow.status === "unread") {
              setUnreadCount((c) => c + 1);
            }
          } else if (payload.eventType === "UPDATE") {
            setAlerts((prev) => {
              const updated = prev.map((item) => (item.id === newRow.id ? newRow : item));
              setUnreadCount(updated.filter((a) => a.status === "unread").length);
              return updated;
            });
          } else if (payload.eventType === "DELETE") {
            setAlerts((prev) => {
              const remaining = prev.filter((item) => item.id !== oldRow.id);
              setUnreadCount(remaining.filter((a) => a.status === "unread").length);
              return remaining;
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Synchronize across components
  useEffect(() => {
    const handleAlertReadEvent = (e: any) => {
      const id = e.detail?.id;
      if (id) {
        setAlerts((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: "read" } : a))
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      }
    };
    window.addEventListener("mdos:alert-read", handleAlertReadEvent);
    return () => {
      window.removeEventListener("mdos:alert-read", handleAlertReadEvent);
    };
  }, []);

  const handleMarkRead = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    // Optimistic update
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "read" } : a))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    window.dispatchEvent(new CustomEvent("mdos:alert-read", { detail: { id } }));

    startTransition(async () => {
      try {
        await markAlertRead(id);
        // No router.refresh() — that re-ran ensureOverdueAlerts via the alerts page
        // and made Mark Read feel stuck. Optimistic UI + realtime already update the bell.
      } catch (err: any) {
        console.error("Failed to mark alert as read:", err?.message);
      }
    });
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative p-1.5 rounded-full text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition-colors focus:outline-none"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[1rem] h-4 px-1 text-[0.625rem] font-bold text-white bg-red-600 rounded-full ring-2 ring-white animate-pulse">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-2xl border border-zinc-200 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-50/80 border-b border-zinc-200">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs text-zinc-900">Alerts Feed</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 text-[0.625rem] font-bold bg-red-100 text-red-700 rounded-full">
                  {unreadCount} unread
                </span>
              )}
            </div>
            <Link
              href="/tab7/alerts"
              onClick={() => setIsOpen(false)}
              className="text-[0.6875rem] text-red-600 hover:text-red-700 font-medium flex items-center gap-1"
            >
              View Feed <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-zinc-100">
            {alerts.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-400">
                No alerts at this time
              </div>
            ) : (
              alerts.map((item) => (
                <div
                  key={item.id}
                  className={`p-3 transition-colors ${
                    item.status === "unread"
                      ? (item.details?.startsWith("Admin restored") ? "bg-blue-50/30" : "bg-red-50/20")
                      : "hover:bg-zinc-50/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5">
                      {item.details?.startsWith("Admin restored") ? (
                        <span className="px-1.5 py-0.5 text-[0.59375rem] font-bold bg-blue-100 text-blue-700 rounded">
                          RESTORE
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-[0.59375rem] font-bold bg-red-100 text-red-700 rounded">
                          OVERDUE
                        </span>
                      )}
                      <span className="text-[0.625rem] text-zinc-400 font-mono">
                        {new Date(item.created_at).toLocaleTimeString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                          hour12: false,
                        })}
                      </span>
                    </div>
                    {item.status === "unread" ? (
                      <button
                        type="button"
                        onClick={(e) => handleMarkRead(item.id, e)}
                        disabled={isPending}
                        className="text-[0.65625rem] font-semibold text-zinc-600 hover:text-zinc-900 border border-zinc-200 hover:border-zinc-300 rounded px-2 py-0.5 bg-white shadow-xs transition-colors"
                      >
                        Mark Read
                      </button>
                    ) : (
                      <span className="text-[0.625rem] text-zinc-400 flex items-center gap-0.5 font-medium">
                        <Check className="w-3 h-3 text-zinc-400" /> Read
                      </span>
                    )}
                  </div>
                  <p className="text-[0.71875rem] text-zinc-700 leading-snug break-words">
                    {item.details}
                  </p>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 bg-zinc-50 border-t border-zinc-100 text-center">
            <Link
              href="/tab7/alerts"
              onClick={() => setIsOpen(false)}
              className="text-[0.6875rem] font-semibold text-zinc-600 hover:text-zinc-900"
            >
              Go to Tab 7 Live Alerts Feed →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
