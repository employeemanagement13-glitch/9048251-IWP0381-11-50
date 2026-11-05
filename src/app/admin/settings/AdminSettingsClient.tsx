"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import {
  updateGlobalFlag,
  updateGlobalAlertSetting,
  setBanner,
  deactivateBanner,
} from "@/lib/actions/admin";
import { toggleGlobalManualMonth } from "@/lib/actions/manual-income-statement";
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
  initialFlags: any[];
  initialAlerts: any[];
  initialBanner: any;
}

export function AdminSettingsClient({ initialFlags, initialAlerts, initialBanner }: Props) {
  const router = useRouter();
  const supabase = useSupabase();
  const [isPending, startTransition] = useTransition();
  const [bannerText, setBannerText] = useState("");

  const [flagsMap, setFlagsMap] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const f of initialFlags || []) {
      map[f.flag_key] = f.enabled;
    }
    return map;
  });

  useEffect(() => {
    const map: Record<string, boolean> = {};
    for (const f of initialFlags || []) {
      map[f.flag_key] = f.enabled;
    }
    setFlagsMap(map);
  }, [initialFlags]);

  const [activeTab, setActiveTab] = useState<TabFlagItem | null>(null);
  const [activePage, setActivePage] = useState<PageFlagItem | null>(null);
  const [manualMonth, setManualMonth] = useState("September");
  const [manualYear, setManualYear] = useState("2026");

  const selectedMonthYear = `${manualMonth} ${manualYear}`;
  const isSelectedManualMonthEnabled =
    flagsMap[`manual_income_statement:${selectedMonthYear}`] ??
    (flagsMap["manual_income_statement"] &&
    initialFlags?.find((f) => f.flag_key === "manual_income_statement")?.label === selectedMonthYear
      ? flagsMap["manual_income_statement"]
      : false);

  const configuredManualMonths = (() => {
    const list: { month_year: string; enabled: boolean }[] = [];
    const seen = new Set<string>();
    for (const f of initialFlags || []) {
      if (f.flag_key === "manual_income_statement" && f.label) {
        if (!seen.has(f.label)) {
          seen.add(f.label);
          list.push({ month_year: f.label, enabled: flagsMap[f.flag_key] ?? f.enabled });
        }
      } else if (f.flag_key.startsWith("manual_income_statement:")) {
        const my = f.flag_key.replace("manual_income_statement:", "").trim();
        if (my && !seen.has(my)) {
          seen.add(my);
          list.push({ month_year: my, enabled: flagsMap[f.flag_key] ?? f.enabled });
        }
      }
    }
    return list;
  })();

  const handleToggleManualMonth = (targetMY: string, currentVal: boolean) => {
    startTransition(async () => {
      try {
        await toggleGlobalManualMonth(targetMY, !currentVal);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  useRealtimeTable("global_feature_flags", () => router.refresh());
  useRealtimeTable("global_alert_settings", () => router.refresh());

  const handleToggleFlag = (flagKey: string, currentVal: boolean, label?: string) => {
    const nextVal = !currentVal;
    setFlagsMap((prev) => ({ ...prev, [flagKey]: nextVal }));

    try {
      const bc = supabase.channel("broadcast_channel_global_feature_flags");
      bc.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          bc.send({
            type: "broadcast",
            event: "change",
            payload: { flag_key: flagKey, enabled: nextVal },
          });
        }
      });
    } catch (_) {}

    startTransition(async () => {
      try {
        await updateGlobalFlag(flagKey, nextVal, label);
        router.refresh();
      } catch (err: any) {
        setFlagsMap((prev) => ({ ...prev, [flagKey]: currentVal }));
        alert(err.message);
      }
    });
  };

  const handleToggleAlert = (alertType: string, currentVal: boolean) => {
    startTransition(async () => {
      try {
        await updateGlobalAlertSetting(alertType, !currentVal);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleActivateBanner = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bannerText.trim()) return;

    startTransition(async () => {
      try {
        await setBanner(bannerText.trim());
        setBannerText("");
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleDeactivateBanner = () => {
    startTransition(async () => {
      try {
        await deactivateBanner();
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const closeModal = () => {
    setActiveTab(null);
    setActivePage(null);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm p-6 space-y-4">
        <h3 className="text-md font-bold text-zinc-900">Section 1 — Global Tabs & Pages Control</h3>
        <p className="text-xs text-zinc-500">
          Toggle tabs globally. Disabling a tab here immediately hides and denies access to it for all distributors across the platform.
        </p>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>System Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {FEATURE_TABS_HIERARCHY.map((tab) => {
              const tabEnabled = flagsMap[tab.key] ?? true;
              return (
                <TableRow key={tab.key}>
                  <TableCell className="font-medium text-zinc-800">{tab.label}</TableCell>
                  <TableCell>
                    <Badge variant={tabEnabled ? "success" : "destructive"}>
                      {tabEnabled ? "Globally Enabled" : "Globally Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant={tabEnabled ? "outline" : "default"}
                        onClick={() => handleToggleFlag(tab.key, tabEnabled, tab.label)}
                        disabled={isPending}
                      >
                        {tabEnabled ? "Disable globally" : "Enable globally"}
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
                        <Eye className="w-3.5 h-3.5" />
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
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden border border-zinc-200">
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between bg-zinc-50">
              <div className="flex items-center gap-2">
                {activePage ? (
                  <button
                    onClick={() => setActivePage(null)}
                    className="p-1.5 hover:bg-zinc-200 rounded-md text-zinc-600 transition-colors mr-1 cursor-pointer"
                    title="Back to Pages"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                ) : null}
                <div>
                  <h3 className="text-base font-bold text-zinc-900">
                    {activePage ? `Reports in ${activePage.label}` : `Pages in ${activeTab.label}`}
                  </h3>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500 mt-0.5">
                    <span>Global Tabs</span>
                    <span>/</span>
                    <span
                      className={activePage ? "cursor-pointer hover:underline text-zinc-700" : "font-semibold text-zinc-800"}
                      onClick={() => activePage && setActivePage(null)}
                    >
                      {activeTab.label}
                    </span>
                    {activePage ? (
                      <>
                        <span>/</span>
                        <span className="font-semibold text-zinc-800">{activePage.label}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
              <button
                onClick={closeModal}
                className="p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200 rounded-md transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {!activePage ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Flag Key</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>System Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeTab.pages.map((page) => {
                      const pageEnabled = flagsMap[page.key] ?? true;
                      const hasSubReports =
                        page.path === "/inventory/stock-reports" ||
                        page.path === "/reports/financial";
                      return (
                        <TableRow key={page.key}>
                          <TableCell className="font-mono text-xs text-zinc-600">{page.key}</TableCell>
                          <TableCell className="font-medium text-zinc-800">{page.label}</TableCell>
                          <TableCell>
                            <Badge variant={pageEnabled ? "success" : "destructive"}>
                              {pageEnabled ? "Globally Enabled" : "Globally Disabled"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant={pageEnabled ? "outline" : "default"}
                                onClick={() => handleToggleFlag(page.key, pageEnabled, page.label)}
                                disabled={isPending}
                              >
                                {pageEnabled ? "Disable globally" : "Enable globally"}
                              </Button>
                              {hasSubReports && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setActivePage(page)}
                                  className="flex items-center gap-1.5"
                                >
                                  <Eye className="w-3.5 h-3.5" />
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
                      <TableHead>System Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(activePage.reports || []).map((report) => {
                      const reportEnabled = flagsMap[report.key] ?? true;
                      return (
                        <TableRow key={report.key}>
                          <TableCell className="font-mono text-xs text-zinc-600">{report.key}</TableCell>
                          <TableCell className="font-medium text-zinc-800">{report.label}</TableCell>
                          <TableCell>
                            <Badge variant={reportEnabled ? "success" : "destructive"}>
                              {reportEnabled ? "Globally Enabled" : "Globally Disabled"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant={reportEnabled ? "outline" : "default"}
                              onClick={() => handleToggleFlag(report.key, reportEnabled, report.label)}
                              disabled={isPending}
                            >
                              {reportEnabled ? "Disable globally" : "Enable globally"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>

            <div className="px-6 py-3 border-t border-zinc-200 bg-zinc-50 flex justify-end">
              <Button size="sm" variant="outline" onClick={closeModal}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm p-6 space-y-4">
        <h3 className="text-md font-bold text-zinc-900">Section 2 — Global Alert settings</h3>
        <p className="text-xs text-zinc-500">
          Control platform-wide background worker alert evaluations.
        </p>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Alert Type</TableHead>
              <TableHead>System Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialAlerts.map((item) => (
              <TableRow key={item.alert_type}>
                <TableCell className="font-medium text-zinc-800 capitalize">
                  {item.alert_type.replace(/_/g, " ")}
                </TableCell>
                <TableCell>
                  <Badge variant={item.enabled ? "success" : "destructive"}>
                    {item.enabled ? "Globally Enabled" : "Globally Disabled"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant={item.enabled ? "outline" : "default"}
                    onClick={() => handleToggleAlert(item.alert_type, item.enabled)}
                    disabled={isPending}
                  >
                    {item.enabled ? "Disable globally" : "Enable globally"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-md font-bold text-zinc-900">Section 3 — Manual Income Statement Permission</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Enable manual template-based income statement globally for distributors across specific months.
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
            <Button
              size="sm"
              variant={isSelectedManualMonthEnabled ? "outline" : "default"}
              onClick={() => handleToggleManualMonth(selectedMonthYear, isSelectedManualMonthEnabled)}
              disabled={isPending}
            >
              {isSelectedManualMonthEnabled ? `Disable (${selectedMonthYear})` : `Enable (${selectedMonthYear})`}
            </Button>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month & Year</TableHead>
              <TableHead>System Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-semibold text-zinc-900">
                {selectedMonthYear}
              </TableCell>
              <TableCell>
                <Badge variant={isSelectedManualMonthEnabled ? "success" : "destructive"}>
                  {isSelectedManualMonthEnabled ? "Globally Enabled" : "Globally Disabled"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant={isSelectedManualMonthEnabled ? "outline" : "default"}
                  onClick={() => handleToggleManualMonth(selectedMonthYear, isSelectedManualMonthEnabled)}
                  disabled={isPending}
                >
                  {isSelectedManualMonthEnabled ? "Disable globally" : "Enable globally"}
                </Button>
              </TableCell>
            </TableRow>
            {configuredManualMonths
              .filter((item) => item.month_year !== selectedMonthYear)
              .map((item) => (
                <TableRow key={item.month_year}>
                  <TableCell className="font-medium text-zinc-800">{item.month_year}</TableCell>
                  <TableCell>
                    <Badge variant={item.enabled ? "success" : "destructive"}>
                      {item.enabled ? "Globally Enabled" : "Globally Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant={item.enabled ? "outline" : "default"}
                      onClick={() => handleToggleManualMonth(item.month_year, item.enabled)}
                      disabled={isPending}
                    >
                      {item.enabled ? "Disable globally" : "Enable globally"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm p-6 space-y-4">
        <h3 className="text-md font-bold text-zinc-900">Emergency Banner Composer</h3>
        <p className="text-xs text-zinc-500">
          Broadcast a platform-wide system notification banner instantly visible to all active distributors.
        </p>

        {initialBanner ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex justify-between items-center">
            <div>
              <span className="text-xs font-semibold text-yellow-800 uppercase tracking-wide">
                Active System Announcement
              </span>
              <p className="text-sm font-medium text-yellow-900 mt-1">{initialBanner.message}</p>
            </div>
            <Button variant="danger" size="sm" onClick={handleDeactivateBanner} disabled={isPending}>
              Deactivate Banner
            </Button>
          </div>
        ) : (
          <form onSubmit={handleActivateBanner} className="space-y-3 max-w-lg">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Banner Message</label>
              <Input
                placeholder="e.g. Schedule Maintenance at 10 PM. Please save all work."
                value={bannerText}
                onChange={(e) => setBannerText(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Activating..." : "Activate Emergency Banner"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
