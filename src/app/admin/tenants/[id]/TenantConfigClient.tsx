"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { updateTenantFlag } from "@/lib/actions/admin";
import { toggleTenantManualMonth } from "@/lib/actions/manual-income-statement";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import {
  FEATURE_TABS_HIERARCHY,
  TabFlagItem,
  PageFlagItem,
} from "@/config/featureFlagsHierarchy";
import { Eye, X, ArrowLeft } from "lucide-react";
import { useSupabase } from "@/lib/supabase/client";

const ALL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const ALL_YEARS = Array.from({ length: 81 }, (_, i) => String(1980 + i));

interface Props {
  tenantId: string;
  initialConfig: any;
  tenant: any;
  globalAlerts: any[];
  tenantAlerts: any;
}

function parseMaps(config: any) {
  if (config && typeof config === "object" && !Array.isArray(config) && config.globalMap) {
    return {
      globalMap: config.globalMap as Record<string, boolean>,
      tenantMap: config.tenantMap as Record<string, boolean>,
    };
  }
  const gMap: Record<string, boolean> = {};
  const tMap: Record<string, boolean> = {};
  if (Array.isArray(config)) {
    for (const item of config) {
      if (item.flag_key) {
        gMap[item.flag_key] = item.global_enabled ?? true;
        tMap[item.flag_key] = item.tenant_enabled ?? true;
      }
    }
  }
  return { globalMap: gMap, tenantMap: tMap };
}

