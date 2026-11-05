"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { menuTabs, standalonePages } from "@/config/menu";
import { FEATURE_TABS_HIERARCHY } from "@/config/featureFlagsHierarchy";
import { useMemo, useState, useEffect } from "react";
import { ChevronDown, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { useSidebar } from "./SidebarContext";

interface Props {
  enabledFlags: string[];
}

export function Sidebar({ enabledFlags = [] }: Props) {
  const pathname = usePathname();
  const [openTabs, setOpenTabs] = useState<Record<number, boolean>>({});
  
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();

  /* ── Active-tab detection & Auto-close other tabs on navigation ── */
  const activeTabId = useMemo(() => {
    const found = menuTabs.find((tab) =>
      tab.pages.some((p) => pathname.startsWith(p.path))
    );
    return found ? found.id : null;
  }, [pathname]);

  // When moving to a page of another tab, automatically close the previous tab's dropdown
  useEffect(() => {
    if (activeTabId !== null) {
      setOpenTabs({ [activeTabId]: true });
    }
  }, [activeTabId]);

  const activeTabs = useMemo(() => {
    if (activeTabId === null) return {};
    return { [activeTabId]: true };
  }, [activeTabId]);

  const displayOpenTabs = { ...openTabs, ...activeTabs };

  const toggleTab = (id: number) =>
    setOpenTabs((prev) => ({ ...prev, [id]: !prev[id] }));

  /* ── Feature-flag filtering ───────────────────────────────────────── */
  const isPageEnabled = (pagePath: string, tabId: number) => {
    const tabItem = FEATURE_TABS_HIERARCHY.find((t) => t.id === tabId);
    if (tabItem && !enabledFlags.includes(tabItem.key)) {
      return false;
    }
    const pageItem = tabItem?.pages.find((p) => pagePath.startsWith(p.path));
    if (pageItem && !enabledFlags.includes(pageItem.key)) {
      return false;
    }
    if (pagePath === "/tab7/alerts") {
      return (
        enabledFlags.includes("alert_page_enabled") ||
        enabledFlags.includes("page_realtime_alerts")
      );
    }
    return true;
  };

  const enabledTabs = menuTabs
    .map((tab) => ({
      ...tab,
      pages: tab.pages.filter((page) => isPageEnabled(page.path, tab.id)),
    }))
    .filter((tab) => tab.pages.length > 0);

  /* ── Shared class helpers ─────────────────────────────────────────── */
  const navLinkCls = (isActive: boolean) =>
    [
      "block px-3 py-[0.375rem] rounded-[var(--radius-sm)] text-[0.71875rem] transition-all duration-150",
      isActive
        ? "bg-[var(--primary-light)] text-[var(--primary)] font-semibold"
        : "text-[var(--text-secondary)] hover:bg-gray-50 hover:text-[var(--text-primary)]",
    ].join(" ");

  const renderNavList = (onItemClick?: () => void) => (
    <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
      {enabledTabs.map((tab) => {
        const isTabActive = !!activeTabs[tab.id];
        return (
          <div key={tab.id}>
            {/* Tab group toggle */}
            <button
              onClick={() => toggleTab(tab.id)}
              className={[
                "w-full text-left px-3 py-[0.375rem] rounded-[var(--radius-sm)]",
                "flex justify-between items-center gap-2",
                "text-[0.6875rem] font-semibold transition-all duration-150",
                isTabActive
                  ? "text-[var(--primary)]"
                  : "text-[var(--text-secondary)] hover:bg-gray-50 hover:text-[var(--text-primary)]",
              ].join(" ")}
            >
              <span className="flex items-center gap-2 truncate">
                <span className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] text-[var(--primary)] shrink-0">
                  {tab.icon ? <tab.icon className="h-[0.875rem] w-[0.875rem]" /> : null}
                </span>
                <span className="truncate">{tab.title}</span>
              </span>
              <ChevronDown
                className={[
                  "w-[0.8125rem] h-[0.8125rem] shrink-0 transition-transform duration-200",
                  displayOpenTabs[tab.id] ? "rotate-180" : "",
                ].join(" ")}
              />
            </button>

            {/* Pages */}
            {displayOpenTabs[tab.id] && (
              <div className="mt-0.5 ml-3 space-y-0.5 tab-expand">
                {tab.pages.map((page) => {
                  const isActive = pathname.startsWith(page.path);
                  const Icon = page.icon;
                  return (
                    <Link
                      key={page.path}
                      href={page.path}
                      onClick={onItemClick}
                      className={navLinkCls(isActive)}
                    >
                      <span className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] text-[var(--primary)] shrink-0">
                          {Icon ? <Icon className="h-[0.875rem] w-[0.875rem]" /> : null}
                        </span>
                        <span>{page.name}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Standalone / System ──────────────────────────────── */}
      <div className="pt-3 mt-3 border-t border-[var(--border-light)]">
        <p className="px-3 mb-1.5 text-[0.59375rem] font-semibold text-[var(--text-muted)] uppercase tracking-widest">
          System
        </p>
        {standalonePages.map((page) => {
          const isActive = pathname.startsWith(page.path);
          const Icon = page.icon;
          return (
            <Link
              key={page.path}
              href={page.path}
              onClick={onItemClick}
              className={navLinkCls(isActive)}
            >
              <span className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] text-[var(--primary)] shrink-0">
                  {Icon ? <Icon className="w-[0.875rem] h-[0.875rem] shrink-0" /> : null}
                </span>
                {page.name}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );

  return (
    <>
      {/* ── Desktop Sidebar (Visible on lg: >= 1024px) ─────────────── */}
      <aside
        className={[
          "hidden lg:flex shrink-0 flex-col h-full min-h-full bg-white border-r border-[var(--border)]",
          "transition-all duration-250 overflow-hidden",
          isCollapsed ? "w-[3.25rem]" : "w-[var(--sidebar-width)]",
        ].join(" ")}
      >
        {/* Brand / Toggle */}
        <div
          className={[
            "flex items-center border-b border-[var(--border-light)] h-[var(--topbar-height)] px-3 shrink-0",
            isCollapsed ? "justify-center" : "justify-between",
          ].join(" ")}
        >
          {!isCollapsed && (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--primary)] flex items-center justify-center shrink-0">
                <span className="text-white text-[0.625rem] font-bold leading-none">M</span>
              </div>
              <span className="text-[0.75rem] font-semibold text-[var(--text-primary)] truncate">
                Distroline Portal
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsCollapsed((p) => !p)}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-[var(--radius-sm)] bg-[var(--primary)] p-1.5 text-white shrink-0 hover:opacity-90 transition-opacity"
          >
            {isCollapsed
              ? <PanelLeftOpen className="h-[0.875rem] w-[0.875rem]" />
              : <PanelLeftClose className="h-[0.875rem] w-[0.875rem]" />}
          </button>
        </div>

        {/* Navigation */}
        {!isCollapsed && renderNavList()}
      </aside>

      {/* ── Mobile / Tablet Drawer (< lg: < 1024px) ────────────────── */}
      {/* Backdrop */}
      <div
        className={[
          "fixed inset-0 bg-black/50 backdrop-blur-xs z-40 lg:hidden transition-opacity duration-200",
          isMobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        ].join(" ")}
        onClick={() => setIsMobileOpen(false)}
        aria-hidden="true"
      />

      {/* Off-canvas Drawer */}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-white shadow-2xl flex flex-col lg:hidden",
          "transform transition-transform duration-300 ease-in-out border-r border-zinc-200",
          isMobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-light)] h-[var(--topbar-height)] px-4 shrink-0 bg-zinc-50/70">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--primary)] flex items-center justify-center shrink-0">
              <span className="text-white text-[0.625rem] font-bold leading-none">M</span>
            </div>
            <span className="text-[0.8125rem] font-bold text-zinc-900 truncate">
              Distroline Portal
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsMobileOpen(false)}
            aria-label="Close menu"
            className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {renderNavList(() => setIsMobileOpen(false))}
      </aside>
    </>
  );
}

