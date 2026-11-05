"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { getRouteMetadata } from "@/config/menu";
import { UserButton } from "@clerk/nextjs";
import { getCurrentDistroName } from "@/lib/actions/settings";
import { AlertsNotificationBell } from "./AlertsNotificationBell";
import { Menu } from "lucide-react";
import { useSidebar } from "./SidebarContext";

/**
 * TopBar — sticky app bar showing:
 *  • Left:  mobile menu toggle (on < lg) + breadcrumb (category › page title)
 *  • Right: distribution name + UserButton + AlertsNotificationBell
 */
interface TopBarProps {
  distroName?: string;
}

export function TopBar({ distroName }: TopBarProps) {
  const pathname = usePathname();
  const { category } = getRouteMetadata(pathname);
  const [currentDistroName, setCurrentDistroName] = useState<string>(distroName || "");
  const [mounted, setMounted] = useState(false);

  const sidebarCtx = useSidebar();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (distroName) {
      setCurrentDistroName(distroName);
      return;
    }
    getCurrentDistroName().then((name) => {
      if (name) setCurrentDistroName(name);
    });
  }, [distroName]);

  const isAdmin = pathname.startsWith("/admin");
  const displayName = currentDistroName || (isAdmin ? "MDOS Admin" : "Distributor");

  return (
    <header
      className={[
        "h-[var(--topbar-height)] shrink-0 z-10",
        "flex items-center justify-between px-3 sm:px-5",
        "bg-white border-b border-[var(--border)]",
      ].join(" ")}
    >
      {/* ── Mobile Hamburger & Breadcrumb ───────────────────────────── */}
      <div className="flex items-center gap-2 min-w-0">
        {sidebarCtx && (
          <button
            type="button"
            onClick={sidebarCtx.toggleMobile}
            className="lg:hidden p-1.5 -ml-1 rounded-[var(--radius-sm)] text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition-colors shrink-0"
            aria-label="Toggle navigation menu"
          >
            <Menu className="h-4 w-4 text-[var(--primary)]" />
          </button>
        )}
        <span className="text-[0.6875rem] text-[var(--text-muted)] truncate">{category}</span>
      </div>

      {/* ── User Pill & Notification Bell ───────────────────────── */}
      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0 min-h-[1.75rem]">
        <span className="text-[0.71875rem] font-semibold text-zinc-800 hidden sm:block truncate max-w-[10rem] md:max-w-[15rem]">
          {displayName}
        </span>
        {mounted ? (
          <UserButton />
        ) : (
          <div className="w-7 h-7 rounded-full bg-zinc-200/60" />
        )}
        <AlertsNotificationBell />
      </div>
    </header>
  );
}

