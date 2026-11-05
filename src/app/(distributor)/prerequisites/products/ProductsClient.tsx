"use client";

import { useState, useTransition, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Trash2, Package, X, Minus, Plus, FileSpreadsheet, Upload, CheckCircle2, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
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
  createProduct,
  updateProduct,
  deleteProduct, deleteProducts,
  createProductCategory,
  updateProductCategory,
  deleteProductCategory,
  bulkImportProducts,
} from "@/lib/actions/products";
import type {
  Product,
  ProductCategory,
  GroupedCategoryProducts,
} from "@/lib/actions/products";
import { parseProductExcel, type ParsedProductImportRow } from "@/lib/parsers/productImport";

interface Props {
  grouped: GroupedCategoryProducts[];
  uncategorised: Product[];
  categories: ProductCategory[];
}

const BLANK_CATEGORY = { title: "", is_returnable: false, is_rgb: false, is_implied: false, sort_order: 0, set_un_case: 1, packing_qty: 1 };
const BLANK_PRODUCT = {
  product_name: "",
  product_code: "",
  category_id: "" as string | null,
  sale_rate: 0,
  purchase_rate: 0,
  packing_qty: 1,
  is_returnable: false,
  active: true,
  linked_rgb_product_id: "" as string | null,
};

function Toggle({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 cursor-pointer select-none">
      <div
        className="relative w-9 h-5 rounded-full transition-colors duration-200"
        style={{ background: checked ? "#e51e2a" : "#d1d5db" }}
      >
        <input
          id={id}
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200"
          style={{ transform: checked ? "translateX(1rem)" : "translateX(0)" }}
        />
      </div>
      <span className="text-[0.71875rem] font-medium text-[var(--text-primary)]">{label}</span>
    </label>
  );
}

