"use client";

import { useState, useRef, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Trash2, Plus, Upload, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
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
  createShop,
  updateShop,
  deleteShop,
  deleteShops,
  bulkImportOutlets,
  bulkImportTradeOutlets,
  blockShop,
  unblockShop,
  type ShopFormData,
} from "@/lib/actions/shops";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Papa from "papaparse";
import * as XLSX from "xlsx";

interface ShopDetailsClientProps {
  initialShops: any[];
}

export function ShopDetailsClient({ initialShops }: ShopDetailsClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isBlockingPending, startBlockingTransition] = useTransition();

  // File input refs for two separate import reports
  const outletsFileInputRef = useRef<HTMLInputElement>(null);
  const tradeFileInputRef = useRef<HTMLInputElement>(null);
  const [isImportingOutlets, setIsImportingOutlets] = useState(false);
  const [isImportingTrade, setIsImportingTrade] = useState(false);

  // Search & Filter states
  const [search, setSearch] = useState("");
  const [filerFilter, setFilerFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // Modal forms
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [outletCode, setOutletCode] = useState("");
  const [shopName, setShopName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [status, setStatus] = useState("Active");
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [subTradeChannel, setSubTradeChannel] = useState("");
  const [tradeChannel, setTradeChannel] = useState("");
  const [gps, setGps] = useState("");
  const [openDate, setOpenDate] = useState("");
  const [address, setAddress] = useState("");
  const [mainChannelDesc, setMainChannelDesc] = useState("");
  const [presellerName, setPresellerName] = useState("");
  const [segmentDesc, setSegmentDesc] = useState("");
  const [filerStatus, setFilerStatus] = useState<"Yes" | "No" | "Partial">("No");
  const [phone, setPhone] = useState("");
  const [outletType, setOutletType] = useState("");

  const getFilerDisplay = (shop: any): "Yes" | "No" | "Partial" => {
    if (shop.filer_status) {
      const f = String(shop.filer_status).trim();
      if (f === "Partial") return "Partial";
      if (f === "Yes") return "Yes";
      return "No";
    }
    return shop.is_filer ? "Yes" : "No";
  };

  const getTypeDisplay = (shop: any): "Cash" | "Credit" | "" => {
    const t = String(shop.outlet_type || "").trim().toLowerCase();
    if (t === "credit") return "Credit";
    if (t === "cash") return "Cash";
    return "";
  };

  // All active shops
  const activeShops = initialShops.filter((s) => !s.is_blocked);

  const filteredShops = activeShops.filter((s) => {
    if (filerFilter !== "all") {
      const f = getFilerDisplay(s).toLowerCase();
      if (f !== filerFilter.toLowerCase()) return false;
    }
    if (typeFilter !== "all") {
      const t = getTypeDisplay(s).toLowerCase();
      if (t !== typeFilter.toLowerCase()) return false;
    }
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      (s.shop_name && s.shop_name.toLowerCase().includes(term)) ||
      (s.outlet_code && s.outlet_code.toLowerCase().includes(term)) ||
      (s.owner_name && s.owner_name.toLowerCase().includes(term)) ||
      (s.status && s.status.toLowerCase().includes(term)) ||
      (s.tax_number && s.tax_number.toLowerCase().includes(term)) ||
      (s.sub_trade_channel && s.sub_trade_channel.toLowerCase().includes(term)) ||
      (s.trade_channel && s.trade_channel.toLowerCase().includes(term)) ||
      (s.gps && s.gps.toLowerCase().includes(term)) ||
      (s.open_date && s.open_date.toLowerCase().includes(term)) ||
      (s.address && s.address.toLowerCase().includes(term)) ||
      (s.main_channel_desc && s.main_channel_desc.toLowerCase().includes(term)) ||
      (s.preseller_name && s.preseller_name.toLowerCase().includes(term)) ||
      (s.segment_desc && s.segment_desc.toLowerCase().includes(term)) ||
      (s.phone && s.phone.toLowerCase().includes(term)) ||
      (s.filer_status && s.filer_status.toLowerCase().includes(term)) ||
      (s.outlet_type && s.outlet_type.toLowerCase().includes(term)) ||
      (s.shop_type && s.shop_type.toLowerCase().includes(term))
    );
  });

  const isAllSelected =
    filteredShops.length > 0 &&
    filteredShops.every((s) => selectedIds.includes(s.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(filteredShops.map((s) => s.id));
  };

  const handleEdit = (shop: any) => {
    setEditingId(shop.id);
    setOutletCode(shop.outlet_code || "");
    setShopName(shop.shop_name || "");
    setOwnerName(shop.owner_name || "");
    setStatus(shop.is_blocked ? "Blocked" : shop.status || "Active");
    setIsBlocked(!!shop.is_blocked);
    setBlockReason(shop.block_reason || "");
    setTaxNumber(shop.tax_number || "");
    setSubTradeChannel(shop.sub_trade_channel || "");
    setTradeChannel(shop.trade_channel || "");
    setGps(shop.gps || "");
    setOpenDate(shop.open_date || "");
    setAddress(shop.address || "");
    setMainChannelDesc(shop.main_channel_desc || "");
    setPresellerName(shop.preseller_name || "");
    setSegmentDesc(shop.segment_desc || "");
    setFilerStatus(getFilerDisplay(shop));
    setPhone(shop.phone || "");
    setOutletType(getTypeDisplay(shop));
    setShowModal(true);
  };

  const handleOpenAddModal = () => {
    setEditingId(null);
    setOutletCode("");
    setShopName("");
    setOwnerName("");
    setStatus("Active");
    setIsBlocked(false);
    setBlockReason("");
    setTaxNumber("");
    setSubTradeChannel("");
    setTradeChannel("");
    setGps("");
    setOpenDate("");
    setAddress("");
    setMainChannelDesc("");
    setPresellerName("");
    setSegmentDesc("");
    setFilerStatus("No");
    setPhone("");
    setOutletType("");
    setShowModal(true);
  };

  const handleBlockShopAction = () => {
    if (!editingId) return;
    if (!blockReason.trim()) {
      alert("A reason is required to block a shop.");
      return;
    }
    startBlockingTransition(async () => {
      try {
        await blockShop(editingId, blockReason.trim());
        setIsBlocked(true);
        setStatus("Blocked");
        router.refresh();
        alert("Shop account blocked successfully.");
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleUnblockShopAction = () => {
    if (!editingId) return;
    startBlockingTransition(async () => {
      try {
        await unblockShop(editingId);
        setIsBlocked(false);
        setBlockReason("");
        setStatus("Active");
        router.refresh();
        alert("Shop account unblocked successfully.");
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected shop(s)?`)) return;
    setIsBulkDeleting(true);
    startTransition(async () => {
      try {
        await deleteShops(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      } finally {
        setIsBulkDeleting(false);
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this shop?")) return;
    setDeletingId(id);
    startTransition(async () => {
      try {
        await deleteShop(id);
        setSelectedIds((prev) => prev.filter((item) => item !== id));
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      } finally {
        setDeletingId(null);
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    startTransition(async () => {
      try {
        const payload: Partial<ShopFormData> = {
          outlet_code: outletCode.trim(),
          shop_name: shopName.trim(),
          owner_name: ownerName.trim(),
          status: status.trim() || "Active",
          tax_number: taxNumber.trim(),
          sub_trade_channel: subTradeChannel.trim(),
          trade_channel: tradeChannel.trim(),
          gps: gps.trim(),
          open_date: openDate.trim(),
          address: address.trim(),
          main_channel_desc: mainChannelDesc.trim(),
          preseller_name: presellerName.trim(),
          segment_desc: segmentDesc.trim(),
          filer_status: filerStatus,
          is_filer: filerStatus === "Yes",
          phone: phone.trim(),
          outlet_type: outletType.trim(),
        };

        if (editingId) {
          await updateShop(editingId, payload);
        } else {
          await createShop(payload);
        }

        setShowModal(false);
        setEditingId(null);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  // Helper to read file rows
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

  // 1. IMPORT OUTLETS (Outlets Reports.xlsx)
  const handleImportOutletsFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImportingOutlets(true);

    try {
      const rawRows = await parseUploadedFile(file);

      startTransition(async () => {
        try {
          const listToImport: Partial<ShopFormData>[] = rawRows
            .map((row: any) => {
              const code = String(row["Code"] || row["code"] || row["Outlet Code"] || row["outlet_code"] || "").trim();
              const title = String(row["Title"] || row["title"] || row["Outlet Name"] || row["shop_name"] || "").trim();
              const relatedPerson = String(row["Related Person"] || row["related_person"] || row["Owner Name"] || row["owner_name"] || "").trim();
              const st = String(row["Status"] || row["status"] || "Active").trim();

              const rawTax = row["Tax Number"] !== undefined ? row["Tax Number"] : row["tax_number"];
              const strTax = rawTax !== undefined && rawTax !== null ? String(rawTax).trim() : "";

              // Filer logic:
              // !=0 && not empty -> Yes
              // ==0 -> Partial
              // empty -> No
              let fStatus: "Yes" | "No" | "Partial" = "No";
              if (strTax === "0") {
                fStatus = "Partial";
              } else if (strTax !== "") {
                fStatus = "Yes";
              }

              const subTrade = String(row["Sub Trade Channel"] || row["sub_trade_channel"] || "").trim();
              const trade = String(row["Trade Channel"] || row["trade_channel"] || "").trim();
              const gpsVal = String(row["GPS"] || row["gps"] || "").trim();

              let openDateVal = "";
              const rawDate = row["Open Date"] !== undefined ? row["Open Date"] : row["open_date"];
              if (typeof rawDate === "number") {
                openDateVal = new Date(Math.round((rawDate - 25569) * 86400 * 1000)).toISOString().split("T")[0];
              } else if (rawDate) {
                openDateVal = String(rawDate).trim();
              }

              const phone = String(row["Phone"] || row["phone"] || row["Mobile"] || row["mobile"] || row["Contact"] || row["Phone Number"] || row["phone_number"] || "").trim();
              const rawType = String(row["Type"] || row["type"] || row["Outlet Type"] || row["outlet_type"] || row["Shop Type"] || row["shop_type"] || "").trim();
              let parsedType = "";
              if (rawType.toLowerCase() === "credit" || rawType.toLowerCase().includes("cred")) {
                parsedType = "Credit";
              } else if (rawType.toLowerCase() === "cash") {
                parsedType = "Cash";
              } else if (rawType) {
                parsedType = rawType;
              }

              const item: any = {
                outlet_code: code,
                shop_name: title,
                owner_name: relatedPerson,
                status: st || "Active",
                tax_number: strTax,
                sub_trade_channel: subTrade,
                trade_channel: trade,
                gps: gpsVal,
                open_date: openDateVal,
                filer_status: fStatus,
                is_filer: fStatus === "Yes",
              };
              if (phone) item.phone = phone;
              if (parsedType) {
                item.outlet_type = parsedType;
                item.shop_type = parsedType.toLowerCase() === "credit" ? "credit" : "cash";
              }

              return item;
            })
            .filter((s) => s.outlet_code || s.shop_name);

          if (listToImport.length === 0) {
            alert("No valid outlet records found in file.");
            return;
          }

          await bulkImportOutlets(listToImport);
          router.refresh();
          alert(`Successfully imported ${listToImport.length} outlets.`);
        } catch (err: any) {
          alert(`Import Outlets failed: ${err.message}`);
        } finally {
          setIsImportingOutlets(false);
        }
      });
    } catch (err: any) {
      alert(`Failed to parse file: ${err.message}`);
      setIsImportingOutlets(false);
    }

    if (outletsFileInputRef.current) {
      outletsFileInputRef.current.value = "";
    }
  };

  // 2. IMPORT TRADE OUTLETS (Outlet Trade.xlsx)
  const handleImportTradeFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImportingTrade(true);

    try {
      const rawRows = await parseUploadedFile(file);

      startTransition(async () => {
        try {
            const listToImport = rawRows
            .map((row: any) => {
              const code = String(row["Outlet Code"] || row["outlet_code"] || row["Code"] || row["code"] || "").trim();
              const outletName = String(row["Outlet Name"] || row["outlet_name"] || row["Title"] || row["title"] || "").trim();
              const addr = String(row["Address"] || row["address"] || "").trim();
              const channel = String(row["Main Channel Desc"] || row["main_channel_desc"] || "").trim();
              const preseller = String(row["Preseller Name"] || row["preseller_name"] || "").trim();
              const segment = String(row["Segment Desc"] || row["segment_desc"] || "").trim();
              const phone = String(row["Phone"] || row["phone"] || row["Mobile"] || row["mobile"] || row["Contact"] || row["Phone Number"] || row["phone_number"] || "").trim();
              const rawType = String(row["Type"] || row["type"] || row["Outlet Type"] || row["outlet_type"] || row["Shop Type"] || row["shop_type"] || "").trim();
              let parsedType = "";
              if (rawType.toLowerCase() === "credit" || rawType.toLowerCase().includes("cred")) {
                parsedType = "Credit";
              } else if (rawType.toLowerCase() === "cash") {
                parsedType = "Cash";
              } else if (rawType) {
                parsedType = rawType;
              }

              const item: any = {
                outlet_code: code,
                outlet_name: outletName || undefined,
                address: addr,
                main_channel_desc: channel,
                preseller_name: preseller,
                segment_desc: segment,
              };
              if (phone) item.phone = phone;
              if (parsedType) {
                item.outlet_type = parsedType;
                item.shop_type = parsedType.toLowerCase() === "credit" ? "credit" : "cash";
              }

              return item;
            })
            .filter((s) => s.outlet_code);

          if (listToImport.length === 0) {
            alert("No trade outlet records found in file.");
            return;
          }

          const res = await bulkImportTradeOutlets(listToImport);
          router.refresh();
          alert(
            `Trade details updated for ${res.updated ?? 0} of ${listToImport.length} outlets.` +
              (res.failed
                ? `\n${res.failed} failed, e.g.:\n` +
                  (res.failures || []).map((f: any) => `${f.outlet_code}: ${f.error}`).join("\n")
                : "")
          );
        } catch (err: any) {
          alert(`Import Trade Outlets failed: ${err.message}`);
        } finally {
          setIsImportingTrade(false);
        }
      });
    } catch (err: any) {
      alert(`Failed to parse file: ${err.message}`);
      setIsImportingTrade(false);
    }

    if (tradeFileInputRef.current) {
      tradeFileInputRef.current.value = "";
    }
  };

  // Export matching updated Outlets table fields
  const exportData = filteredShops.map((s) => ({
    "Code": s.outlet_code || "",
    "Title": s.shop_name || "",
    "Related Person": s.owner_name || "",
    "Status": s.status || "Active",
    "Tax Number": s.tax_number || "",
    "Sub Trade Channel": s.sub_trade_channel || "",
    "Trade Channel": s.trade_channel || "",
    "GPS": s.gps || "",
    "Open Date": s.open_date || "",
    "Address": s.address || "",
    "Main Channel Desc": s.main_channel_desc || "",
    "Preseller Name": s.preseller_name || "",
    "Segment Desc": s.segment_desc || "",
    "Filer": getFilerDisplay(s),
    "Phone": s.phone || "",
    "Type": getTypeDisplay(s),
  }));

  return (
    <div className="space-y-6">
      {/* Top Toolbar */}
      <div className="flex flex-wrap justify-between items-center gap-4 bg-white p-4 rounded-xl border border-zinc-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[16.25rem]">
          <div className="max-w-xs w-full">
            <Input
              placeholder="Search by Code, Title, Related Person..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-zinc-500">Filer:</span>
            <select
              value={filerFilter}
              onChange={(e) => setFilerFilter(e.target.value)}
              className="h-9 text-xs rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-zinc-800 focus:outline-none focus:ring-2 focus:ring-red-500 cursor-pointer"
            >
              <option value="all">All Filers</option>
              <option value="yes">Yes</option>
              <option value="partial">Partial</option>
              <option value="no">No</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-zinc-500">Type:</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-9 text-xs rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-zinc-800 focus:outline-none focus:ring-2 focus:ring-red-500 cursor-pointer"
            >
              <option value="all">All Types</option>
              <option value="cash">Cash</option>
              <option value="credit">Credit</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
              disabled={isBulkDeleting || !!deletingId}
              className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 whitespace-nowrap"
            >
              {isBulkDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete ({selectedIds.length})
            </Button>
          )}

          {/* 1. Import Outlets */}
          <input
            ref={outletsFileInputRef}
            type="file"
            accept=".csv, .xlsx, .xls"
            className="hidden"
            onChange={(e) => { setIsImportingOutlets(true); handleImportOutletsFile(e); }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => outletsFileInputRef.current?.click()}
            disabled={isImportingOutlets}
            className="flex items-center gap-1.5 border-zinc-300 hover:border-zinc-400"
            title="Import Outlets Report (Outlets Reports.xlsx)"
          >
            {isImportingOutlets ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                <span className="text-red-600 font-semibold">Importing...</span>
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 text-blue-600" />
                Import Outlets
              </>
            )}
          </Button>

          {/* 2. Import Trade Outlets */}
          <input
            ref={tradeFileInputRef}
            type="file"
            accept=".csv, .xlsx, .xls"
            className="hidden"
            onChange={(e) => { setIsImportingTrade(true); handleImportTradeFile(e); }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => tradeFileInputRef.current?.click()}
            disabled={isImportingTrade}
            className="flex items-center gap-1.5 border-zinc-300 hover:border-zinc-400"
            title="Import Trade Outlets Report (Outlet Trade.xlsx)"
          >
            {isImportingTrade ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                <span className="text-red-600 font-semibold">Importing...</span>
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 text-emerald-600" />
                Import Trade Outlets
              </>
            )}
          </Button>

          {/* Add Shop */}
          <Button
            size="sm"
            onClick={handleOpenAddModal}
            className="bg-[#e51e2a] hover:bg-[#c01520] text-white flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Add Shop
          </Button>
        </div>
      </div>

      {/* Outlets Table */}
      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-200 flex flex-wrap justify-between items-center gap-3 bg-zinc-50/50">
          <div className="font-semibold text-zinc-800 text-sm">
            All Outlets ({filteredShops.length})
          </div>
          <ExportButtons data={exportData} filename="shops_directory" />
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50/80 text-xs">
                <TableHead className="w-10 text-center">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleToggleSelectAll}
                    className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                  />
                </TableHead>
                <TableHead className="whitespace-nowrap">Code</TableHead>
                <TableHead className="whitespace-nowrap">Title</TableHead>
                <TableHead className="whitespace-nowrap">Related Person</TableHead>
                <TableHead className="whitespace-nowrap">Status</TableHead>
                <TableHead className="whitespace-nowrap">Tax Number</TableHead>
                <TableHead className="whitespace-nowrap">Sub Trade Channel</TableHead>
                <TableHead className="whitespace-nowrap">Trade Channel</TableHead>
                <TableHead className="whitespace-nowrap">GPS</TableHead>
                <TableHead className="whitespace-nowrap">Open Date</TableHead>
                <TableHead className="whitespace-nowrap">Address</TableHead>
                <TableHead className="whitespace-nowrap">Main Channel Desc</TableHead>
                <TableHead className="whitespace-nowrap">Preseller Name</TableHead>
                <TableHead className="whitespace-nowrap">Segment Desc</TableHead>
                <TableHead className="whitespace-nowrap text-center">Filer</TableHead>
                <TableHead className="whitespace-nowrap">Phone</TableHead>
                <TableHead className="whitespace-nowrap">Type</TableHead>
                <TableHead className="text-right whitespace-nowrap">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredShops.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={18} className="text-center text-zinc-400 py-10">
                    No outlets found
                  </TableCell>
                </TableRow>
              ) : (
                filteredShops.map((shop) => {
                  const filer = getFilerDisplay(shop);
                  return (
                    <TableRow
                      key={shop.id}
                      className={selectedIds.includes(shop.id) ? "bg-red-50/40" : "hover:bg-zinc-50/60"}
                    >
                      <TableCell className="w-10 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(shop.id)}
                          onChange={() =>
                            setSelectedIds((prev) =>
                              prev.includes(shop.id)
                                ? prev.filter((id) => id !== shop.id)
                                : [...prev, shop.id]
                            )
                          }
                          className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                        />
                      </TableCell>
                      <TableCell className="font-bold text-zinc-800 whitespace-nowrap">
                        {shop.outlet_code || "—"}
                      </TableCell>
                      <TableCell className="font-semibold whitespace-nowrap">
                        <Link
                          href={`/shop-details/${shop.id}`}
                          className="text-red-600 hover:text-red-900 transition-colors"
                        >
                          {shop.shop_name || "—"}
                        </Link>
                      </TableCell>
                      <TableCell className="text-zinc-700 whitespace-nowrap">
                        {shop.owner_name || "—"}
                      </TableCell>
                      <TableCell className="text-zinc-600 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                          shop.is_blocked
                            ? "bg-red-100 text-red-700 border border-red-300"
                            : (shop.status || "").toLowerCase() === "active"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium"
                            : "bg-zinc-100 text-zinc-600 font-medium"
                        }`}>
                          {shop.is_blocked ? "Blocked" : shop.status || "Active"}
                        </span>
                      </TableCell>
                      <TableCell className="text-zinc-600 whitespace-nowrap font-mono text-xs">
                        {shop.tax_number || "—"}
                      </TableCell>
                      <TableCell className="text-zinc-600 whitespace-nowrap">
                        {shop.sub_trade_channel || "—"}
                      </TableCell>
                      <TableCell className="text-zinc-600 whitespace-nowrap">
                        {shop.trade_channel || "—"}
                      </TableCell>
                      <TableCell className="text-zinc-600 whitespace-nowrap">
                        {shop.gps || "—"}
                      </TableCell>
                      <TableCell className="text-zinc-600 whitespace-nowrap">
                        {shop.open_date || "—"}
                      </TableCell>
                      <TableCell className="text-zinc-600 max-w-xs truncate" title={shop.address || ""}>
                        {shop.address || "—"}
                      </TableCell>
                      <TableCell className="text-zinc-600 whitespace-nowrap">
                        {shop.main_channel_desc || "—"}
                      </TableCell>
                      <TableCell className="text-zinc-600 whitespace-nowrap">
                        {shop.preseller_name || "—"}
                      </TableCell>
                      <TableCell className="text-zinc-600 whitespace-nowrap">
                        {shop.segment_desc || "—"}
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        <Badge
                          variant="outline"
                          className={
                            filer === "Yes"
                              ? "border-green-200 text-green-700 bg-green-50"
                              : filer === "Partial"
                              ? "border-amber-200 text-amber-700 bg-amber-50"
                              : "border-zinc-200 text-zinc-500 bg-zinc-50"
                          }
                        >
                          {filer}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-zinc-600 whitespace-nowrap">
                        {shop.phone || "—"}
                      </TableCell>
                      <TableCell className="text-zinc-600 whitespace-nowrap">
                        {getTypeDisplay(shop) ? (
                          <Badge
                            variant="outline"
                            className={
                              getTypeDisplay(shop) === "Credit"
                                ? "border-purple-200 text-purple-700 bg-purple-50"
                                : "border-blue-200 text-blue-700 bg-blue-50"
                            }
                          >
                            {getTypeDisplay(shop)}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEdit(shop)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500 hover:text-red-700"
                            onClick={() => handleDelete(shop.id)}
                            disabled={deletingId === shop.id || isBulkDeleting}
                          >
                            {deletingId === shop.id ? (
                              <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                            ) : (
                              "Delete"
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ADD / EDIT OUTLET MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-zinc-900 mb-4">
              {editingId ? "Edit Outlet Record" : "Add Outlet Record"}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Code
                  </label>
                  <Input
                    placeholder="e.g. 3009753479"
                    value={outletCode}
                    onChange={(e) => setOutletCode(e.target.value)}
                    disabled={!!editingId}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Title
                  </label>
                  <Input
                    placeholder="e.g. 7 day mart"
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Related Person
                  </label>
                  <Input
                    placeholder="e.g. Mirza Tahir"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Status
                  </label>
                  <select
                    className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white"
                    value={isBlocked ? "Blocked" : status}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "Blocked") {
                        setIsBlocked(true);
                        setStatus("Blocked");
                      } else {
                        setIsBlocked(false);
                        setStatus(val);
                      }
                    }}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Blocked">Blocked</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Tax Number
                  </label>
                  <Input
                    placeholder="e.g. 8873669-3 or 0"
                    value={taxNumber}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTaxNumber(val);
                      if (val.trim() === "0") setFilerStatus("Partial");
                      else if (val.trim() !== "") setFilerStatus("Yes");
                      else setFilerStatus("No");
                    }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Filer
                  </label>
                  <select
                    className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white"
                    value={filerStatus}
                    onChange={(e) => setFilerStatus(e.target.value as any)}
                  >
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                    <option value="Partial">Partial</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Sub Trade Channel
                  </label>
                  <Input
                    placeholder="e.g. Supermarket-Small"
                    value={subTradeChannel}
                    onChange={(e) => setSubTradeChannel(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Trade Channel
                  </label>
                  <Input
                    placeholder="e.g. SUPERMARKET"
                    value={tradeChannel}
                    onChange={(e) => setTradeChannel(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    GPS
                  </label>
                  <Input
                    placeholder="e.g. GPS"
                    value={gps}
                    onChange={(e) => setGps(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Open Date
                  </label>
                  <Input
                    placeholder="e.g. 2024-03-13"
                    value={openDate}
                    onChange={(e) => setOpenDate(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Address
                </label>
                <Input
                  placeholder="e.g. RAJOKEY RAJOKEY"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Main Channel Desc
                  </label>
                  <Input
                    placeholder="e.g. ON-PREMISE"
                    value={mainChannelDesc}
                    onChange={(e) => setMainChannelDesc(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Preseller Name
                  </label>
                  <Input
                    placeholder="e.g. GJ USMAN IQBAL"
                    value={presellerName}
                    onChange={(e) => setPresellerName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Segment Desc
                  </label>
                  <Input
                    placeholder="e.g. SILVER"
                    value={segmentDesc}
                    onChange={(e) => setSegmentDesc(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Phone (Optional / Edit Later)
                  </label>
                  <Input
                    placeholder="e.g. 03314272223"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Type (Cash / Credit)
                  </label>
                  <select
                    className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white"
                    value={outletType}
                    onChange={(e) => setOutletType(e.target.value)}
                  >
                    <option value="">— Select Type (Empty) —</option>
                    <option value="Cash">Cash</option>
                    <option value="Credit">Credit</option>
                  </select>
                </div>
              </div>

              {/* Block Shop Section (Available when editing an existing outlet) */}
              {editingId && (
                <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-zinc-900 flex items-center gap-2">
                        <span>Block Shop Status</span>
                        {isBlocked ? (
                          <Badge variant="destructive" className="font-bold">BLOCKED</Badge>
                        ) : (
                          <Badge variant="success" className="font-medium">ACTIVE</Badge>
                        )}
                      </div>
                      <p className="text-[0.6875rem] text-zinc-500 mt-0.5">
                        Block this shop from receiving further credit or deliveries with a required reason.
                      </p>
                    </div>
                  </div>

                  {isBlocked ? (
                    <div className="space-y-2 pt-1">
                      <div className="text-xs text-red-700 bg-red-50 p-2.5 rounded border border-red-200">
                        <span className="font-semibold">Reason for Block:</span> {blockReason || "No reason specified"}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleUnblockShopAction}
                        disabled={isBlockingPending}
                        className="text-zinc-700 border-zinc-300"
                      >
                        {isBlockingPending ? "Unblocking..." : "Unblock Shop Account"}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3 pt-1">
                      <div>
                        <label className="block text-xs font-semibold text-zinc-700 mb-1">
                          Reason to Block *
                        </label>
                        <Input
                          placeholder="e.g. 60+ days overdue, no response"
                          value={blockReason}
                          onChange={(e) => setBlockReason(e.target.value)}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={handleBlockShopAction}
                        disabled={isBlockingPending || !blockReason.trim()}
                        className="bg-red-600 hover:bg-red-700 text-white"
                      >
                        {isBlockingPending ? "Blocking Account..." : "Block Shop Account"}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-3">
                <Button type="submit" className="flex-1 bg-[#e51e2a] hover:bg-[#c01520] text-white" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Outlet"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