export function TenantConfigClient({
  tenantId,
  initialConfig,
  tenant,
  globalAlerts,
  tenantAlerts,
}: Props) {
  const router = useRouter();
  const supabase = useSupabase();
  const [isPending, startTransition] = useTransition();

  const [flagsMaps, setFlagsMaps] = useState(() => parseMaps(initialConfig));
  const [activeTab, setActiveTab] = useState<TabFlagItem | null>(null);
  const [activePage, setActivePage] = useState<PageFlagItem | null>(null);
  const [manualMonth, setManualMonth] = useState("September");
  const [manualYear, setManualYear] = useState("2026");

  const selectedMonthYear = `${manualMonth} ${manualYear}`;
  const selectedFlagKey = `manual_income_statement:${selectedMonthYear}`;
  const isGlobalManualEnabled = flagsMaps.globalMap[selectedFlagKey] ?? (flagsMaps.globalMap["manual_income_statement"] ?? false);
  const tenantManualOverride = flagsMaps.tenantMap[selectedFlagKey];
  const effectiveTenantManualEnabled = tenantManualOverride !== undefined ? tenantManualOverride : isGlobalManualEnabled;

  const handleUpdateTenantManual = (targetMY: string, enabledVal: boolean | null) => {
    startTransition(async () => {
      try {
        await toggleTenantManualMonth(tenantId, targetMY, enabledVal);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const configuredTenantManualMonths = (() => {
    const list: { month_year: string; global_enabled: boolean; tenant_enabled: boolean | null }[] = [];
    const seen = new Set<string>();

    for (const key of Object.keys({ ...flagsMaps.globalMap, ...flagsMaps.tenantMap })) {
      if (key.startsWith("manual_income_statement:")) {
        const my = key.replace("manual_income_statement:", "").trim();
        if (my && !seen.has(my)) {
          seen.add(my);
          list.push({
            month_year: my,
            global_enabled: flagsMaps.globalMap[key] ?? false,
            tenant_enabled: flagsMaps.tenantMap[key] !== undefined ? flagsMaps.tenantMap[key] : null,
          });
        }
      }
    }
    return list;
  })();

  useEffect(() => {
    setFlagsMaps(parseMaps(initialConfig));
  }, [initialConfig]);

  useRealtimeTable("global_feature_flags", () => router.refresh());
  useRealtimeTable("tenant_feature_flags", () => router.refresh(), {
    filter: `tenant_id=eq.${tenantId}`,
  });

  const isGlobalEnabled = (flagKey: string) => flagsMaps.globalMap[flagKey] ?? true;
  const isTenantEnabled = (flagKey: string) => flagsMaps.tenantMap[flagKey] ?? true;

  const handleToggleFlag = (flagKey: string, currentVal: boolean) => {
    const nextVal = !currentVal;
    setFlagsMaps((prev) => ({
      ...prev,
      tenantMap: { ...prev.tenantMap, [flagKey]: nextVal },
    }));

    try {
      const bc = supabase.channel("broadcast_channel_tenant_feature_flags");
      bc.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          bc.send({
            type: "broadcast",
            event: "change",
            payload: { tenant_id: tenantId, flag_key: flagKey, enabled: nextVal },
          });
        }
      });
    } catch (_) {}

    startTransition(async () => {
      try {
        await updateTenantFlag(tenantId, flagKey, nextVal);
        router.refresh();
      } catch (err: any) {
        setFlagsMaps((prev) => ({
          ...prev,
          tenantMap: { ...prev.tenantMap, [flagKey]: currentVal },
        }));
        alert(err.message);
      }
    });
  };

  const getGlobalAlertStatus = (type: string) => {
    const matched = globalAlerts.find((ga) => ga.alert_type === type);
    return matched ? matched.enabled : true;
  };

  const closeModal = () => {
    setActiveTab(null);
    setActivePage(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-zinc-50 p-4 rounded-lg border border-zinc-200">
        <div>
          <span className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">
            Distributor Details
          </span>
          <h2 className="text-lg font-bold text-zinc-900 mt-0.5">{tenant.distro_name}</h2>
          <p className="text-sm text-zinc-600 mt-1">
            Email: {tenant.email} | Phone: {tenant.phone_number}
          </p>
        </div>
        <Link href="/admin/dashboard">
          <Button variant="outline">&larr; Back to Dashboard</Button>
        </Link>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm p-6 space-y-4">
        <h3 className="text-md font-bold text-zinc-900">Tabs & Pages Permissions Matrix</h3>
        <p className="text-xs text-zinc-500">
          Control which tabs, pages, and reports this specific distributor can view. Note that if an item is disabled globally in Settings, it will be unavailable regardless of individual tenant settings.
        </p>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Global Status</TableHead>
              <TableHead>Distributor Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {FEATURE_TABS_HIERARCHY.map((tab) => {
              const globalActive = isGlobalEnabled(tab.key);
              const tenantActive = isTenantEnabled(tab.key);
              return (
                <TableRow key={tab.key}>
                  <TableCell className="font-medium text-zinc-800">{tab.label}</TableCell>
                  <TableCell>
                    <Badge variant={globalActive ? "success" : "destructive"}>
                      {globalActive ? "Active" : "Globally Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={tenantActive ? "success" : "destructive"}>
                      {tenantActive ? "Enabled" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant={tenantActive ? "outline" : "default"}
                        onClick={() => handleToggleFlag(tab.key, tenantActive)}
                        disabled={isPending}
                      >
                        {tenantActive ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setActiveTab(tab);
                          setActivePage(null);
                        }}
                        className="flex items-center gap-1.5"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {activeTab && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl border border-zinc-200 w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 bg-zinc-50/70">
              <div className="flex items-center gap-3">
                {activePage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setActivePage(null)}
                    className="h-8 px-2 text-zinc-600 hover:text-zinc-900"
                  >
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Back
                  </Button>
                )}
                <div>
                  <h3 className="text-base font-bold text-zinc-900">
                    {activePage ? `${activePage.label} Reports` : `${activeTab.label} Pages`}
                  </h3>
                  <p className="text-xs text-zinc-500">
                    {activePage
                      ? `Enable / disable specific reports for ${tenant.distro_name}`
                      : `Enable / disable specific pages for ${tenant.distro_name}`}
                  </p>
                </div>
              </div>
              <button
                onClick={closeModal}
                className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-6 flex-1">
              {!activePage ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Flag Key</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Global Status</TableHead>
                      <TableHead>Distributor Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeTab.pages.map((page) => {
                      const pageGlobalActive = isGlobalEnabled(page.key);
                      const pageTenantActive = isTenantEnabled(page.key);
                      const hasReports =
                        (page.path === "/inventory/stock-reports" ||
                          page.path === "/reports/financial") &&
                        Boolean(page.reports && page.reports.length > 0);

                      return (
                        <TableRow key={page.key}>
                          <TableCell className="font-mono text-xs text-zinc-500">
                            {page.key}
                          </TableCell>
                          <TableCell className="font-medium text-zinc-800">
                            <div>
                              <span>{page.label}</span>
                              <span className="block font-mono text-[0.6875rem] text-zinc-400">
                                {page.path}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={pageGlobalActive ? "success" : "destructive"}>
                              {pageGlobalActive ? "Active" : "Globally Disabled"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={pageTenantActive ? "success" : "destructive"}>
                              {pageTenantActive ? "Enabled" : "Disabled"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant={pageTenantActive ? "outline" : "default"}
                                onClick={() => handleToggleFlag(page.key, pageTenantActive)}
                                disabled={isPending}
                              >
                                {pageTenantActive ? "Disable" : "Enable"}
                              </Button>
                              {hasReports && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setActivePage(page)}
                                  className="flex items-center gap-1.5"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  View
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Flag Key</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Global Status</TableHead>
                      <TableHead>Distributor Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activePage.reports?.map((report) => {
                      const reportGlobalActive = isGlobalEnabled(report.key);
                      const reportTenantActive = isTenantEnabled(report.key);

                      return (
                        <TableRow key={report.key}>
                          <TableCell className="font-mono text-xs text-zinc-500">
                            {report.key}
                          </TableCell>
                          <TableCell className="font-medium text-zinc-800">
                            {report.label}
                          </TableCell>
                          <TableCell>
                            <Badge variant={reportGlobalActive ? "success" : "destructive"}>
                              {reportGlobalActive ? "Active" : "Globally Disabled"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={reportTenantActive ? "success" : "destructive"}>
                              {reportTenantActive ? "Enabled" : "Disabled"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant={reportTenantActive ? "outline" : "default"}
                              onClick={() => handleToggleFlag(report.key, reportTenantActive)}
                              disabled={isPending}
                            >
                              {reportTenantActive ? "Disable" : "Enable"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>

            <div className="flex justify-end px-6 py-3 border-t border-zinc-200 bg-zinc-50">
              <Button variant="outline" size="sm" onClick={closeModal}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm p-6 space-y-4">
        <h3 className="text-md font-bold text-zinc-900">Alert Settings Monitor (Read-Only Mirror)</h3>
        <p className="text-xs text-zinc-500">
          Current alert rule configurations as configured by the distributor in their settings page.
        </p>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Alert Type</TableHead>
              <TableHead>Global System Status</TableHead>
              <TableHead>Distributor Status</TableHead>
              <TableHead>Configured Threshold</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">Cash Not Deposited</TableCell>
              <TableCell>
                <Badge variant={getGlobalAlertStatus("cash_not_deposited") ? "success" : "destructive"}>
                  {getGlobalAlertStatus("cash_not_deposited") ? "Active" : "Globally Disabled"}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={tenantAlerts.cash_not_deposited_enabled ? "success" : "destructive"}>
                  {tenantAlerts.cash_not_deposited_enabled ? "Enabled" : "Disabled"}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-zinc-700">
                {tenantAlerts.cash_not_deposited_hours} hours
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Overdue Threshold</TableCell>
              <TableCell>
                <Badge variant={getGlobalAlertStatus("overdue_threshold") ? "success" : "destructive"}>
                  {getGlobalAlertStatus("overdue_threshold") ? "Active" : "Globally Disabled"}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={tenantAlerts.overdue_threshold_enabled ? "success" : "destructive"}>
                  {tenantAlerts.overdue_threshold_enabled ? "Enabled" : "Disabled"}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-zinc-700">
                {tenantAlerts.overdue_threshold_days} days
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-md font-bold text-zinc-900">Manual Income Statement Permission</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Enable manual template-based income statement specifically for {tenant.distro_name}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={manualMonth}
              onChange={(e) => setManualMonth(e.target.value)}
              className="h-9 px-3 py-1 text-sm border border-zinc-200 rounded-md bg-white text-zinc-800 font-medium focus:outline-none focus:ring-1 focus:ring-zinc-400"
            >
              {ALL_MONTHS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <select
              value={manualYear}
              onChange={(e) => setManualYear(e.target.value)}
              className="h-9 px-3 py-1 text-sm border border-zinc-200 rounded-md bg-white text-zinc-800 font-medium focus:outline-none focus:ring-1 focus:ring-zinc-400"
            >
              {ALL_YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant={effectiveTenantManualEnabled ? "outline" : "default"}
                onClick={() => handleUpdateTenantManual(selectedMonthYear, !effectiveTenantManualEnabled)}
                disabled={isPending}
              >
                {effectiveTenantManualEnabled ? "Disable for Distributor" : "Enable for Distributor"}
              </Button>
              {tenantManualOverride !== undefined && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleUpdateTenantManual(selectedMonthYear, null)}
                  disabled={isPending}
                  className="text-xs"
                >
                  Reset to Global
                </Button>
              )}
            </div>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month & Year</TableHead>
              <TableHead>Global Status</TableHead>
              <TableHead>Distributor Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-semibold text-zinc-900">{selectedMonthYear}</TableCell>
              <TableCell>
                <Badge variant={isGlobalManualEnabled ? "success" : "destructive"}>
                  {isGlobalManualEnabled ? "Globally Enabled" : "Globally Disabled"}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={effectiveTenantManualEnabled ? "success" : "destructive"}>
                  {tenantManualOverride === undefined
                    ? `Inherited (${effectiveTenantManualEnabled ? "Enabled" : "Disabled"})`
                    : tenantManualOverride
                    ? "Enabled"
                    : "Disabled"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <Button
                    size="sm"
                    variant={effectiveTenantManualEnabled ? "outline" : "default"}
                    onClick={() => handleUpdateTenantManual(selectedMonthYear, !effectiveTenantManualEnabled)}
                    disabled={isPending}
                  >
                    {effectiveTenantManualEnabled ? "Disable" : "Enable"}
                  </Button>
                  {tenantManualOverride !== undefined && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleUpdateTenantManual(selectedMonthYear, null)}
                      disabled={isPending}
                      className="text-xs"
                    >
                      Reset
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
            {configuredTenantManualMonths
              .filter((item) => item.month_year !== selectedMonthYear)
              .map((item) => {
                const effective = item.tenant_enabled !== null ? item.tenant_enabled : item.global_enabled;
                return (
                  <TableRow key={item.month_year}>
                    <TableCell className="font-medium text-zinc-800">{item.month_year}</TableCell>
                    <TableCell>
                      <Badge variant={item.global_enabled ? "success" : "destructive"}>
                        {item.global_enabled ? "Globally Enabled" : "Globally Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={effective ? "success" : "destructive"}>
                        {item.tenant_enabled === null
                          ? `Inherited (${effective ? "Enabled" : "Disabled"})`
                          : item.tenant_enabled
                          ? "Enabled"
                          : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant={effective ? "outline" : "default"}
                          onClick={() => handleUpdateTenantManual(item.month_year, !effective)}
                          disabled={isPending}
                        >
                          {effective ? "Disable" : "Enable"}
                        </Button>
                        {item.tenant_enabled !== null && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleUpdateTenantManual(item.month_year, null)}
                            disabled={isPending}
                            className="text-xs"
                          >
                            Reset
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