function Modal({
  title,
  onClose,
  children,
  maxWidth = "max-w-md",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(0.125rem)" }}
    >
      <div
        className={`w-full ${maxWidth} bg-white rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 transition-colors rounded-lg p-1 hover:bg-zinc-100"
          >
            <X className="h-[1rem] w-[1rem]" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function CategoryTypeBadge({ cat }: { cat: ProductCategory }) {
  if (cat.is_implied)
    return (
      <span className="px-2 py-0.5 text-[0.625rem] font-bold rounded-full bg-amber-100 text-amber-700">
        Implied
      </span>
    );
  if (cat.is_rgb)
    return (
      <span className="px-2 py-0.5 text-[0.625rem] font-bold rounded-full bg-purple-100 text-purple-700">
        RGB
      </span>
    );
  if (cat.is_returnable)
    return (
      <span className="px-2 py-0.5 text-[0.625rem] font-bold rounded-full bg-blue-100 text-blue-700">
        Empties
      </span>
    );
  return (
    <span className="px-2 py-0.5 text-[0.625rem] font-bold rounded-full bg-zinc-100 text-zinc-600">
      Standard
    </span>
  );
}

function CategoryTypeLabel({ cat }: { cat: ProductCategory }) {
  if (cat.is_implied) return "Implied";
  if (cat.is_rgb) return "RGB";
  if (cat.is_returnable) return "Empties";
  return "Standard";
}

export function ProductsClient({ grouped, uncategorised, categories }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [selectedProdIds, setSelectedProdIds] = useState<string[]>([]);
  const [openHeads, setOpenHeads] = useState<Set<string>>(() => {
    const ids = categories.map((c) => c.id);
    return new Set([...ids, "uncategorised"]);
  });
  const [deletingProdId, setDeletingProdId] = useState<string | null>(null);
  const [deletingCatId, setDeletingCatId] = useState<string | null>(null);
  const [isBulkDeletingProds, setIsBulkDeletingProds] = useState(false);

  const [catModal, setCatModal] = useState<"add" | "edit" | null>(null);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catForm, setCatForm] = useState({ ...BLANK_CATEGORY });

  const [prodModal, setProdModal] = useState<"add" | "edit" | null>(null);
  const [editingProdId, setEditingProdId] = useState<string | null>(null);
  const [prodForm, setProdForm] = useState({ ...BLANK_PRODUCT });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ParsedProductImportRow[] | null>(null);
  const [importFeedback, setImportFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    startTransition(() => {
      router.refresh();
      setTimeout(() => setIsRefreshing(false), 500);
    });
  };

  const scf = (k: string, v: any) => setCatForm((p) => ({ ...p, [k]: v }));
  const spf = (k: string, v: any) => setProdForm((p) => ({ ...p, [k]: v }));

  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartExpanded, setCartExpanded] = useState(false);

  const updateCartQty = (productId: string, delta: number) => {
    setCart((prev) => {
      const current = prev[productId] || 0;
      const next = Math.max(0, current + delta);
      if (next === 0) {
        const copy = { ...prev };
        delete copy[productId];
        return copy;
      }
      return { ...prev, [productId]: next };
    });
  };

  const augmentedProductData = useMemo(() => {
    // No dummy products  use the provided grouped and uncategorised data as-is
    const groupedCopy = grouped.map((g) => ({ ...g, products: [...g.products] }));
    const uncategorisedCopy = [...uncategorised];

    return {
      grouped: groupedCopy,
      uncategorised: uncategorisedCopy,
    };
  }, [grouped, uncategorised]);

  const allProducts = useMemo(() => {
    const all: Product[] = [];
    augmentedProductData.grouped.forEach((g) => all.push(...g.products));
    all.push(...augmentedProductData.uncategorised);
    return all;
  }, [augmentedProductData]);

  const exportData = allProducts.map((p) => {
    const cat = categories.find((c) => c.id === p.category_id);
    return {
      "Code": p.product_code ?? "",
      "Product Name": p.product_name,
      "Category": cat?.title ?? "Uncategorised",
      "Sale Rate": p.sale_rate,
      "Purchase Rate": p.purchase_rate,
      "Packing Qty": p.packing_qty,
      "UN Case": cat?.set_un_case ?? 1,
      "Status": p.active ? "Active" : "Inactive",
      "Is Returnable?": (p.is_returnable || cat?.is_returnable) ? true : false,
      "Is RGB?": cat?.is_rgb ? true : false,
      "Is Implied?": cat?.is_implied ? true : false,
    };
  });

  const searchQuery = search.toLowerCase().trim();
  const isSearching = searchQuery.length > 0;

  const toggleHead = (id: string) => {
    setOpenHeads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getFilteredProducts = (products: Product[]) => {
    if (!isSearching) return products;
    return products.filter(
      (p) =>
        p.product_name.toLowerCase().includes(searchQuery) ||
        (p.product_code ?? "").toLowerCase().includes(searchQuery)
    );
  };

  const openAddCat = () => {
    setEditingCatId(null);
    setCatForm({ ...BLANK_CATEGORY });
    setCatModal("add");
  };

  const openEditCat = (c: ProductCategory) => {
    setEditingCatId(c.id);
    setCatForm({
      title: c.title,
      is_returnable: c.is_returnable,
      is_rgb: c.is_rgb,
      is_implied: c.is_implied ?? false,
      sort_order: c.sort_order,
      set_un_case: c.set_un_case ?? 1,
      packing_qty: c.packing_qty ?? 1,
    });
    setCatModal("edit");
  };

  const handleCatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (editingCatId) {
          await updateProductCategory(editingCatId, catForm);
        } else {
          await createProductCategory(catForm);
        }
        setCatModal(null);
        router.refresh();
      } catch (ex: any) {
        alert(ex.message);
      }
    });
  };

  const handleDeleteCat = (id: string) => {
    if (!confirm("Delete this category? Products in it will become uncategorised.")) return;
    setDeletingCatId(id);
    startTransition(async () => {
      try {
        await deleteProductCategory(id);
        router.refresh();
      } catch (ex: any) {
        alert(ex.message);
      } finally {
        setDeletingCatId(null);
      }
    });
  };

  const openAddProd = (categoryId?: string) => {
    setEditingProdId(null);
    const cat = categoryId ? categories.find((c) => c.id === categoryId) : null;
    const defaultPackQty = cat?.packing_qty ?? 1;
    setProdForm({ ...BLANK_PRODUCT, category_id: categoryId ?? "", packing_qty: defaultPackQty });
    setProdModal("add");
  };

  const openEditProd = (p: Product) => {
    setEditingProdId(p.id);
    setProdForm({
      product_name: p.product_name,
      product_code: p.product_code ?? "",
      category_id: p.category_id ?? "",
      sale_rate: p.sale_rate,
      purchase_rate: p.purchase_rate,
      packing_qty: p.packing_qty,
      is_returnable: p.is_returnable,
      active: p.active,
      linked_rgb_product_id: p.linked_rgb_product_id ?? "",
    });
    setProdModal("edit");
  };

  const handleProdSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        const payload = {
          ...prodForm,
          category_id: prodForm.category_id || null,
          linked_rgb_product_id: prodForm.linked_rgb_product_id || null,
        };
        if (editingProdId) {
          await updateProduct(editingProdId, payload);
        } else {
          await createProduct(payload);
        }
        setProdModal(null);
        router.refresh();
      } catch (ex: any) {
        alert(ex.message);
      }
    });
  };

  const isAllProdsSelected = allProducts.length > 0 && allProducts.every((p) => selectedProdIds.includes(p.id));

  const handleToggleSelectAllProds = () => {
    if (isAllProdsSelected) setSelectedProdIds([]);
    else setSelectedProdIds(allProducts.map((p) => p.id));
  };

  const handleBulkDeleteProds = () => {
    if (!selectedProdIds.length) return;
    const isAll = isAllProdsSelected || (allProducts.length > 0 && selectedProdIds.length >= allProducts.length);
    const confirmMsg = isAll
      ? `Are you sure you want to delete all ${selectedProdIds.length} product(s) and their categories?`
      : `Are you sure you want to delete ${selectedProdIds.length} selected product(s)?`;
    if (!confirm(confirmMsg)) return;
    setIsBulkDeletingProds(true);
    startTransition(async () => {
      try {
        await deleteProducts(selectedProdIds, isAll);
        setSelectedProdIds([]);
        router.refresh();
      } catch (ex: any) {
        alert(ex.message);
      } finally {
        setIsBulkDeletingProds(false);
      }
    });
  };

  const handleDeleteProd = (id: string) => {
    if (!confirm("Delete this product?")) return;
    setDeletingProdId(id);
    startTransition(async () => {
      try {
        await deleteProduct(id);
        router.refresh();
      } catch (ex: any) {
        alert(ex.message);
      } finally {
        setDeletingProdId(null);
      }
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const parsed = await parseProductExcel(file);
      if (!parsed || parsed.length === 0) {
        alert("No valid product records found in the uploaded file.");
        return;
      }
      setImportPreview(parsed);
      setImportFeedback(null);
    } catch (err: any) {
      alert(`Failed to parse file: ${err.message}`);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleConfirmImport = () => {
    if (!importPreview || importPreview.length === 0) return;
    startTransition(async () => {
      try {
        const res = await bulkImportProducts(importPreview);
        setImportPreview(null);
        setImportFeedback({
          type: "success",
          message: `Successfully imported ${res.total} products (${res.created} created, ${res.updated} updated, ${res.categoriesCreated} new categories created).`,
        });
        // Auto-expand all heads so the user can immediately see them
        const allCatIds = new Set(categories.map((c) => c.id));
        setOpenHeads(allCatIds);
        router.refresh();
      } catch (err: any) {
        setImportFeedback({
          type: "error",
          message: `Import failed: ${err.message}`,
        });
      }
    });
  };

  const importCategorySummary = useMemo(() => {
    if (!importPreview) return [];
    const counts = new Map<string, number>();
    importPreview.forEach((p) => {
      const cat = p.category_title?.trim() || "Uncategorised";
      counts.set(cat, (counts.get(cat) || 0) + 1);
    });
    const existingTitles = new Set(categories.map((c) => c.title.toLowerCase().trim()));
    return Array.from(counts.entries()).map(([title, count]) => ({
      title,
      count,
      isNew: title !== "Uncategorised" && !existingTitles.has(title.toLowerCase()),
    }));
  }, [importPreview, categories]);

  const renderProductRow = (p: Product) => {
    const cartQty = cart[p.id] || 0;
    const cat = categories.find((c) => c.id === p.category_id);
    const unCaseVal = cat?.set_un_case ?? 1;
    const isRet = p.is_returnable || cat?.is_returnable;
    const isRgb = cat?.is_rgb;
    const isImplied = cat?.is_implied;

    return (
      <TableRow key={p.id} className={`group hover:bg-zinc-50/60 transition-colors ${selectedProdIds.includes(p.id) ? "bg-red-50/50" : ""}` }>
        <TableCell className="w-10 text-center"><input type="checkbox" checked={selectedProdIds.includes(p.id)} onChange={() => setSelectedProdIds(prev => prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableCell>
        <TableCell>
          {p.product_code ? (
            <span className="font-mono text-[0.65625rem] text-[#e51e2a] font-bold tracking-wide">
              {p.product_code}
            </span>
          ) : (
            <span className="text-zinc-300 text-[0.625rem]">-</span>
          )}
        </TableCell>
        <TableCell className="font-medium text-[var(--text-primary)]">{p.product_name}</TableCell>
        <TableCell className="text-right font-mono text-[0.6875rem] font-semibold text-blue-700">
          {unCaseVal}
        </TableCell>
        <TableCell className="text-center">
          {isRet ? (
            <span className="px-2 py-0.5 text-[0.625rem] font-bold rounded-full bg-emerald-100 text-emerald-700">True</span>
          ) : (
            <span className="px-2 py-0.5 text-[0.625rem] font-bold rounded-full bg-zinc-100 text-zinc-500">False</span>
          )}
        </TableCell>
        <TableCell className="text-center">
          {isRgb ? (
            <span className="px-2 py-0.5 text-[0.625rem] font-bold rounded-full bg-purple-100 text-purple-700">True</span>
          ) : (
            <span className="px-2 py-0.5 text-[0.625rem] font-bold rounded-full bg-zinc-100 text-zinc-500">False</span>
          )}
        </TableCell>
        <TableCell className="text-center">
          {isImplied ? (
            <span className="px-2 py-0.5 text-[0.625rem] font-bold rounded-full bg-amber-100 text-amber-700">True</span>
          ) : (
            <span className="px-2 py-0.5 text-[0.625rem] font-bold rounded-full bg-zinc-100 text-zinc-500">False</span>
          )}
        </TableCell>
        <TableCell className="text-right font-mono text-[0.6875rem]">
          {p.sale_rate > 0 ? `Rs. ${p.sale_rate.toFixed(2)}` : <span className="text-zinc-300">-</span>}
        </TableCell>
        <TableCell className="text-right font-mono text-[0.6875rem]">
          {p.purchase_rate > 0 ? `Rs. ${p.purchase_rate.toFixed(2)}` : <span className="text-zinc-300">-</span>}
        </TableCell>
        <TableCell className="text-right font-mono text-[0.6875rem]">{p.packing_qty}</TableCell>
        <TableCell>
          {p.active ? (
            <span className="px-2 py-0.5 text-[0.625rem] font-bold rounded-full bg-emerald-100 text-emerald-700">Active</span>
          ) : (
            <span className="px-2 py-0.5 text-[0.625rem] font-bold rounded-full bg-zinc-100 text-zinc-400">Inactive</span>
          )}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center gap-2 justify-end">
            <div className="inline-flex items-center gap-1 bg-zinc-100 rounded-lg p-0.5 border border-zinc-200">
              <button
                type="button"
                onClick={() => updateCartQty(p.id, -1)}
                disabled={cartQty === 0}
                className="w-5 h-5 flex items-center justify-center rounded bg-white text-zinc-700 hover:bg-zinc-200 disabled:opacity-30 text-xs font-bold shadow-sm"
              >
                -
              </button>
              <span className={`w-5 text-center text-xs font-bold font-mono ${cartQty > 0 ? "text-[#e51e2a]" : "text-zinc-400"}`}>
                {cartQty}
              </span>
              <button
                type="button"
                onClick={() => updateCartQty(p.id, 1)}
                className="w-5 h-5 flex items-center justify-center rounded bg-white text-zinc-700 hover:bg-zinc-200 text-xs font-bold shadow-sm"
              >
                +
              </button>
            </div>
            <div className="flex gap-1 items-center border-l border-zinc-200 pl-1">
              <Button size="sm" variant="ghost" onClick={() => openEditProd(p)}>Edit</Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-500 hover:text-red-700"
                onClick={() => handleDeleteProd(p.id)}
                disabled={deletingProdId === p.id || isBulkDeletingProds}
              >
                {deletingProdId === p.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-red-600" />
                ) : (
                  "Del"
                )}
              </Button>
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  };

  const tableHeaders = (
    <TableHeader>
      <TableRow>
        <TableHead className="w-10 text-center"><input type="checkbox" checked={isAllProdsSelected} onChange={handleToggleSelectAllProds} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableHead>
        <TableHead className="w-28">Code</TableHead>
        <TableHead>Product Name</TableHead>
        <TableHead className="text-right">UN Case</TableHead>
        <TableHead className="text-center">Is Returnable?</TableHead>
        <TableHead className="text-center">Is RGB?</TableHead>
        <TableHead className="text-center">Is Implied?</TableHead>
        <TableHead className="text-right">Sale Rate</TableHead>
        <TableHead className="text-right">Purchase Rate</TableHead>
        <TableHead className="text-right">Pack Qty</TableHead>
        <TableHead>Status</TableHead>
        <TableHead className="text-right">Actions</TableHead>
      </TableRow>
    </TableHeader>
  );

  const cartCount = Object.keys(cart).length;
  const cartTotalItems = Object.values(cart).reduce((a, b) => a + b, 0);
  const cartTotal = allProducts.reduce((sum, p) => sum + (cart[p.id] || 0) * (p.purchase_rate || 0), 0);

  const headSections = [
    ...augmentedProductData.grouped.map((g) => ({ id: g.category.id, category: g.category as ProductCategory | null, products: g.products })),
    ...(augmentedProductData.uncategorised.length > 0
      ? [{ id: "__uncategorised__", category: null, products: augmentedProductData.uncategorised }]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search products or codes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
                    <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={isAllProdsSelected ? "ghost" : "outline"}
              size="sm"
              onClick={handleToggleSelectAllProds}
              className="whitespace-nowrap"
            >
              {isAllProdsSelected ? "Deselect All" : "Select All"}
            </Button>
            {selectedProdIds.length > 0 && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={handleBulkDeleteProds}
                disabled={isBulkDeletingProds || !!deletingProdId || !!deletingCatId}
                className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 whitespace-nowrap"
              >
                {isBulkDeletingProds ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Delete ({selectedProdIds.length})
              </Button>
            )}
          </div>
          <ExportButtons data={exportData} filename="product_catalogue" />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 border-zinc-200 text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin text-zinc-500" : "text-zinc-500"}`} />
            <span>Refresh</span>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx, .xls, .csv"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="flex items-center gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
          >
            {isImporting ? (
              <>
                <Loader2 className="animate-spin h-4 w-4 text-emerald-600" />
                <span className="text-emerald-700 font-semibold">Reading File...</span>
              </>
            ) : (
              <>
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                Import Excel
              </>
            )}
          </Button>
          <Button variant="outline" onClick={openAddCat}>
            + Add Category
          </Button>
          <Button onClick={() => openAddProd()}>+ Add Product</Button>
        </div>
      </div>

      {importFeedback && (
        <div
          className={`flex items-center justify-between p-3.5 rounded-xl border text-xs font-medium ${
            importFeedback.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          <div className="flex items-center gap-2">
            {importFeedback.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
            )}
            <span>{importFeedback.message}</span>
          </div>
          <button
            onClick={() => setImportFeedback(null)}
            className="text-zinc-400 hover:text-zinc-600 text-sm font-bold ml-2 leading-none"
          >
            ×
          </button>
        </div>
      )}

      <div className="space-y-2">
        {headSections.map(({ id, category, products }) => {
          const filtered = getFilteredProducts(products);
          if (isSearching && filtered.length === 0) return null;
          const isOpen = isSearching ? true : openHeads.has(id);
          const label = category ? category.title : "Uncategorised";

          return (
            <div
              key={id}
              className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden"
            >
              <div
                role="button"
                tabIndex={0}
                className="w-full flex items-center justify-between px-4 py-3 bg-zinc-50 hover:bg-zinc-100 transition-colors border-b border-zinc-200 cursor-pointer"
                onClick={() => !isSearching && toggleHead(id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (!isSearching) toggleHead(id);
                  }
                }}
                aria-expanded={isOpen}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-1 h-5 rounded-full"
                    style={{ background: "#e51e2a" }}
                  />
                  <span className="text-[0.8125rem] font-bold text-[var(--text-primary)]">{label}</span>
                  {category && <CategoryTypeBadge cat={category} />}
                  <span className="text-[0.625rem] text-zinc-400 ml-1">
                    {isSearching ? filtered.length : products.length} product{products.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  {category && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => openAddProd(category.id)}>
                        + Product
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEditCat(category)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-400 hover:text-red-600"
                        onClick={() => handleDeleteCat(category.id)}
                        disabled={deletingCatId === category.id || isBulkDeletingProds}
                      >
                        {deletingCatId === category.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-red-600" />
                        ) : (
                          "Delete"
                        )}
                      </Button>
                    </>
                  )}
                  <span
                    className="flex items-center justify-center text-zinc-400 px-1 select-none"
                    style={{ pointerEvents: "none" }}
                  >
                    {isOpen ? <ChevronUp className="h-[1rem] w-[1rem]" /> : <ChevronDown className="h-[1rem] w-[1rem]" />}
                  </span>
                </div>
              </div>

              {isOpen && (
                <Table>
                  {tableHeaders}
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={12}
                          className="text-center text-zinc-400 text-[0.6875rem] py-6"
                        >
                          {isSearching ? "No matches." : (
                            <>
                              No products in this category.{" "}
                              {category && (
                                <button
                                  className="underline text-[#e51e2a]"
                                  onClick={() => openAddProd(category.id)}
                                >
                                  Add one
                                </button>
                              )}
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((p) => renderProductRow(p))
                    )}
                  </TableBody>
                </Table>
              )}
            </div>
          );
        })}

        {headSections.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Package className="h-12 w-12 text-zinc-300 mb-3" />
            <p className="text-zinc-500 text-sm font-medium">No categories yet.</p>
            <p className="text-zinc-400 text-[0.6875rem] mt-1">
              Start by adding a category (Head), then add products to it.
            </p>
            <Button className="mt-4" onClick={openAddCat}>
              + Add Category
            </Button>
          </div>
        )}
      </div>

      {catModal && (
        <Modal
          title={catModal === "edit" ? "Edit Category" : "Add Category (Head)"}
          onClose={() => setCatModal(null)}
        >
          <form onSubmit={handleCatSubmit} className="space-y-4">
            <div>
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                Category Title *
              </label>
              <Input
                value={catForm.title}
                onChange={(e) => scf("title", e.target.value)}
                placeholder="e.g. 1500ML, RGB, Empties..."
                required
              />
            </div>

            <div>
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                Sort Order
              </label>
              <Input
                type="number"
                value={catForm.sort_order}
                onChange={(e) => scf("sort_order", parseInt(e.target.value) || 0)}
                min={0}
              />
            </div>

            <div>
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                Set UN Case
              </label>
              <Input
                type="number"
                min={0}
                step="any"
                value={(catForm as any).set_un_case ?? 0}
                onChange={(e) => {
                  const val = e.target.value;
                  scf("set_un_case", val === "" ? 0 : parseFloat(val));
                }}
                placeholder="e.g. 1.056, 24, or 0"
              />
              <p className="text-[0.625rem] text-zinc-400 mt-1">
                Units per physical case — used to auto-calculate Unit Case in warehouse (0 for Implied).
              </p>
            </div>

            <div>
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                Packing Qty
              </label>
              <Input
                type="number"
                min="1"
                step="1"
                value={(catForm as any).packing_qty ?? 1}
                onChange={(e) => scf("packing_qty", parseFloat(e.target.value) || 1)}
                placeholder="e.g. 6 or 24"
              />
              <p className="text-[0.625rem] text-zinc-400 mt-1">
                Sets default packing qty for all products belonging to this category.
              </p>
            </div>

            <div className="space-y-3 pt-1">
              <Toggle
                id="cat_returnable"
                checked={(catForm as any).is_returnable}
                onChange={(v) => {
                  scf("is_returnable", v);
                  if (!v) { scf("is_rgb", false); }
                }}
                label="Is Returnable (products have empties/glass)"
              />
              <Toggle
                id="cat_rgb"
                checked={(catForm as any).is_rgb}
                onChange={(v) => {
                  if (v && !(catForm as any).is_returnable) scf("is_returnable", true);
                  scf("is_rgb", v);
                  if (v) scf("is_implied", false);
                }}
                label="Is RGB (Returnable Glass Bottles)"
              />
              <Toggle
                id="cat_implied"
                checked={(catForm as any).is_implied ?? false}
                onChange={(v) => {
                  scf("is_implied", v);
                  if (v) {
                    scf("is_rgb", false);
                    scf("is_returnable", false);
                    scf("set_un_case", 0);
                  }
                }}
                label="Is Implied? (Empties returned from outlets, dispatched via Waybill)"
              />
            </div>

            {(catForm as any).is_rgb && !(catForm as any).is_returnable && (
              <p className="text-[0.65625rem] text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                RGB requires Is Returnable to also be enabled.
              </p>
            )}

            <div className="flex gap-2 pt-2">
              <Button type="submit" className="flex-1" disabled={isPending}>
                {isPending ? "Saving..." : catModal === "edit" ? "Update Category" : "Add Category"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setCatModal(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {prodModal && (
        <Modal
          title={prodModal === "edit" ? "Edit Product" : "Add Product"}
          onClose={() => setProdModal(null)}
        >
          <form onSubmit={handleProdSubmit} className="space-y-4">
            <div>
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                Category (Head)
              </label>
              <SearchableSelect
                options={[
                  { value: "", label: "- Uncategorised -" },
                  ...categories.map((c) => ({
                    value: c.id,
                    label: c.title,
                    sub: CategoryTypeLabel({ cat: c }),
                  })),
                ]}
                value={prodForm.category_id ?? ""}
                onChange={(val) => {
                  const newCatId = val || null;
                  spf("category_id", newCatId);
                  if (newCatId) {
                    const cat = categories.find((c) => c.id === newCatId);
                    if (cat?.packing_qty) {
                      spf("packing_qty", cat.packing_qty);
                    }
                  }
                }}
                placeholder="- Uncategorised -"
                searchPlaceholder="Search category (Head)..."
              />
            </div>

            <div>
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                Product Code *
              </label>
              <Input
                value={prodForm.product_code}
                onChange={(e) => spf("product_code", e.target.value)}
                placeholder="e.g. 10001, 800001, COKE-1.5L..."
                required
              />
            </div>

            <div>
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                Product Name *
              </label>
              <Input
                value={prodForm.product_name}
                onChange={(e) => spf("product_name", e.target.value)}
                placeholder="e.g. Mineral Water 1.5L"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                  Sale Rate (Rs.)
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={prodForm.sale_rate}
                  onChange={(e) => spf("sale_rate", parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                  Purchase Rate (Rs.)
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={prodForm.purchase_rate}
                  onChange={(e) => spf("purchase_rate", parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>

            <div>
              <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                Packing Qty
              </label>
              <Input
                type="number"
                min="1"
                step="0.01"
                value={prodForm.packing_qty}
                onChange={(e) => spf("packing_qty", parseFloat(e.target.value) || 1)}
              />
            </div>

            <div className="space-y-3">
              <Toggle
                id="prod_active"
                checked={prodForm.active}
                onChange={(v) => spf("active", v)}
                label="Active"
              />
            </div>

            {(() => {
              const selectedCat = categories.find((c) => c.id === (prodForm.category_id || ""));
              if (!selectedCat?.is_implied) return null;
              const rgbProducts = allProducts.filter((p) => {
                const pCat = categories.find((c) => c.id === p.category_id);
                return pCat?.is_rgb === true;
              });
              return (
                <div>
                  <label className="block text-[0.6875rem] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">
                    Link (RGB Product)
                  </label>
                  <SearchableSelect
                    options={[
                      { value: "", label: "— Select RGB Product —" },
                      ...rgbProducts.map((p) => ({
                        value: p.id,
                        label: p.product_name,
                        sub: p.product_code ?? undefined,
                      })),
                    ]}
                    value={(prodForm as any).linked_rgb_product_id ?? ""}
                    onChange={(val) => {
                      spf("linked_rgb_product_id", val || null);
                      if (val) {
                        const selRgb = rgbProducts.find((p) => p.id === val);
                        if (selRgb?.product_code && !prodForm.product_code) {
                          spf("product_code", selRgb.product_code);
                        }
                      }
                    }}
                    placeholder="— Select RGB Product —"
                    searchPlaceholder="Search RGB product..."
                  />
                  <p className="text-[0.625rem] text-zinc-400 mt-1">
                    Optional: link this Implied empty product to its filled RGB counterpart.
                  </p>
                </div>
              );
            })()}

            <div className="flex gap-2 pt-2">
              <Button type="submit" className="flex-1" disabled={isPending}>
                {isPending ? "Saving..." : prodModal === "edit" ? "Update Product" : "Add Product"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setProdModal(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {importPreview && (
        <Modal
          title="Import Products Preview"
          onClose={() => !isPending && setImportPreview(null)}
          maxWidth="max-w-4xl"
        >
          <div className="space-y-4">
            <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-zinc-700">
                  Detected {importPreview.length} product{importPreview.length !== 1 ? "s" : ""} across {importCategorySummary.length} categor{importCategorySummary.length !== 1 ? "ies" : "y"}:
                </span>
                <span className="text-[0.6875rem] text-zinc-500 font-medium">
                  Categories will be created automatically if not existing
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {importCategorySummary.map((cat) => (
                  <span
                    key={cat.title}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
                      cat.isNew
                        ? "bg-emerald-50 border-emerald-200 text-emerald-700 font-semibold"
                        : "bg-white border-zinc-200 text-zinc-700"
                    }`}
                  >
                    <span>{cat.title}</span>
                    <span className="bg-zinc-100 text-zinc-600 rounded-full px-1.5 py-0.5 text-[0.625rem] font-bold">
                      {cat.count}
                    </span>
                    {cat.isNew && (
                      <span className="text-[0.59375rem] uppercase tracking-wider font-bold text-emerald-600 bg-emerald-100/70 px-1 py-0.5 rounded">
                        New Head
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>

            <div className="border border-zinc-200 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Code</TableHead>
                    <TableHead>Product Name</TableHead>
                    <TableHead>Category (Head)</TableHead>
                    <TableHead className="text-right">UN Case</TableHead>
                    <TableHead className="text-center">Returnable?</TableHead>
                    <TableHead className="text-center">RGB?</TableHead>
                    <TableHead className="text-center">Implied?</TableHead>
                    <TableHead className="text-right">Sale Rate</TableHead>
                    <TableHead className="text-right">Purchase Rate</TableHead>
                    <TableHead className="text-right">Pack Qty</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importPreview.map((row, idx) => (
                    <TableRow key={idx} className="hover:bg-zinc-50/50">
                      <TableCell className="font-mono text-[0.65625rem] text-[#e51e2a] font-bold">
                        {row.product_code || <span className="text-zinc-300">Auto</span>}
                      </TableCell>
                      <TableCell className="font-medium text-xs text-zinc-900">
                        {row.product_name}
                      </TableCell>
                      <TableCell className="text-xs text-zinc-600">
                        {row.category_title ? (
                          <span className="px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 font-medium text-[0.6875rem]">
                            {row.category_title}
                          </span>
                        ) : (
                          <span className="text-zinc-400 text-[0.6875rem]">Uncategorised</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold text-blue-700">
                        {row.un_case !== undefined ? row.un_case : "—"}
                      </TableCell>
                      <TableCell className="text-center text-xs">
                        {row.is_returnable !== undefined ? (
                          <span className={`px-2 py-0.5 text-[0.625rem] font-bold rounded-full ${row.is_returnable ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
                            {row.is_returnable ? "True" : "False"}
                          </span>
                        ) : <span className="text-zinc-300">—</span>}
                      </TableCell>
                      <TableCell className="text-center text-xs">
                        {row.is_rgb !== undefined ? (
                          <span className={`px-2 py-0.5 text-[0.625rem] font-bold rounded-full ${row.is_rgb ? "bg-purple-100 text-purple-700" : "bg-zinc-100 text-zinc-500"}`}>
                            {row.is_rgb ? "True" : "False"}
                          </span>
                        ) : <span className="text-zinc-300">—</span>}
                      </TableCell>
                      <TableCell className="text-center text-xs">
                        {row.is_implied !== undefined ? (
                          <span className={`px-2 py-0.5 text-[0.625rem] font-bold rounded-full ${row.is_implied ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-500"}`}>
                            {row.is_implied ? "True" : "False"}
                          </span>
                        ) : <span className="text-zinc-300">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {row.sale_rate > 0 ? `Rs. ${row.sale_rate.toFixed(2)}` : "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {row.purchase_rate > 0 ? `Rs. ${row.purchase_rate.toFixed(2)}` : "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {row.packing_qty}
                      </TableCell>
                      <TableCell className="text-center">
                        {row.active ? (
                          <span className="px-2 py-0.5 text-[0.625rem] font-bold rounded-full bg-emerald-100 text-emerald-700">
                            Active
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[0.625rem] font-bold rounded-full bg-zinc-100 text-zinc-400">
                            Inactive
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-zinc-100">
              <p className="text-xs text-zinc-500">
                Products will be matched and updated if existing, or inserted if new.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setImportPreview(null)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={isPending}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  <span>{isPending ? "Importing..." : `Confirm Import (${importPreview.length} Products)`}</span>
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {cartCount > 0 && (
        <>
          {!cartExpanded ? (
            <div
              className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-4 px-5 py-3 rounded-2xl shadow-2xl border border-zinc-800 animate-in fade-in slide-in-from-bottom-4"
              style={{ background: "#18181b" }}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white flex-shrink-0"
                style={{ background: "#e51e2a" }}
              >
                {cartCount}
              </div>
              <div>
                <p className="text-xs font-semibold text-zinc-200 whitespace-nowrap">
                  {cartCount} Product{cartCount !== 1 ? "s" : ""} selected for Purchase Order
                </p>
                <p className="text-[0.6875rem] text-zinc-400 font-mono">
                  Est. Purchase Total: Rs. {cartTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-2">
                <button
                  type="button"
                  onClick={() => setCart({})}
                  className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white transition-colors whitespace-nowrap"
                >
                  Clear Cart
                </button>
                <button
                  type="button"
                  onClick={() => setCartExpanded(true)}
                  className="px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:text-white border border-zinc-600 rounded-lg transition-colors whitespace-nowrap"
                >
                  Maximize View
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const cartItems = Object.entries(cart).map(([productId, qty]) => ({ productId, qty }));
                    const encoded = encodeURIComponent(JSON.stringify(cartItems));
                    router.push(`/inventory/sell-in?cart=${encoded}&create=true`);
                  }}
                  className="px-4 py-1.5 rounded-xl text-xs font-bold text-white whitespace-nowrap transition-colors"
                  style={{ background: "#e51e2a" }}
                >
                  Create Purchase Order
                </button>
              </div>
            </div>
          ) : (
            <div
              className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-2xl rounded-2xl shadow-2xl border border-zinc-800 animate-in fade-in slide-in-from-bottom-4 overflow-hidden"
              style={{ background: "#18181b" }}
            >
              <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-700">
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white"
                    style={{ background: "#e51e2a" }}
                  >
                    {cartTotalItems}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-zinc-200">
                      {cartCount} Product{cartCount !== 1 ? "s" : ""} selected for Purchase Order
                    </p>
                    <p className="text-[0.6875rem] text-zinc-400 font-mono">
                      Est. Purchase Total: Rs. {cartTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCartExpanded(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:text-white border border-zinc-600 rounded-lg transition-colors whitespace-nowrap"
                >
                  Minimize View
                </button>
              </div>

              <div className="px-5 py-3 max-h-60 overflow-y-auto space-y-2">
                {Object.entries(cart).map(([productId, qty]) => {
                  const product = allProducts.find((p) => p.id === productId);
                  if (!product) return null;
                  return (
                    <div key={productId} className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-[0.75rem] font-medium text-zinc-200 truncate">{product.product_name}</p>
                        <p className="text-[0.625rem] text-zinc-500 font-mono">
                          {product.purchase_rate.toFixed(2)}  {qty} = {(product.purchase_rate * qty).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 ml-4">
                        <button
                          type="button"
                          onClick={() => updateCartQty(productId, -1)}
                          className="w-6 h-6 flex items-center justify-center rounded bg-zinc-700 text-white hover:bg-zinc-600 text-xs font-bold"
                        >
                          
                        </button>
                        <span className="w-6 text-center text-xs font-bold font-mono text-white">{qty}</span>
                        <button
                          type="button"
                          onClick={() => updateCartQty(productId, 1)}
                          className="w-6 h-6 flex items-center justify-center rounded bg-zinc-700 text-white hover:bg-zinc-600 text-xs font-bold"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-3 px-5 py-3 border-t border-zinc-700">
                <button
                  type="button"
                  onClick={() => setCart({})}
                  className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white border border-zinc-600 rounded-xl transition-colors whitespace-nowrap"
                >
                  Clear Cart
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const cartItems = Object.entries(cart).map(([productId, qty]) => ({ productId, qty }));
                    const encoded = encodeURIComponent(JSON.stringify(cartItems));
                    router.push(`/inventory/sell-in?cart=${encoded}&create=true`);
                  }}
                  className="flex-1 py-2 rounded-xl text-xs font-bold text-white transition-colors"
                  style={{ background: "#e51e2a" }}
                >
                  Create Purchase Order
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}