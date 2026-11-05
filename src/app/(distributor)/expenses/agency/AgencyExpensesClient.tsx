"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Trash2, Loader2, Search, ChevronDown, Check, Plus, Edit2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { ExportButtons } from "@/components/export/ExportButtons";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/Table";
import {
  createFuelEntry, updateFuelEntry, deleteFuelEntry, getLastFuelReading, getFuelEntries,
} from "@/lib/actions/fuel";
import {
  createBill, updateBill, deleteBill, deleteBills, getBills,
  createEntertainment, updateEntertainment, deleteEntertainment, deleteEntertainments, getEntertainment,
  createPetty, updatePetty, deletePetty, deletePetties, getPetty,
  createPenalty, updatePenalty, deletePenalty, deleteAgencyPenalties, getPenalties,
} from "@/lib/actions/expenses";
import { getMaintenanceEntries } from "@/lib/actions/maintenance";
import { getSalaryHeadView } from "@/lib/actions/payroll";
import {
  recordLaborerExpense, updateLaborerExpense, deleteLaborerExpense, getLaborerExpenses, getLaborers,
} from "@/lib/actions/laborers";

interface Employee { id: string; full_name: string; role: string; }
interface DmRoute  { id: string; truck_no: string; route_name: string; dm_name?: string; personnel?: string; dm?: { full_name: string }; }

interface Props {
  employees:          Employee[];
  dmRoutes:           DmRoute[];
  loaders?:           any[];
  salaryRows:         any[];
  fuelEntries:        any[];
  maintenanceEntries?: any[];
  billsRows:          any[];
  entertainmentRows:  any[];
  pettyRows:          any[];
  penaltiesRows:      any[];
  bankAccounts:       any[];
  vendorAccounts:     any[];
  laborers?:          any[];
  laborerExpenses?:   any[];
}

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const CURRENT_YEAR  = new Date().getFullYear();
const YEARS         = Array.from({ length: 5 }, (_, i) => String(CURRENT_YEAR - i));
const CURRENT_MONTH = MONTHS[new Date().getMonth()];

const TODAY = new Date().toISOString().split("T")[0];
const FIRST_DAY_OF_MONTH = `${TODAY.substring(0, 8)}01`;

function getExpenseRowDate(r: any): string {
  if (r.expense_date) return String(r.expense_date).slice(0, 10);
  if (r.date) return String(r.date).slice(0, 10);
  if (r.salary_month) return String(r.salary_month).slice(0, 10);
  if (r.month && r.year) {
    const mIdx = MONTHS.findIndex((m) => m.toLowerCase() === r.month?.trim().toLowerCase());
    const mStr = mIdx >= 0 ? String(mIdx + 1).padStart(2, "0") : "01";
    return `${r.year}-${mStr}-01`;
  }
  return "";
}

function DateRangeFilter({
  fromDate,
  toDate,
  onFromDate,
  onToDate,
  onLoad,
  loading,
}: {
  fromDate: string;
  toDate: string;
  onFromDate: (d: string) => void;
  onToDate: (d: string) => void;
  onLoad?: () => void;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-semibold text-zinc-600">From</label>
        <Input
          type="date"
          value={fromDate}
          onChange={(e) => onFromDate(e.target.value)}
          className="h-8 text-sm w-36"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-semibold text-zinc-600">To</label>
        <Input
          type="date"
          value={toDate}
          onChange={(e) => onToDate(e.target.value)}
          className="h-8 text-sm w-36"
        />
      </div>
      {onLoad && (
        <Button
          type="button"
          size="sm"
          onClick={onLoad}
          disabled={loading}
          className="h-8 px-3 text-xs font-semibold flex items-center gap-1.5"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span>{loading ? "Loading..." : "Load"}</span>
        </Button>
      )}
    </div>
  );
}

type HeadKey = "Salary" | "Fuel" | "Maintenance" | "Bills" | "Entertainment" | "Petty" | "Penalties" | "Laborers";

export function AgencyExpensesClient({
  employees, dmRoutes, loaders = [], salaryRows, fuelEntries, maintenanceEntries = [],
  billsRows, entertainmentRows, pettyRows, penaltiesRows, bankAccounts, vendorAccounts = [],
  laborers = [], laborerExpenses = [],
}: Props) {
  const searchParams = useSearchParams();
  const paramHead = searchParams.get("head") as HeadKey | null;
  const heads: HeadKey[] = ["Salary","Fuel","Maintenance","Bills","Entertainment","Petty","Penalties","Laborers"];
  const [activeHead, setActiveHead] = useState<HeadKey>(
    paramHead && heads.includes(paramHead) ? paramHead : "Salary"
  );

  useEffect(() => {
    if (paramHead && heads.includes(paramHead)) {
      setActiveHead(paramHead);
    }
  }, [paramHead]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Agency Expenses</h1>
        <p className="text-zinc-500 mt-1 text-sm">Track all agency running costs across expense categories.</p>
      </div>

      <div className="flex gap-1 bg-zinc-100 rounded-lg p-1 flex-wrap">
        {heads.map((h) => (
          <button key={h} onClick={() => setActiveHead(h)}
            className={[
              "px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-150",
              activeHead === h
                ? "bg-white shadow-sm font-semibold"
                : "text-zinc-600 hover:text-zinc-900 hover:bg-white/60",
            ].join(" ")}
            style={activeHead === h ? { color: "var(--primary)" } : {}}
          >
            {h}
          </button>
        ))}
      </div>

      {activeHead === "Salary"        && <SalaryHead rows={salaryRows} />}
      {activeHead === "Fuel"          && <FuelHead initialEntries={fuelEntries} dmRoutes={dmRoutes} loaders={loaders} />}
      {activeHead === "Maintenance"   && <MaintenanceHead initialEntries={maintenanceEntries} dmRoutes={dmRoutes} loaders={loaders} bankAccounts={bankAccounts} />}
      {activeHead === "Bills"         && <BillsHead rows={billsRows} bankAccounts={bankAccounts} />}
      {activeHead === "Entertainment" && <EntertainmentHead rows={entertainmentRows} bankAccounts={bankAccounts} />}
      {activeHead === "Petty"         && <PettyHead rows={pettyRows} bankAccounts={bankAccounts} />}
      {activeHead === "Penalties"     && <PenaltiesHead rows={penaltiesRows} bankAccounts={bankAccounts} vendorAccounts={vendorAccounts} />}
      {activeHead === "Laborers"      && <LaborersHead laborers={laborers} initialExpenses={laborerExpenses} bankAccounts={bankAccounts} />}
    </div>
  );
}

