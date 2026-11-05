"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Building2,
  SlidersHorizontal,
  ScrollText,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowLeft,
  HardDrive,
} from "lucide-react";

export function AdminSidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const adminNav = [
    {
      name: "Tenants",
      path: "/admin/dashboard",
      isActive:
        pathname.startsWith("/admin/dashboard") ||
        pathname.startsWith("/admin/tenants"),
      icon: Building2,
    },
    {
      name: "Backup Management",
      path: "/admin/backups",
      isActive: pathname.startsWith("/admin/backups"),
      icon: HardDrive,
    },
    {
      name: "Platform Settings",
      path: "/admin/settings",
      isActive: pathname.startsWith("/admin/settings"),
      icon: SlidersHorizontal,
    },
    {
      name: "Access Logs",
      path: "/admin/logs",
      isActive: pathname.startsWith("/admin/logs"),
      icon: ScrollText,
    },
  ];

  const navLinkCls = (isActive: boolean) =>
    [
      "block px-3 py-[0.3125rem] rounded-[var(--radius-sm)] text-[0.6875rem] transition-all duration-150",
      isActive
        ? "bg-[var(--primary-light)] text-[var(--primary)] font-semibold"
        : "text-[var(--text-secondary)] hover:bg-gray-50 hover:text-[var(--text-primary)]",
    ].join(" ");

  return (
    <aside
      className={[
        "shrink-0 flex flex-col h-full min-h-full bg-white border-r border-[var(--border)]",
        "transition-all duration-250 overflow-hidden",
        isCollapsed ? "w-[3.25rem]" : "w-[var(--sidebar-width)]",
      ].join(" ")}
    >
      <div
        className={[
          "flex items-center border-b border-[var(--border-light)] h-[var(--topbar-height)] px-3 shrink-0",
          isCollapsed ? "justify-center" : "justify-between",
        ].join(" ")}
      >
        {!isCollapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--primary)] flex items-center justify-center shrink-0">
              <span className="text-white text-[0.625rem] font-bold leading-none">A</span>
            </div>
            <span className="text-[0.75rem] font-semibold text-[var(--text-primary)] truncate">
              MDOS Admin
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() => setIsCollapsed((p) => !p)}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded-[var(--radius-sm)] bg-[var(--primary)] p-1.5 text-white shrink-0"
        >
          {isCollapsed ? (
            <PanelLeftOpen className="h-[0.875rem] w-[0.875rem]" />
          ) : (
            <PanelLeftClose className="h-[0.875rem] w-[0.875rem]" />
          )}
        </button>
      </div>

      {!isCollapsed ? (
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          <p className="px-3 mb-1.5 text-[0.59375rem] font-semibold text-[var(--text-muted)] uppercase tracking-widest">
            Administration
          </p>

          <div className="space-y-0.5">
            {adminNav.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  className={navLinkCls(item.isActive)}
                >
                  <span className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] text-[var(--primary)]">
                      <Icon className="h-[0.875rem] w-[0.875rem]" />
                    </span>
                    <span>{item.name}</span>
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="pt-3 mt-3 border-t border-[var(--border-light)]">
            <p className="px-3 mb-1.5 text-[0.59375rem] font-semibold text-[var(--text-muted)] uppercase tracking-widest">
              Exit
            </p>
            <Link href="/tab1/transactions" className={navLinkCls(false)}>
              <span className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] text-[var(--primary)]">
                  <ArrowLeft className="w-[0.875rem] h-[0.875rem] shrink-0" />
                </span>
                <span>Return to Portal</span>
              </span>
            </Link>
          </div>
        </nav>
      ) : (
        <nav className="flex-1 overflow-y-auto py-3 px-1 space-y-1 flex flex-col items-center">
          {adminNav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                href={item.path}
                title={item.name}
                className={[
                  "flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] transition-all",
                  item.isActive
                    ? "bg-[var(--primary-light)] text-[var(--primary)] font-semibold border border-[var(--primary)]"
                    : "text-[var(--text-secondary)] hover:bg-gray-50 hover:text-[var(--text-primary)] border border-transparent",
                ].join(" ")}
              >
                <Icon className="h-[0.9375rem] w-[0.9375rem]" />
              </Link>
            );
          })}
          <div className="w-6 border-t border-[var(--border-light)] my-2" />
          <Link
            href="/tab1/transactions"
            title="Return to Portal"
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-gray-50 hover:text-[var(--text-primary)] transition-all"
          >
            <ArrowLeft className="h-[0.9375rem] w-[0.9375rem]" />
          </Link>
        </nav>
      )}
    </aside>
  );
}
