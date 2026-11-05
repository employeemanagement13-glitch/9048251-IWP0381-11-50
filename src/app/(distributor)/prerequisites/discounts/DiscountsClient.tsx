"use client";

import { useState, useMemo, useTransition } from "react";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { ExportButtons } from "@/components/export/ExportButtons";
import { Plus, Trash2, Edit2, Search, X, Check, Tag, Loader2 } from "lucide-react";
import {
  createDiscountConfig,
  updateDiscountConfig,
  deleteDiscountConfig,
} from "@/lib/actions/discounts";
import { PERMANENT_FROM, PERMANENT_TO } from "@/lib/discount-constants";

const isPermanent = (fromDate: string, toDate: string) =>
  fromDate <= "1900-01-02" || toDate >= "2099-01-01";

interface ProductItem {
  id: string;
  product_name: string;
  product_code?: string | null;
  sale_rate?: number;
}

interface ShopItem {
  id: string;
  outlet_code: string;
  shop_name: string;
  preseller_name?: string | null;
}

interface PresellerItem {
  id: string;
  full_name: string;
  employee_code?: string;
}

interface DiscountProductConfig {
  productId: string;
  productName: string;
  saleRate: number;
  discountedRate: number;
}

interface DiscountRecord {
  id: string;
  outletCode: string;
  shopId: string;
  shopName: string;
  fromDate: string;
  toDate: string;
  products: DiscountProductConfig[];
  givenByType: "owner" | "preseller";
  givenByName: string;
  presellerId?: string;
}

interface Props {
  shops: ShopItem[];
  products: ProductItem[];
  presellers: PresellerItem[];
  initialConfigs: any[];
}

function mapConfig(cfg: any): DiscountRecord {
  return {
    id: cfg.id,
    outletCode: cfg.shop?.outlet_code || "",
    shopId: cfg.shop_id,
    shopName: cfg.shop?.shop_name || "",
    fromDate: cfg.from_date,
    toDate: cfg.to_date,
    givenByType: cfg.given_by_type,
    givenByName:
      cfg.given_by_type === "preseller" && cfg.preseller?.full_name
        ? cfg.preseller.full_name
        : "Owner",
    presellerId: cfg.preseller_id || undefined,
    products: (cfg.discount_config_products || []).map((dp: any) => ({
      productId: dp.product_id,
      productName: dp.product?.product_name || "",
      saleRate: Number(dp.sale_rate),
      discountedRate: Number(dp.discounted_rate),
    })),
  };
}

