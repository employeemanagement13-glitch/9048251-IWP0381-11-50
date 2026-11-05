"use client";

import { useState, useRef, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Trash2, Upload, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
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
  deleteDmRoutes,
  updateDmRoute,
  bulkImportVehicles,
  bulkImportDms,
  createLoader,
  updateLoader,
  deleteLoader,
  deleteLoaders,
} from "@/lib/actions/routes";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import Papa from "papaparse";

interface DmRoutesClientProps {
  registry: any[];
  loaders?: any[];
  employees: any[];
}

export function DmRoutesClient({ registry, loaders = [], employees }: DmRoutesClientProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const vehicleFileInputRef = useRef<HTMLInputElement>(null);
  const dmFileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<{ message: string; isError?: boolean } | null>(null);
  const [isImportingVehicles, setIsImportingVehicles] = useState(false);
  const [isImportingDms, setIsImportingDms] = useState(false);
  const [deletingRouteId, setDeletingRouteId] = useState<string | null>(null);
  const [isBulkDeletingRoutes, setIsBulkDeletingRoutes] = useState(false);
  const [deletingLoaderId, setDeletingLoaderId] = useState<string | null>(null);
  const [isBulkDeletingLoaders, setIsBulkDeletingLoaders] = useState(false);

  const [showRouteForm, setShowRouteForm] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [formCode, setFormCode] = useState("");
  const [formDmName, setFormDmName] = useState("");
  const [formPersonnel, setFormPersonnel] = useState("");
  const [formTruckNo, setFormTruckNo] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formVehicleType, setFormVehicleType] = useState("");
  const [formModel, setFormModel] = useState("");
  const [formBrand, setFormBrand] = useState("");
  const [formYear, setFormYear] = useState("");
  const [formCapWeight, setFormCapWeight] = useState("");
  const [formCapVolume, setFormCapVolume] = useState("");
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([]);

  const [showLoaderForm, setShowLoaderForm] = useState(false);
  const [editingLoaderId, setEditingLoaderId] = useState<string | null>(null);
  const [loaderName, setLoaderName] = useState("");
  const [loaderNumber, setLoaderNumber] = useState("");
  const [loaderModel, setLoaderModel] = useState("");
  const [selectedLoaderIds, setSelectedLoaderIds] = useState<string[]>([]);

  const loaderEmployees = employees.filter((e) => e.role === "loader");
  const displayRegistry = [...registry];
  const displayLoaders = [...loaders];

  const parseUploadedFile = async (file: File): Promise<any[]> => {
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheet = workbook.SheetNames[0];
      if (firstSheet) {
        return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: "" });
      }
      return [];
    } else {
      const text = await file.text();
      const results = Papa.parse(text, { header: true, skipEmptyLines: true });
      return results.data;
    }
  };

  const handleImportVehiclesFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImportingVehicles(true);

    try {
      const rawRows = await parseUploadedFile(file);
      startTransition(async () => {
        try {
          const list = rawRows
            .map((row: any) => {
              const code = String(row["Code"] || row["code"] || "").trim();
              const personnel = String(row["Personnel"] || row["personnel"] || "").trim();
              const truckNo = String(
                row["Lic. Plate"] ||
                row["lic. plate"] ||
                row["Lic Plate"] ||
                row["lic_plate"] ||
                row["Truck No"] ||
                row["truck_no"] ||
                ""
              ).trim();
              const category = String(row["Category"] || row["category"] || "").trim();
              const vehicleType = String(row["Type"] || row["type"] || "").trim();
              const model = String(row["Model"] || row["model"] || "").trim();
              const brand = String(row["Brand"] || row["brand"] || "").trim();
              const year = String(row["Year"] || row["year"] || "").trim();
              const capWeight = String(row["Cap. (Weight)"] || row["cap. (weight)"] || row["cap_weight"] || "").trim();
              const capVolume = String(row["Cap. (Volume)"] || row["cap. (volume)"] || row["cap_volume"] || "").trim();

              return {
                code: code || undefined,
                personnel: personnel || undefined,
                truck_no: truckNo,
                category: category || undefined,
                vehicle_type: vehicleType || undefined,
                model: model || undefined,
                brand: brand || undefined,
                year: year || undefined,
                cap_weight: capWeight || undefined,
                cap_volume: capVolume || undefined,
              };
            })
            .filter((v) => !!v.truck_no);

          if (!list.length) {
            setImportStatus({ message: "No valid vehicle rows with Lic. Plate found in file.", isError: true });
            return;
          }

          const result = await bulkImportVehicles(list);
          setImportStatus({
            message: `Successfully imported ${result.length} vehicles from ${file.name}.`,
            isError: false,
          });
          router.refresh();
        } catch (err: any) {
          setImportStatus({ message: `Import error: ${err.message}`, isError: true });
        } finally {
          setIsImportingVehicles(false);
        }
      });
    } catch (err: any) {
      setImportStatus({ message: `File read error: ${err.message}`, isError: true });
      setIsImportingVehicles(false);
    } finally {
      if (vehicleFileInputRef.current) vehicleFileInputRef.current.value = "";
    }
  };

  const handleImportDmsFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImportingDms(true);

    try {
      const rawRows = await parseUploadedFile(file);
      startTransition(async () => {
        try {
          const list = rawRows
            .map((row: any) => {
              const vehicle = String(
                row["Vehicle"] ||
                row["vehicle"] ||
                row["Lic. Plate"] ||
                row["lic_plate"] ||
                ""
              ).trim();
              const name = String(
                row["Name"] ||
                row["name"] ||
                row["DM Name"] ||
                row["dm_name"] ||
                ""
              ).trim();
              return { vehicle, name };
            })
            .filter((d) => !!d.vehicle && !!d.name);

          if (!list.length) {
            setImportStatus({ message: "No valid DM rows with Vehicle and Name found in file.", isError: true });
            return;
          }

          const result = await bulkImportDms(list);
          setImportStatus({
            message: `Successfully updated ${result.updatedCount} delivery vehicle assignments from ${file.name}.`,
            isError: false,
          });
          router.refresh();
        } catch (err: any) {
          setImportStatus({ message: `Import error: ${err.message}`, isError: true });
        } finally {
          setIsImportingDms(false);
        }
      });
    } catch (err: any) {
      setImportStatus({ message: `File read error: ${err.message}`, isError: true });
      setIsImportingDms(false);
    } finally {
      if (dmFileInputRef.current) dmFileInputRef.current.value = "";
    }
  };

  const openAddVehicleForm = () => {
    setEditingRouteId(null);
    setFormCode("");
    setFormDmName("");
    setFormPersonnel("");
    setFormTruckNo("");
    setFormCategory("");
    setFormVehicleType("");
    setFormModel("");
    setFormBrand("");
    setFormYear("");
    setFormCapWeight("");
    setFormCapVolume("");
    setShowRouteForm(true);
  };

  const openEditVehicleForm = (r: any) => {
    setEditingRouteId(r.id);
    setFormCode(r.code || "");
    setFormDmName(r.dm_name || r.dm?.full_name || "");
    setFormPersonnel(r.personnel || "");
    setFormTruckNo(r.truck_no || "");
    setFormCategory(r.category || "");
    setFormVehicleType(r.vehicle_type || "");
    setFormModel(r.model || "");
    setFormBrand(r.brand || "");
    setFormYear(r.year || "");
    setFormCapWeight(r.cap_weight || "");
    setFormCapVolume(r.cap_volume || "");
    setShowRouteForm(true);
  };

  const handleVehicleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTruckNo) return;

    startTransition(async () => {
      const payload = {
        code: formCode.trim() || null,
        dm_name: formDmName.trim() || null,
        personnel: formPersonnel.trim() || null,
        truck_no: formTruckNo.trim(),
        category: formCategory.trim() || null,
        vehicle_type: formVehicleType.trim() || null,
        model: formModel.trim() || null,
        brand: formBrand.trim() || null,
        year: formYear.trim() || null,
        cap_weight: formCapWeight.trim() || null,
        cap_volume: formCapVolume.trim() || null,
      };

      if (editingRouteId) {
        await updateDmRoute(editingRouteId, payload);
      } else {
        await createDmRoute(payload);
      }

      setShowRouteForm(false);
      setEditingRouteId(null);
      setFormCode("");
      setFormDmName("");
      setFormPersonnel("");
      setFormTruckNo("");
      setFormCategory("");
      setFormVehicleType("");
      setFormModel("");
      setFormBrand("");
      setFormYear("");
      setFormCapWeight("");
      setFormCapVolume("");
      router.refresh();
    });
  };

  const isAllRoutesSelected = displayRegistry.length > 0 && displayRegistry.every((r) => selectedRouteIds.includes(r.id));

  const handleToggleSelectAllRoutes = () => {
    if (isAllRoutesSelected) setSelectedRouteIds([]);
    else setSelectedRouteIds(displayRegistry.map((r) => r.id));
  };

  const handleBulkDeleteRoutes = () => {
    if (!selectedRouteIds.length) return;
    if (!confirm(`Remove ${selectedRouteIds.length} selected vehicles from the Delivery Vehicles table?`)) return;
    setIsBulkDeletingRoutes(true);
    startTransition(async () => {
      try {
        await deleteDmRoutes(selectedRouteIds);
        setSelectedRouteIds([]);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      } finally {
        setIsBulkDeletingRoutes(false);
      }
    });
  };

  const handleDeleteRoute = (id: string) => {
    if (!confirm("Remove this vehicle from the Delivery Vehicles table?")) return;
    setDeletingRouteId(id);
    startTransition(async () => {
      try {
        await deleteDmRoute(id);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      } finally {
        setDeletingRouteId(null);
      }
    });
  };

  const openAddLoaderForm = () => {
    setEditingLoaderId(null);
    setLoaderName("");
    setLoaderNumber("");
    setLoaderModel("");
    setShowLoaderForm(true);
  };

  const openEditLoaderForm = (l: any) => {
    setEditingLoaderId(l.id);
    setLoaderName(l.loader_name || l.loader?.full_name || "");
    setLoaderNumber(l.number || "");
    setLoaderModel(l.model || "");
    setShowLoaderForm(true);
  };

  const handleLoaderSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loaderName.trim() || !loaderNumber.trim() || !loaderModel.trim()) return;

    startTransition(async () => {
      if (editingLoaderId) {
        await updateLoader(editingLoaderId, { loader_name: loaderName.trim(), number: loaderNumber.trim(), model: loaderModel.trim() });
      } else {
        await createLoader({ loader_name: loaderName.trim(), number: loaderNumber.trim(), model: loaderModel.trim() });
      }

      setShowLoaderForm(false);
      setEditingLoaderId(null);
      setLoaderName("");
      setLoaderNumber("");
      setLoaderModel("");
      router.refresh();
    });
  };

  const isAllLoadersSelected = displayLoaders.length > 0 && displayLoaders.every((l) => selectedLoaderIds.includes(l.id));

  const handleToggleSelectAllLoaders = () => {
    if (isAllLoadersSelected) setSelectedLoaderIds([]);
    else setSelectedLoaderIds(displayLoaders.map((l) => l.id));
  };

  const handleBulkDeleteLoaders = () => {
    if (!selectedLoaderIds.length) return;
    if (!confirm(`Remove ${selectedLoaderIds.length} selected loaders?`)) return;
    setIsBulkDeletingLoaders(true);
    startTransition(async () => {
      try {
        await deleteLoaders(selectedLoaderIds);
        setSelectedLoaderIds([]);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      } finally {
        setIsBulkDeletingLoaders(false);
      }
    });
  };

  const handleDeleteLoader = (id: string) => {
    if (!confirm("Remove this loader?")) return;
    setDeletingLoaderId(id);
    startTransition(async () => {
      try {
        await deleteLoader(id);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      } finally {
        setDeletingLoaderId(null);
      }
    });
  };

  const exportVehiclesData = displayRegistry.map((r) => ({
    "Code": r.code || "",
    "Name": r.dm_name || r.dm?.full_name || "",
    "Personnel": r.personnel || "",
    "Lic. Plate": r.truck_no || "",
    "Category": r.category || "",
    "Type": r.vehicle_type || "",
    "Model": r.model || "",
    "Brand": r.brand || "",
    "Year": r.year || "",
    "Cap. (Weight)": r.cap_weight || "",
    "Cap. (Volume)": r.cap_volume || "",
  }));

  const exportLoadersData = displayLoaders.map((l) => ({
    "Loader Name": l.loader?.full_name || l.loader_name || "",
    "Number": l.number,
    "Model": l.model,
  }));

  return (
    <div className="space-y-8">
      <input
        ref={vehicleFileInputRef}
        type="file"
        accept=".csv, .xlsx, .xls"
        className="hidden"
        onChange={handleImportVehiclesFile}
      />
      <input
        ref={dmFileInputRef}
        type="file"
        accept=".csv, .xlsx, .xls"
        className="hidden"
        onChange={handleImportDmsFile}
      />

      {importStatus && (
        <div
          className={`p-3 rounded-md text-sm flex items-center justify-between ${
            importStatus.isError ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
          }`}
        >
          <span>{importStatus.message}</span>
          <button
            type="button"
            className="text-xs underline hover:opacity-80"
            onClick={() => setImportStatus(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">Sale Vehicles</h2>
            <p className="text-xs text-zinc-500">
              {displayRegistry.length} vehicle{displayRegistry.length !== 1 ? "s" : ""} registered
            </p>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <Button
              type="button"
              variant={isAllRoutesSelected ? "ghost" : "outline"}
              size="sm"
              onClick={handleToggleSelectAllRoutes}
              className="whitespace-nowrap"
            >
              {isAllRoutesSelected ? "Deselect All" : "Select All"}
            </Button>
            {selectedRouteIds.length > 0 && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={handleBulkDeleteRoutes}
                disabled={isBulkDeletingRoutes || !!deletingRouteId}
                className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 whitespace-nowrap"
              >
                {isBulkDeletingRoutes ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Delete ({selectedRouteIds.length})
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => vehicleFileInputRef.current?.click()}
              disabled={isPending || isImportingVehicles}
              className="flex items-center gap-1.5 whitespace-nowrap"
              title="Import Vehicle List report (.xlsx, .xls, .csv)"
            >
              {isImportingVehicles ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span className="text-red-600 font-semibold">Importing...</span>
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Import Vehicle List
                </>
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => dmFileInputRef.current?.click()}
              disabled={isPending || isImportingDms}
              className="flex items-center gap-1.5 whitespace-nowrap"
              title="Import DM list report (.xlsx, .xls, .csv)"
            >
              {isImportingDms ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span className="text-red-600 font-semibold">Importing...</span>
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Import DM list
                </>
              )}
            </Button>

            <ExportButtons data={exportVehiclesData} filename="delivery_vehicles" />
            <Button onClick={openAddVehicleForm}>+ Add Sale Vehicle</Button>
          </div>
        </div>

        {showRouteForm && (
          <form
            onSubmit={handleVehicleSave}
            className="bg-zinc-50 p-4 rounded-lg border border-zinc-200 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3 items-end"
          >
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Code</label>
              <Input
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                placeholder="e.g. 101"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Name (DM Name)</label>
              <Input
                value={formDmName}
                onChange={(e) => setFormDmName(e.target.value)}
                placeholder="e.g. WARIS"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Personnel</label>
              <Input
                value={formPersonnel}
                onChange={(e) => setFormPersonnel(e.target.value)}
                placeholder="e.g. 10022 - WARIS"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Lic. Plate *</label>
              <Input
                value={formTruckNo}
                onChange={(e) => setFormTruckNo(e.target.value)}
                placeholder="e.g. LES-18-1133"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Category</label>
              <Input
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                placeholder="e.g. Truck / Van"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Type</label>
              <Input
                value={formVehicleType}
                onChange={(e) => setFormVehicleType(e.target.value)}
                placeholder="e.g. Commercial"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Model</label>
              <Input
                value={formModel}
                onChange={(e) => setFormModel(e.target.value)}
                placeholder="e.g. SHEHZOR"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Brand</label>
              <Input
                value={formBrand}
                onChange={(e) => setFormBrand(e.target.value)}
                placeholder="e.g. HYUNDAI"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Year</label>
              <Input
                value={formYear}
                onChange={(e) => setFormYear(e.target.value)}
                placeholder="e.g. 2018"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Cap. (Weight)</label>
              <Input
                value={formCapWeight}
                onChange={(e) => setFormCapWeight(e.target.value)}
                placeholder="e.g. 1.5 Ton"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Cap. (Volume)</label>
              <Input
                value={formCapVolume}
                onChange={(e) => setFormCapVolume(e.target.value)}
                placeholder="e.g. 350 cu.ft"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={isPending} className="flex items-center gap-1.5">
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingRouteId ? "Update" : "Save"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowRouteForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50/80">
                <TableHead className="w-10 text-center">
                  <input
                    type="checkbox"
                    checked={isAllRoutesSelected}
                    onChange={handleToggleSelectAllRoutes}
                    className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                  />
                </TableHead>
                <TableHead className="whitespace-nowrap">Code</TableHead>
                <TableHead className="whitespace-nowrap">Name</TableHead>
                <TableHead className="whitespace-nowrap">Personnel</TableHead>
                <TableHead className="whitespace-nowrap font-bold">Lic. Plate</TableHead>
                <TableHead className="whitespace-nowrap">Category</TableHead>
                <TableHead className="whitespace-nowrap">Type</TableHead>
                <TableHead className="whitespace-nowrap">Model</TableHead>
                <TableHead className="whitespace-nowrap">Brand</TableHead>
                <TableHead className="whitespace-nowrap">Year</TableHead>
                <TableHead className="whitespace-nowrap">Cap. (Weight)</TableHead>
                <TableHead className="whitespace-nowrap">Cap. (Volume)</TableHead>
                <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRegistry.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} className="text-center text-zinc-400 py-8">
                    No delivery vehicles registered yet. Click &quot;Import Vehicle List&quot; or &quot;+ Add Delivery Vehicle&quot; to get started.
                  </TableCell>
                </TableRow>
              ) : (
                displayRegistry.map((r) => (
                  <TableRow key={r.id} className={selectedRouteIds.includes(r.id) ? "bg-red-50/50" : ""}>
                    <TableCell className="w-10 text-center">
                      <input
                        type="checkbox"
                        checked={selectedRouteIds.includes(r.id)}
                        onChange={() =>
                          setSelectedRouteIds((prev) =>
                            prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                          )
                        }
                        className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                      />
                    </TableCell>
                    <TableCell className="text-xs font-mono">{r.code || "—"}</TableCell>
                    <TableCell className="font-semibold text-xs whitespace-nowrap text-zinc-900">{r.dm_name || r.dm?.full_name || "—"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-zinc-600">{r.personnel || "—"}</TableCell>
                    <TableCell className="font-mono text-xs font-bold text-red-700 whitespace-nowrap">{r.truck_no || "—"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{r.category || "—"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{r.vehicle_type || "—"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{r.model || "—"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{r.brand || "—"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{r.year || "—"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{r.cap_weight || "—"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{r.cap_volume || "—"}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEditVehicleForm(r)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-700"
                          onClick={() => handleDeleteRoute(r.id)}
                          disabled={deletingRouteId === r.id || isBulkDeletingRoutes}
                        >
                          {deletingRouteId === r.id ? (
                            <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                          ) : (
                            "Delete"
                          )}
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

      <div className="space-y-4 pt-4 border-t border-zinc-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-zinc-900">Folk Lifters</h2>
            <p className="text-xs text-zinc-500">
              {displayLoaders.length} loader{displayLoaders.length !== 1 ? "s" : ""} registered
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <Button
              type="button"
              variant={isAllLoadersSelected ? "ghost" : "outline"}
              size="sm"
              onClick={handleToggleSelectAllLoaders}
              className="whitespace-nowrap"
            >
              {isAllLoadersSelected ? "Deselect All" : "Select All"}
            </Button>
            {selectedLoaderIds.length > 0 && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={handleBulkDeleteLoaders}
                disabled={isBulkDeletingLoaders || !!deletingLoaderId}
                className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 whitespace-nowrap"
              >
                {isBulkDeletingLoaders ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Delete ({selectedLoaderIds.length})
              </Button>
            )}
            <ExportButtons data={exportLoadersData} filename="loaders_registry" />
            <Button onClick={openAddLoaderForm}>+ Add Folk Lifter</Button>
          </div>
        </div>

        {showLoaderForm && (
          <form
            onSubmit={handleLoaderSave}
            className="bg-zinc-50 p-4 rounded-lg border border-zinc-200 flex gap-4 items-end flex-wrap"
          >
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Loader Name *</label>
              <Input
                value={loaderName}
                onChange={(e) => setLoaderName(e.target.value)}
                placeholder="e.g. Ali Raza"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Number *</label>
              <Input
                value={loaderNumber}
                onChange={(e) => setLoaderNumber(e.target.value)}
                placeholder="e.g. AEV-5687"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Model *</label>
              <Input
                value={loaderModel}
                onChange={(e) => setLoaderModel(e.target.value)}
                placeholder="e.g. Model 2024 / Qingqi"
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={isPending} className="flex items-center gap-1.5">
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingLoaderId ? "Update" : "Save"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowLoaderForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-center">
                  <input
                    type="checkbox"
                    checked={isAllLoadersSelected}
                    onChange={handleToggleSelectAllLoaders}
                    className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                  />
                </TableHead>
                <TableHead>#</TableHead>
                <TableHead>Loader Name</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayLoaders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-zinc-400 py-8">
                    No loaders registered yet. Click &quot;+ Add Loader&quot; to register a vehicle loader.
                  </TableCell>
                </TableRow>
              ) : (
                displayLoaders.map((l, idx) => (
                  <TableRow key={l.id} className={selectedLoaderIds.includes(l.id) ? "bg-red-50/50" : ""}>
                    <TableCell className="w-10 text-center">
                      <input
                        type="checkbox"
                        checked={selectedLoaderIds.includes(l.id)}
                        onChange={() =>
                          setSelectedLoaderIds((prev) =>
                            prev.includes(l.id) ? prev.filter((id) => id !== l.id) : [...prev, l.id]
                          )
                        }
                        className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                      />
                    </TableCell>
                    <TableCell className="text-zinc-400 text-sm">{idx + 1}</TableCell>
                    <TableCell className="font-semibold">{l.loader_name || l.loader?.full_name || "—"}</TableCell>
                    <TableCell className="font-mono">{l.number}</TableCell>
                    <TableCell>{l.model}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEditLoaderForm(l)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-700"
                          onClick={() => handleDeleteLoader(l.id)}
                          disabled={deletingLoaderId === l.id || isBulkDeletingLoaders}
                        >
                          {deletingLoaderId === l.id ? (
                            <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                          ) : (
                            "Delete"
                          )}
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
    </div>
  );
}
