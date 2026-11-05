"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Printer,
  FileSpreadsheet,
  X,
  Loader2,
  CheckCircle2,
  Save,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { Input } from "@/components/ui/Input";
import {
  ExportPdfDocument,
  downloadBlob,
  sanitizeFileName,
  buildWorksheet,
} from "@/components/export/ExportButtons";
import {
  bulkImportInvoicesReport,
  bulkImportSalesTax,
  bulkImportSaleDetail,
  deleteInvoices,
  getInvoicesPaginated,
  getProductCatalogForInvoiceMatch,
} from "@/lib/actions/invoices";
import {
  findUnmatchedInvoiceProducts,
  formatUnmatchedProductAlert,
} from "@/lib/invoice-product-match";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { pdf } from "@react-pdf/renderer";
import { generateFastInvoicesPdfBlob } from "@/lib/pdf/fastInvoicePdf";
import { InvoiceForm } from "@/components/invoice/InvoiceForm";

interface InvoiceTableProps {
  invoices: any[];
  initialPagination?: {
    totalCount: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
  shops: any[];
  onEdit: (invoice: any) => void;
  onDelete: (id: string) => void;
  onView: (invoice: any) => void;
  defaultDateFilter?: boolean;
  /** Increment this to force a data re-fetch (e.g. after edit form save) */
  refreshKey?: number;
}

function getYesterdayAndToday() {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  return { yesterdayStr, todayStr };
}

function excelDateToISO(v: any): string {
  if (!v) return "";
  if (typeof v === "string" && v.includes("-")) return v.split("T")[0];
  const n = Number(v);
  if (isNaN(n) || n === 0) return "";
  const d = new Date(Math.round((n - 25569) * 86400 * 1000));
  return d.toISOString().split("T")[0];
}

function parseNum(v: any): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function formatExportRow(inv: any) {
  return {
    "Invoice No": inv.invoice_no,
    "Outlet Code": inv.outlet_code || "",
    "Outlet Name": inv.outlet_name || "",
    "Record Date": inv.record_date || "",
    "Delivery Date": inv.delivery_date || "",
    "Seller Code": inv.seller_code || "",
    "Seller Name": inv.seller_name || "",
    "Store Name": inv.store_name || "",
    "Type": inv.outlet_type || "",
    "Total Qty": inv.total_qty ?? "",
    "Amount": inv.amount ?? "",
    "Tax Return": inv.tax_return || "",
    "Excl Tax": inv.excl_tax ?? "",
    "Sales Tax": inv.sales_tax ?? "",
    "Adv. Tax": inv.adv_tax ?? "",
    "Disc. Tot": inv.disc_tot ?? "",
    "Products": inv.products || "",
  };
}

export function InvoiceTable({
  invoices: initialInvoices,
  initialPagination,
  shops,
  onEdit,
  onDelete,
  onView,
  defaultDateFilter,
  refreshKey,
}: InvoiceTableProps) {
  const router = useRouter();
  const invoiceFileRef = useRef<HTMLInputElement>(null);
  const taxFileRef = useRef<HTMLInputElement>(null);
  const saleDetailFileRef = useRef<HTMLInputElement>(null);

  // File import loading states
  const [importingInvoices, setImportingInvoices] = useState(false);
  const [importingTax, setImportingTax] = useState(false);
  const [importingSaleDetail, setImportingSaleDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Staged (pending) invoices — imported but not yet committed to DB
  const [pendingInvoices, setPendingInvoicesState] = useState<any[]>([]);
  // Always-current mirror of staged invoices so import handlers can merge synchronously
  // (state updater functions run lazily, so counts computed inside them are unreliable).
  const pendingRef = useRef<any[]>([]);
  const setPendingInvoices = useCallback(
    (next: any[] | ((prev: any[]) => any[])) => {
      const resolved = typeof next === "function" ? next(pendingRef.current) : next;
      pendingRef.current = resolved;
      setPendingInvoicesState(resolved);
    },
    []
  );
  const hasPendingImport = pendingInvoices.length > 0;
  // Form edit for a pending row
  const [editingPendingInvoice, setEditingPendingInvoice] = useState<any | null>(null);

  // Products-menu catalogue for the unsaved check. Loaded once pending invoices exist,
  // and refreshed in parallel with a Sale Detail import so the result is ready the
  // moment products land on the staged rows.
  const [productCatalog, setProductCatalog] = useState<
    { product_code: string; product_name: string }[] | null
  >(null);
  const catalogPromiseRef = useRef<Promise<
    { product_code: string; product_name: string }[] | null
  > | null>(null);

  const loadProductCatalog = useCallback((force = false) => {
    if (!force && catalogPromiseRef.current) return catalogPromiseRef.current;
    const p = getProductCatalogForInvoiceMatch()
      .then((rows) => {
        setProductCatalog(rows);
        return rows;
      })
      .catch((err) => {
        console.error("[InvoiceTable] product catalog load failed:", err);
        catalogPromiseRef.current = null;
        return null;
      });
    catalogPromiseRef.current = p;
    return p;
  }, []);

  useEffect(() => {
    if (hasPendingImport) void loadProductCatalog(false);
  }, [hasPendingImport, loadProductCatalog]);

  const pendingProductCheck = useMemo(() => {
    if (!productCatalog) {
      return {
        unmatched: [] as ReturnType<typeof findUnmatchedInvoiceProducts>["unmatched"],
        unmatchedInvoiceKeys: new Set<string>(),
        parsedLineCount: 0,
        ready: false,
      };
    }
    return { ...findUnmatchedInvoiceProducts(pendingInvoices, productCatalog), ready: true };
  }, [pendingInvoices, productCatalog]);

  // Pagination & Data states
  const [invoices, setInvoices] = useState<any[]>(initialInvoices);
  const [page, setPage] = useState<number>(initialPagination?.page ?? 1);
  const pageSize = initialPagination?.pageSize ?? 500;
  const [totalCount, setTotalCount] = useState<number>(
    initialPagination?.totalCount ?? initialInvoices.length
  );
  const [totalPages, setTotalPages] = useState<number>(
    initialPagination?.totalPages ?? Math.max(1, Math.ceil(totalCount / pageSize))
  );
  const [isLoading, setIsLoading] = useState(false);
  const [jumpPageInput, setJumpPageInput] = useState<string>(String(page));

  // Selection states
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Filter input states (user controls these before clicking Load)
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState(() =>
    defaultDateFilter ? getYesterdayAndToday().yesterdayStr : ""
  );
  const [dateTo, setDateTo] = useState(() =>
    defaultDateFilter ? getYesterdayAndToday().todayStr : ""
  );

  // Active date filters applied to queries
  const [appliedFrom, setAppliedFrom] = useState(() =>
    defaultDateFilter ? getYesterdayAndToday().yesterdayStr : ""
  );
  const [appliedTo, setAppliedTo] = useState(() =>
    defaultDateFilter ? getYesterdayAndToday().todayStr : ""
  );

  // Client-side page cache for instantaneous (0ms) page revisit
  const pageCacheRef = useRef<Map<number, any[]>>(new Map());
  const initialCachedRef = useRef(false);
  if (!initialCachedRef.current && initialInvoices && initialInvoices.length > 0) {
    pageCacheRef.current.set(initialPagination?.page ?? 1, initialInvoices);
    initialCachedRef.current = true;
  }

  // Export Modal states
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportType, setExportType] = useState<"pdf" | "excel">("pdf");
  const [exportScope, setExportScope] = useState<"current" | "all" | "range">("current");
  const [rangeStart, setRangeStart] = useState<number>(1);
  const [rangeEnd, setRangeEnd] = useState<number>(totalPages);
  const [pdfCombineMode, setPdfCombineMode] = useState<"combined" | "per_page">("combined");
  const [excelCombineMode, setExcelCombineMode] = useState<"combined" | "per_page">("combined");
  const [exportProgress, setExportProgress] = useState<{
    current: number;
    total: number;
    message: string;
  } | null>(null);
  const exportCancelledRef = useRef<boolean>(false);

  const shopMap = useMemo(
    () => new Map(shops.map((s: any) => [s.outlet_code?.toString(), s.id])),
    [shops]
  );

  // Keep jump input in sync with current page
  useEffect(() => {
    setJumpPageInput(String(page));
  }, [page]);

  // Keep rangeEnd clamped to totalPages
  useEffect(() => {
    setRangeEnd((prev) => Math.min(Math.max(1, prev), totalPages));
  }, [totalPages]);

  // Fetch paginated invoices from server and cache the result
  const fetchInvoices = useCallback(
    async (
      targetPage: number,
      targetSearch: string,
      targetFrom: string,
      targetTo: string
    ) => {
      setIsLoading(true);
      try {
        const res = await getInvoicesPaginated({
          page: targetPage,
          pageSize,
          search: targetSearch,
          dateFrom: targetFrom,
          dateTo: targetTo,
        });

        // Store into client cache for instant revisit
        pageCacheRef.current.set(targetPage, res.invoices);

        setInvoices(res.invoices);
        setTotalCount(res.totalCount);
        setTotalPages(res.totalPages || 1);
        setPage(res.page);
        setSelectedIds([]);
      } catch (err: any) {
        console.error("[InvoiceTable fetchInvoices] error:", err?.message ?? err);
      } finally {
        setIsLoading(false);
      }
    },
    [pageSize]
  );

  // Debounced search watcher (only triggered when search text changes, not on unsubmitted dates)
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const timer = setTimeout(() => {
      pageCacheRef.current.clear();
      fetchInvoices(1, search, appliedFrom, appliedTo);
    }, 350);

    return () => clearTimeout(timer);
  }, [search, appliedFrom, appliedTo, fetchInvoices]);

  // Re-fetch when refreshKey changes (e.g. after edit form save)
  const isFirstRefreshKey = useRef(true);
  useEffect(() => {
    if (isFirstRefreshKey.current) {
      isFirstRefreshKey.current = false;
      return;
    }
    if (refreshKey !== undefined) {
      pageCacheRef.current.clear();
      fetchInvoices(page, search, appliedFrom, appliedTo);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Explicit Load button for date range filter
  const handleApplyDateFilter = () => {
    pageCacheRef.current.clear();
    setAppliedFrom(dateFrom);
    setAppliedTo(dateTo);
    fetchInvoices(1, search, dateFrom, dateTo);
  };

  // Handle page navigation with instant cache retrieval
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages || newPage === page || isLoading) return;

    // Instant revisit check: if cached, render immediately without any network request
    if (pageCacheRef.current.has(newPage)) {
      const cached = pageCacheRef.current.get(newPage)!;
      setInvoices(cached);
      setPage(newPage);
      setSelectedIds([]);
      const tableEl = document.getElementById("invoices-table-container");
      if (tableEl) {
        tableEl.scrollTop = 0;
      }
      return;
    }

    // Not in cache: fetch from server
    fetchInvoices(newPage, search, appliedFrom, appliedTo);
    const tableEl = document.getElementById("invoices-table-container");
    if (tableEl) {
      tableEl.scrollTop = 0;
    }
  };

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseInt(jumpPageInput, 10);
    if (!isNaN(p) && p >= 1 && p <= totalPages && p !== page) {
      handlePageChange(p);
    } else {
      setJumpPageInput(String(page));
    }
  };

  const handleResetFilters = () => {
    pageCacheRef.current.clear();
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setAppliedFrom("");
    setAppliedTo("");
    fetchInvoices(1, "", "", "");
  };

  // Selection handlers
  const isAllCurrentSelected =
    invoices.length > 0 && invoices.every((inv) => selectedIds.includes(inv.id));

  const handleToggleSelectAllCurrent = () => {
    if (isAllCurrentSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(invoices.map((inv) => inv.id));
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.length) return;
    if (!confirm(`Delete ${selectedIds.length} selected invoice(s)?`)) return;
    setIsDeleting(true);
    try {
      await deleteInvoices(selectedIds);
      setSelectedIds([]);
      pageCacheRef.current.clear();
      await fetchInvoices(page, search, appliedFrom, appliedTo);
      router.refresh();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  // Excel parsing helper for imports
  function parseRowFromExcel(r: any) {
    const invoiceNo = String(
      r["Invoice No."] ||
        r["Invoice No"] ||
        r["Document Nr"] ||
        r["document_nr"] ||
        r["invoice_no"] ||
        ""
    ).trim();

    if (!invoiceNo) return null;

    const outletCode = String(
      r["Buyer code"] ||
        r["Buyer Code"] ||
        r["buyer_code"] ||
        r["Outlet Code"] ||
        r["outlet_code"] ||
        ""
    ).trim();

    const outletName = String(
      r["Buyer Name"] ||
        r["Buyer name"] ||
        r["buyer_name"] ||
        r["Outlet Name"] ||
        r["outlet_name"] ||
        ""
    ).trim();

    const shopId = outletCode ? shopMap.get(outletCode) ?? null : null;

    const recordDate =
      excelDateToISO(
        r["Record Date"] ?? r["Date"] ?? r["record_date"] ?? r["date"]
      ) || null;

    const deliveryDate =
      excelDateToISO(r["Delivery Date"] ?? r["delivery_date"]) || null;

    const sellerCode = String(r["Seller Code"] || r["seller_code"] || "").trim() || null;
    const sellerName = String(r["Seller Name"] || r["seller_name"] || "").trim() || null;
    const storeName = String(r["Store Name"] || r["store_name"] || "").trim() || null;
    const outletType = String(r["Type"] || r["type"] || "").trim() || null;
    const taxReturn = String(r["Tax Return"] || r["tax_return"] || "").trim() || null;

    const rawQty = r["Total Qty"] ?? r["total_qty"];
    const totalQty = rawQty != null && rawQty !== "" ? parseNum(rawQty) : null;

    const rawExcl = r["Excl Tex"] ?? r["Excl Tax"] ?? r["excl_tax"];
    const exclTax = rawExcl != null && rawExcl !== "" ? parseNum(rawExcl) : null;

    const rawSales = r["Sales Tax"] ?? r["sales_tax"];
    const salesTax = rawSales != null && rawSales !== "" ? parseNum(rawSales) : null;

    const rawAdv = r["Adv.Tax"] ?? r["Adv. Tax"] ?? r["adv_tax"];
    const advTax = rawAdv != null && rawAdv !== "" ? parseNum(rawAdv) : null;

    const rawDisc = r["Disc Tot."] ?? r["Disc Tot"] ?? r["disc_tot"];
    const discTot = rawDisc != null && rawDisc !== "" ? parseNum(rawDisc) : null;

    const rawAmt = r["Total Inv"] ?? r["Amount"] ?? r["amount"] ?? r["total_inv"];
    const amount = rawAmt != null && rawAmt !== "" ? parseNum(rawAmt) : null;

    return {
      invoice_no: invoiceNo,
      outlet_code: outletCode || null,
      outlet_name: outletName || null,
      shop_id: shopId,
      record_date: recordDate,
      delivery_date: deliveryDate,
      seller_code: sellerCode,
      seller_name: sellerName,
      store_name: storeName,
      outlet_type: outletType,
      total_qty: totalQty,
      grand_total: amount,    // maps to DB column grand_total / amount
      tax_return: taxReturn,
      excl_tax_amount: exclTax,
      sales_tax: salesTax,
      advance_income_tax: advTax,
      discount_total: discTot,
    };
  }

  // Import Invoices Excel — stages data locally, does NOT write to DB
  const handleImportInvoices = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingInvoices(true);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

      const rows = rawRows
        .map(parseRowFromExcel)
        .filter((r): r is NonNullable<typeof r> => r !== null && Boolean(r.invoice_no));

      if (rows.length === 0) {
        throw new Error(
          "No valid invoice rows found. Please check that 'Invoice No.' or 'Document Nr' column exists."
        );
      }

      // Stage locally: merge with existing pending by invoice_no (normalized)
      setPendingInvoices((prev) => {
        const map = new Map(prev.map((p) => [String(p.invoice_no).trim().toUpperCase(), p]));
        for (const r of rows) {
          const key = String(r.invoice_no).trim().toUpperCase();
          if (!map.has(key)) {
            map.set(key, { ...r, _pending: true });
          } else {
            // Overwrite existing pending entry with fresh import data
            map.set(key, { ...map.get(key), ...r, _pending: true });
          }
        }
        return Array.from(map.values());
      });

      // Alert after state update scheduled
      setTimeout(() => {
        alert(`Import Invoices staged: ${rows.length} invoice(s) ready. They appear at the top of the table in amber. Click Save to commit to system.`);
      }, 0);
    } catch (err: any) {
      alert(`Import failed:\n${err.message}`);
    } finally {
      setImportingInvoices(false);
      if (invoiceFileRef.current) invoiceFileRef.current.value = "";
    }
  };

  // Import Sales Tax Summary — merges into pending staged invoices
  const handleImportSalesTax = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingTax(true);
    try {
      let rows: any[] = [];
      const isPdf =
        file.name.toLowerCase().endsWith(".pdf") ||
        file.type === "application/pdf";

      if (isPdf) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/parse-sales-tax-pdf", {
          method: "POST",
          body: fd,
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || "Failed to parse Sales Tax Summary PDF");
        }
        rows = (json.data || []).map((r: any) => ({
          ...r,
          shop_id: r.outlet_code ? shopMap.get(String(r.outlet_code).trim()) ?? null : null,
        }));
      } else {
        const data = await file.arrayBuffer();
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawRows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

        rows = rawRows
          .map(parseRowFromExcel)
          .filter((r): r is NonNullable<typeof r> => r !== null && Boolean(r.invoice_no));
      }

      if (rows.length === 0) {
        throw new Error(
          "No valid invoice rows found. Please check that 'Document Nr' or 'Invoice No.' exists in the file."
        );
      }

      if (pendingRef.current.length > 0) {
        // Merge tax data into pending staged invoices (synchronously, so counts are exact)
        const map = new Map(
          pendingRef.current.map((p) => [String(p.invoice_no).trim().toUpperCase(), p])
        );
        let mergedCount = 0;
        const unmatched: string[] = [];
        for (const r of rows) {
          const key = String(r.invoice_no).trim().toUpperCase();
          const existing = map.get(key);
          if (!existing) {
            unmatched.push(String(r.invoice_no).trim());
            continue;
          }
          const updated = { ...existing };
          if (r.outlet_code) updated.outlet_code = r.outlet_code;
          if (r.outlet_name && (!existing.outlet_name || existing.outlet_name.startsWith("Outlet "))) {
            updated.outlet_name = r.outlet_name;
          }
          if (r.record_date && !existing.record_date) updated.record_date = r.record_date;
          if (r.delivery_date && !existing.delivery_date) updated.delivery_date = r.delivery_date;
          if (r.seller_code && !existing.seller_code) updated.seller_code = r.seller_code;
          if (r.seller_name && !existing.seller_name) updated.seller_name = r.seller_name;
          if (r.store_name && !existing.store_name) updated.store_name = r.store_name;
          if (r.outlet_type && !existing.outlet_type) updated.outlet_type = r.outlet_type;

          if (r.total_qty != null) updated.total_qty = r.total_qty;

          const rAmt = r.grand_total ?? r.amount;
          if (rAmt != null) {
            updated.grand_total = rAmt;
            updated.amount = rAmt;
          }

          if (r.tax_return) updated.tax_return = r.tax_return;
          if (r.tax_return_book_no) updated.tax_return_book_no = r.tax_return_book_no;

          const rExcl = r.excl_tax_amount ?? r.excl_tax;
          if (rExcl != null) {
            updated.excl_tax_amount = rExcl;
            updated.excl_tax = rExcl;
          }

          if (r.sales_tax != null) updated.sales_tax = r.sales_tax;

          const rAdv = r.advance_income_tax ?? r.adv_tax;
          if (rAdv != null) {
            updated.advance_income_tax = rAdv;
            updated.adv_tax = rAdv;
          }

          const rDisc = r.discount_total ?? r.disc_tot;
          if (rDisc != null) {
            updated.discount_total = rDisc;
            updated.disc_tot = rDisc;
          }

          if (r.shop_id) updated.shop_id = r.shop_id;
          map.set(key, updated);
          mergedCount++;
        }
        setPendingInvoices(Array.from(map.values()));
        const unmatchedMsg = unmatched.length
          ? `\n${unmatched.length} report row(s) did not match any staged invoice` +
            ` (e.g. ${unmatched.slice(0, 5).join(", ")}${unmatched.length > 5 ? ", …" : ""}).`
          : "";
        setTimeout(() => {
          alert(
            `Sales Tax Summary merged into ${mergedCount} of ${pendingRef.current.length} pending invoice(s).${unmatchedMsg}\nVerify rows in the table, then click Save.`
          );
        }, 0);
      } else {
        // No pending invoices — run against DB directly
        const res = await bulkImportSalesTax(rows);
        pageCacheRef.current.clear();
        await fetchInvoices(page, search, appliedFrom, appliedTo);
        router.refresh();
        alert(
          `Sales Tax Summary imported:\n${res.updated ?? 0} invoice(s) updated.\n${res.inserted ? `${res.inserted} invoice(s) inserted.\n` : ""}${res.skipped ?? 0} skipped.`
        );
      }
    } catch (err: any) {
      alert(`Import failed:\n${err.message}`);
    } finally {
      setImportingTax(false);
      if (taxFileRef.current) taxFileRef.current.value = "";
    }
  };

  // Import Sale Detail PDF — merges into pending staged invoices
  const handleImportSaleDetailPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingSaleDetail(true);
    try {
      // Start the catalogue fetch in parallel with the PDF parse so the unmatched
      // check costs no extra wait after products are staged.
      const catalogPromise = loadProductCatalog(true);
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-sale-detail-pdf", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.success) {
        const rawPreview = json.rawText
          ? `\n\nRaw PDF text (first 2000 chars):\n${json.rawText.slice(0, 2000)}`
          : "";
        throw new Error((json.error || "PDF parse failed") + rawPreview);
      }
      const invoiceProducts: {
        invoice_no: string;
        products: { code: string; name: string; phCase: number }[];
      }[] = json.data;
      if (!invoiceProducts.length) {
        const rawPreview = json.rawText
          ? `\n\nRaw PDF text (first 2000 chars):\n${json.rawText.slice(0, 2000)}`
          : "";
        throw new Error(
          "No invoice/product blocks found in PDF. Check the format matches expected layout." +
            rawPreview
        );
      }

      if (pendingRef.current.length > 0) {
        // Merge product data into pending staged invoices (always update products)
        const map = new Map(
          pendingRef.current.map((p) => [String(p.invoice_no).trim().toUpperCase(), p])
        );
        let mergedCount = 0;
        const unmatched: string[] = [];
        for (const inv of invoiceProducts) {
          const cleanNo = String(inv.invoice_no).replace(/^DATE\s*/i, "").trim();
          const key = cleanNo.toUpperCase();
          const existing = map.get(key);
          if (!existing) {
            unmatched.push(cleanNo);
            continue;
          }
          const products = inv.products
            .map((p) => `${p.code}     ${p.name}\u00D7${p.phCase}`)
            .join(", ");
          map.set(key, { ...existing, products });
          mergedCount++;
        }
        const nextPending = Array.from(map.values());
        setPendingInvoices(nextPending);
        const catalog = await catalogPromise;
        const productCheck = catalog
          ? findUnmatchedInvoiceProducts(nextPending, catalog)
          : null;
        const unmatchedMsg = unmatched.length
          ? `\n${unmatched.length} report invoice(s) did not match any staged invoice` +
            ` (e.g. ${unmatched.slice(0, 5).join(", ")}${unmatched.length > 5 ? ", …" : ""}).`
          : "";
        setTimeout(() => {
          alert(
            `Sale Detail merged into ${mergedCount} of ${pendingRef.current.length} pending invoice(s).${unmatchedMsg}` +
              (productCheck
                ? formatUnmatchedProductAlert(productCheck.unmatched) +
                  (productCheck.unmatched.length === 0 && productCheck.parsedLineCount > 0
                    ? `\n\nAll ${productCheck.parsedLineCount} imported product line(s) match the Products menu.`
                    : "")
                : "") +
              `\nVerify rows in the table, then click Save.`
          );
        }, 0);
      } else {
        // No pending invoices — run against DB directly
        const entries = invoiceProducts.map((inv) => ({
          invoice_no: inv.invoice_no,
          products: inv.products
            .map((p) => `${p.code}     ${p.name}\u00D7${p.phCase}`)
            .join(", "),
        }));
        const result = await bulkImportSaleDetail(entries);
        pageCacheRef.current.clear();
        await fetchInvoices(page, search, appliedFrom, appliedTo);
        router.refresh();
        const skippedMsg = result.skippedExisting
          ? `\n${result.skippedExisting} skipped (products already set).`
          : "";
        alert(
          `Sale Detail import complete:\n${result.updated} invoice(s) updated.\n${result.notFound} skipped (not in Import Invoices baseline).${skippedMsg}` +
            (result.unmatchedCodes?.length
              ? `\n\n⚠ ${result.unmatchedCodes.length} product code(s) match no product, so their stock was NOT deducted:\n${result.unmatchedCodes.slice(0, 10).join("\n")}`
              : "") +
            (result.stockError ? `\n\n⚠ Warehouse stock deduction failed: ${result.stockError}` : "")
        );
      }
    } catch (err: any) {
      alert(`Import failed:\n${err.message}`);
    } finally {
      setImportingSaleDetail(false);
      if (saleDetailFileRef.current) saleDetailFileRef.current.value = "";
    }
  };

  // Open Export Modal
  const openExportDialog = (type: "pdf" | "excel") => {
    setExportType(type);
    setRangeStart(1);
    setRangeEnd(totalPages);
    setExportScope(totalPages > 1 ? "current" : "current");
    setShowExportModal(true);
  };

  // Helper to fetch server-generated PDF blob without freezing client UI
  async function fetchServerPdf(data: any[], filename: string): Promise<Blob> {
    const res = await fetch("/api/export-invoices-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, filename }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || `Server responded with ${res.status}`);
    }
    return await res.blob();
  }

  // Paginated Export Execution
  const executeExport = async () => {
    exportCancelledRef.current = false;

    let startP = page;
    let endP = page;

    if (exportScope === "all") {
      startP = 1;
      endP = totalPages;
    } else if (exportScope === "range") {
      startP = Math.max(1, Math.min(rangeStart, totalPages));
      endP = Math.max(startP, Math.min(rangeEnd, totalPages));
    }

    const totalPagesToExport = endP - startP + 1;
    const baseFilename = sanitizeFileName(
      `invoices_${appliedFrom || "all"}_to_${appliedTo || "all"}`
    );

    // Single Page Fast Path
    if (totalPagesToExport === 1 && startP === page) {
      setExportProgress({
        current: 1,
        total: 1,
        message: `Exporting ${exportType.toUpperCase()} for Page ${page}...`,
      });

      try {
        const rows = invoices.map(formatExportRow);

        if (exportType === "pdf") {
          let blob: Blob;
          try {
            blob = generateFastInvoicesPdfBlob(
              rows,
              `Invoices Page ${page} (${rows.length} records)`
            );
          } catch (clientErr) {
            console.warn("[Export] Client fast PDF failed, falling back to server:", clientErr);
            blob = await fetchServerPdf(
              rows,
              `Invoices Page ${page} (${rows.length} records)`
            );
          }
          downloadBlob(blob, `${baseFilename}_page_${page}.pdf`);
        } else {
          const worksheet = buildWorksheet(rows);
          const workbook = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(workbook, worksheet, `Page ${page}`);
          XLSX.writeFile(workbook, `${baseFilename}_page_${page}.xlsx`);
        }
      } catch (err: any) {
        alert(`Export failed: ${err.message}`);
      } finally {
        setExportProgress(null);
        setShowExportModal(false);
      }
      return;
    }

    // Multi-page batching: first identify uncached pages to prefetch in parallel
    setExportProgress({
      current: 0,
      total: totalPagesToExport,
      message: `Preparing export for ${totalPagesToExport} pages...`,
    });

    try {
      const missingPages: number[] = [];
      for (let p = startP; p <= endP; p++) {
        if (p !== page && !pageCacheRef.current.has(p)) {
          missingPages.push(p);
        }
      }

      // Concurrently prefetch missing pages in batches of 4
      const BATCH_SIZE = 4;
      for (let i = 0; i < missingPages.length; i += BATCH_SIZE) {
        if (exportCancelledRef.current) break;
        const batch = missingPages.slice(i, i + BATCH_SIZE);
        setExportProgress({
          current: Math.min(i + batch.length, totalPagesToExport),
          total: totalPagesToExport,
          message: `Loading data for page(s) ${batch.join(", ")} of ${endP}...`,
        });
        await Promise.all(
          batch.map(async (pNum) => {
            const res = await getInvoicesPaginated({
              page: pNum,
              pageSize: 500,
              search,
              dateFrom: appliedFrom,
              dateTo: appliedTo,
            });
            pageCacheRef.current.set(pNum, res.invoices);
          })
        );
      }

      if (exportCancelledRef.current) return;

      const accumulatedExcelRows: any[] = [];
      const accumulatedPdfRows: any[] = [];

      for (let p = startP; p <= endP; p++) {
        if (exportCancelledRef.current) break;

        const currentStepIndex = p - startP + 1;
        setExportProgress({
          current: currentStepIndex,
          total: totalPagesToExport,
          message: `Processing Page ${p} of ${endP}...`,
        });

        let pageRows: any[] = [];
        if (p === page) {
          pageRows = invoices.map(formatExportRow);
        } else if (pageCacheRef.current.has(p)) {
          pageRows = pageCacheRef.current.get(p)!.map(formatExportRow);
        } else {
          const res = await getInvoicesPaginated({
            page: p,
            pageSize: 500,
            search,
            dateFrom: appliedFrom,
            dateTo: appliedTo,
          });
          pageCacheRef.current.set(p, res.invoices);
          pageRows = res.invoices.map(formatExportRow);
        }

        if (exportCancelledRef.current) break;

        if (exportType === "pdf") {
          if (pdfCombineMode === "per_page") {
            setExportProgress({
              current: currentStepIndex,
              total: totalPagesToExport,
              message: `Generating fast PDF for Page ${p} of ${endP}...`,
            });
            let blob: Blob;
            try {
              blob = generateFastInvoicesPdfBlob(
                pageRows,
                `Invoices Page ${p} (${pageRows.length} records)`
              );
            } catch (err) {
              blob = await fetchServerPdf(
                pageRows,
                `Invoices Page ${p} (${pageRows.length} records)`
              );
            }
            downloadBlob(blob, `${baseFilename}_part_${p}_of_${endP}.pdf`);
            await new Promise((r) => setTimeout(r, 100));
          } else {
            // Combined mode: accumulate rows in memory
            accumulatedPdfRows.push(...pageRows);
          }
        } else {
          // Excel Export
          if (excelCombineMode === "per_page") {
            setExportProgress({
              current: currentStepIndex,
              total: totalPagesToExport,
              message: `Saving Excel for Page ${p}...`,
            });
            const worksheet = buildWorksheet(pageRows);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, `Page ${p}`);
            XLSX.writeFile(workbook, `${baseFilename}_page_${p}.xlsx`);
            await new Promise((r) => setTimeout(r, 200));
          } else {
            accumulatedExcelRows.push(...pageRows);
          }
        }
      }

      // If combined PDF was chosen and not cancelled
      if (
        exportType === "pdf" &&
        pdfCombineMode === "combined" &&
        !exportCancelledRef.current &&
        accumulatedPdfRows.length > 0
      ) {
        setExportProgress({
          current: totalPagesToExport,
          total: totalPagesToExport,
          message: `Building high-speed PDF (${accumulatedPdfRows.length.toLocaleString()} invoices)...`,
        });
        await new Promise((r) => setTimeout(r, 30));

        let blob: Blob;
        try {
          blob = generateFastInvoicesPdfBlob(
            accumulatedPdfRows,
            `Invoices (${accumulatedPdfRows.length.toLocaleString()} records)`
          );
        } catch (serverErr) {
          console.warn("[Export] Fast PDF fallback to server:", serverErr);
          blob = await fetchServerPdf(
            accumulatedPdfRows,
            `Invoices (${accumulatedPdfRows.length.toLocaleString()} records)`
          );
        }
        downloadBlob(blob, `${baseFilename}_all_p${startP}_to_p${endP}.pdf`);
      }

      // If combined excel was chosen and not cancelled
      if (
        exportType === "excel" &&
        excelCombineMode === "combined" &&
        !exportCancelledRef.current &&
        accumulatedExcelRows.length > 0
      ) {
        setExportProgress({
          current: totalPagesToExport,
          total: totalPagesToExport,
          message: `Building final Excel file (${accumulatedExcelRows.length.toLocaleString()} invoices)...`,
        });
        await new Promise((r) => setTimeout(r, 80));

        const worksheet = buildWorksheet(accumulatedExcelRows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Invoices");
        XLSX.writeFile(workbook, `${baseFilename}_p${startP}_to_p${endP}.xlsx`);
      }
    } catch (err: any) {
      alert(`Export error: ${err.message}`);
    } finally {
      setExportProgress(null);
      setShowExportModal(false);
    }
  };

  const n = (v: any) =>
    v != null && v !== ""
      ? Number(v).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "—";

  const fromRecord = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const toRecord = Math.min(page * pageSize, totalCount);

  return (
    <div className="space-y-4">
      {/* ── Filter & Action Bar ─────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 sm:gap-3 items-center sm:items-end bg-zinc-50 p-2.5 sm:p-3 rounded-lg border border-zinc-200">
        <div className="w-full sm:flex-1 sm:min-w-[11.25rem]">
          <Input
            placeholder="Search Invoice No, Outlet, Seller..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Date Filter with accurate calendar icon display and dedicated Load button */}
        <div className="flex flex-wrap sm:flex-nowrap gap-1.5 sm:gap-2 items-center">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleApplyDateFilter();
            }}
            className="w-[9.0625rem] sm:w-[9.6875rem] text-xs shrink-0"
          />
          <span className="text-zinc-400 text-xs sm:text-sm font-medium">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleApplyDateFilter();
            }}
            className="w-[9.0625rem] sm:w-[9.6875rem] text-xs shrink-0"
          />
          <Button
            type="button"
            size="sm"
            onClick={handleApplyDateFilter}
            className="bg-red-600 hover:bg-red-700 text-white font-semibold px-3 text-xs h-9 shrink-0 shadow-sm"
          >
            Load
          </Button>
        </div>

        <Button variant="ghost" size="sm" onClick={handleResetFilters}>
          Reset
        </Button>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <Button
            type="button"
            variant={isAllCurrentSelected ? "ghost" : "outline"}
            size="sm"
            onClick={handleToggleSelectAllCurrent}
            className="whitespace-nowrap"
            disabled={invoices.length === 0}
          >
            {isAllCurrentSelected ? "Deselect Page" : "Select Page"}
          </Button>

          {selectedIds.length > 0 && (
            <Button
              type="button"
              size="sm"
              onClick={handleBulkDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 whitespace-nowrap"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                  <span>Deleting ({selectedIds.length})...</span>
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  <span>Delete ({selectedIds.length})</span>
                </>
              )}
            </Button>
          )}
        </div>

        {/* Export Buttons */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <Button
            type="button"
            onClick={() => openExportDialog("pdf")}
            variant="default"
            size="sm"
            className="whitespace-nowrap"
            disabled={totalCount === 0}
          >
            <Printer className="h-3.5 w-3.5 mr-1" />
            Print PDF
          </Button>

          <Button
            type="button"
            onClick={() => openExportDialog("excel")}
            variant="default"
            size="sm"
            className="whitespace-nowrap"
            disabled={totalCount === 0}
          >
            <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />
            Export Excel
          </Button>
        </div>

        {/* Import Buttons */}
        <div className="flex flex-wrap gap-1.5 sm:gap-2">
          <input
            ref={invoiceFileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleImportInvoices}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => invoiceFileRef.current?.click()}
            disabled={importingInvoices}
            className="flex items-center gap-1.5"
          >
            {importingInvoices ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                <span className="text-red-600 font-semibold">Importing...</span>
              </>
            ) : (
              "Import Invoices"
            )}
          </Button>

          <input
            ref={taxFileRef}
            type="file"
            accept=".xlsx,.xls,.csv,.pdf"
            className="hidden"
            onChange={handleImportSalesTax}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => taxFileRef.current?.click()}
            disabled={importingTax}
            className="flex items-center gap-1.5"
          >
            {importingTax ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                <span className="text-red-600 font-semibold">Importing...</span>
              </>
            ) : (
              "Import Sales Tax Summary"
            )}
          </Button>

          <input
            ref={saleDetailFileRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handleImportSaleDetailPdf}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => saleDetailFileRef.current?.click()}
            disabled={importingSaleDetail}
            className="flex items-center gap-1.5"
          >
            {importingSaleDetail ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                <span className="text-red-600 font-semibold">Importing...</span>
              </>
            ) : (
              "Import Sale Detail | PDF"
            )}
          </Button>

          {hasPendingImport && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (confirm(`Discard ${pendingInvoices.length} pending imported invoice(s)?`)) {
                  setPendingInvoices([]);
                }
              }}
              className="flex items-center gap-1.5 border-red-300 text-red-600 hover:bg-red-50"
            >
              <X className="h-4 w-4" />
              <span>Discard ({pendingInvoices.length})</span>
            </Button>
          )}

          <Button
            variant="default"
            size="sm"
            onClick={async () => {
              if (hasPendingImport) {
                if (pendingProductCheck.unmatched.length > 0) {
                  const ok = window.confirm(
                    `${pendingProductCheck.unmatched.length} product(s) on these unsaved invoices are not in the Products menu.\n\n` +
                      pendingProductCheck.unmatched
                        .slice(0, 10)
                        .map((u) => u.label)
                        .join("\n") +
                      (pendingProductCheck.unmatched.length > 10
                        ? `\n…and ${pendingProductCheck.unmatched.length - 10} more`
                        : "") +
                      `\n\nIf you Save now, those lines will not deduct stock and Closing Stock will read high.\n\nCreate them in the Products menu first, or Save anyway?`
                  );
                  if (!ok) return;
                }
                setIsSaving(true);
                try {
                  const res = await bulkImportInvoicesReport(pendingInvoices);
                  setPendingInvoices([]);
                  pageCacheRef.current.clear();
                  await fetchInvoices(1, search, appliedFrom, appliedTo);
                  router.refresh();
                  alert(
                    `Saved: ${res.inserted ?? 0} inserted, ${res.updated ?? 0} updated.` +
                      (res.failed ? `\n⚠ ${res.failed} invoice(s) could NOT be saved — see server log.` : "") +
                      (res.stockDeducted ? `\nWarehouse stock deducted for ${res.stockDeducted} invoice(s).` : "") +
                      (res.productsPreserved
                        ? `\n${res.productsPreserved} invoice(s) already had a product list — kept as-is, stock not touched again.`
                        : "") +
                      (res.unmatchedCodes?.length
                        ? `\n⚠ ${res.unmatchedCodes.length} product code(s) match no product, so their stock was NOT deducted:\n${res.unmatchedCodes.slice(0, 10).join("\n")}`
                        : "") +
                      (res.stockError ? `\n⚠ Warehouse stock deduction failed: ${res.stockError}` : "")
                  );
                } catch (err: any) {
                  alert(`Save failed:\n${err.message}`);
                } finally {
                  setIsSaving(false);
                }
              } else {
                pageCacheRef.current.clear();
                fetchInvoices(page, search, appliedFrom, appliedTo);
              }
            }}
            disabled={isLoading || isSaving}
            className={`flex items-center gap-1.5 font-semibold ${
              hasPendingImport
                ? "bg-amber-500 hover:bg-amber-600 text-white animate-pulse"
                : "bg-green-600 hover:bg-green-700 text-white"
            }`}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Refreshing...</span>
              </>
            ) : hasPendingImport ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                <span>Save ({pendingInvoices.length} pending)</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                <span>Save</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ── Top Pagination Bar ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-zinc-600">
        <div className="flex items-center gap-2 font-medium">
          <span>
            Showing <strong className="text-zinc-900">{fromRecord.toLocaleString()}</strong>–
            <strong className="text-zinc-900">{toRecord.toLocaleString()}</strong> of{" "}
            <strong className="text-zinc-900">{totalCount.toLocaleString()}</strong> invoices
          </span>
          <span className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-[0.6875rem] font-semibold text-zinc-700 border border-zinc-200">
            500 per page
          </span>
          {isLoading && (
            <span className="flex items-center gap-1 text-red-600 font-semibold ml-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading...
            </span>
          )}
        </div>

        {/* Navigation Controls */}
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(1)}
            disabled={page <= 1 || isLoading}
            className="h-7 w-7 p-0"
            title="First Page"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(page - 1)}
            disabled={page <= 1 || isLoading}
            className="h-7 w-7 p-0"
            title="Previous Page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <form onSubmit={handleJumpSubmit} className="flex items-center gap-1">
            <span className="text-zinc-500">Page</span>
            <input
              type="text"
              value={jumpPageInput}
              onChange={(e) => setJumpPageInput(e.target.value)}
              className="h-7 w-12 rounded border border-zinc-300 text-center font-medium text-xs focus:border-red-500 focus:outline-none"
            />
            <span className="text-zinc-500">of {totalPages.toLocaleString()}</span>
          </form>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(page + 1)}
            disabled={page >= totalPages || isLoading}
            className="h-7 w-7 p-0"
            title="Next Page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(totalPages)}
            disabled={page >= totalPages || isLoading}
            className="h-7 w-7 p-0"
            title="Last Page"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Pending Import Banner ───────────────────────────────────────── */}
      {hasPendingImport && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold mb-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            <span>{pendingInvoices.length} imported invoice(s) are staged and not yet saved to the system.</span>
          </div>
          <span className="text-amber-700">Click <strong>Save</strong> to commit or <strong>Discard</strong> to cancel.</span>
        </div>
      )}

      {hasPendingImport &&
        pendingProductCheck.ready &&
        pendingProductCheck.parsedLineCount > 0 &&
        pendingProductCheck.unmatched.length > 0 && (
          <div className="flex items-start justify-between gap-3 px-4 py-2 rounded-lg bg-red-50 border border-red-300 text-red-900 text-xs mb-1">
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
              <div className="min-w-0">
                <p className="font-semibold">
                  {pendingProductCheck.unmatched.length} imported product(s) are not in the Products
                  menu — stock will not be deducted for them if you Save.
                </p>
                <p className="mt-1 font-mono text-[0.6875rem] leading-relaxed break-words">
                  {pendingProductCheck.unmatched
                    .slice(0, 8)
                    .map((u) => u.label)
                    .join(" · ")}
                  {pendingProductCheck.unmatched.length > 8
                    ? ` · +${pendingProductCheck.unmatched.length - 8} more`
                    : ""}
                </p>
                <p className="mt-1 text-red-700">
                  Add the missing SKU in the Products menu, then re-import Sale Detail — or edit the
                  pending row. Do not Save until these match, or Closing Stock will read high.
                </p>
              </div>
            </div>
          </div>
        )}

      {/* ── Invoices Data Table ────────────────────────────────────────── */}
      <div id="invoices-table-container" className="relative">
        {isLoading && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-20 flex items-center justify-center rounded-lg">
            <div className="flex items-center gap-2 bg-white px-4 py-2.5 rounded-lg shadow-md border border-zinc-200 text-xs font-semibold text-zinc-800">
              <Loader2 className="h-4 w-4 animate-spin text-red-600" />
              Loading invoices...
            </div>
          </div>
        )}

        <Table className="whitespace-nowrap min-w-full">
          <TableHeader>
            <TableRow className="bg-zinc-50">
              <TableHead className="w-10 text-center whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={isAllCurrentSelected}
                  onChange={handleToggleSelectAllCurrent}
                  className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                />
              </TableHead>
              <TableHead className="whitespace-nowrap">Invoice No</TableHead>
              <TableHead className="whitespace-nowrap">Outlet Code</TableHead>
              <TableHead className="whitespace-nowrap">Outlet Name</TableHead>
              <TableHead className="whitespace-nowrap">Record Date</TableHead>
              <TableHead className="whitespace-nowrap">Delivery Date</TableHead>
              <TableHead className="whitespace-nowrap">Seller Code</TableHead>
              <TableHead className="whitespace-nowrap">Seller Name</TableHead>
              <TableHead className="whitespace-nowrap">Store Name</TableHead>
              <TableHead className="whitespace-nowrap">Type</TableHead>
              <TableHead className="text-right whitespace-nowrap">Total Qty</TableHead>
              <TableHead className="text-right whitespace-nowrap">Amount</TableHead>
              <TableHead className="whitespace-nowrap">Tax Return</TableHead>
              <TableHead className="text-right whitespace-nowrap">Excl Tax</TableHead>
              <TableHead className="text-right whitespace-nowrap">Sales Tax</TableHead>
              <TableHead className="text-right whitespace-nowrap">Adv. Tax</TableHead>
              <TableHead className="text-right whitespace-nowrap">Disc. Tot</TableHead>
              <TableHead className="whitespace-nowrap">Products</TableHead>
              <TableHead className="whitespace-nowrap">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* ─── PENDING (UNSAVED) ROWS ─── */}
            {pendingInvoices.map((inv, idx) => {
              const amountVal = inv.grand_total ?? inv.amount;
              const exclTaxVal = inv.excl_tax_amount ?? inv.excl_tax;
              const advTaxVal = inv.advance_income_tax ?? inv.adv_tax;
              const discTotVal = inv.discount_total ?? inv.disc_tot;
              const hasUnmatchedProducts = pendingProductCheck.unmatchedInvoiceKeys.has(
                String(inv.invoice_no || "").trim().toUpperCase()
              );

              return (
                <TableRow
                  key={`pending-${idx}`}
                  className={
                    hasUnmatchedProducts
                      ? "bg-red-50/80 border-l-4 border-l-red-500 hover:bg-red-100/70 transition-colors"
                      : "bg-amber-50/80 border-l-4 border-l-amber-500 hover:bg-amber-100/60 transition-colors"
                  }
                >
                  {/* Status Badge */}
                  <TableCell className="w-10 text-center">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.5625rem] font-bold bg-amber-500 text-white uppercase tracking-wider shadow-sm">
                      PENDING
                    </span>
                  </TableCell>
                  <TableCell className="font-semibold whitespace-nowrap text-xs text-amber-900">
                    {inv.invoice_no || "—"}
                  </TableCell>
                  <TableCell className="text-xs font-mono whitespace-nowrap text-zinc-700">
                    {inv.outlet_code || "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap font-medium text-zinc-800">
                    {inv.outlet_name || "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-zinc-600">
                    {inv.record_date || "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-zinc-600">
                    {inv.delivery_date || "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-zinc-600">
                    {inv.seller_code || "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-zinc-600">
                    {inv.seller_name || "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-zinc-600">
                    {inv.store_name || "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-zinc-600">
                    {inv.outlet_type || "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right whitespace-nowrap font-medium text-zinc-700">
                    {inv.total_qty ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right font-bold whitespace-nowrap text-amber-800">
                    {amountVal != null ? Number(amountVal).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-zinc-600">
                    {inv.tax_return || inv.tax_return_book_no || "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right whitespace-nowrap text-zinc-600">
                    {exclTaxVal != null ? Number(exclTaxVal).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right whitespace-nowrap text-zinc-600">
                    {inv.sales_tax != null ? Number(inv.sales_tax).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right whitespace-nowrap text-zinc-600">
                    {advTaxVal != null ? Number(advTaxVal).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right whitespace-nowrap text-zinc-600">
                    {discTotVal != null ? Number(discTotVal).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
                  </TableCell>
                  <TableCell
                    className={`text-xs whitespace-nowrap max-w-[10rem] truncate ${
                      hasUnmatchedProducts ? "text-red-700 font-semibold" : "text-zinc-600"
                    }`}
                    title={
                      hasUnmatchedProducts
                        ? `Not in Products menu: ${inv.products || ""}`
                        : inv.products || ""
                    }
                  >
                    {hasUnmatchedProducts ? "⚠ " : ""}
                    {inv.products || "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs font-medium text-zinc-700 hover:bg-amber-100"
                        onClick={() =>
                          onView({
                            ...inv,
                            amount: amountVal,
                            excl_tax: exclTaxVal,
                            adv_tax: advTaxVal,
                            disc_tot: discTotVal,
                            tax_return: inv.tax_return || inv.tax_return_book_no || null,
                          })
                        }
                      >
                        View
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs font-medium text-amber-700 hover:text-amber-900 hover:bg-amber-100"
                        onClick={() => setEditingPendingInvoice({ ...inv, _pendingIdx: idx })}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs font-medium text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => setPendingInvoices((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        Del
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {/* ─── SAVED ROWS ─── */}
            {invoices.length === 0 && pendingInvoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={19} className="text-center text-zinc-400 py-20 text-xs font-medium">
                  No invoices found
                </TableCell>
              </TableRow>
            ) : invoices.length === 0 && pendingInvoices.length > 0 ? null : (
              invoices.map((inv) => (
                <TableRow
                  key={inv.id}
                  className={selectedIds.includes(inv.id) ? "bg-red-50/50" : ""}
                >
                  <TableCell className="w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(inv.id)}
                      onChange={() =>
                        setSelectedIds((prev) =>
                          prev.includes(inv.id)
                            ? prev.filter((id) => id !== inv.id)
                            : [...prev, inv.id]
                        )
                      }
                      className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                    />
                  </TableCell>
                  <TableCell className="font-medium whitespace-nowrap text-xs">
                    {inv.invoice_no}
                  </TableCell>
                  <TableCell className="text-xs font-mono whitespace-nowrap">
                    {inv.outlet_code || "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {inv.outlet_name || "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {inv.record_date || "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {inv.delivery_date || "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {inv.seller_code || "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {inv.seller_name || "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {inv.store_name || "—"}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {inv.outlet_type || "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right whitespace-nowrap">
                    {inv.total_qty ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right font-medium whitespace-nowrap">
                    {inv.amount != null ? `Rs.${n(inv.amount)}` : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-center">{inv.tax_return || "—"}</TableCell>
                  <TableCell className="text-xs text-right whitespace-nowrap">
                    {inv.excl_tax != null ? n(inv.excl_tax) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right whitespace-nowrap">
                    {inv.sales_tax != null ? n(inv.sales_tax) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right whitespace-nowrap">
                    {inv.adv_tax != null ? n(inv.adv_tax) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right whitespace-nowrap">
                    {inv.disc_tot != null ? n(inv.disc_tot) : "—"}
                  </TableCell>
                  <TableCell
                    className="text-xs whitespace-nowrap max-w-xs truncate"
                    title={inv.products || ""}
                  >
                    {inv.products || "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="whitespace-nowrap"
                        onClick={() => onView(inv)}
                      >
                        View
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="whitespace-nowrap"
                        onClick={() => onEdit(inv)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="whitespace-nowrap text-red-500 hover:text-red-700"
                        disabled={deletingId === inv.id || isDeleting}
                        onClick={async () => {
                          setDeletingId(inv.id);
                          try {
                            await onDelete(inv.id);
                            await fetchInvoices(page, search, dateFrom, dateTo);
                          } finally {
                            setDeletingId(null);
                          }
                        }}
                      >
                        {deletingId === inv.id ? (
                          <span className="flex items-center gap-1 text-red-600 font-semibold">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Deleting...</span>
                          </span>
                        ) : (
                          "Del"
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

      {/* ── Bottom Pagination Bar ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-zinc-600">
        <div>
          Showing <strong className="text-zinc-900">{fromRecord.toLocaleString()}</strong>–
          <strong className="text-zinc-900">{toRecord.toLocaleString()}</strong> of{" "}
          <strong className="text-zinc-900">{totalCount.toLocaleString()}</strong> invoices
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(1)}
            disabled={page <= 1 || isLoading}
            className="h-7 w-7 p-0"
            title="First Page"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(page - 1)}
            disabled={page <= 1 || isLoading}
            className="h-7 w-7 p-0"
            title="Previous Page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <span className="px-2 font-medium">
            Page {page} of {totalPages.toLocaleString()}
          </span>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(page + 1)}
            disabled={page >= totalPages || isLoading}
            className="h-7 w-7 p-0"
            title="Next Page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(totalPages)}
            disabled={page >= totalPages || isLoading}
            className="h-7 w-7 p-0"
            title="Last Page"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Paginated Export Modal (for 100K+ handling without browser lag) */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-zinc-200 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 bg-zinc-50">
              <div className="flex items-center gap-2">
                {exportType === "pdf" ? (
                  <Printer className="h-5 w-5 text-red-600" />
                ) : (
                  <FileSpreadsheet className="h-5 w-5 text-green-600" />
                )}
                <div>
                  <h3 className="text-sm font-bold text-zinc-900">
                    Export Invoices ({exportType.toUpperCase()})
                  </h3>
                  <p className="text-[0.6875rem] text-zinc-500">
                    {totalCount.toLocaleString()} total filtered invoices across {totalPages.toLocaleString()} pages
                  </p>
                </div>
              </div>
              {!exportProgress && (
                <button
                  type="button"
                  onClick={() => setShowExportModal(false)}
                  className="rounded-lg p-1 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4">
              {exportProgress ? (
                /* Live Progress Bar when export is in flight */
                <div className="space-y-3 py-2 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-red-600 mx-auto" />
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-zinc-800">
                      {exportProgress.message}
                    </p>
                    <p className="text-[0.6875rem] text-zinc-500">
                      Progress: {exportProgress.current} / {exportProgress.total} parts (
                      {Math.round((exportProgress.current / exportProgress.total) * 100)}%)
                    </p>
                  </div>
                  {/* Progress bar */}
                  <div className="w-full bg-zinc-100 rounded-full h-2 overflow-hidden border border-zinc-200">
                    <div
                      className="bg-red-600 h-2 transition-all duration-300 rounded-full"
                      style={{
                        width: `${Math.round(
                          (exportProgress.current / exportProgress.total) * 100
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="text-[0.65625rem] text-zinc-400">
                    Exporting in safe 500-invoice chunks to prevent browser freeze.
                  </p>
                  <div className="pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        exportCancelledRef.current = true;
                        setExportProgress(null);
                      }}
                    >
                      Cancel Export
                    </Button>
                  </div>
                </div>
              ) : (
                /* Scope Selection Form */
                <>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-700">Choose Pages to Export:</label>

                    <div className="space-y-2 text-xs">
                      {/* Option 1: Current Page */}
                      <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-zinc-200 cursor-pointer hover:bg-zinc-50 transition-colors">
                        <input
                          type="radio"
                          name="exportScope"
                          checked={exportScope === "current"}
                          onChange={() => setExportScope("current")}
                          className="mt-0.5 accent-red-600"
                        />
                        <div>
                          <p className="font-semibold text-zinc-900">
                            Current Page Only (Page {page})
                          </p>
                          <p className="text-[0.6875rem] text-zinc-500">
                            Exports the {invoices.length} invoices currently displayed on this page.
                          </p>
                        </div>
                      </label>

                      {/* Option 2: All Pages */}
                      <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-zinc-200 cursor-pointer hover:bg-zinc-50 transition-colors">
                        <input
                          type="radio"
                          name="exportScope"
                          checked={exportScope === "all"}
                          onChange={() => setExportScope("all")}
                          className="mt-0.5 accent-red-600"
                        />
                        <div>
                          <p className="font-semibold text-zinc-900">
                            All Filtered Pages ({totalPages.toLocaleString()} pages)
                          </p>
                          <p className="text-[0.6875rem] text-zinc-500">
                            Exports all {totalCount.toLocaleString()} invoices in sequential 500-record parts.
                          </p>
                        </div>
                      </label>

                      {/* Option 3: Page Range */}
                      <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-zinc-200 cursor-pointer hover:bg-zinc-50 transition-colors">
                        <input
                          type="radio"
                          name="exportScope"
                          checked={exportScope === "range"}
                          onChange={() => setExportScope("range")}
                          className="mt-0.5 accent-red-600"
                        />
                        <div className="flex-1">
                          <p className="font-semibold text-zinc-900">Specific Page Range</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-[0.6875rem] text-zinc-500">From Page:</span>
                            <input
                              type="number"
                              min={1}
                              max={totalPages}
                              value={rangeStart}
                              onChange={(e) => setRangeStart(Math.max(1, parseInt(e.target.value) || 1))}
                              className="h-6 w-14 rounded border border-zinc-300 text-center text-xs font-medium focus:border-red-500 focus:outline-none"
                            />
                            <span className="text-[0.6875rem] text-zinc-500">to</span>
                            <input
                              type="number"
                              min={rangeStart}
                              max={totalPages}
                              value={rangeEnd}
                              onChange={(e) =>
                                setRangeEnd(
                                  Math.max(rangeStart, Math.min(totalPages, parseInt(e.target.value) || 1))
                                )
                              }
                              className="h-6 w-14 rounded border border-zinc-300 text-center text-xs font-medium focus:border-red-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* File Packaging Choice for Multi-page PDF or Excel */}
                  {exportScope !== "current" && (
                    <div className="space-y-1.5 pt-1">
                      <label className="text-xs font-bold text-zinc-700">
                        {exportType === "pdf" ? "PDF Document Packaging:" : "Excel File Packaging:"}
                      </label>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() =>
                            exportType === "pdf"
                              ? setPdfCombineMode("combined")
                              : setExcelCombineMode("combined")
                          }
                          className={`p-2 rounded-lg border text-left transition-all ${
                            (exportType === "pdf" ? pdfCombineMode === "combined" : excelCombineMode === "combined")
                              ? "border-red-600 bg-red-50/50 text-red-900 font-semibold"
                              : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                          }`}
                        >
                          {exportType === "pdf" ? "Single Combined PDF" : "Single Combined Workbook"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            exportType === "pdf"
                              ? setPdfCombineMode("per_page")
                              : setExcelCombineMode("per_page")
                          }
                          className={`p-2 rounded-lg border text-left transition-all ${
                            (exportType === "pdf" ? pdfCombineMode === "per_page" : excelCombineMode === "per_page")
                              ? "border-red-600 bg-red-50/50 text-red-900 font-semibold"
                              : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                          }`}
                        >
                          Separate File per Page
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Safety & Performance Note */}
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-[0.6875rem] text-amber-800 leading-snug">
                    💡 <strong>Browser Safety Guarantee:</strong> Data is streamed and exported in 500-invoice
                    pages with pauses between downloads to prevent memory overload or UI freezing even on 100K+ records.
                  </div>

                  {/* Modal Action Buttons */}
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowExportModal(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={executeExport}
                      className="bg-red-600 hover:bg-red-700 text-white font-semibold"
                    >
                      Start {exportType.toUpperCase()} Export
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── PENDING INVOICE EDIT MODAL ─── */}
      {editingPendingInvoice && (
        <InvoiceForm
          shops={shops}
          editData={editingPendingInvoice}
          isPending={true}
          onClose={() => setEditingPendingInvoice(null)}
          onSuccess={(updatedPendingData) => {
            if (updatedPendingData && editingPendingInvoice._pendingIdx != null) {
              const targetIdx = editingPendingInvoice._pendingIdx;
              setPendingInvoices((prev) =>
                prev.map((item, i) => (i === targetIdx ? { ...item, ...updatedPendingData } : item))
              );
            }
            setEditingPendingInvoice(null);
          }}
        />
      )}
    </div>
  );
}