export function DiscountsClient({ shops, products, presellers, initialConfigs }: Props) {
  const [discountList, setDiscountList] = useState<DiscountRecord[]>(
    (initialConfigs || []).map(mapConfig)
  );
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [filterGivenBy, setFilterGivenBy] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formFromDate, setFormFromDate] = useState("");
  const [formToDate, setFormToDate] = useState("");
  const [formIsPermanent, setFormIsPermanent] = useState(false);
  const [formShopId, setFormShopId] = useState("");
  const [shopSearchQuery, setShopSearchQuery] = useState("");
  const [isShopDropdownOpen, setIsShopDropdownOpen] = useState(false);

  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [selectedProductConfigs, setSelectedProductConfigs] = useState<DiscountProductConfig[]>([]);
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);

  const [formGivenByType, setFormGivenByType] = useState<"owner" | "preseller">("owner");
  const [formPresellerId, setFormPresellerId] = useState("");

  const filteredShopsForDropdown = useMemo(() => {
    if (!shopSearchQuery.trim()) return shops;
    const q = shopSearchQuery.toLowerCase();
    return shops.filter(
      (s) =>
        s.outlet_code?.toLowerCase().includes(q) ||
        s.shop_name?.toLowerCase().includes(q)
    );
  }, [shops, shopSearchQuery]);

  const filteredProductsForDropdown = useMemo(() => {
    if (!productSearchQuery.trim()) return products;
    const q = productSearchQuery.toLowerCase();
    return products.filter(
      (p) =>
        p.product_code?.toLowerCase().includes(q) ||
        p.product_name?.toLowerCase().includes(q)
    );
  }, [products, productSearchQuery]);

  const openAddModal = () => {
    setEditingId(null);
    setFormIsPermanent(false);
    setFormFromDate(new Date().toISOString().split("T")[0]);
    setFormToDate(new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0]);
    setFormShopId("");
    setShopSearchQuery("");
    setSelectedProductConfigs([]);
    setProductSearchQuery("");
    setFormGivenByType("owner");
    setFormPresellerId(presellers[0]?.id || "");
    setError(null);
    setShowModal(true);
  };

  const openEditModal = (rec: DiscountRecord) => {
    setEditingId(rec.id);
    const perm = isPermanent(rec.fromDate, rec.toDate);
    setFormIsPermanent(perm);
    setFormFromDate(perm ? new Date().toISOString().split("T")[0] : rec.fromDate);
    setFormToDate(perm ? new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0] : rec.toDate);
    setFormShopId(rec.shopId);
    const sh = shops.find((s) => s.id === rec.shopId);
    setShopSearchQuery(sh ? `${sh.outlet_code} — ${sh.shop_name}` : "");
    setSelectedProductConfigs([...rec.products]);
    setProductSearchQuery("");
    setFormGivenByType(rec.givenByType);
    setFormPresellerId(rec.presellerId || presellers[0]?.id || "");
    setError(null);
    setShowModal(true);
  };

  const handleToggleProduct = (product: ProductItem) => {
    const exists = selectedProductConfigs.find((p) => p.productId === product.id);
    if (exists) {
      setSelectedProductConfigs((prev) => prev.filter((p) => p.productId !== product.id));
    } else {
      const saleRate = Number(product.sale_rate || 0);
      setSelectedProductConfigs((prev) => [
        ...prev,
        {
          productId: product.id,
          productName: product.product_name,
          saleRate,
          discountedRate: saleRate > 10 ? saleRate - 10 : saleRate,
        },
      ]);
    }
  };

  const handleUpdateDiscountedRate = (productId: string, val: number) => {
    setSelectedProductConfigs((prev) =>
      prev.map((p) => (p.productId === productId ? { ...p, discountedRate: val } : p))
    );
  };


  const handleSave = async () => {
    if (!formShopId || selectedProductConfigs.length === 0) {
      setError("Please fill all required fields and select at least one product.");
      return;
    }
    if (!formIsPermanent && (!formFromDate || !formToDate)) {
      setError("Please fill the date range for a Temporary discount.");
      return;
    }
    if (formGivenByType === "preseller" && !formPresellerId) {
      setError("Please select a preseller.");
      return;
    }

    const resolvedFrom = formIsPermanent ? PERMANENT_FROM : formFromDate;
    const resolvedTo = formIsPermanent ? PERMANENT_TO : formToDate;

    setSaving(true);
    setError(null);

    try {
      const input = {
        shop_id: formShopId,
        from_date: resolvedFrom,
        to_date: resolvedTo,
        given_by_type: formGivenByType,
        preseller_id: formGivenByType === "preseller" ? formPresellerId : null,
        products: selectedProductConfigs.map((p) => ({
          product_id: p.productId,
          sale_rate: p.saleRate,
          discounted_rate: p.discountedRate,
        })),
      };

      const shop = shops.find((s) => s.id === formShopId)!;
      const preseller = presellers.find((p) => p.id === formPresellerId);

      if (editingId) {
        await updateDiscountConfig(editingId, input);
        setDiscountList((prev) =>
          prev.map((item) =>
            item.id === editingId
              ? {
                  ...item,
                  outletCode: shop.outlet_code,
                  shopId: shop.id,
                  shopName: shop.shop_name,
                  fromDate: resolvedFrom,
                  toDate: resolvedTo,
                  products: selectedProductConfigs,
                  givenByType: formGivenByType,
                  givenByName:
                    formGivenByType === "preseller" && preseller
                      ? preseller.full_name
                      : "Owner",
                  presellerId: formGivenByType === "preseller" ? formPresellerId : undefined,
                }
              : item
          )
        );
      } else {
        const created = await createDiscountConfig(input);
        const newRec: DiscountRecord = {
          id: created.id,
          outletCode: shop.outlet_code,
          shopId: shop.id,
          shopName: shop.shop_name,
          fromDate: resolvedFrom,
          toDate: resolvedTo,
          products: selectedProductConfigs,
          givenByType: formGivenByType,
          givenByName:
            formGivenByType === "preseller" && preseller
              ? preseller.full_name
              : "Owner",
          presellerId: formGivenByType === "preseller" ? formPresellerId : undefined,
        };
        setDiscountList((prev) => [newRec, ...prev]);
      }

      setShowModal(false);
    } catch (err: any) {
      setError(err?.message || "Failed to save discount configuration.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this discount record?")) return;
    setDeletingId(id);
    startTransition(async () => {
      try {
        await deleteDiscountConfig(id);
        setDiscountList((prev) => prev.filter((d) => d.id !== id));
        setSelectedIds((prev) => prev.filter((i) => i !== id));
      } catch (err: any) {
        alert(err?.message || "Failed to delete.");
      } finally {
        setDeletingId(null);
      }
    });
  };

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Delete ${selectedIds.length} selected discount record(s)?`)) return;
    setIsBulkDeleting(true);
    startTransition(async () => {
      try {
        await Promise.all(selectedIds.map((id) => deleteDiscountConfig(id)));
        setDiscountList((prev) => prev.filter((d) => !selectedIds.includes(d.id)));
        setSelectedIds([]);
      } catch (err: any) {
        alert(err?.message || "Failed to delete.");
      } finally {
        setIsBulkDeleting(false);
      }
    });
  };

  const filteredDiscounts = useMemo(() => {
    let list = discountList;

    if (filterGivenBy === "owner") {
      list = list.filter((d) => d.givenByType === "owner");
    } else if (filterGivenBy === "preseller") {
      list = list.filter((d) => d.givenByType === "preseller");
    } else if (filterGivenBy.startsWith("preseller:")) {
      const pId = filterGivenBy.replace("preseller:", "");
      const targetPreseller = presellers.find((p) => p.id === pId);
      list = list.filter(
        (d) =>
          d.givenByType === "preseller" &&
          (d.presellerId === pId ||
            (targetPreseller &&
              d.givenByName.trim().toLowerCase() === targetPreseller.full_name.trim().toLowerCase()))
      );
    }

    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (d) =>
        d.outletCode.toLowerCase().includes(q) ||
        d.shopName.toLowerCase().includes(q) ||
        d.givenByName.toLowerCase().includes(q) ||
        d.products.some((p) => p.productName.toLowerCase().includes(q))
    );
  }, [discountList, filterGivenBy, search, presellers]);

  const isAllSelected =
    filteredDiscounts.length > 0 &&
    filteredDiscounts.every((d) => selectedIds.includes(d.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredDiscounts.map((d) => d.id));
    }
  };

  const exportData = filteredDiscounts.map((d) => ({
    "Outlet Code": d.outletCode,
    Shop: d.shopName,
    "From - To": `${d.fromDate} — ${d.toDate}`,
    Products: d.products.map((p) => `${p.productName}+${p.discountedRate}-${p.saleRate}`).join(", "),
    "Given By": `${d.givenByType === "owner" ? "Owner" : "Preseller"}: ${d.givenByName}`,
  }));

  const selectedShopObj = shops.find((s) => s.id === formShopId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-zinc-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 flex-1 max-w-2xl">
          <div className="relative flex-1 min-w-[12.5rem]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <Input
              type="text"
              placeholder="Search by outlet code, shop, or product..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 text-xs"
            />
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <label className="text-xs font-semibold text-zinc-600 whitespace-nowrap">Filter By:</label>
            <select
              value={filterGivenBy}
              onChange={(e) => setFilterGivenBy(e.target.value)}
              className="h-9 rounded-lg border border-zinc-200 px-3 text-xs bg-white text-zinc-800 focus:outline-none focus:ring-2 focus:ring-red-500 shadow-sm"
            >
              <option value="all">All (Owner & Preseller)</option>
              <option value="owner">Owner</option>
              <option value="preseller">Preseller (All)</option>
              {presellers.length > 0 && (
                <optgroup label="Specific Preseller">
                  {presellers.map((p) => (
                    <option key={p.id} value={`preseller:${p.id}`}>
                      Preseller: {p.full_name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={isAllSelected ? "ghost" : "outline"}
            size="sm"
            onClick={handleToggleSelectAll}
            className="whitespace-nowrap text-xs"
          >
            {isAllSelected ? "Deselect All" : "Select All"}
          </Button>

          {selectedIds.length > 0 && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={handleBulkDelete}
              disabled={isPending || isBulkDeleting || !!deletingId}
              className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 whitespace-nowrap text-xs"
            >
              {isBulkDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete ({selectedIds.length})
            </Button>
          )}

          <ExportButtons data={exportData} filename="discounts_registry" />

          <Button
            type="button"
            onClick={openAddModal}
            className="bg-[#e51e2a] hover:bg-[#c91823] text-white flex items-center gap-1.5 text-xs shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Add Discount
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50 border-b border-zinc-200">
              <TableHead className="w-10 text-center">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={handleToggleSelectAll}
                  className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                />
              </TableHead>
              <TableHead className="text-xs font-bold text-zinc-800">Outlet Code</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800">Shop</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800">Type / Date Range</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800">Products</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800">Given By</TableHead>
              <TableHead className="text-xs font-bold text-zinc-800 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredDiscounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-zinc-400 text-xs">
                  No discount configurations found. Click <strong>+ Add Discount</strong> to create one.
                </TableCell>
              </TableRow>
            ) : (
              filteredDiscounts.map((row) => {
                const isSelected = selectedIds.includes(row.id);
                return (
                  <TableRow key={row.id} className={isSelected ? "bg-red-50/40" : ""}>
                    <TableCell className="w-10 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() =>
                          setSelectedIds((prev) =>
                            prev.includes(row.id)
                              ? prev.filter((i) => i !== row.id)
                              : [...prev, row.id]
                          )
                        }
                        className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold text-zinc-700">
                      {row.outletCode}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-zinc-900">
                      {row.shopName}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-zinc-600 whitespace-nowrap">
                      {isPermanent(row.fromDate, row.toDate) ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[0.6875rem] border border-emerald-200">
                          ✦ Permanent
                        </span>
                      ) : (
                        <span>{row.fromDate} — {row.toDate}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs max-w-md font-mono text-zinc-800">
                      <div className="flex flex-wrap gap-1.5">
                        {row.products.map((p, pIdx) => (
                          <span
                            key={pIdx}
                            className="inline-flex items-center px-2 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-[0.6875rem] font-medium"
                          >
                            <span className="text-zinc-900">{p.productName}</span>
                            <span className="text-emerald-700 font-bold ml-1">+{p.discountedRate}</span>
                            <span className="text-zinc-400 ml-0.5">-{p.saleRate}</span>
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[0.6875rem] font-semibold bg-zinc-100 text-zinc-800 border border-zinc-200">
                        <span className="capitalize font-bold text-zinc-600">
                          {row.givenByType}:
                        </span>
                        <span>{row.givenByName}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEditModal(row)}
                          className="h-7 px-2 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                        >
                          <Edit2 className="h-3.5 w-3.5 mr-1" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(row.id)}
                          disabled={isPending || deletingId === row.id}
                          className="h-7 px-2 text-xs text-red-600 hover:text-red-800 hover:bg-red-50 flex items-center gap-1"
                        >
                          {deletingId === row.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5 mr-1" />
                          )}
                          Delete
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

      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border border-zinc-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 bg-zinc-50">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-red-100 text-[#e51e2a] flex items-center justify-center font-bold">
                  <Tag className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-900">
                    {editingId ? "Edit Discount Configuration" : "Add Discount"}
                  </h3>
                  <p className="text-[0.6875rem] text-zinc-500">
                    Set special discounted prices for outlets active across a date range
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 transition-colors text-lg leading-none"
              >
                ×
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              {/* Discount Type — Permanent or Temporary */}
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-2">Discount Type *</label>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                      !formIsPermanent
                        ? "border-red-600 bg-red-50/50 text-red-900 font-bold"
                        : "border-zinc-200 bg-white text-zinc-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name="discountType"
                      checked={!formIsPermanent}
                      onChange={() => setFormIsPermanent(false)}
                      className="accent-red-600"
                    />
                    <div className="text-xs">
                      <div className="font-semibold">Temporary</div>
                      <div className="text-[0.625rem] text-zinc-500 font-normal">Active only within a date range</div>
                    </div>
                  </label>
                  <label
                    className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                      formIsPermanent
                        ? "border-emerald-600 bg-emerald-50/50 text-emerald-900 font-bold"
                        : "border-zinc-200 bg-white text-zinc-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name="discountType"
                      checked={formIsPermanent}
                      onChange={() => setFormIsPermanent(true)}
                      className="accent-emerald-600"
                    />
                    <div className="text-xs">
                      <div className="font-semibold">Permanent</div>
                      <div className="text-[0.625rem] text-zinc-500 font-normal">Always applied, no expiry</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Date Range — only shown for Temporary */}
              {!formIsPermanent && (
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">
                  Active Date Range (From — To) *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[0.625rem] text-zinc-400 uppercase font-semibold">From Date</span>
                    <Input
                      type="date"
                      value={formFromDate}
                      onChange={(e) => setFormFromDate(e.target.value)}
                      className="text-xs h-9 bg-white"
                      required
                    />
                  </div>
                  <div>
                    <span className="text-[0.625rem] text-zinc-400 uppercase font-semibold">To Date</span>
                    <Input
                      type="date"
                      value={formToDate}
                      onChange={(e) => setFormToDate(e.target.value)}
                      className="text-xs h-9 bg-white"
                      required
                    />
                  </div>
                </div>
              </div>
              )}

              <div className="relative">
                <label className="block text-xs font-bold text-zinc-700 mb-1">
                  Shop (Outlet) *
                </label>
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="Search shop by code or name..."
                    value={shopSearchQuery}
                    onFocus={() => setIsShopDropdownOpen(true)}
                    onChange={(e) => {
                      setShopSearchQuery(e.target.value);
                      setIsShopDropdownOpen(true);
                    }}
                    className="text-xs h-9"
                  />
                  {formShopId && (
                    <button
                      type="button"
                      onClick={() => {
                        setFormShopId("");
                        setShopSearchQuery("");
                      }}
                      className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {isShopDropdownOpen && (
                  <div className="absolute z-20 top-full mt-1 left-0 right-0 max-h-48 overflow-y-auto bg-white border border-zinc-200 rounded-lg shadow-xl divide-y divide-zinc-100">
                    {filteredShopsForDropdown.length === 0 ? (
                      <div className="p-3 text-xs text-zinc-400 text-center">
                        No shops match "{shopSearchQuery}"
                      </div>
                    ) : (
                      filteredShopsForDropdown.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setFormShopId(s.id);
                            setShopSearchQuery(`${s.outlet_code} — ${s.shop_name}`);
                            setIsShopDropdownOpen(false);
                            if (s.preseller_name) {
                              const matched = presellers.find(
                                (pr) => pr.full_name.toLowerCase().trim() === s.preseller_name?.toLowerCase().trim()
                              );
                              if (matched) {
                                setFormPresellerId(matched.id);
                              }
                            }
                          }}
                          className={`w-full text-left px-3 py-2 text-xs flex justify-between items-center hover:bg-red-50/60 transition-colors ${
                            formShopId === s.id ? "bg-red-50 text-red-700 font-semibold" : "text-zinc-800"
                          }`}
                        >
                          <div>
                            <span className="font-mono text-zinc-500 mr-2">[{s.outlet_code}]</span>
                            <span>{s.shop_name}</span>
                          </div>
                          {formShopId === s.id && <Check className="h-4 w-4 text-red-600" />}
                        </button>
                      ))
                    )}
                  </div>
                )}
                {selectedShopObj && (
                  <div className="mt-1 text-[0.6875rem] text-emerald-700 font-medium flex items-center gap-1">
                    <Check className="h-3.5 w-3.5" /> Selected: {selectedShopObj.outlet_code} — {selectedShopObj.shop_name}
                  </div>
                )}
              </div>

              <div className="relative">
                <label className="block text-xs font-bold text-zinc-700 mb-1">
                  Products (Select single or multiple products) *
                </label>
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="Search product by title or code to add..."
                    value={productSearchQuery}
                    onFocus={() => setIsProductDropdownOpen(true)}
                    onChange={(e) => {
                      setProductSearchQuery(e.target.value);
                      setIsProductDropdownOpen(true);
                    }}
                    className="text-xs h-9"
                  />
                </div>

                {isProductDropdownOpen && (
                  <div className="absolute z-20 top-full mt-1 left-0 right-0 max-h-48 overflow-y-auto bg-white border border-zinc-200 rounded-lg shadow-xl divide-y divide-zinc-100">
                    <div className="p-2 bg-zinc-50 flex justify-between items-center text-[0.6875rem] font-semibold text-zinc-500">
                      <span>Select Products</span>
                      <button
                        type="button"
                        onClick={() => setIsProductDropdownOpen(false)}
                        className="text-blue-600 hover:underline"
                      >
                        Done
                      </button>
                    </div>
                    {filteredProductsForDropdown.length === 0 ? (
                      <div className="p-3 text-xs text-zinc-400 text-center">
                        No products found
                      </div>
                    ) : (
                      filteredProductsForDropdown.map((p) => {
                        const isSelected = selectedProductConfigs.some(
                          (sc) => sc.productId === p.id
                        );
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => handleToggleProduct(p)}
                            className={`w-full text-left px-3 py-2 text-xs flex justify-between items-center hover:bg-zinc-50 transition-colors ${
                              isSelected ? "bg-red-50/50 text-red-900 font-semibold" : "text-zinc-800"
                            }`}
                          >
                            <div>
                              <span>{p.product_name}</span>
                              <span className="text-zinc-400 text-[0.625rem] ml-2">
                                (Sale Rate: Rs.{Number(p.sale_rate || 0)})
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {isSelected ? (
                                <span className="text-[0.625rem] bg-red-100 text-red-700 px-2 py-0.5 rounded font-bold">
                                  Selected
                                </span>
                              ) : (
                                <span className="text-[0.625rem] text-zinc-400">+ Add</span>
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              {selectedProductConfigs.length > 0 && (
                <div className="space-y-2 bg-zinc-50 p-3.5 rounded-xl border border-zinc-200">
                  <div className="text-xs font-bold text-zinc-800 mb-2">
                    Configured Products & Discounted Rates ({selectedProductConfigs.length}):
                  </div>
                  <div className="space-y-2.5">
                    {selectedProductConfigs.map((prod) => (
                      <div
                        key={prod.productId}
                        className="bg-white p-3 rounded-lg border border-zinc-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm"
                      >
                        <div className="flex-1">
                          <div className="text-xs font-bold text-zinc-900">{prod.productName}</div>
                          <div className="text-[0.6875rem] text-zinc-500 mt-0.5">
                            Sale Rate: <strong className="text-zinc-700">Rs. {prod.saleRate}</strong>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <label className="text-xs font-semibold text-zinc-600 whitespace-nowrap">
                              Discounted Rate:
                            </label>
                            <Input
                              type="number"
                              min={0}
                              value={prod.discountedRate}
                              onChange={(e) =>
                                handleUpdateDiscountedRate(
                                  prod.productId,
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              className="w-28 h-8 text-xs font-bold text-emerald-700 bg-emerald-50/40 border-emerald-300 focus:ring-emerald-500"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setSelectedProductConfigs((prev) =>
                                prev.filter((p) => p.productId !== prod.productId)
                              )
                            }
                            className="text-zinc-400 hover:text-red-600 p-1"
                            title="Remove"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3 pt-1">
                <label className="block text-xs font-bold text-zinc-700">Given By *</label>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${
                      formGivenByType === "owner"
                        ? "border-red-600 bg-red-50/50 text-red-900 font-bold"
                        : "border-zinc-200 bg-white text-zinc-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name="givenByType"
                      value="owner"
                      checked={formGivenByType === "owner"}
                      onChange={() => setFormGivenByType("owner")}
                      className="accent-red-600"
                    />
                    <div className="text-xs">
                      <div>Owner</div>
                      <div className="text-[0.625rem] text-zinc-500 font-normal">
                        Discount given by distributor owner
                      </div>
                    </div>
                  </label>

                  <label
                    className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${
                      formGivenByType === "preseller"
                        ? "border-red-600 bg-red-50/50 text-red-900 font-bold"
                        : "border-zinc-200 bg-white text-zinc-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name="givenByType"
                      value="preseller"
                      checked={formGivenByType === "preseller"}
                      onChange={() => setFormGivenByType("preseller")}
                      className="accent-red-600"
                    />
                    <div className="text-xs">
                      <div>Preseller</div>
                      <div className="text-[0.625rem] text-zinc-500 font-normal">
                        Authorized sales preseller
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {formGivenByType === "preseller" && (
                <div className="pt-2 border-t border-zinc-200">
                  <label className="block text-xs font-bold text-zinc-700 mb-1">
                    Select Preseller *
                  </label>
                  {presellers.length === 0 ? (
                    <p className="text-xs text-zinc-400 italic">No presellers found in employee directory.</p>
                  ) : (
                    <SearchableSelect
                      options={presellers.map((pr) => ({
                        value: pr.id,
                        label: pr.full_name,
                        sub: pr.employee_code || undefined,
                      }))}
                      value={formPresellerId}
                      onChange={(v) => setFormPresellerId(v)}
                      placeholder="— Select Preseller —"
                      searchPlaceholder="Search by name or code..."
                      required
                      closeOnClickOutside={false}
                    />
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-3.5 border-t border-zinc-200 flex justify-end gap-2 bg-zinc-50">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowModal(false)}
                className="text-xs"
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="bg-[#e51e2a] hover:bg-[#c91823] text-white text-xs font-semibold flex items-center gap-1.5"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {saving ? "Saving..." : "Save Discount"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