function SalaryHead({ rows }: { rows: any[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [salaryRows, setSalaryRows] = useState(rows);
  const [isLoading, setIsLoading] = useState(false);
  const [fromDate, setFromDate] = useState(FIRST_DAY_OF_MONTH);
  const [toDate, setToDate]     = useState(TODAY);
  const [appliedFrom, setAppliedFrom] = useState(FIRST_DAY_OF_MONTH);
  const [appliedTo, setAppliedTo]     = useState(TODAY);

  useEffect(() => {
    setSalaryRows(rows);
  }, [rows]);

  const handleLoad = async () => {
    setIsLoading(true);
    try {
      const fresh = await getSalaryHeadView({ dateFrom: fromDate, dateTo: toDate });
      setSalaryRows(fresh);
      setAppliedFrom(fromDate);
      setAppliedTo(toDate);
    } finally {
      setIsLoading(false);
    }
  };

  const filtered = salaryRows.filter((r) => {
    const d = getExpenseRowDate(r);
    if (!d) return true;
    return d >= appliedFrom && d <= appliedTo;
  });

  const exportData = filtered.map((r) => ({
    "Emp Code": r.employee_code || "",
    Name: r.name || r.employee_name || r.full_name || "",
    Role: r.role || "",
    Month: r.month,
    Year: r.year,
    "Net Payable (Rs.)": r.net_payable,
    Source: "Payroll Run — auto",
  }));

  const total = filtered.reduce((s, r) => s + (Number(r.net_payable) || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 items-center flex-wrap">
          <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromDate={setFromDate} onToDate={setToDate} onLoad={handleLoad} loading={isLoading} />
          <ExportButtons data={exportData} filename="salary_expenses" />
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
          <span>🔒</span>
          <span>Auto-populated from Payroll Runs — not manually editable</span>
        </div>
      </div>

      {filtered.length > 0 && (
        <div className="bg-white rounded-lg border border-zinc-200 p-4 flex justify-between items-center">
          <p className="text-sm text-zinc-500">Total Net Payable ({appliedFrom} to {appliedTo})</p>
          <p className="text-xl font-bold" style={{ color: "var(--primary)" }}>
            Rs. {total.toLocaleString()}
          </p>
        </div>
      )}

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Month</TableHead>
              <TableHead>Year</TableHead>
              <TableHead className="text-right">Net Payable (Rs.)</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <EmptyRow colSpan={7} label="No payroll runs for this period — run Payroll in Employee Management" />
            ) : (
              filtered.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{r.employee_code || "—"}</TableCell>
                  <TableCell className="font-medium">{r.name || r.employee_name || r.full_name || "—"}</TableCell>
                  <TableCell><RoleBadge role={r.role || ""} /></TableCell>
                  <TableCell>{r.month}</TableCell>
                  <TableCell>{r.year}</TableCell>
                  <TableCell className="text-right font-mono font-semibold" style={{ color: "var(--primary)" }}>
                    {fmt(r.net_payable)}
                  </TableCell>
                  <TableCell className="text-xs text-zinc-400">Payroll Run — auto</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}

const BLANK_FUEL = {
  truck_no: "", driver_name: "",
  entry_date: new Date().toISOString().split("T")[0],
  initial_reading: "", final_reading: "",
  fuel_liters: "", amount: "",
};

function FuelHead({ initialEntries, dmRoutes, loaders = [] }: { initialEntries: any[]; dmRoutes: any[]; loaders?: any[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [vehicleTab, setVehicleTab] = useState<"delivery" | "loader">("delivery");
  const [viewLoadingKey, setViewLoadingKey] = useState<string | null>(null);
  const [entries, setEntries] = useState(initialEntries);
  const [isLoading, setIsLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(FIRST_DAY_OF_MONTH);
  const [dateTo, setDateTo]     = useState(TODAY);
  const [appliedFrom, setAppliedFrom] = useState(FIRST_DAY_OF_MONTH);
  const [appliedTo, setAppliedTo] = useState(TODAY);

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  const handleLoad = async () => {
    setIsLoading(true);
    try {
      const fresh = await getFuelEntries({ dateFrom, dateTo });
      setEntries(fresh);
      setAppliedFrom(dateFrom);
      setAppliedTo(dateTo);
    } finally {
      setIsLoading(false);
    }
  };

  const filtered = entries.filter((e) => {
    if (appliedFrom && e.entry_date < appliedFrom) return false;
    if (appliedTo   && e.entry_date > appliedTo)   return false;
    return true;
  });

  const fromLabel  = appliedFrom || "All";
  const toLabel    = appliedTo   || "All";

  // 1. Delivery Vehicles aggregation
  const trucksMap = new Map<string, {
    truck_no: string;
    driver_name: string;
    totalDistance: number;
    totalFuel: number;
    totalAmount: number;
    minInitial: number | null;
    maxFinal: number | null;
  }>();

  dmRoutes.forEach((r) => {
    if (r.truck_no && !trucksMap.has(r.truck_no)) {
      const driver = r.dm?.full_name || r.dm_name || r.personnel || "";
      trucksMap.set(r.truck_no, {
        truck_no: r.truck_no,
        driver_name: driver,
        totalDistance: 0, totalFuel: 0, totalAmount: 0,
        minInitial: null, maxFinal: null,
      });
    }
  });

  // Loader number set for partition
  const loaderNumberSet = new Set(loaders.map((l) => l.number).filter(Boolean));

  filtered.forEach((e) => {
    if (e.vehicle_type === "loader" || loaderNumberSet.has(e.truck_no)) return;
    if (!trucksMap.has(e.truck_no)) {
      trucksMap.set(e.truck_no, {
        truck_no: e.truck_no,
        driver_name: e.driver_name || "",
        totalDistance: 0, totalFuel: 0, totalAmount: 0,
        minInitial: null, maxFinal: null,
      });
    }
    const t = trucksMap.get(e.truck_no)!;
    const init = Number(e.initial_reading) || 0;
    const fin  = Number(e.final_reading)   || 0;
    t.totalDistance += Math.max(0, fin - init);
    t.totalFuel     += Number(e.fuel_liters) || 0;
    t.totalAmount   += Number(e.amount)      || 0;
    if (t.minInitial === null || init < t.minInitial) t.minInitial = init;
    if (t.maxFinal   === null || fin  > t.maxFinal)   t.maxFinal   = fin;
    if (!t.driver_name && e.driver_name) t.driver_name = e.driver_name;
  });

  const trucks = Array.from(trucksMap.values());
  const deliveryGrandTotal = trucks.reduce((s, t) => s + t.totalAmount, 0);

  const deliveryExportData = trucks.map((t) => ({
    "Truck No":       t.truck_no,
    Driver:           t.driver_name || "",
    "From":           fromLabel,
    "To":             toLabel,
    "Initial (km)":   t.minInitial ?? "",
    "Final (km)":     t.maxFinal   ?? "",
    "Distance (km)":  t.totalDistance.toFixed(1),
    "Fuel (L)":       t.totalFuel.toFixed(2),
    "Amount (Rs.)":   t.totalAmount.toFixed(2),
    "km/L":           t.totalFuel > 0 ? (t.totalDistance / t.totalFuel).toFixed(2) : "",
  }));

  const handleViewTruck = (truckNo: string, driverName?: string) => {
    setViewLoadingKey(`truck_${truckNo}`);
    const params = new URLSearchParams();
    if (appliedFrom) params.set("from", appliedFrom);
    if (appliedTo)   params.set("to",   appliedTo);
    if (driverName) params.set("name", driverName);
    router.push(`/expenses/agency/fuel/${encodeURIComponent(truckNo)}${params.toString() ? "?" + params.toString() : ""}`);
  };

  // 2. Load Vehicles aggregation
  const loadersMap = new Map<string, {
    loader_no: string;
    loader_name: string;
    totalFuel: number;
    totalAmount: number;
  }>();

  loaders.forEach((l) => {
    if (l.number && !loadersMap.has(l.number)) {
      loadersMap.set(l.number, {
        loader_no: l.number,
        loader_name: l.loader_name || l.loader?.full_name || "",
        totalFuel: 0,
        totalAmount: 0,
      });
    }
  });

  filtered.forEach((e) => {
    if (e.vehicle_type === "loader" || loaderNumberSet.has(e.truck_no)) {
      if (!loadersMap.has(e.truck_no)) {
        loadersMap.set(e.truck_no, {
          loader_no: e.truck_no,
          loader_name: e.driver_name || "",
          totalFuel: 0,
          totalAmount: 0,
        });
      }
      const l = loadersMap.get(e.truck_no)!;
      l.totalFuel   += Number(e.fuel_liters) || 0;
      l.totalAmount += Number(e.amount)      || 0;
      if (!l.loader_name && e.driver_name) l.loader_name = e.driver_name;
    }
  });

  const loadVehicles = Array.from(loadersMap.values());
  const loaderGrandTotal = loadVehicles.reduce((s, l) => s + l.totalAmount, 0);

  const loaderExportData = loadVehicles.map((l) => ({
    "Loader No":    l.loader_no,
    "Loader":       l.loader_name || "",
    "From":         fromLabel,
    "To":           toLabel,
    "Fuel (L)":     l.totalFuel.toFixed(2),
    "Amount (Rs.)": l.totalAmount.toFixed(2),
  }));

  const handleViewLoader = (loaderNo: string, loaderName: string) => {
    setViewLoadingKey(`loader_${loaderNo}`);
    const params = new URLSearchParams();
    if (appliedFrom) params.set("from", appliedFrom);
    if (appliedTo)   params.set("to",   appliedTo);
    params.set("type", "loader");
    if (loaderName) params.set("name", loaderName);
    router.push(`/expenses/agency/fuel/${encodeURIComponent(loaderNo)}${params.toString() ? "?" + params.toString() : ""}`);
  };

  return (
    <div className="space-y-4">
      {/* 2 Switch Tabs */}
      <div
        className="inline-flex rounded-full p-[0.1875rem] gap-[0.125rem]"
        style={{ background: "var(--surface-hover, #f4f4f5)" }}
      >
        <button
          type="button"
          onClick={() => setVehicleTab("delivery")}
          className="px-4 py-1.5 text-xs font-semibold rounded-full transition-all duration-200"
          style={
            vehicleTab === "delivery"
              ? { background: "var(--primary)", color: "#fff", boxShadow: "0 1px 0.25rem rgba(229,30,42,0.25)" }
              : { color: "var(--text-secondary, #6b7280)", background: "transparent" }
          }
        >
          1: Sale Vehicles
        </button>
        <button
          type="button"
          onClick={() => setVehicleTab("loader")}
          className="px-4 py-1.5 text-xs font-semibold rounded-full transition-all duration-200"
          style={
            vehicleTab === "loader"
              ? { background: "var(--primary)", color: "#fff", boxShadow: "0 1px 0.25rem rgba(229,30,42,0.25)" }
              : { color: "var(--text-secondary, #6b7280)", background: "transparent" }
          }
        >
          2: Folk Lifters
        </button>
      </div>

      {vehicleTab === "delivery" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2 items-center flex-nowrap">
              <span className="text-xs font-semibold text-zinc-500 whitespace-nowrap">Filter:</span>
              <label className="text-xs font-medium text-zinc-500">From</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36" />
              <label className="text-xs font-medium text-zinc-500">To</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36" />
              <Button type="button" size="sm" onClick={handleLoad} disabled={isLoading} className="h-8 px-3 text-xs font-semibold flex items-center gap-1.5">
                {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{isLoading ? "Loading..." : "Load"}</span>
              </Button>
            </div>
          </div>

          {trucks.length > 0 && deliveryGrandTotal > 0 && (
            <div className="bg-white rounded-lg border border-zinc-200 p-3 flex justify-between text-sm">
              <span className="text-zinc-500">Total Fuel Cost (filtered period)</span>
              <span className="font-bold" style={{ color: "var(--primary)" }}>
                Rs. {deliveryGrandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}

          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Truck No</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead>From - To</TableHead>
                  <TableHead className="text-right">Initial (km)</TableHead>
                  <TableHead className="text-right">Final (km)</TableHead>
                  <TableHead className="text-right">Distance</TableHead>
                  <TableHead className="text-right">Fuel (L)</TableHead>
                  <TableHead className="text-right">Amount (Rs.)</TableHead>
                  <TableHead className="text-right">km/L</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trucks.length === 0 ? (
                  <EmptyRow colSpan={10} label="No delivery trucks or fuel entries for this period" />
                ) : (
                  trucks.map((t) => {
                    const kmPerL = t.totalFuel > 0 ? t.totalDistance / t.totalFuel : null;
                    const hasEntries = t.totalFuel > 0 || t.totalAmount > 0;
                    return (
                      <TableRow key={t.truck_no}>
                        <TableCell className="font-mono font-medium">{t.truck_no}</TableCell>
                        <TableCell>{t.driver_name || "—"}</TableCell>
                        <TableCell className="text-xs text-zinc-400">{fromLabel} - {toLabel}</TableCell>
                        <TableCell className="text-right">{hasEntries && t.minInitial != null ? Number(t.minInitial).toLocaleString() : "—"}</TableCell>
                        <TableCell className="text-right">{hasEntries && t.maxFinal != null ? Number(t.maxFinal).toLocaleString() : "—"}</TableCell>
                        <TableCell className="text-right font-medium">{hasEntries ? `${t.totalDistance.toFixed(1)} km` : "—"}</TableCell>
                        <TableCell className="text-right">{hasEntries ? t.totalFuel.toFixed(2) : "—"}</TableCell>
                        <TableCell className="text-right font-mono">{hasEntries ? fmt(t.totalAmount) : "—"}</TableCell>
                        <TableCell className="text-right text-zinc-500">{kmPerL != null ? kmPerL.toFixed(2) : "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleViewTruck(t.truck_no, t.driver_name)}
                            disabled={viewLoadingKey === `truck_${t.truck_no}`}
                            className="flex items-center gap-1 ml-auto"
                          >
                            {viewLoadingKey === `truck_${t.truck_no}` && (
                              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                              </svg>
                            )}
                            <span>View</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableCard>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2 items-center flex-nowrap">
              <span className="text-xs font-semibold text-zinc-500 whitespace-nowrap">Filter:</span>
              <label className="text-xs font-medium text-zinc-500">From</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36" />
              <label className="text-xs font-medium text-zinc-500">To</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36" />
              <Button type="button" size="sm" onClick={handleLoad} disabled={isLoading} className="h-8 px-3 text-xs font-semibold flex items-center gap-1.5">
                {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{isLoading ? "Loading..." : "Load"}</span>
              </Button>
              <ExportButtons data={loaderExportData} filename="fuel_load_vehicles" />
            </div>
          </div>

          {loadVehicles.length > 0 && loaderGrandTotal > 0 && (
            <div className="bg-white rounded-lg border border-zinc-200 p-3 flex justify-between text-sm">
              <span className="text-zinc-500">Total Fuel Cost (filtered period)</span>
              <span className="font-bold" style={{ color: "var(--primary)" }}>
                Rs. {loaderGrandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}

          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loader No</TableHead>
                  <TableHead>Loader</TableHead>
                  <TableHead>From - To</TableHead>
                  <TableHead className="text-right">Fuel (L)</TableHead>
                  <TableHead className="text-right">Amount (Rs.)</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadVehicles.length === 0 ? (
                  <EmptyRow colSpan={6} label="No loaders or fuel entries for this period" />
                ) : (
                  loadVehicles.map((l) => {
                    const hasEntries = l.totalFuel > 0 || l.totalAmount > 0;
                    return (
                      <TableRow key={l.loader_no}>
                        <TableCell className="font-mono font-medium">{l.loader_no}</TableCell>
                        <TableCell>{l.loader_name || "—"}</TableCell>
                        <TableCell className="text-xs text-zinc-400">{fromLabel} - {toLabel}</TableCell>
                        <TableCell className="text-right">{hasEntries ? l.totalFuel.toFixed(2) : "—"}</TableCell>
                        <TableCell className="text-right font-mono">{hasEntries ? fmt(l.totalAmount) : "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleViewLoader(l.loader_no, l.loader_name)}
                            disabled={viewLoadingKey === `loader_${l.loader_no}`}
                            className="flex items-center gap-1 ml-auto"
                          >
                            {viewLoadingKey === `loader_${l.loader_no}` && (
                              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                              </svg>
                            )}
                            <span>View</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableCard>
        </div>
      )}
    </div>
  );
}

function MaintenanceHead({
  initialEntries,
  dmRoutes,
  loaders = [],
  bankAccounts,
}: {
  initialEntries: any[];
  dmRoutes: any[];
  loaders?: any[];
  bankAccounts: any[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [viewLoadingVehicle, setViewLoadingVehicle] = useState<string | null>(null);
  const [entries, setEntries] = useState(initialEntries);
  const [isLoading, setIsLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(FIRST_DAY_OF_MONTH);
  const [dateTo, setDateTo] = useState(TODAY);
  const [appliedFrom, setAppliedFrom] = useState(FIRST_DAY_OF_MONTH);
  const [appliedTo, setAppliedTo] = useState(TODAY);

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  const handleLoad = async () => {
    setIsLoading(true);
    try {
      const fresh = await getMaintenanceEntries({ dateFrom, dateTo });
      setEntries(fresh);
      setAppliedFrom(dateFrom);
      setAppliedTo(dateTo);
    } finally {
      setIsLoading(false);
    }
  };

  const filtered = entries.filter((e) => {
    if (appliedFrom && e.entry_date < appliedFrom) return false;
    if (appliedTo && e.entry_date > appliedTo) return false;
    return true;
  });

  const fromLabel = appliedFrom || "All";
  const toLabel = appliedTo || "All";

  const vehiclesMap = new Map<string, {
    vehicle_no: string;
    driver_name: string;
    totalAmount: number;
    entriesCount: number;
  }>();

  dmRoutes.forEach((r) => {
    if (r.truck_no && !vehiclesMap.has(r.truck_no)) {
      const driver = r.dm?.full_name || r.dm_name || r.personnel || "";
      vehiclesMap.set(r.truck_no, {
        vehicle_no: r.truck_no,
        driver_name: driver,
        totalAmount: 0,
        entriesCount: 0,
      });
    }
  });

  loaders.forEach((l) => {
    if (l.number && !vehiclesMap.has(l.number)) {
      const driver = l.loader_name || l.loader?.full_name || "";
      vehiclesMap.set(l.number, {
        vehicle_no: l.number,
        driver_name: driver,
        totalAmount: 0,
        entriesCount: 0,
      });
    }
  });

  filtered.forEach((e) => {
    if (!vehiclesMap.has(e.vehicle_no)) {
      vehiclesMap.set(e.vehicle_no, {
        vehicle_no: e.vehicle_no,
        driver_name: e.driver_name || "",
        totalAmount: 0,
        entriesCount: 0,
      });
    }
    const v = vehiclesMap.get(e.vehicle_no)!;
    v.totalAmount += Number(e.amount) || 0;
    v.entriesCount += 1;
    if (!v.driver_name && e.driver_name) v.driver_name = e.driver_name;
  });

  const vehicles = Array.from(vehiclesMap.values());
  const grandTotal = vehicles.reduce((s, v) => s + v.totalAmount, 0);

  const exportData = vehicles.map((v) => ({
    "Vehicle No": v.vehicle_no,
    Driver: v.driver_name || "",
    From: fromLabel,
    To: toLabel,
    "Amount (Rs.)": v.totalAmount.toFixed(2),
  }));

  const handleViewVehicle = (vehicleNo: string, driverName?: string) => {
    setViewLoadingVehicle(vehicleNo);
    const params = new URLSearchParams();
    if (appliedFrom) params.set("from", appliedFrom);
    if (appliedTo) params.set("to", appliedTo);
    if (driverName) params.set("name", driverName);
    router.push(`/expenses/agency/maintenance/${encodeURIComponent(vehicleNo)}${params.toString() ? "?" + params.toString() : ""}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 items-center flex-nowrap">
          <span className="text-xs font-semibold text-zinc-500 whitespace-nowrap">Filter:</span>
          <label className="text-xs font-medium text-zinc-500">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36" />
          <label className="text-xs font-medium text-zinc-500">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36" />
          <Button type="button" size="sm" onClick={handleLoad} disabled={isLoading} className="h-8 px-3 text-xs font-semibold flex items-center gap-1.5">
            {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>{isLoading ? "Loading..." : "Load"}</span>
          </Button>
          <ExportButtons data={exportData} filename="maintenance_vehicles" />
        </div>
      </div>

      {vehicles.length > 0 && grandTotal > 0 && (
        <div className="bg-white rounded-lg border border-zinc-200 p-3 flex justify-between text-sm">
          <span className="text-zinc-500">Total Maintenance Cost (filtered period)</span>
          <span className="font-bold" style={{ color: "var(--primary)" }}>
            Rs. {grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </span>
        </div>
      )}

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vehicle No</TableHead>
              <TableHead>Driver</TableHead>
              <TableHead>From - To</TableHead>
              <TableHead className="text-right">Amount (Rs.)</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vehicles.length === 0 ? (
              <EmptyRow colSpan={5} label="No vehicles or maintenance entries for this period" />
            ) : (
              vehicles.map((v) => {
                const hasEntries = v.totalAmount > 0 || v.entriesCount > 0;
                return (
                  <TableRow key={v.vehicle_no}>
                    <TableCell className="font-mono font-medium">{v.vehicle_no}</TableCell>
                    <TableCell>{v.driver_name || "—"}</TableCell>
                    <TableCell className="text-xs text-zinc-400">{fromLabel} - {toLabel}</TableCell>
                    <TableCell className="text-right font-mono font-semibold" style={{ color: "var(--primary)" }}>
                      {hasEntries ? fmt(v.totalAmount) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleViewVehicle(v.vehicle_no, v.driver_name)}
                        disabled={viewLoadingVehicle === v.vehicle_no}
                        className="flex items-center gap-1 ml-auto"
                      >
                        {viewLoadingVehicle === v.vehicle_no && (
                          <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                        )}
                        <span>View</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}


function BankSelect({ value, onChange, bankAccounts }: { value: string; onChange: (v: string) => void; bankAccounts: any[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = bankAccounts.filter((b: any) =>
    (b.account_title || "").toLowerCase().includes(q.toLowerCase())
  );
  const selected = bankAccounts.find((b: any) => b.id === value);
  return (
    <div className="relative">
      <input
        type="text"
        className="w-full h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
        value={open ? q : (selected?.account_title || "")}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => { setQ(""); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="— No transaction account —"
      />
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 text-zinc-400"
            onMouseDown={() => { onChange(""); setOpen(false); setQ(""); }}
          >
            — No transaction account —
          </button>
          {filtered.map((b: any) => (
            <button
              key={b.id}
              type="button"
              className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 ${value === b.id ? "font-semibold bg-zinc-50" : ""}`}
              onMouseDown={() => { onChange(b.id); setOpen(false); setQ(""); }}
            >
              {b.account_title}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-zinc-400">No accounts found</div>
          )}
        </div>
      )}
    </div>
  );
}


function VendorSelect({ value, onChange, vendorAccounts }: { value: string; onChange: (v: string) => void; vendorAccounts: any[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full h-9 rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm focus-visible:outline-none">
      <option value="">— No vendor account —</option>
      {vendorAccounts.map((v: any) => (
        <option key={v.id} value={v.id}>{v.account_title}</option>
      ))}
    </select>
  );
}

function BillsHead({ rows, bankAccounts }: { rows: any[]; bankAccounts: any[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [billRows, setBillRows] = useState(rows);
  const [isLoading, setIsLoading] = useState(false);
  const [fromDate, setFromDate]       = useState(FIRST_DAY_OF_MONTH);
  const [toDate, setToDate]           = useState(TODAY);
  const [appliedFrom, setAppliedFrom] = useState(FIRST_DAY_OF_MONTH);
  const [appliedTo, setAppliedTo]     = useState(TODAY);
  const [showModal, setShowModal]     = useState(false);
  const [isOpeningAdd, setIsOpeningAdd] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [form, setForm] = useState({ bill_name: "", expense_date: TODAY, month: CURRENT_MONTH, year: String(CURRENT_YEAR), amount: "", bank_account_id: "" });

  useEffect(() => {
    setBillRows(rows);
  }, [rows]);

  const handleLoad = async () => {
    setIsLoading(true);
    try {
      const fresh = await getBills({ dateFrom: fromDate, dateTo: toDate });
      setBillRows(fresh);
      setAppliedFrom(fromDate);
      setAppliedTo(toDate);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    setForm({ bill_name: "", expense_date: TODAY, month: CURRENT_MONTH, year: String(CURRENT_YEAR), amount: "", bank_account_id: "" });
    setIsOpeningAdd(true);
    setTimeout(() => {
      setShowModal(true);
      setIsOpeningAdd(false);
    }, 150);
  };

  const handleOpenEdit = (r: any) => {
    setEditingId(r.id);
    setForm({
      bill_name: r.bill_name || "",
      expense_date: r.expense_date ? String(r.expense_date).slice(0, 10) : TODAY,
      month: r.month || CURRENT_MONTH,
      year: r.year ? String(r.year) : String(CURRENT_YEAR),
      amount: r.amount != null ? String(r.amount) : "",
      bank_account_id: r.bank_account_id || "",
    });
    setShowModal(true);
  };

  const filtered = billRows.filter((r) => {
    const d = getExpenseRowDate(r);
    if (!d) return true;
    return d >= appliedFrom && d <= appliedTo;
  });
  const isAllSelected = filtered.length > 0 && filtered.every((r) => selectedIds.includes(r.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(filtered.map((r) => r.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Delete ${selectedIds.length} selected bill(s)?`)) return;
    startTransition(async () => {
      try {
        await deleteBills(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (err: any) { alert(err.message); }
    });
  };
  const total    = filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const exportData = filtered.map((r) => ({ Bill: r.bill_name, Date: r.expense_date || "", Month: r.month, Year: r.year, "Amount (Rs.)": r.amount }));

  const handleSave = () => {
    if (!form.bill_name || !form.amount) return;
    const [y, m] = (form.expense_date || TODAY).split("-");
    const mIdx = parseInt(m, 10) - 1;
    const derivedMonth = (mIdx >= 0 && mIdx < 12) ? MONTHS[mIdx] : CURRENT_MONTH;
    const derivedYear = y || String(CURRENT_YEAR);

    startTransition(async () => {
      try {
        if (editingId) {
          await updateBill(editingId, {
            bill_name: form.bill_name,
            expense_date: form.expense_date,
            month: derivedMonth,
            year: derivedYear,
            amount: parseFloat(form.amount),
            bank_account_id: form.bank_account_id || null,
          });
        } else {
          await createBill({
            bill_name: form.bill_name,
            expense_date: form.expense_date,
            month: derivedMonth,
            year: derivedYear,
            amount: parseFloat(form.amount),
            bank_account_id: form.bank_account_id || undefined,
          });
        }
        setShowModal(false);
        setEditingId(null);
        setForm({ bill_name: "", expense_date: TODAY, month: CURRENT_MONTH, year: String(CURRENT_YEAR), amount: "", bank_account_id: "" });
        router.refresh();
      } catch (err: any) { alert(err.message); }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this bill record?")) return;
    setDeletingId(id);
    startTransition(async () => {
      try { await deleteBill(id); router.refresh(); }
      catch (err: any) { alert(err.message); }
      finally { setDeletingId(null); }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 items-center flex-wrap">
          <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromDate={setFromDate} onToDate={setToDate} onLoad={handleLoad} loading={isLoading} />
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
          <ExportButtons data={exportData} filename="bills_expenses" />
        </div>
        <Button onClick={handleOpenAdd} disabled={isOpeningAdd} className="flex items-center gap-1.5">
          {isOpeningAdd && (
            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          <span>+ Add Bill</span>
        </Button>
      </div>

      {filtered.length > 0 && (
        <div className="bg-white rounded-lg border border-zinc-200 p-3 flex justify-between text-sm">
          <span className="text-zinc-500">Total Bills ({appliedFrom} to {appliedTo})</span>
          <span className="font-bold" style={{ color: "var(--primary)" }}>{fmt(total)}</span>
        </div>
      )}

      <TableCard>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-10 text-center"><input type="checkbox" checked={isAllSelected} onChange={handleToggleSelectAll} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableHead><TableHead>Bill Name</TableHead><TableHead>Date</TableHead><TableHead>Month</TableHead><TableHead>Year</TableHead>
            <TableHead className="text-right">Amount (Rs.)</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0
              ? <EmptyRow colSpan={7} label="No bill records for this period" />
              : filtered.map((r) => (
                <TableRow key={r.id} className={selectedIds.includes(r.id) ? "bg-red-50/50" : ""}>
                  <TableCell className="w-10 text-center"><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => setSelectedIds(prev => prev.includes(r.id) ? prev.filter(id => id !== r.id) : [...prev, r.id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableCell>
                  <TableCell className="font-medium">{r.bill_name}</TableCell>
                  <TableCell className="text-xs font-mono">{r.expense_date || "—"}</TableCell>
                  <TableCell>{r.month}</TableCell><TableCell>{r.year}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(r.amount)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenEdit(r)}
                        className="h-7 px-2 text-xs flex items-center gap-1"
                      >
                        <Edit2 className="w-3 h-3" />
                        <span>Edit</span>
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700 min-w-[2rem] h-7 px-2 text-xs flex items-center justify-center"
                        onClick={() => handleDelete(r.id)} disabled={deletingId === r.id || isPending}>
                        {deletingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Delete"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </TableCard>

      {showModal && (
        <Modal title={editingId ? "Edit Bill" : "Add Bill"} onClose={() => { setShowModal(false); setEditingId(null); }}>
          <div className="space-y-3">
            <Field label="Bill Name *">
              <Input placeholder="e.g. Electricity, Water, Rent" value={form.bill_name}
                onChange={(e) => setForm({ ...form, bill_name: e.target.value })} />
            </Field>
            <Field label="Date *">
              <Input type="date" value={form.expense_date}
                onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
            </Field>
            <Field label="Amount (Rs.) *">
              <Input type="number" min="0" placeholder="0" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Bank Account">
              <BankSelect value={form.bank_account_id} onChange={(v) => setForm({ ...form, bank_account_id: v })} bankAccounts={bankAccounts} />
            </Field>
            <div className="flex gap-2 pt-1">
              <Button className="flex-1 flex items-center justify-center gap-1.5" onClick={handleSave} disabled={isPending}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPending ? "Saving..." : (editingId ? "Update Bill" : "Save Bill")}
              </Button>
              <Button variant="outline" onClick={() => { setShowModal(false); setEditingId(null); }}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EntertainmentHead({ rows, bankAccounts }: { rows: any[]; bankAccounts: any[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [entertainmentRows, setEntertainmentRows] = useState(rows);
  const [isLoading, setIsLoading] = useState(false);
  const [fromDate, setFromDate]       = useState(FIRST_DAY_OF_MONTH);
  const [toDate, setToDate]           = useState(TODAY);
  const [appliedFrom, setAppliedFrom] = useState(FIRST_DAY_OF_MONTH);
  const [appliedTo, setAppliedTo]     = useState(TODAY);
  const [showModal, setShowModal]     = useState(false);
  const [isOpeningAdd, setIsOpeningAdd] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [form, setForm] = useState({ expense_date: TODAY, month: CURRENT_MONTH, year: String(CURRENT_YEAR), description: "", amount: "", bank_account_id: "" });

  useEffect(() => {
    setEntertainmentRows(rows);
  }, [rows]);

  const handleLoad = async () => {
    setIsLoading(true);
    try {
      const fresh = await getEntertainment({ dateFrom: fromDate, dateTo: toDate });
      setEntertainmentRows(fresh);
      setAppliedFrom(fromDate);
      setAppliedTo(toDate);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    setForm({ expense_date: TODAY, month: CURRENT_MONTH, year: String(CURRENT_YEAR), description: "", amount: "", bank_account_id: "" });
    setIsOpeningAdd(true);
    setTimeout(() => {
      setShowModal(true);
      setIsOpeningAdd(false);
    }, 150);
  };

  const handleOpenEdit = (r: any) => {
    setEditingId(r.id);
    setForm({
      expense_date: r.expense_date ? String(r.expense_date).slice(0, 10) : TODAY,
      month: r.month || CURRENT_MONTH,
      year: r.year ? String(r.year) : String(CURRENT_YEAR),
      description: r.description || "",
      amount: r.amount != null ? String(r.amount) : "",
      bank_account_id: r.bank_account_id || "",
    });
    setShowModal(true);
  };

  const filtered = entertainmentRows.filter((r) => {
    const d = getExpenseRowDate(r);
    if (!d) return true;
    return d >= appliedFrom && d <= appliedTo;
  });
  const isAllSelected = filtered.length > 0 && filtered.every((r) => selectedIds.includes(r.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(filtered.map((r) => r.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Delete ${selectedIds.length} selected record(s)?`)) return;
    startTransition(async () => {
      try {
        await deleteEntertainments(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (err: any) { alert(err.message); }
    });
  };
  const total    = filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const exportData = filtered.map((r) => ({ Date: r.expense_date || "", Month: r.month, Year: r.year, Description: r.description, "Amount (Rs.)": r.amount }));

  const handleSave = () => {
    if (!form.description || !form.amount) return;
    const [y, m] = (form.expense_date || TODAY).split("-");
    const mIdx = parseInt(m, 10) - 1;
    const derivedMonth = (mIdx >= 0 && mIdx < 12) ? MONTHS[mIdx] : CURRENT_MONTH;
    const derivedYear = y || String(CURRENT_YEAR);

    startTransition(async () => {
      try {
        if (editingId) {
          await updateEntertainment(editingId, {
            expense_date: form.expense_date,
            month: derivedMonth,
            year: derivedYear,
            description: form.description,
            amount: parseFloat(form.amount),
            bank_account_id: form.bank_account_id || null,
          });
        } else {
          await createEntertainment({
            expense_date: form.expense_date,
            month: derivedMonth,
            year: derivedYear,
            description: form.description,
            amount: parseFloat(form.amount),
            bank_account_id: form.bank_account_id || undefined,
          });
        }
        setShowModal(false);
        setEditingId(null);
        setForm({ expense_date: TODAY, month: CURRENT_MONTH, year: String(CURRENT_YEAR), description: "", amount: "", bank_account_id: "" });
        router.refresh();
      } catch (err: any) { alert(err.message); }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this record?")) return;
    setDeletingId(id);
    startTransition(async () => {
      try { await deleteEntertainment(id); router.refresh(); }
      catch (err: any) { alert(err.message); }
      finally { setDeletingId(null); }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 items-center flex-wrap">
          <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromDate={setFromDate} onToDate={setToDate} onLoad={handleLoad} loading={isLoading} />
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
          <ExportButtons data={exportData} filename="entertainment_expenses" />
        </div>
        <Button onClick={handleOpenAdd} disabled={isOpeningAdd} className="flex items-center gap-1.5">
          {isOpeningAdd && (
            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          <span>+ Add Entertainment</span>
        </Button>
      </div>

      {filtered.length > 0 && (
        <div className="bg-white rounded-lg border border-zinc-200 p-3 flex justify-between text-sm">
          <span className="text-zinc-500">Total Entertainment ({appliedFrom} to {appliedTo})</span>
          <span className="font-bold" style={{ color: "var(--primary)" }}>{fmt(total)}</span>
        </div>
      )}

      <TableCard>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-10 text-center"><input type="checkbox" checked={isAllSelected} onChange={handleToggleSelectAll} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableHead><TableHead>Date</TableHead><TableHead>Month</TableHead><TableHead>Description</TableHead>
            <TableHead className="text-right">Amount (Rs.)</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0
              ? <EmptyRow colSpan={6} label="No entertainment records for this period" />
              : filtered.map((r) => (
                <TableRow key={r.id} className={selectedIds.includes(r.id) ? "bg-red-50/50" : ""}>
                  <TableCell className="w-10 text-center"><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => setSelectedIds(prev => prev.includes(r.id) ? prev.filter(id => id !== r.id) : [...prev, r.id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableCell>
                  <TableCell className="text-xs font-mono">{r.expense_date || "—"}</TableCell>
                  <TableCell>{r.month}</TableCell>
                  <TableCell>{r.description}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(r.amount)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenEdit(r)}
                        className="h-7 px-2 text-xs flex items-center gap-1"
                      >
                        <Edit2 className="w-3 h-3" />
                        <span>Edit</span>
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700 min-w-[2rem] h-7 px-2 text-xs flex items-center justify-center"
                        onClick={() => handleDelete(r.id)} disabled={deletingId === r.id || isPending}>
                        {deletingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Delete"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </TableCard>

      {showModal && (
        <Modal title={editingId ? "Edit Entertainment" : "Add Entertainment"} onClose={() => { setShowModal(false); setEditingId(null); }}>
          <div className="space-y-3">
            <Field label="Date *">
              <Input type="date" value={form.expense_date}
                onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
            </Field>
            <Field label="Description *">
              <Input placeholder="e.g. Client dinner, Office supplies" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Amount (Rs.) *">
              <Input type="number" min="0" placeholder="0" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Bank Account">
              <BankSelect value={form.bank_account_id} onChange={(v) => setForm({ ...form, bank_account_id: v })} bankAccounts={bankAccounts} />
            </Field>
            <div className="flex gap-2 pt-1">
              <Button className="flex-1 flex items-center justify-center gap-1.5" onClick={handleSave} disabled={isPending}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPending ? "Saving..." : (editingId ? "Update Entertainment" : "Save")}
              </Button>
              <Button variant="outline" onClick={() => { setShowModal(false); setEditingId(null); }}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PettyHead({ rows, bankAccounts }: { rows: any[]; bankAccounts: any[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pettyRows, setPettyRows] = useState(rows);
  const [isLoading, setIsLoading] = useState(false);
  const [fromDate, setFromDate]       = useState(FIRST_DAY_OF_MONTH);
  const [toDate, setToDate]           = useState(TODAY);
  const [appliedFrom, setAppliedFrom] = useState(FIRST_DAY_OF_MONTH);
  const [appliedTo, setAppliedTo]     = useState(TODAY);
  const [showModal, setShowModal]     = useState(false);
  const [isOpeningAdd, setIsOpeningAdd] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [form, setForm] = useState({ expense_date: TODAY, month: CURRENT_MONTH, year: String(CURRENT_YEAR), description: "", amount: "", bank_account_id: "" });

  useEffect(() => {
    setPettyRows(rows);
  }, [rows]);

  const handleLoad = async () => {
    setIsLoading(true);
    try {
      const fresh = await getPetty({ dateFrom: fromDate, dateTo: toDate });
      setPettyRows(fresh);
      setAppliedFrom(fromDate);
      setAppliedTo(toDate);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    setForm({ expense_date: TODAY, month: CURRENT_MONTH, year: String(CURRENT_YEAR), description: "", amount: "", bank_account_id: "" });
    setIsOpeningAdd(true);
    setTimeout(() => {
      setShowModal(true);
      setIsOpeningAdd(false);
    }, 150);
  };

  const handleOpenEdit = (r: any) => {
    setEditingId(r.id);
    setForm({
      expense_date: r.expense_date ? String(r.expense_date).slice(0, 10) : TODAY,
      month: r.month || CURRENT_MONTH,
      year: r.year ? String(r.year) : String(CURRENT_YEAR),
      description: r.description || "",
      amount: r.amount != null ? String(r.amount) : "",
      bank_account_id: r.bank_account_id || "",
    });
    setShowModal(true);
  };

  const filtered = pettyRows.filter((r) => {
    const d = getExpenseRowDate(r);
    if (!d) return true;
    return d >= appliedFrom && d <= appliedTo;
  });
  const isAllSelected = filtered.length > 0 && filtered.every((r) => selectedIds.includes(r.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(filtered.map((r) => r.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Delete ${selectedIds.length} selected record(s)?`)) return;
    startTransition(async () => {
      try {
        await deletePetties(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (err: any) { alert(err.message); }
    });
  };
  const total    = filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const exportData = filtered.map((r) => ({ Date: r.expense_date || "", Month: r.month, Year: r.year, Description: r.description, "Amount (Rs.)": r.amount }));

  const handleSave = () => {
    if (!form.description || !form.amount) return;
    const [y, m] = (form.expense_date || TODAY).split("-");
    const mIdx = parseInt(m, 10) - 1;
    const derivedMonth = (mIdx >= 0 && mIdx < 12) ? MONTHS[mIdx] : CURRENT_MONTH;
    const derivedYear = y || String(CURRENT_YEAR);

    startTransition(async () => {
      try {
        if (editingId) {
          await updatePetty(editingId, {
            expense_date: form.expense_date,
            month: derivedMonth,
            year: derivedYear,
            description: form.description,
            amount: parseFloat(form.amount),
            bank_account_id: form.bank_account_id || null,
          });
        } else {
          await createPetty({
            expense_date: form.expense_date,
            month: derivedMonth,
            year: derivedYear,
            description: form.description,
            amount: parseFloat(form.amount),
            bank_account_id: form.bank_account_id || undefined,
          });
        }
        setShowModal(false);
        setEditingId(null);
        setForm({ expense_date: TODAY, month: CURRENT_MONTH, year: String(CURRENT_YEAR), description: "", amount: "", bank_account_id: "" });
        router.refresh();
      } catch (err: any) { alert(err.message); }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this record?")) return;
    setDeletingId(id);
    startTransition(async () => {
      try { await deletePetty(id); router.refresh(); }
      catch (err: any) { alert(err.message); }
      finally { setDeletingId(null); }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 items-center flex-wrap">
          <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromDate={setFromDate} onToDate={setToDate} onLoad={handleLoad} loading={isLoading} />
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
          <ExportButtons data={exportData} filename="petty_expenses" />
        </div>
        <Button onClick={handleOpenAdd} disabled={isOpeningAdd} className="flex items-center gap-1.5">
          {isOpeningAdd && (
            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          <span>+ Add Petty</span>
        </Button>
      </div>

      {filtered.length > 0 && (
        <div className="bg-white rounded-lg border border-zinc-200 p-3 flex justify-between text-sm">
          <span className="text-zinc-500">Total Petty Cash ({appliedFrom} to {appliedTo})</span>
          <span className="font-bold" style={{ color: "var(--primary)" }}>{fmt(total)}</span>
        </div>
      )}

      <TableCard>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-10 text-center"><input type="checkbox" checked={isAllSelected} onChange={handleToggleSelectAll} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableHead><TableHead>Date</TableHead><TableHead>Month</TableHead><TableHead>Description</TableHead>
            <TableHead className="text-right">Amount (Rs.)</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0
              ? <EmptyRow colSpan={6} label="No petty cash records for this period" />
              : filtered.map((r) => (
                <TableRow key={r.id} className={selectedIds.includes(r.id) ? "bg-red-50/50" : ""}>
                  <TableCell className="w-10 text-center"><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => setSelectedIds(prev => prev.includes(r.id) ? prev.filter(id => id !== r.id) : [...prev, r.id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableCell>
                  <TableCell className="text-xs font-mono">{r.expense_date || "—"}</TableCell>
                  <TableCell>{r.month}</TableCell>
                  <TableCell>{r.description}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(r.amount)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenEdit(r)}
                        className="h-7 px-2 text-xs flex items-center gap-1"
                      >
                        <Edit2 className="w-3 h-3" />
                        <span>Edit</span>
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700 min-w-[2rem] h-7 px-2 text-xs flex items-center justify-center"
                        onClick={() => handleDelete(r.id)} disabled={deletingId === r.id || isPending}>
                        {deletingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Delete"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </TableCard>

      {showModal && (
        <Modal title={editingId ? "Edit Petty Cash" : "Add Petty Cash"} onClose={() => { setShowModal(false); setEditingId(null); }}>
          <div className="space-y-3">
            <Field label="Date *">
              <Input type="date" value={form.expense_date}
                onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
            </Field>
            <Field label="Description *">
              <Input placeholder="e.g. Tea, Stationary, Misc" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Amount (Rs.) *">
              <Input type="number" min="0" placeholder="0" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Bank Account">
              <BankSelect value={form.bank_account_id} onChange={(v) => setForm({ ...form, bank_account_id: v })} bankAccounts={bankAccounts} />
            </Field>
            <div className="flex gap-2 pt-1">
              <Button className="flex-1 flex items-center justify-center gap-1.5" onClick={handleSave} disabled={isPending}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPending ? "Saving..." : (editingId ? "Update Petty Cash" : "Save")}
              </Button>
              <Button variant="outline" onClick={() => { setShowModal(false); setEditingId(null); }}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PenaltiesHead({ rows, bankAccounts, vendorAccounts }: { rows: any[]; bankAccounts: any[]; vendorAccounts: any[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [penaltyRows, setPenaltyRows] = useState(rows);
  const [isLoading, setIsLoading] = useState(false);
  const [fromDate, setFromDate]       = useState(FIRST_DAY_OF_MONTH);
  const [toDate, setToDate]           = useState(TODAY);
  const [appliedFrom, setAppliedFrom] = useState(FIRST_DAY_OF_MONTH);
  const [appliedTo, setAppliedTo]     = useState(TODAY);
  const [showModal, setShowModal]     = useState(false);
  const [isOpeningAdd, setIsOpeningAdd] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [form, setForm] = useState({ expense_date: TODAY, month: CURRENT_MONTH, year: String(CURRENT_YEAR), description: "", reason: "", amount: "", vendor_account_id: "" });

  useEffect(() => {
    setPenaltyRows(rows);
  }, [rows]);

  const handleLoad = async () => {
    setIsLoading(true);
    try {
      const fresh = await getPenalties({ dateFrom: fromDate, dateTo: toDate });
      setPenaltyRows(fresh);
      setAppliedFrom(fromDate);
      setAppliedTo(toDate);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    setForm({ expense_date: TODAY, month: CURRENT_MONTH, year: String(CURRENT_YEAR), description: "", reason: "", amount: "", vendor_account_id: "" });
    setIsOpeningAdd(true);
    setTimeout(() => {
      setShowModal(true);
      setIsOpeningAdd(false);
    }, 150);
  };

  const handleOpenEdit = (r: any) => {
    setEditingId(r.id);
    setForm({
      expense_date: r.expense_date ? String(r.expense_date).slice(0, 10) : TODAY,
      month: r.month || CURRENT_MONTH,
      year: r.year ? String(r.year) : String(CURRENT_YEAR),
      description: r.description || "",
      reason: r.reason || "",
      amount: r.amount != null ? String(r.amount) : "",
      vendor_account_id: r.vendor_account_id || "",
    });
    setShowModal(true);
  };

  const filtered = rows.filter((r) => {
    const d = getExpenseRowDate(r);
    if (!d) return true;
    return d >= appliedFrom && d <= appliedTo;
  });
  const isAllSelected = filtered.length > 0 && filtered.every((r) => selectedIds.includes(r.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(filtered.map((r) => r.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Delete ${selectedIds.length} selected penalty record(s)?`)) return;
    startTransition(async () => {
      try {
        await deleteAgencyPenalties(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (err: any) { alert(err.message); }
    });
  };
  const total    = filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const exportData = filtered.map((r) => ({ Date: r.expense_date || "", Month: r.month, Year: r.year, Description: r.description, Reason: r.reason, "Amount (Rs.)": r.amount }));

  const handleSave = () => {
    if (!form.description || !form.amount) return;
    const [y, m] = (form.expense_date || TODAY).split("-");
    const mIdx = parseInt(m, 10) - 1;
    const derivedMonth = (mIdx >= 0 && mIdx < 12) ? MONTHS[mIdx] : CURRENT_MONTH;
    const derivedYear = y || String(CURRENT_YEAR);

    startTransition(async () => {
      try {
        if (editingId) {
          await updatePenalty(editingId, {
            expense_date: form.expense_date,
            month: derivedMonth,
            year: derivedYear,
            description: form.description,
            reason: form.reason || undefined,
            amount: parseFloat(form.amount),
            vendor_account_id: form.vendor_account_id || null,
          });
        } else {
          await createPenalty({
            expense_date: form.expense_date,
            month: derivedMonth,
            year: derivedYear,
            description: form.description,
            reason: form.reason || undefined,
            amount: parseFloat(form.amount),
            vendor_account_id: form.vendor_account_id || undefined,
          });
        }
        setShowModal(false);
        setEditingId(null);
        setForm({ expense_date: TODAY, month: CURRENT_MONTH, year: String(CURRENT_YEAR), description: "", reason: "", amount: "", vendor_account_id: "" });
        router.refresh();
      } catch (err: any) { alert(err.message); }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this penalty record?")) return;
    setDeletingId(id);
    startTransition(async () => {
      try { await deletePenalty(id); router.refresh(); }
      catch (err: any) { alert(err.message); }
      finally { setDeletingId(null); }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 items-center flex-wrap">
          <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromDate={setFromDate} onToDate={setToDate} onLoad={handleLoad} loading={isLoading} />
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
          <ExportButtons data={exportData} filename="penalties_expenses" />
        </div>
        <Button onClick={handleOpenAdd} disabled={isOpeningAdd} className="flex items-center gap-1.5">
          {isOpeningAdd && (
            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          <span>+ Add Penalty</span>
        </Button>
      </div>

      {filtered.length > 0 && (
        <div className="bg-white rounded-lg border border-zinc-200 p-3 flex justify-between text-sm">
          <span className="text-zinc-500">Total Penalties ({appliedFrom} to {appliedTo})</span>
          <span className="font-bold" style={{ color: "var(--primary)" }}>{fmt(total)}</span>
        </div>
      )}

      <TableCard>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-10 text-center"><input type="checkbox" checked={isAllSelected} onChange={handleToggleSelectAll} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableHead><TableHead>Date</TableHead><TableHead>Month</TableHead><TableHead>Description</TableHead>
            <TableHead>Reason</TableHead><TableHead className="text-right">Amount (Rs.)</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.length === 0
              ? <EmptyRow colSpan={7} label="No penalty records for this period" />
              : filtered.map((r) => (
                <TableRow key={r.id} className={selectedIds.includes(r.id) ? "bg-red-50/50" : ""}>
                  <TableCell className="w-10 text-center"><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => setSelectedIds(prev => prev.includes(r.id) ? prev.filter(id => id !== r.id) : [...prev, r.id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableCell>
                  <TableCell className="text-xs font-mono">{r.expense_date || "—"}</TableCell>
                  <TableCell>{r.month}</TableCell>
                  <TableCell>{r.description}</TableCell>
                  <TableCell className="text-zinc-500">{r.reason || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(r.amount)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenEdit(r)}
                        className="h-7 px-2 text-xs flex items-center gap-1"
                      >
                        <Edit2 className="w-3 h-3" />
                        <span>Edit</span>
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700 min-w-[2rem] h-7 px-2 text-xs flex items-center justify-center"
                        onClick={() => handleDelete(r.id)} disabled={deletingId === r.id || isPending}>
                        {deletingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Delete"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </TableCard>

      {showModal && (
        <Modal title={editingId ? "Edit Penalty" : "Add Penalty"} onClose={() => { setShowModal(false); setEditingId(null); }}>
          <div className="space-y-3">
            <Field label="Date *">
              <Input type="date" value={form.expense_date}
                onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
            </Field>
            <Field label="Description *">
              <Input placeholder="e.g. CCBPL Display Penalty, Warehouse Audit" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Reason">
              <Input placeholder="e.g. Non-compliance, Late delivery" value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </Field>
            <Field label="Amount (Rs.) *">
              <Input type="number" min="0" placeholder="0" value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Vendor Account">
              <VendorSelect value={form.vendor_account_id} onChange={(v) => setForm({ ...form, vendor_account_id: v })} vendorAccounts={vendorAccounts} />
            </Field>
            <div className="flex gap-2 pt-1">
              <Button className="flex-1 flex items-center justify-center gap-1.5" onClick={handleSave} disabled={isPending}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPending ? "Saving..." : (editingId ? "Update Penalty" : "Save")}
              </Button>
              <Button variant="outline" onClick={() => { setShowModal(false); setEditingId(null); }}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SearchableAccountSelect({
  value,
  onChange,
  bankAccounts,
}: {
  value: string;
  onChange: (v: string) => void;
  bankAccounts: any[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedAccount = bankAccounts.find((b) => b.id === value);
  const filtered = bankAccounts.filter((b) =>
    (b.account_title || "").toLowerCase().includes(search.toLowerCase()) ||
    (b.bank_name || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-9 rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm flex items-center justify-between text-left focus:outline-none focus:ring-1 focus:ring-zinc-400"
      >
        <span className={selectedAccount ? "font-medium text-zinc-900 truncate" : "text-zinc-400"}>
          {selectedAccount ? selectedAccount.account_title : "— Select Transaction Account —"}
        </span>
        <ChevronDown className="h-4 w-4 text-zinc-400 ml-2 shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg border border-zinc-200 shadow-xl z-50 p-2 space-y-1 max-h-60 overflow-hidden flex flex-col">
          <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-50 rounded border border-zinc-200 shrink-0">
            <Search className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
            <input
              type="text"
              placeholder="Search transaction accounts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-xs bg-transparent focus:outline-none"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto flex-1 divide-y divide-zinc-100">
            {filtered.length === 0 ? (
              <p className="text-xs text-zinc-400 py-3 text-center">No transaction accounts found</p>
            ) : (
              filtered.map((b) => {
                const isSelected = b.id === value;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      onChange(b.id);
                      setIsOpen(false);
                      setSearch("");
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded text-xs flex items-center justify-between hover:bg-zinc-100 transition-colors ${
                      isSelected ? "bg-blue-50 text-blue-700 font-semibold" : "text-zinc-700"
                    }`}
                  >
                    <div>
                      <p className="font-medium">{b.account_title}</p>
                      {b.current_balance !== undefined && (
                        <p className="text-[0.625rem] text-zinc-400">
                          Balance: Rs. {Number(b.current_balance || 0).toLocaleString()}
                        </p>
                      )}
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 text-blue-600 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkAutocomplete({
  value,
  onChange,
  onSelectLaborer,
  laborers,
}: {
  value: string;
  onChange: (val: string) => void;
  onSelectLaborer: (laborer: any) => void;
  laborers: any[];
}) {
  const [isOpen, setIsOpen] = useState(false);

  const filtered = laborers.filter((l) =>
    (l.work || "").toLowerCase().includes(value.toLowerCase())
  );

  return (
    <div className="relative">
      <Input
        type="text"
        placeholder="Type or select laborer work..."
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        className="w-full text-sm"
      />
      {isOpen && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg border border-zinc-200 shadow-xl z-50 max-h-52 overflow-y-auto divide-y divide-zinc-100">
          <div className="px-3 py-1.5 bg-zinc-50 text-[0.625rem] font-bold uppercase text-zinc-400">
            Available Laborer Works ({filtered.length})
          </div>
          {filtered.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                onSelectLaborer(l);
                setIsOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50/60 transition-colors flex items-center justify-between"
            >
              <div>
                <p className="font-semibold text-zinc-900">{l.work}</p>
                <p className="text-[0.625rem] text-zinc-500">
                  {l.from_date} → {l.to_date} &bull; {l.days} {l.days === 1 ? "day" : "days"}
                </p>
              </div>
              <span className="text-[0.625rem] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                Auto-fill
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LaborersHead({
  laborers = [],
  initialExpenses = [],
  bankAccounts = [],
}: {
  laborers?: any[];
  initialExpenses?: any[];
  bankAccounts: any[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fromDate, setFromDate] = useState(FIRST_DAY_OF_MONTH);
  const [toDate, setToDate] = useState(TODAY);
  const [appliedFrom, setAppliedFrom] = useState(FIRST_DAY_OF_MONTH);
  const [appliedTo, setAppliedTo] = useState(TODAY);
  const [expenses, setExpenses] = useState<any[]>(initialExpenses);
  const [currentLaborers, setCurrentLaborers] = useState<any[]>(laborers);
  const [isLoadingFilter, setIsLoadingFilter] = useState(false);

  useEffect(() => {
    setExpenses(initialExpenses);
  }, [initialExpenses]);

  useEffect(() => {
    setCurrentLaborers(laborers);
  }, [laborers]);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form state
  const [work, setWork] = useState("");
  const [linkedLaborerId, setLinkedLaborerId] = useState<string | null>(null);
  const [formFromDate, setFormFromDate] = useState(TODAY);
  const [formToDate, setFormToDate] = useState(TODAY);
  const [days, setDays] = useState(1);
  const [amount, setAmount] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [formError, setFormError] = useState("");

  const handleDatesAutoCalc = (from: string, to: string) => {
    if (!from || !to) return 1;
    const d1 = new Date(from);
    const d2 = new Date(to);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 1;
    const diffTime = d2.getTime() - d1.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays > 0 ? diffDays : 1;
  };

  const handleFromDateChange = (val: string) => {
    setFormFromDate(val);
    setDays(handleDatesAutoCalc(val, formToDate));
  };

  const handleToDateChange = (val: string) => {
    setFormToDate(val);
    setDays(handleDatesAutoCalc(formFromDate, val));
  };

  const handleSelectLaborer = (l: any) => {
    setWork(l.work);
    setLinkedLaborerId(l.id);
    setFormFromDate(l.from_date);
    setFormToDate(l.to_date);
    setDays(l.days || handleDatesAutoCalc(l.from_date, l.to_date));
  };

  const openRecordModal = (presetLaborer?: any) => {
    setEditingExpenseId(null);
    setFormError("");
    if (presetLaborer) {
      setWork(presetLaborer.work);
      setLinkedLaborerId(presetLaborer.id);
      setFormFromDate(presetLaborer.from_date);
      setFormToDate(presetLaborer.to_date);
      setDays(presetLaborer.days || handleDatesAutoCalc(presetLaborer.from_date, presetLaborer.to_date));
    } else {
      setWork("");
      setLinkedLaborerId(null);
      setFormFromDate(TODAY);
      setFormToDate(TODAY);
      setDays(1);
    }
    setAmount("");
    setBankAccountId(bankAccounts[0]?.id || "");
    setShowModal(true);
  };

  const openEditModal = (expenseRow: any) => {
    setEditingExpenseId(expenseRow.id);
    setFormError("");
    setWork(expenseRow.work);
    setLinkedLaborerId(expenseRow.laborer_id || null);
    setFormFromDate(expenseRow.from_date);
    setFormToDate(expenseRow.to_date);
    setDays(expenseRow.days || handleDatesAutoCalc(expenseRow.from_date, expenseRow.to_date));
    setAmount(String(expenseRow.amount || ""));
    setBankAccountId(expenseRow.bank_account_id || "");
    setShowModal(true);
  };

  const [isLoading, setIsLoading] = useState(false);

  const handleLoad = async () => {
    setIsLoading(true);
    try {
      const [refreshedExpenses, refreshedLaborers] = await Promise.all([
        getLaborerExpenses({ fromDate, toDate }),
        getLaborers({ fromDate, toDate }),
      ]);
      setExpenses(refreshedExpenses);
      setCurrentLaborers(refreshedLaborers);
      setAppliedFrom(fromDate);
      setAppliedTo(toDate);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = () => {
    if (!work.trim()) {
      setFormError("Please enter or select a work description.");
      return;
    }
    if (!formFromDate || !formToDate) {
      setFormError("Please provide both From and To dates.");
      return;
    }
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setFormError("Please enter a valid expense amount greater than 0.");
      return;
    }
    if (!bankAccountId) {
      setFormError("Please select a linked transaction account.");
      return;
    }

    setFormError("");
    startTransition(async () => {
      try {
        if (editingExpenseId) {
          await updateLaborerExpense(editingExpenseId, {
            laborer_id: linkedLaborerId || undefined,
            work: work.trim(),
            from_date: formFromDate,
            to_date: formToDate,
            days: days > 0 ? days : 1,
            amount: numAmount,
            bank_account_id: bankAccountId,
          });
        } else {
          await recordLaborerExpense({
            laborer_id: linkedLaborerId || undefined,
            work: work.trim(),
            from_date: formFromDate,
            to_date: formToDate,
            days: days > 0 ? days : 1,
            amount: numAmount,
            bank_account_id: bankAccountId,
          });
        }
        setShowModal(false);
        const [refreshedExpenses, refreshedLaborers] = await Promise.all([
          getLaborerExpenses(appliedFrom || appliedTo ? { fromDate: appliedFrom, toDate: appliedTo } : undefined),
          getLaborers(appliedFrom || appliedTo ? { fromDate: appliedFrom, toDate: appliedTo } : undefined),
        ]);
        setExpenses(refreshedExpenses);
        setCurrentLaborers(refreshedLaborers);
        router.refresh();
      } catch (err: any) {
        setFormError(err?.message || "Failed to record expense.");
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this laborer expense record?")) return;
    setDeletingId(id);
    startTransition(async () => {
      try {
        await deleteLaborerExpense(id);
        const [refreshedExpenses, refreshedLaborers] = await Promise.all([
          getLaborerExpenses(appliedFrom || appliedTo ? { fromDate: appliedFrom, toDate: appliedTo } : undefined),
          getLaborers(appliedFrom || appliedTo ? { fromDate: appliedFrom, toDate: appliedTo } : undefined),
        ]);
        setExpenses(refreshedExpenses);
        setCurrentLaborers(refreshedLaborers);
        router.refresh();
      } catch (err: any) {
        alert("Failed to delete expense: " + (err?.message || err));
      } finally {
        setDeletingId(null);
      }
    });
  };

  // Filter laborer records by current date filter (interval overlap)
  const filteredLaborers = currentLaborers.filter((l) => {
    if (appliedFrom && l.to_date < appliedFrom) return false;
    if (appliedTo && l.from_date > appliedTo) return false;
    return true;
  });

  // Filter expense records by current date filter (interval overlap)
  const filteredExpenses = expenses.filter((e) => {
    if (appliedFrom && e.to_date < appliedFrom) return false;
    if (appliedTo && e.from_date > appliedTo) return false;
    return true;
  });

  // Build unified table rows
  interface CombinedRow {
    key: string;
    laborerId?: string;
    expenseId?: string;
    fromDate: string;
    toDate: string;
    work: string;
    days: number;
    amount: number | null;
    accountTitle: string | null;
    bankAccountId: string | null;
    isRecorded: boolean;
    rawLaborer?: any;
    rawExpense?: any;
  }

  const rows: CombinedRow[] = [];
  const matchedExpenseIds = new Set<string>();

  // 1. Map from filtered laborers
  filteredLaborers.forEach((l) => {
    // Find matching expense by laborer_id or work & dates
    const matchedExpense = filteredExpenses.find(
      (e) => (e.laborer_id && e.laborer_id === l.id) ||
             (e.work?.trim().toLowerCase() === l.work?.trim().toLowerCase() &&
              e.from_date === l.from_date &&
              e.to_date === l.to_date)
    );

    if (matchedExpense) {
      matchedExpenseIds.add(matchedExpense.id);
      const acc = bankAccounts.find((b) => b.id === matchedExpense.bank_account_id);
      rows.push({
        key: `laborer_${l.id}_exp_${matchedExpense.id}`,
        laborerId: l.id,
        expenseId: matchedExpense.id,
        fromDate: matchedExpense.from_date || l.from_date,
        toDate: matchedExpense.to_date || l.to_date,
        work: matchedExpense.work || l.work,
        days: matchedExpense.days || l.days,
        amount: Number(matchedExpense.amount || 0),
        accountTitle: matchedExpense.bank_account?.account_title || acc?.account_title || "Linked Account",
        bankAccountId: matchedExpense.bank_account_id,
        isRecorded: true,
        rawLaborer: l,
        rawExpense: matchedExpense,
      });
    } else {
      rows.push({
        key: `laborer_${l.id}`,
        laborerId: l.id,
        fromDate: l.from_date,
        toDate: l.to_date,
        work: l.work,
        days: l.days,
        amount: null,
        accountTitle: null,
        bankAccountId: null,
        isRecorded: false,
        rawLaborer: l,
      });
    }
  });

  // 2. Add any standalone expenses not matched above
  filteredExpenses.forEach((e) => {
    if (!matchedExpenseIds.has(e.id)) {
      const acc = bankAccounts.find((b) => b.id === e.bank_account_id);
      rows.push({
        key: `exp_standalone_${e.id}`,
        expenseId: e.id,
        laborerId: e.laborer_id || undefined,
        fromDate: e.from_date,
        toDate: e.to_date,
        work: e.work,
        days: e.days,
        amount: Number(e.amount || 0),
        accountTitle: e.bank_account?.account_title || acc?.account_title || "Linked Account",
        bankAccountId: e.bank_account_id,
        isRecorded: true,
        rawExpense: e,
      });
    }
  });

  // Sort rows by fromDate descending
  rows.sort((a, b) => b.fromDate.localeCompare(a.fromDate));

  const totalRecordedAmount = rows.reduce(
    (sum, r) => sum + (r.isRecorded && r.amount ? r.amount : 0),
    0
  );

  const exportData = rows.map((r) => ({
    "From - To": `${r.fromDate} - ${r.toDate}`,
    Work: r.work,
    Days: r.days,
    "Amount (Rs.)": r.amount !== null ? r.amount : "—",
    Account: r.accountTitle || "—",
    Status: r.isRecorded ? "Recorded" : "Pending",
  }));

  return (
    <div className="space-y-4">
      {/* Top Filter & Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 items-center flex-wrap">
          <DateRangeFilter
            fromDate={fromDate}
            toDate={toDate}
            onFromDate={setFromDate}
            onToDate={setToDate}
            onLoad={handleLoad}
            loading={isLoading}
          />
          <ExportButtons data={exportData} filename="laborer_expenses" />
        </div>

        <Button
          size="sm"
          onClick={() => openRecordModal()}
          className="flex items-center gap-1.5 shadow-sm"
        >
          <Plus className="h-4 w-4" />
          <span>+ Record Laborer Expense</span>
        </Button>
      </div>

      {/* Summary Card */}
      {rows.length > 0 && totalRecordedAmount > 0 && (
        <div className="bg-white rounded-lg border border-zinc-200 p-3.5 flex justify-between items-center text-sm shadow-xs">
          <span className="text-zinc-500 font-medium">
            Total Laborer Expense (Filtered Period: {appliedFrom} to {appliedTo})
          </span>
          <span className="font-bold text-base" style={{ color: "var(--primary)" }}>
            {fmt(totalRecordedAmount)}
          </span>
        </div>
      )}

      {/* Table */}
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>From - To</TableHead>
              <TableHead>Work</TableHead>
              <TableHead className="text-center">Days</TableHead>
              <TableHead className="text-right">Amount (Rs.)</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} label="No laborer records or expenses found for this period" />
            ) : (
              rows.map((row) => {
                const isDeleting = deletingId === row.expenseId;

                return (
                  <TableRow key={row.key} className="hover:bg-zinc-50/70 transition-colors">
                    <TableCell className="font-medium text-xs text-zinc-600 whitespace-nowrap">
                      {row.fromDate} - {row.toDate}
                    </TableCell>

                    <TableCell className="font-semibold text-zinc-900">
                      {row.work}
                    </TableCell>

                    <TableCell className="text-center font-mono font-medium text-xs text-zinc-700">
                      {row.days}
                    </TableCell>

                    <TableCell className="text-right font-mono font-semibold">
                      {row.isRecorded && row.amount !== null ? (
                        <span style={{ color: "var(--primary)" }}>
                          {fmt(row.amount)}
                        </span>
                      ) : (
                        <span className="text-zinc-400 font-normal">—</span>
                      )}
                    </TableCell>

                    <TableCell className="text-xs">
                      {row.isRecorded && row.accountTitle ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {row.accountTitle}
                        </span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </TableCell>

                    <TableCell className="text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {!row.isRecorded ? (
                          <Button
                            size="sm"
                            onClick={() => openRecordModal(row.rawLaborer)}
                            className="h-7 px-2.5 text-xs font-semibold shadow-xs flex items-center gap-1"
                          >
                            <span>Record</span>
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEditModal(row.rawExpense)}
                              className="h-7 px-2 text-xs flex items-center gap-1"
                            >
                              <Edit2 className="h-3 w-3 text-zinc-500" />
                              <span>Edit</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(row.expenseId!)}
                              disabled={isDeleting}
                              className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 flex items-center gap-1"
                            >
                              {isDeleting ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="h-3 w-3" />
                              )}
                              <span>Delete</span>
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableCard>

      {/* Record / Edit Laborer Expense Modal */}
      {showModal && (
        <Modal
          title={editingExpenseId ? "Edit Laborer Expense" : "Record Laborer Expense"}
          onClose={() => setShowModal(false)}
        >
          <div className="space-y-4">
            {formError && (
              <div className="p-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg font-medium">
                {formError}
              </div>
            )}

            <Field label="Work (auto complete) *">
              <WorkAutocomplete
                value={work}
                onChange={setWork}
                onSelectLaborer={handleSelectLaborer}
                laborers={currentLaborers}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="From (auto complete) *">
                <Input
                  type="date"
                  value={formFromDate}
                  onChange={(e) => handleFromDateChange(e.target.value)}
                  className="text-sm"
                />
              </Field>
              <Field label="To (auto complete) *">
                <Input
                  type="date"
                  value={formToDate}
                  onChange={(e) => handleToDateChange(e.target.value)}
                  className="text-sm"
                />
              </Field>
              <Field label="Days (auto complete)">
                <Input
                  type="number"
                  min="1"
                  value={days}
                  onChange={(e) => setDays(parseInt(e.target.value, 10) || 1)}
                  className="text-sm font-mono font-semibold bg-zinc-50"
                />
              </Field>
            </div>

            <Field label="Amount (input form) *">
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="text-sm font-mono"
              />
            </Field>

            <Field label="Account (searchable selection drop down of transaction accounts) *">
              <SearchableAccountSelect
                value={bankAccountId}
                onChange={setBankAccountId}
                bankAccounts={bankAccounts}
              />
            </Field>

            <div className="p-2.5 bg-blue-50/80 rounded-lg border border-blue-200/80 text-[0.6875rem] text-blue-800 space-y-1">
              <p className="font-semibold flex items-center gap-1">
                <span>🏦</span> Linked Transaction Account Ledger Entry:
              </p>
              <p className="font-mono text-zinc-600">
                Date: <span className="font-semibold text-zinc-900">{formFromDate || "From Date"}</span> &bull; Reference: <span className="font-semibold text-zinc-900">{formFromDate && formToDate ? `${formFromDate} - ${formToDate}` : "From - To"} | {work || "Work name"}</span> &bull; OUT: <span className="font-semibold text-zinc-900">Rs. {parseFloat(amount) || 0}</span>
              </p>
            </div>

            <div className="flex gap-2 pt-2 border-t border-zinc-100">
              <Button
                className="flex-1"
                onClick={handleSave}
                disabled={isPending}
              >
                {isPending ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </span>
                ) : (
                  "Save"
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowModal(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function MonthYearFilter({ month, year, onMonth, onYear }: {
  month: string; year: string; onMonth: (v: string) => void; onYear: (v: string) => void;
}) {
  return (
    <div className="flex gap-2">
      <MonthSelect value={month} onChange={onMonth} />
      <YearSelect value={year} onChange={onYear} />
    </div>
  );
}

function MonthSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm focus-visible:outline-none" style={{ boxShadow: "0 0 0 1px var(--primary-ring)" }}>
      {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
}

function YearSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm focus-visible:outline-none">
      {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
    </select>
  );
}

function TableCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
      {children}
    </div>
  );
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-center text-zinc-400 py-10">
        {label}
      </TableCell>
    </TableRow>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl p-6">
        <h3 className="text-lg font-bold text-zinc-900 mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const isDm = role.toLowerCase().includes("delivery") || role === "dm";
  return (
    <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${isDm ? "bg-[var(--primary-light)] text-[var(--primary-dark)]" : "bg-green-100 text-green-700"}`}>
      {role}
    </span>
  );
}

function fmt(n: number) {
  return "Rs. " + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
