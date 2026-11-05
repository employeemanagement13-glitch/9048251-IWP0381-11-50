"use server";

import { createClient, createAdminClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getWarehouseRGBLevels, getWarehouseEmptiesLevels } from "@/lib/actions/warehouse-catalogue";
import { ensureOverdueAlerts } from "@/lib/actions/alerts";
import { parseProductsWithCode } from "@/lib/parsers/products";


// --------------------------------------------------------------------------
// TYPES
// --------------------------------------------------------------------------

export interface InvoiceFilters {
  search?: string;
  invoiceType?: "cash" | "credit" | "";
  deliveryStatus?: string;
  paymentStatus?: string;
  scheduledDate?: string;
  presellerId?: string;
  dmId?: string;
}

export interface InvoiceFormData {
  invoice_no: string;
  shop_id: string;
  outlet_code?: string;
  outlet_name?: string;
  record_date?: string;
  delivery_date?: string;
  seller_code?: string;
  seller_name?: string;
  store_name?: string;
  outlet_type?: string;
  total_qty?: number;
  amount?: number;
  tax_return?: string;
  excl_tax?: number;
  sales_tax?: number;
  adv_tax?: number;
  disc_tot?: number;

  // Optional legacy fields for backward compatibility
  preseller_id?: string;
  dm_id?: string;
  products?: string;
  promo_type?: string;
  promo_note?: string;
  invoice_date?: string;
  scheduled_date?: string;
  due_date?: string;
  invoice_type?: "cash" | "credit" | string;
  invoice_total?: number;
  discount_amount?: number;
  advance_tax?: number;
  empties_deposit?: number;
  amount_received?: number;
  delivery_status?: string;
  visit_status?: string;
}

// --------------------------------------------------------------------------
// LIST
// --------------------------------------------------------------------------

export async function getInvoices(filters?: InvoiceFilters) {
  try {
    const supabase = await createClient();
    const PAGE = 1000;
    const all: any[] = [];

    for (let from = 0; ; from += PAGE) {
      let query = supabase
        .from("invoices")
        .select(`*, shop:shops(shop_name, outlet_code)`)
        .order("record_date", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .range(from, from + PAGE - 1);

      if (filters?.search) {
        query = query.or(
          `invoice_no.ilike.%${filters.search}%,outlet_name.ilike.%${filters.search}%,outlet_code.ilike.%${filters.search}%`
        );
      }

      const { data, error } = await query;
      if (error) {
        console.error("[getInvoices] error:", error.message);
        return all;
      }
      const rows = data || [];
      all.push(...rows);
      if (rows.length < PAGE) break;
    }

    return all;
  } catch (err: any) {
    console.error("[getInvoices] unexpected error:", err?.message ?? err);
    return [];
  }
}

export interface GetInvoicesPaginatedParams {
  page?: number;
  pageSize?: number;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface GetInvoicesPaginatedResponse {
  invoices: any[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function getInvoicesPaginated(
  params: GetInvoicesPaginatedParams = {}
): Promise<GetInvoicesPaginatedResponse> {
  try {
    const supabase = await createClient();
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.max(1, Number(params.pageSize) || 500);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("invoices")
      .select(`*, shop:shops(shop_name, outlet_code)`, { count: "exact" })
      .order("record_date", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });

    if (params.search?.trim()) {
      const s = params.search.trim();
      query = query.or(
        `invoice_no.ilike.%${s}%,outlet_name.ilike.%${s}%,outlet_code.ilike.%${s}%,seller_name.ilike.%${s}%,store_name.ilike.%${s}%`
      );
    }

    if (params.dateFrom) {
      query = query.gte("record_date", params.dateFrom);
    }

    if (params.dateTo) {
      query = query.lte("record_date", params.dateTo);
    }

    const { data, count, error } = await query.range(from, to);

    if (error) {
      console.error("[getInvoicesPaginated] error:", error.message);
      return { invoices: [], totalCount: 0, page, pageSize, totalPages: 0 };
    }

    const totalCount = count || 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    return {
      invoices: data || [],
      totalCount,
      page,
      pageSize,
      totalPages,
    };
  } catch (err: any) {
    console.error("[getInvoicesPaginated] unexpected error:", err?.message ?? err);
    return { invoices: [], totalCount: 0, page: 1, pageSize: 500, totalPages: 0 };
  }
}

export async function createInvoice(formData: InvoiceFormData) {

  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const defaultDate = formData.record_date || formData.delivery_date || new Date().toISOString().split("T")[0];

  let isCredit = (formData.outlet_type || "").toLowerCase() === "credit" || formData.invoice_type === "credit";
  if (!isCredit && formData.shop_id) {
    const { data: s } = await supabase.from("shops").select("shop_type, outlet_type").eq("id", formData.shop_id).maybeSingle();
    if (s && (s.shop_type === "credit" || (s.outlet_type || "").toLowerCase() === "credit")) {
      isCredit = true;
    }
  }

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      tenant_id: tenantId,
      invoice_no: formData.invoice_no,
      shop_id: formData.shop_id || null,
      outlet_code: formData.outlet_code || null,
      outlet_name: formData.outlet_name || null,
      record_date: formData.record_date || null,
      delivery_date: formData.delivery_date || null,
      seller_code: formData.seller_code || null,
      seller_name: formData.seller_name || null,
      store_name: formData.store_name || null,
      outlet_type: formData.outlet_type || null,
      total_qty: formData.total_qty ?? null,
      amount: formData.amount ?? null,
      tax_return: formData.tax_return || null,
      excl_tax: formData.excl_tax ?? null,
      sales_tax: formData.sales_tax ?? null,
      adv_tax: formData.adv_tax ?? null,
      disc_tot: formData.disc_tot ?? null,
      // Fallback defaults for legacy NOT NULL columns
      products: formData.products || "",
      invoice_date: defaultDate,
      scheduled_date: formData.delivery_date || defaultDate,
      invoice_type: isCredit ? "credit" : (formData.invoice_type || "cash"),
      invoice_total: formData.amount ?? 0,
      discount_amount: formData.discount_amount ?? 0,
      advance_tax: formData.adv_tax ?? 0,
      promo_type: formData.promo_type || "none",
      delivery_status: formData.delivery_status || "delivered",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  if (isCredit) {
    try {
      await ensureOverdueAlerts();
    } catch (e: any) {
      console.error("[createInvoice ensureOverdueAlerts]", e?.message);
    }
  }

  if (formData.products && formData.invoice_no) {
    try {
      await deductWarehouseStockForInvoices(supabase, tenantId, [
        { invoice_no: formData.invoice_no, products: formData.products },
      ]);
    } catch (e: any) {
      console.error("[createInvoice deductWarehouseStockForInvoices]", e?.message);
    }
  }

  revalidatePath("/tab1/transactions");
  revalidatePath("/tab1/invoices");
  revalidatePath("/tab2/credit");
  revalidatePath("/tab7/alerts");
  revalidatePath("/inventory/warehouse");
  revalidatePath("/tab3/warehouse");
  return data;
}

// --------------------------------------------------------------------------
// UPDATE
// --------------------------------------------------------------------------

export async function updateInvoice(id: string, formData: Partial<InvoiceFormData>) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const updatePayload: Record<string, unknown> = {};
  if (formData.invoice_no !== undefined) updatePayload.invoice_no = formData.invoice_no;
  if (formData.shop_id !== undefined) updatePayload.shop_id = formData.shop_id;
  if (formData.outlet_code !== undefined) updatePayload.outlet_code = formData.outlet_code || null;
  if (formData.outlet_name !== undefined) updatePayload.outlet_name = formData.outlet_name || null;
  if (formData.record_date !== undefined) updatePayload.record_date = formData.record_date || null;
  if (formData.delivery_date !== undefined) updatePayload.delivery_date = formData.delivery_date || null;
  if (formData.seller_code !== undefined) updatePayload.seller_code = formData.seller_code || null;
  if (formData.seller_name !== undefined) updatePayload.seller_name = formData.seller_name || null;
  if (formData.store_name !== undefined) updatePayload.store_name = formData.store_name || null;
  if (formData.outlet_type !== undefined) updatePayload.outlet_type = formData.outlet_type || null;
  if (formData.total_qty !== undefined) updatePayload.total_qty = formData.total_qty ?? null;
  if (formData.amount !== undefined) updatePayload.amount = formData.amount ?? null;
  if (formData.tax_return !== undefined) updatePayload.tax_return = formData.tax_return || null;
  if (formData.excl_tax !== undefined) updatePayload.excl_tax = formData.excl_tax ?? null;
  if (formData.sales_tax !== undefined) updatePayload.sales_tax = formData.sales_tax ?? null;
  if (formData.adv_tax !== undefined) updatePayload.adv_tax = formData.adv_tax ?? null;
  if (formData.disc_tot !== undefined) updatePayload.disc_tot = formData.disc_tot ?? null;
  if (formData.products !== undefined) updatePayload.products = formData.products || "";

  // --- FIX: include tenant_id filter so RLS-protected row is found correctly ---
  let query = supabase
    .from("invoices")
    .update(updatePayload)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select()
    .single();

  const { data, error } = await query;

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Invoice not found or access denied.");

  // --- Warehouse deduction: re-upsert sale_entry_lines for this invoice ---
  // The warehouse_standard_levels VIEW dynamically computes stock by subtracting
  // SUM(sale_entry_lines.qty). deductWarehouseStockForInvoices upserts sale_entries
  // and deletes+reinserts sale_entry_lines, so calling it replaces old deductions correctly.
  if (formData.products !== undefined && data?.invoice_no) {
    const newProducts = formData.products || "";
    try {
      if (newProducts.trim()) {
        // Re-deduct with new products (replaces old sale_entry_lines for this invoice)
        await deductWarehouseStockForInvoices(supabase, tenantId, [
          { invoice_no: data.invoice_no, products: newProducts },
        ]);
      } else {
        // Products cleared — delete the sale_entry for this invoice so no deduction remains
        const saleNo = `INV-${data.invoice_no}`;
        await supabase
          .from("sale_entries")
          .delete()
          .eq("sale_no", saleNo)
          .eq("tenant_id", tenantId);
      }
    } catch (e: any) {
      console.error("[updateInvoice deductWarehouseStockForInvoices]", e?.message);
    }
  }

  revalidatePath("/tab1/invoices");
  revalidatePath("/tab1/transactions");
  revalidatePath("/inventory/warehouse");
  revalidatePath("/tab3/warehouse");
  return data;
}

// --------------------------------------------------------------------------
// DELETE
// --------------------------------------------------------------------------

export async function deleteInvoice(id: string) {
  const supabase = await createClient();
  const tenantId = await getTenantId();

  if (tenantId) {
    const { data: inv } = await supabase
      .from("invoices")
      .select("invoice_no, invoice_type, outlet_type")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (inv?.invoice_no) {
      const invNo = inv.invoice_no.trim();

      await supabase
        .from("shop_payments")
        .delete()
        .eq("invoice_id", id)
        .eq("tenant_id", tenantId);

      await supabase
        .from("alerts")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("alert_type", "overdue_threshold")
        .ilike("details", `%${invNo}%`);

      const saleNos = Array.from(
        new Set([
          `INV-${invNo}`,
          `INV-${invNo.toLowerCase()}`,
          `INV-${invNo.toUpperCase()}`,
        ])
      );
      await supabase
        .from("sale_entries")
        .delete()
        .in("sale_no", saleNos)
        .eq("tenant_id", tenantId);
    }

    await supabase.from("invoice_line_items").delete().eq("invoice_id", id);
    await supabase.from("invoice_returns").delete().eq("invoice_id", id);
  }

  const { error } = await supabase.from("invoices").delete().eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath("/tab1/invoices");
  revalidatePath("/tab1/transactions");
  revalidatePath("/tab2/credit");
  revalidatePath("/tab7/alerts");
  revalidatePath("/cash-bank/bank-accounts");
  revalidatePath("/shop-details");
  revalidatePath("/reports/financial");
  revalidatePath("/inventory/warehouse");
  revalidatePath("/tab3/warehouse");
}

export async function deleteInvoices(ids: string[]) {
  if (!ids.length) return;
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");
  const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : await createClient();

  // Fetch overdue alerts once for the tenant so we don't query the database per invoice in a loop
  const { data: existingAlerts } = await supabase
    .from("alerts")
    .select("id, details")
    .eq("tenant_id", tenantId)
    .eq("alert_type", "overdue_threshold");

  const BATCH_SIZE = 200;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);

    const { data: invList } = await supabase
      .from("invoices")
      .select("invoice_no")
      .in("id", chunk)
      .eq("tenant_id", tenantId);

    if (invList && invList.length > 0) {
      const invNos = invList
        .map((inv: any) => inv.invoice_no?.trim())
        .filter(Boolean);

      if (invNos.length > 0) {
        // Delete matching overdue alerts in a single batch
        if (existingAlerts && existingAlerts.length > 0) {
          const alertIdsToDelete = existingAlerts
            .filter((a: any) => a.details && invNos.some((no: string) => a.details.includes(no)))
            .map((a: any) => a.id);

          if (alertIdsToDelete.length > 0) {
            await supabase
              .from("alerts")
              .delete()
              .in("id", alertIdsToDelete)
              .eq("tenant_id", tenantId);
          }
        }

        const saleNos = Array.from(
          new Set([
            ...invNos.map((no: string) => `INV-${no}`),
            ...invNos.map((no: string) => `INV-${no.toLowerCase()}`),
            ...invNos.map((no: string) => `INV-${no.toUpperCase()}`),
          ])
        );
        await supabase
          .from("sale_entries")
          .delete()
          .in("sale_no", saleNos)
          .eq("tenant_id", tenantId);
      }
    }

    // Delete dependent tables in parallel
    await Promise.all([
      supabase.from("shop_payments").delete().in("invoice_id", chunk).eq("tenant_id", tenantId),
      supabase.from("invoice_line_items").delete().in("invoice_id", chunk),
      supabase.from("invoice_returns").delete().in("invoice_id", chunk),
    ]);

    const { error } = await supabase.from("invoices").delete().in("id", chunk).eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/tab1/invoices");
  revalidatePath("/tab1/transactions");
  revalidatePath("/tab2/credit");
  revalidatePath("/tab7/alerts");
  revalidatePath("/cash-bank/bank-accounts");
  revalidatePath("/shop-details");
  revalidatePath("/reports/financial");
  revalidatePath("/inventory/warehouse");
  revalidatePath("/tab3/warehouse");
}

// --------------------------------------------------------------------------
// RESCHEDULE
// --------------------------------------------------------------------------

export async function rescheduleInvoice(id: string, newDate: string) {
  return updateInvoice(id, { record_date: newDate });
}

// --------------------------------------------------------------------------
// BULK IMPORT & MERGE
// --------------------------------------------------------------------------

export interface BulkInvoiceRow {
  invoice_no: string;
  shop_id?: string | null;
  outlet_code?: string | null;
  outlet_name?: string | null;
  record_date?: string | null;
  delivery_date?: string | null;
  seller_code?: string | null;
  seller_name?: string | null;
  store_name?: string | null;
  outlet_type?: string | null;
  total_qty?: number | null;
  // Old DB column names (kept for backward compat)
  amount?: number | null;
  excl_tax?: number | null;
  adv_tax?: number | null;
  disc_tot?: number | null;
  // New standardized names from pending invoice import
  grand_total?: number | null;
  excl_tax_amount?: number | null;
  advance_income_tax?: number | null;
  discount_total?: number | null;
  tax_return?: string | null;
  tax_return_book_no?: string | null;
  sales_tax?: number | null;
  products?: string | null;
}

export async function bulkMergeInvoices(rows: BulkInvoiceRow[]) {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : await createClient();

  if (!rows || rows.length === 0) return { inserted: 0, updated: 0 };

  const { data: creditShopsData } = await supabase
    .from("shops")
    .select("id, outlet_code, shop_type, outlet_type")
    .eq("tenant_id", tenantId)
    .or("shop_type.eq.credit,outlet_type.ilike.credit");

  const creditShopIds = new Set((creditShopsData || []).map((s) => s.id));
  const creditOutletCodes = new Set(
    (creditShopsData || []).map((s) => s.outlet_code).filter(Boolean)
  );

  const uniqueMap = new Map<string, BulkInvoiceRow>();
  for (const r of rows) {
    if (r && r.invoice_no) {
      uniqueMap.set(String(r.invoice_no).trim(), r);
    }
  }
  const cleanRows = Array.from(uniqueMap.values());

  let inserted = 0;
  let updated = 0;
  // Rows that could not be written. Counted so the caller never reports a save as complete
  // when the database rejected part of it.
  let failed = 0;
  // invoice_no of rows with no existing record, so a persisted row can be reported as an
  // insert or an update only once the write has actually succeeded.
  const newInvoiceNos = new Set<string>();
  // Invoices whose products field went from empty to filled by THIS save. Stock is deducted
  // once, when an invoice first learns what it contained. Re-saving an invoice that already
  // had products must not touch its stock again, so those rows are deliberately absent here.
  const stockEntries: { invoice_no: string; products: string }[] = [];
  // invoice_no of rows that gained products in this save, so only they are collected below.
  const productsFirstSet = new Set<string>();
  let productsPreserved = 0;

  const BATCH = 100;
  for (let i = 0; i < cleanRows.length; i += BATCH) {
    const chunk = cleanRows.slice(i, i + BATCH);
    const invoiceNos = chunk.map((r) => String(r.invoice_no).trim()).filter(Boolean);

    const { data: existing } = await supabase
      .from("invoices")
      .select("id, invoice_no, shop_id, outlet_code, outlet_name, record_date, delivery_date, seller_code, seller_name, store_name, outlet_type, total_qty, amount, tax_return, excl_tax, sales_tax, adv_tax, advance_tax, disc_tot, products, invoice_date, scheduled_date, invoice_type, invoice_total, delivery_status")
      .eq("tenant_id", tenantId)
      .in("invoice_no", invoiceNos);

    const existingMap = new Map((existing || []).map((e: any) => [e.invoice_no, e]));

    const batchUpsertRows: any[] = [];

    for (const r of chunk) {
      const invNo = String(r.invoice_no).trim();
      if (!invNo) continue;
      const existingRec = existingMap.get(invNo);

      // `products` is write-once. It is the only field that drives a stock deduction, and
      // the deduction is rebuilt from this string rather than added to it, so letting a later
      // import overwrite it would silently restate what was sold. Once an invoice knows its
      // contents only an explicit single-invoice edit may change them, and stock is deducted
      // in the one save that fills the field — never again on a re-save.
      const existingProducts = String(existingRec?.products ?? "").trim();
      const incomingProducts = String(r.products ?? "").trim();
      const finalProducts = existingProducts || incomingProducts;
      if (existingProducts) {
        if (incomingProducts && incomingProducts !== existingProducts) productsPreserved++;
      } else if (incomingProducts) {
        productsFirstSet.add(invNo);
      }

      const isCredit =
        (r.outlet_type && r.outlet_type.toLowerCase() === "credit") ||
        (r.shop_id && creditShopIds.has(r.shop_id)) ||
        (r.outlet_code && creditOutletCodes.has(r.outlet_code));

      const rAmount = r.grand_total ?? r.amount ?? null;
      const rExcl = r.excl_tax_amount ?? r.excl_tax ?? null;
      const rAdv = r.advance_income_tax ?? r.adv_tax ?? null;
      const rDisc = r.discount_total ?? r.disc_tot ?? null;
      const rowDate = r.record_date || r.delivery_date || new Date().toISOString().split("T")[0];

      if (existingRec) {
        const mergedRec = {
          ...existingRec,
          tenant_id: tenantId,
          invoice_no: invNo,
          shop_id: r.shop_id || existingRec.shop_id || null,
          outlet_code: r.outlet_code || existingRec.outlet_code || null,
          outlet_name: (r.outlet_name && (!existingRec.outlet_name || existingRec.outlet_name.startsWith("Outlet ")))
            ? r.outlet_name
            : (existingRec.outlet_name || null),
          record_date: r.record_date || existingRec.record_date || null,
          delivery_date: r.delivery_date || existingRec.delivery_date || null,
          seller_code: r.seller_code || existingRec.seller_code || null,
          seller_name: r.seller_name || existingRec.seller_name || null,
          store_name: r.store_name || existingRec.store_name || null,
          outlet_type: r.outlet_type || existingRec.outlet_type || null,
          total_qty: r.total_qty ?? existingRec.total_qty ?? null,
          amount: rAmount != null ? rAmount : existingRec.amount,
          invoice_total: rAmount != null ? rAmount : (existingRec.invoice_total ?? existingRec.amount ?? 0),
          tax_return: r.tax_return || r.tax_return_book_no || existingRec.tax_return || null,
          excl_tax: rExcl != null ? rExcl : existingRec.excl_tax,
          sales_tax: r.sales_tax != null ? r.sales_tax : existingRec.sales_tax,
          adv_tax: rAdv != null ? rAdv : existingRec.adv_tax,
          advance_tax: rAdv != null ? rAdv : (existingRec.advance_tax ?? existingRec.adv_tax ?? 0),
          disc_tot: rDisc != null ? rDisc : existingRec.disc_tot,
          products: finalProducts,
          invoice_date: existingRec.invoice_date || r.record_date || r.delivery_date || rowDate,
          scheduled_date: existingRec.scheduled_date || r.delivery_date || rowDate,
          invoice_type: isCredit ? "credit" : (existingRec.invoice_type || "cash"),
          delivery_status: existingRec.delivery_status || "delivered",
        };
        batchUpsertRows.push(mergedRec);
      } else {
        newInvoiceNos.add(invNo);
        const newRec = {
          tenant_id: tenantId,
          invoice_no: invNo,
          shop_id: r.shop_id || null,
          outlet_code: r.outlet_code || null,
          outlet_name: r.outlet_name || null,
          record_date: r.record_date || null,
          delivery_date: r.delivery_date || null,
          seller_code: r.seller_code || null,
          seller_name: r.seller_name || null,
          store_name: r.store_name || null,
          outlet_type: r.outlet_type || null,
          total_qty: r.total_qty ?? null,
          amount: rAmount,
          tax_return: r.tax_return || r.tax_return_book_no || null,
          excl_tax: rExcl,
          sales_tax: r.sales_tax ?? null,
          adv_tax: rAdv,
          advance_tax: rAdv ?? 0,
          disc_tot: rDisc,
          products: incomingProducts,
          invoice_date: rowDate,
          scheduled_date: r.delivery_date || rowDate,
          invoice_type: isCredit ? "credit" : "cash",
          invoice_total: rAmount ?? 0,
          discount_amount: 0,
          promo_type: "none",
          delivery_status: "delivered",
        };
        batchUpsertRows.push(newRec);
      }
    }

    if (batchUpsertRows.length > 0) {
      // Only invoices that learned their contents in this save. An invoice that already had
      // products keeps the stock deduction it was given the first time, so re-saving the
      // same batch is a no-op for the warehouse instead of deleting and rebuilding every
      // sale line again.
      const collectForStock = (item: any) => {
        if (!productsFirstSet.has(item?.invoice_no)) return;
        if (item?.products && String(item.products).trim()) {
          stockEntries.push({ invoice_no: item.invoice_no, products: item.products });
        }
      };

      // Counted here rather than while building the rows, so the reported totals describe
      // what the database accepted instead of what was attempted.
      const countPersisted = (item: any) => {
        if (newInvoiceNos.has(item?.invoice_no)) inserted++;
        else updated++;
      };

      const { error: upsertErr } = await supabase
        .from("invoices")
        .upsert(batchUpsertRows, { onConflict: "tenant_id,invoice_no" });

      if (upsertErr) {
        console.error("[bulkMergeInvoices upsert error, attempting fallback]:", upsertErr.message);
        for (const item of batchUpsertRows) {
          const { error: singleErr } = await supabase
            .from("invoices")
            .upsert([item], { onConflict: "tenant_id,invoice_no" });
          if (singleErr) {
            failed++;
            console.error("[bulkMergeInvoices single upsert error]:", singleErr.message);
          } else {
            countPersisted(item);
            collectForStock(item);
          }
        }
      } else {
        batchUpsertRows.forEach((item) => {
          countPersisted(item);
          collectForStock(item);
        });
      }
    }
  }

  try {
    // Non-blocking overdue alerts check in background
    ensureOverdueAlerts().catch((e: any) =>
      console.error("[bulkMergeInvoices ensureOverdueAlerts]", e?.message)
    );
  } catch (e: any) {
    console.error("[bulkMergeInvoices ensureOverdueAlerts]", e?.message);
  }

  // Warehouse stock deduction, for first-time product assignments only.
  // Must run AFTER the invoices exist in the DB (it verifies them) and must be awaited.
  let stockDeducted = 0;
  let stockError: string | null = null;
  let unmatchedCodes: string[] = [];
  if (stockEntries.length > 0) {
    try {
      const res = await deductWarehouseStockForInvoices(supabase, tenantId, stockEntries);
      stockDeducted = res.invoicesDeducted;
      unmatchedCodes = res.unmatchedCodes;
    } catch (err: any) {
      stockError = err?.message ?? String(err);
      console.error("[bulkMergeInvoices] warehouse deduction error:", stockError);
    }
  }

  if (productsPreserved > 0) {
    console.warn(
      `[bulkMergeInvoices] ${productsPreserved} invoice(s) already had a products list, so ` +
      `the incoming one was ignored and their stock was left alone. Edit a single invoice if ` +
      `its contents genuinely need correcting.`
    );
  }

  revalidatePath("/tab1/transactions");
  revalidatePath("/tab1/invoices");
  revalidatePath("/inventory/warehouse");
  revalidatePath("/tab3/warehouse");
  if (failed > 0) {
    console.error(`[bulkMergeInvoices] ${failed} invoice row(s) could not be written.`);
  }

  return {
    inserted,
    updated,
    failed,
    orphans: inserted,
    stockDeducted,
    stockError,
    productsPreserved,
    unmatchedCodes,
  };
}

export async function bulkImportInvoicesReport(rows: any[]) {
  return bulkMergeInvoices(rows);
}

/**
 * Import Sales Tax Summary — updates existing invoices or inserts missing ones.
 * Fast batch upsert with standardized field name aliases.
 */
export async function bulkImportSalesTax(rows: any[]) {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createAdminClient()
    : await createClient();

  if (!rows || rows.length === 0) return { updated: 0, skipped: 0, inserted: 0 };

  // Deduplicate by invoice_no
  const uniqueMap = new Map<string, any>();
  for (const r of rows) {
    if (r && r.invoice_no) uniqueMap.set(String(r.invoice_no).trim(), r);
  }
  const cleanRows = Array.from(uniqueMap.values());

  let updated = 0;
  let inserted = 0;
  let skipped = 0;

  const BATCH = 100;
  for (let i = 0; i < cleanRows.length; i += BATCH) {
    const chunk = cleanRows.slice(i, i + BATCH);
    const invoiceNos = chunk.map((r) => String(r.invoice_no).trim()).filter(Boolean);

    // Look up invoices that already exist in the DB (case-insensitive check)
    const candidates = Array.from(
      new Set([
        ...invoiceNos,
        ...invoiceNos.map((s) => s.toUpperCase()),
        ...invoiceNos.map((s) => s.toLowerCase()),
      ])
    );

    const { data: existing } = await supabase
      .from("invoices")
      .select("id, invoice_no, shop_id, outlet_code, outlet_name, record_date, delivery_date, seller_code, seller_name, store_name, outlet_type, total_qty, amount, tax_return, excl_tax, sales_tax, adv_tax, advance_tax, disc_tot, products, invoice_date, scheduled_date, invoice_type, invoice_total, delivery_status")
      .eq("tenant_id", tenantId)
      .in("invoice_no", candidates);

    const existingMap = new Map<string, any>();
    (existing || []).forEach((e: any) => {
      const trimmed = String(e.invoice_no).trim();
      existingMap.set(trimmed, e);
      existingMap.set(trimmed.toLowerCase(), e);
      existingMap.set(trimmed.toUpperCase(), e);
    });

    const batchUpsertRows: any[] = [];

    for (const r of chunk) {
      const invNo = String(r.invoice_no).trim();
      const existingRec = existingMap.get(invNo) || existingMap.get(invNo.toLowerCase()) || existingMap.get(invNo.toUpperCase());

      const rAmount = r.grand_total ?? r.amount ?? null;
      const rExcl = r.excl_tax_amount ?? r.excl_tax ?? null;
      const rAdv = r.advance_income_tax ?? r.adv_tax ?? null;
      const rDisc = r.discount_total ?? r.disc_tot ?? null;
      const rowDate = r.record_date || r.delivery_date || new Date().toISOString().split("T")[0];

      if (existingRec) {
        const mergedRec = {
          ...existingRec,
          tenant_id: tenantId,
          invoice_no: invNo,
          shop_id: r.shop_id || existingRec.shop_id || null,
          outlet_code: r.outlet_code || existingRec.outlet_code || null,
          outlet_name: (r.outlet_name && (!existingRec.outlet_name || existingRec.outlet_name.startsWith("Outlet ")))
            ? r.outlet_name
            : (existingRec.outlet_name || null),
          record_date: r.record_date || existingRec.record_date || null,
          delivery_date: r.delivery_date || existingRec.delivery_date || null,
          seller_code: r.seller_code || existingRec.seller_code || null,
          seller_name: r.seller_name || existingRec.seller_name || null,
          store_name: r.store_name || existingRec.store_name || null,
          outlet_type: r.outlet_type || existingRec.outlet_type || null,
          total_qty: r.total_qty ?? existingRec.total_qty ?? null,
          amount: rAmount != null ? rAmount : existingRec.amount,
          invoice_total: rAmount != null ? rAmount : (existingRec.invoice_total ?? existingRec.amount ?? 0),
          tax_return: r.tax_return || r.tax_return_book_no || existingRec.tax_return || null,
          excl_tax: rExcl != null ? rExcl : existingRec.excl_tax,
          sales_tax: r.sales_tax != null ? r.sales_tax : existingRec.sales_tax,
          adv_tax: rAdv != null ? rAdv : existingRec.adv_tax,
          advance_tax: rAdv != null ? rAdv : (existingRec.advance_tax ?? existingRec.adv_tax ?? 0),
          disc_tot: rDisc != null ? rDisc : existingRec.disc_tot,
          products: existingRec.products || "",
          invoice_date: existingRec.invoice_date || r.record_date || r.delivery_date || rowDate,
          scheduled_date: existingRec.scheduled_date || r.delivery_date || rowDate,
          invoice_type: existingRec.invoice_type || "cash",
          delivery_status: existingRec.delivery_status || "delivered",
        };
        batchUpsertRows.push(mergedRec);
        updated++;
      } else {
        const newRec = {
          tenant_id: tenantId,
          invoice_no: invNo,
          shop_id: r.shop_id || null,
          outlet_code: r.outlet_code || null,
          outlet_name: r.outlet_name || null,
          record_date: r.record_date || null,
          delivery_date: r.delivery_date || null,
          seller_code: r.seller_code || null,
          seller_name: r.seller_name || null,
          store_name: r.store_name || null,
          outlet_type: r.outlet_type || null,
          total_qty: r.total_qty ?? null,
          amount: rAmount,
          tax_return: r.tax_return || r.tax_return_book_no || null,
          excl_tax: rExcl,
          sales_tax: r.sales_tax ?? null,
          adv_tax: rAdv,
          advance_tax: rAdv ?? 0,
          disc_tot: rDisc,
          products: "",
          invoice_date: rowDate,
          scheduled_date: r.delivery_date || rowDate,
          invoice_type: "cash",
          invoice_total: rAmount ?? 0,
          discount_amount: 0,
          promo_type: "none",
          delivery_status: "delivered",
        };
        batchUpsertRows.push(newRec);
        inserted++;
      }
    }

    if (batchUpsertRows.length > 0) {
      const { error: upsertErr } = await supabase
        .from("invoices")
        .upsert(batchUpsertRows, { onConflict: "tenant_id,invoice_no" });

      if (upsertErr) {
        console.error("[bulkImportSalesTax] batch upsert error, falling back:", upsertErr.message);
        for (const item of batchUpsertRows) {
          const { error: sErr } = await supabase
            .from("invoices")
            .upsert([item], { onConflict: "tenant_id,invoice_no" });
          if (sErr) {
            console.error("[bulkImportSalesTax] single upsert error:", sErr.message);
            skipped++;
          }
        }
      }
    }
  }

  revalidatePath("/tab1/transactions");
  revalidatePath("/tab1/invoices");
  return { updated, skipped, inserted };
}



export async function bulkImportSaleDetail(
  entries: { invoice_no: string; products: string }[]
) {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createAdminClient()
    : await createClient();

  let updated = 0;
  let notFound = 0;
  let skippedExisting = 0;
  const matchedEntries: { invoice_no: string; products: string }[] = [];

  const BATCH = 50;
  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH);
    const invoiceNos = chunk.map((e) => e.invoice_no.replace(/^DATE\s*/i, "").trim());
    const rawNos = chunk.map((e) => e.invoice_no.trim());
    const variations = Array.from(
      new Set([
        ...invoiceNos,
        ...invoiceNos.map((s) => s.toLowerCase()),
        ...invoiceNos.map((s) => s.toUpperCase()),
        ...rawNos,
        ...rawNos.map((s) => s.toLowerCase()),
        ...rawNos.map((s) => s.toUpperCase()),
      ])
    );

    const { data: existing } = await supabase
      .from("invoices")
      .select("id, invoice_no, products")
      .eq("tenant_id", tenantId)
      .in("invoice_no", variations);

    const existingMap = new Map<string, { id: string; invoice_no: string; products: string | null }>();
    for (const e of existing || []) {
      if (e.invoice_no) {
        const item = { id: e.id, invoice_no: e.invoice_no.trim(), products: e.products };
        const trimmed = e.invoice_no.trim();
        existingMap.set(trimmed, item);
        existingMap.set(trimmed.toLowerCase(), item);
        existingMap.set(trimmed.toUpperCase(), item);
      }
    }

    const updatePromises = chunk.map(async (entry) => {
      const cleanNo = entry.invoice_no.replace(/^DATE\s*/i, "").trim();
      const match =
        existingMap.get(cleanNo) ||
        existingMap.get(cleanNo.toLowerCase()) ||
        existingMap.get(cleanNo.toUpperCase()) ||
        existingMap.get(entry.invoice_no.trim()) ||
        existingMap.get(entry.invoice_no.trim().toLowerCase()) ||
        existingMap.get(entry.invoice_no.trim().toUpperCase());

      if (!match) {
        return { notFound: true, skippedExisting: false, error: null, entry: null };
      }

      // Skip updating if products field is already set (non-null and non-empty)
      const hasProducts = Boolean(match.products && match.products.trim().length > 0);
      if (hasProducts) {
        return { notFound: false, skippedExisting: true, error: null, entry: null };
      }

      const { error } = await supabase
        .from("invoices")
        .update({ products: entry.products })
        .eq("id", match.id)
        .eq("tenant_id", tenantId);
      return {
        notFound: false,
        skippedExisting: false,
        error,
        entry: { invoice_no: match.invoice_no, products: entry.products },
      };
    });

    const results = await Promise.all(updatePromises);
    for (const res of results) {
      if (res.notFound) {
        notFound++;
      } else if (res.skippedExisting) {
        skippedExisting++;
      } else if (!res.error) {
        updated++;
        if (res.entry) {
          matchedEntries.push(res.entry);
        }
      }
    }
  }

  revalidatePath("/tab1/transactions");
  revalidatePath("/tab1/invoices");

  // Deduct warehouse stock ONLY for invoices whose products field this import just filled.
  // Invoices counted in `skippedExisting` keep the deduction they already have.
  let stockError: string | null = null;
  let unmatchedCodes: string[] = [];
  try {
    if (matchedEntries.length > 0) {
      const res = await deductWarehouseStockForInvoices(supabase, tenantId, matchedEntries);
      unmatchedCodes = res.unmatchedCodes;
    }
  } catch (err: any) {
    stockError = err?.message ?? String(err);
    console.error("[bulkImportSaleDetail] warehouse deduction error:", stockError);
    // Non-fatal — the products fields were saved, and the sync action can rebuild the lines.
  }

  return { updated, notFound, skippedExisting, stockError, unmatchedCodes };
}


// --------------------------------------------------------------------------
// PRIVATE — Warehouse stock deduction triggered by sale detail import
// --------------------------------------------------------------------------

/**
 * Slim Products-menu snapshot for the unsaved-invoice check.
 * Only code and name — the same two keys the warehouse deduction uses — so a full
 * catalogue round-trip stays small enough to run in parallel with a Sale Detail parse.
 */
export async function getProductCatalogForInvoiceMatch(): Promise<
  { product_code: string; product_name: string }[]
> {
  const tenantId = await getTenantId();
  if (!tenantId) return [];

  const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createAdminClient()
    : await createClient();

  const PAGE = 1000;
  const out: { product_code: string; product_name: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("products")
      .select("product_code, product_name")
      .eq("tenant_id", tenantId)
      .order("product_code", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      console.error("[getProductCatalogForInvoiceMatch]", error.message);
      break;
    }
    const page = data || [];
    for (const p of page) {
      out.push({
        product_code: String(p.product_code ?? ""),
        product_name: String(p.product_name ?? ""),
      });
    }
    if (page.length < PAGE) break;
  }
  return out;
}

/**
 * Deducts Ph.Case quantities from warehouse stock for each non-returnable product
 * found in the imported invoice product strings.
 * - Skips products whose category or product has is_returnable = true (per user rule)
 * - In MDOS, warehouse_standard_levels view dynamically subtracts SUM(sale_entry_lines.qty)
 *   from Ph.Case and recomputes Unit Case = ph_case × set_un_case.
 * - Records/updates deduplicated sale_entries (with sale_no = 'INV-' + invoice_no)
 *   and corresponding sale_entry_lines.
 */
export interface DeductWarehouseStockResult {
  /** Invoices whose sale lines were written. */
  invoicesDeducted: number;
  /** Invoices named in `entries` that do not exist in the invoices table. */
  missingInvoices: string[];
  /**
   * Product codes that appeared on an invoice but match no row in `products`. Nothing is
   * deducted for these, so the stock they consumed stays on the books and Closing Stock
   * reads high until the product is created or the code corrected.
   */
  unmatchedCodes: string[];
}

export async function deductWarehouseStockForInvoices(
  supabase: any,
  tenantId: string,
  entries: { invoice_no: string; products: string }[]
): Promise<DeductWarehouseStockResult> {
  const result: DeductWarehouseStockResult = {
    invoicesDeducted: 0,
    missingInvoices: [],
    unmatchedCodes: [],
  };
  if (!entries || entries.length === 0) return result;

  // Step 1: Collect product codes & parse products for each invoice
  const allCodes = new Set<string>();
  const parsedByInvoice = new Map<string, { code: string; name: string; qty: number }[]>();

  for (const entry of entries) {
    if (!entry.products || !entry.invoice_no) continue;
    const items = parseProductsWithCode(entry.products);
    if (items.length > 0) {
      const invNo = String(entry.invoice_no).trim();
      parsedByInvoice.set(invNo, items);
      for (const item of items) {
        if (item.code) allCodes.add(item.code);
      }
    }
  }

  if (allCodes.size === 0) return result;

  // Step 2: Verify that invoices actually exist in the database for this tenant
  const rawInvoiceNos = Array.from(parsedByInvoice.keys());
  const cleanInvoiceNos = rawInvoiceNos.map((s) => s.replace(/^DATE\s*/i, "").trim());
  const allInvSearch = Array.from(
    new Set([
      ...rawInvoiceNos,
      ...rawInvoiceNos.map((s) => s.toLowerCase()),
      ...rawInvoiceNos.map((s) => s.toUpperCase()),
      ...cleanInvoiceNos,
      ...cleanInvoiceNos.map((s) => s.toLowerCase()),
      ...cleanInvoiceNos.map((s) => s.toUpperCase()),
    ])
  );

  const invChunks: Promise<any>[] = [];
  for (let i = 0; i < allInvSearch.length; i += 100) {
    invChunks.push(
      supabase
        .from("invoices")
        .select("invoice_no, record_date, delivery_date, invoice_date")
        .eq("tenant_id", tenantId)
        .in("invoice_no", allInvSearch.slice(i, i + 100))
    );
  }
  const invResponses = await Promise.all(invChunks);
  const dbInvs = invResponses.flatMap((r) => r.data || []);

  const dbInvMap = new Map<string, any>();
  for (const inv of dbInvs || []) {
    if (inv.invoice_no) {
      const trimmed = inv.invoice_no.trim();
      dbInvMap.set(trimmed, inv);
      dbInvMap.set(trimmed.toLowerCase(), inv);
      dbInvMap.set(trimmed.toUpperCase(), inv);
    }
  }

  // Step 3: Query products and category metadata (is_returnable, set_un_case)
  const codesArr = Array.from(allCodes);
  const prodChunks: Promise<any>[] = [];
  for (let i = 0; i < codesArr.length; i += 100) {
    prodChunks.push(
      supabase
        .from("products")
        .select("id, product_code, product_name, sale_rate, is_returnable, product_categories(id, title, set_un_case, is_returnable, is_rgb, is_implied)")
        .eq("tenant_id", tenantId)
        .in("product_code", codesArr.slice(i, i + 100))
    );
  }
  const prodResponses = await Promise.all(prodChunks);
  const prods = prodResponses.flatMap((r) => r.data || []);

  const prodMap = new Map<string, any>();
  prods.forEach((p: any) => {
    if (p.product_code) prodMap.set(p.product_code.trim(), p);
    if (p.product_name) prodMap.set(p.product_name.toLowerCase().trim(), p);
  });

  // Step 4: For each invoice, build non-returnable deduction lines
  // User rule: "do not deduct for Is Returnable? True products"
  const invoiceLinesMap = new Map<string, { product_id: string; sale_rate: number; qty: number }[]>();
  const invoiceDateMap = new Map<string, string>();
  const allSaleNos: string[] = [];
  const unmatched = new Set<string>();
  const today = new Date().toISOString().slice(0, 10);

  for (const [invNo, items] of parsedByInvoice.entries()) {
    const cleanNo = invNo.replace(/^DATE\s*/i, "").trim();
    const dbInv =
      dbInvMap.get(cleanNo) ||
      dbInvMap.get(cleanNo.toLowerCase()) ||
      dbInvMap.get(cleanNo.toUpperCase()) ||
      dbInvMap.get(invNo) ||
      dbInvMap.get(invNo.toLowerCase()) ||
      dbInvMap.get(invNo.toUpperCase());

    // Do NOT deduct for invoices that do not exist in the invoices baseline table
    if (!dbInv) {
      result.missingInvoices.push(invNo);
      continue;
    }

    const invDate = (dbInv.delivery_date || dbInv.record_date || dbInv.invoice_date || today).split("T")[0];

    const lines: { product_id: string; sale_rate: number; qty: number }[] = [];
    for (const item of items) {
      const prod = prodMap.get(item.code) || prodMap.get(item.name.toLowerCase().trim());
      if (!prod) {
        // Nothing is deducted, so this stock silently stays on the books. Reported rather
        // than only logged, because a missing product inflates Closing Stock indefinitely.
        unmatched.add(`${item.code} ${item.name}`.trim());
        continue;
      }

      const catMeta = prod.product_categories as any;
      const isImplied = Boolean(catMeta?.is_implied) || (prod.product_name || "").toUpperCase().includes("IMPLIED") || (prod.product_code || "").startsWith("80000");
      const isRgb = Boolean(catMeta?.is_rgb);
      const isReturnable = Boolean(prod.is_returnable || catMeta?.is_returnable);

      if (isImplied) {
        const impliedQty = Math.abs(item.qty);
        if (impliedQty > 0) {
          lines.push({
            product_id: prod.id,
            sale_rate: Number(prod.sale_rate || 0),
            qty: -impliedQty,
          });
        }
      } else if (isReturnable && !isRgb) {
        continue;
      } else {
        lines.push({
          product_id: prod.id,
          sale_rate: Number(prod.sale_rate || 0),
          qty: item.qty,
        });
      }
    }

    const canonicalInvNo = dbInv.invoice_no ? dbInv.invoice_no.trim() : cleanNo;
    const saleNo = `INV-${canonicalInvNo}`;
    invoiceDateMap.set(saleNo, invDate);
    if (lines.length > 0) {
      allSaleNos.push(saleNo);
      invoiceLinesMap.set(saleNo, lines);
    } else {
      allSaleNos.push(saleNo);
      invoiceLinesMap.set(saleNo, []);
    }
  }

  result.unmatchedCodes = Array.from(unmatched);
  if (allSaleNos.length === 0) return result;

  // Step 5: Batch process sale_entries and sale_entry_lines via bulk upsert
  const saleEntriesToUpsert: {
    tenant_id: string;
    sale_no: string;
    sale_date: string;
    total_amount: number;
  }[] = [];

  const saleNosToDelete: string[] = [];

  for (const saleNo of allSaleNos) {
    const lines = invoiceLinesMap.get(saleNo) || [];
    if (lines.length === 0) {
      saleNosToDelete.push(saleNo);
    } else {
      const totalAmount = lines.reduce((sum, l) => sum + l.sale_rate * l.qty, 0);
      const saleDate = invoiceDateMap.get(saleNo) || today;
      saleEntriesToUpsert.push({
        tenant_id: tenantId,
        sale_no: saleNo,
        sale_date: saleDate,
        total_amount: totalAmount,
      });
    }
  }

  if (saleNosToDelete.length > 0) {
    const delPromises = [];
    for (let i = 0; i < saleNosToDelete.length; i += 100) {
      delPromises.push(
        supabase.from("sale_entries").delete().in("sale_no", saleNosToDelete.slice(i, i + 100)).eq("tenant_id", tenantId)
      );
    }
    await Promise.all(delPromises);
  }

  if (saleEntriesToUpsert.length > 0) {
    const upsertPromises = [];
    for (let i = 0; i < saleEntriesToUpsert.length; i += 100) {
      upsertPromises.push(
        supabase
          .from("sale_entries")
          .upsert(saleEntriesToUpsert.slice(i, i + 100), { onConflict: "tenant_id,sale_no" })
          .select("id, sale_no")
      );
    }
    const upsertResults = await Promise.all(upsertPromises);
    const upsertedMap = new Map<string, string>();
    for (const res of upsertResults) {
      if (res.error) throw new Error(`sale_entries upsert failed: ${res.error.message}`);
      (res.data || []).forEach((u: any) => upsertedMap.set(u.sale_no, u.id));
    }

    const allEntryIds = Array.from(upsertedMap.values());
    const delLinePromises = [];
    for (let i = 0; i < allEntryIds.length; i += 100) {
      delLinePromises.push(
        supabase
          .from("sale_entry_lines")
          .delete()
          .in("sale_entry_id", allEntryIds.slice(i, i + 100))
          .eq("tenant_id", tenantId)
      );
    }
    const delLineResults = await Promise.all(delLinePromises);
    for (const r of delLineResults) {
      if (r.error) throw new Error(`sale_entry_lines delete failed: ${r.error.message}`);
    }

    const allLinesToInsert: any[] = [];
    for (const [saleNo, lines] of invoiceLinesMap.entries()) {
      const entryId = upsertedMap.get(saleNo);
      if (!entryId || lines.length === 0) continue;
      for (const line of lines) {
        allLinesToInsert.push({
          tenant_id: tenantId,
          sale_entry_id: entryId,
          product_id: line.product_id,
          sale_rate: line.sale_rate,
          qty: line.qty,
        });
      }
    }

    const insertLinePromises = [];
    for (let i = 0; i < allLinesToInsert.length; i += 200) {
      insertLinePromises.push(
        supabase.from("sale_entry_lines").insert(allLinesToInsert.slice(i, i + 200))
      );
    }
    const insertResults = await Promise.all(insertLinePromises);
    for (const r of insertResults) {
      if (r.error) throw new Error(`sale_entry_lines insert failed: ${r.error.message}`);
    }

    result.invoicesDeducted = upsertedMap.size;
  }

  if (unmatched.size > 0) {
    console.warn(
      `[deductWarehouseStockForInvoices] ${unmatched.size} product code(s) on invoices match ` +
      `no product, so their stock was not deducted and Closing Stock will read high: ` +
      Array.from(unmatched).slice(0, 15).join(" | ")
    );
  }

  // Step 5: Revalidate warehouse catalogue and transactions
  revalidatePath("/inventory/warehouse");
  revalidatePath("/tab3/warehouse");
  revalidatePath("/tab1/transactions");
  revalidatePath("/tab1/invoices");

  return result;
}

/**
 * Rebuilds every invoice's stock deduction from its products field.
 *
 * This is the deliberate repair path. Routine imports deduct an invoice once, when its
 * products field is first filled, so they cannot heal an invoice whose deduction is missing
 * or stale — that is what this is for. It is safe to re-run: each invoice's sale lines are
 * replaced by what its products string says, never added to.
 */
export async function syncAllInvoiceWarehouseDeductions() {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");
  const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : await createClient();

  // PostgREST caps a response at 1000 rows, which silently left every invoice beyond the
  // first thousand un-deducted. Page until the source is exhausted.
  const PAGE_SIZE = 1000;
  const invs: { invoice_no: string; products: string }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("invoices")
      .select("invoice_no, products")
      .eq("tenant_id", tenantId)
      .neq("products", "")
      .not("products", "is", null)
      .order("invoice_no", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("[syncAllInvoiceWarehouseDeductions] fetch failed:", error.message);
      return { count: 0, error: error.message };
    }
    const page = data || [];
    invs.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  if (invs.length === 0) return { count: 0 };

  const res = await deductWarehouseStockForInvoices(supabase, tenantId, invs);
  return {
    count: invs.length,
    deducted: res.invoicesDeducted,
    missingInvoices: res.missingInvoices.length,
    unmatchedCodes: res.unmatchedCodes,
  };
}


// --------------------------------------------------------------------------
// HELPER —  Get shops + employees for dropdowns
// --------------------------------------------------------------------------

export async function getShopsForDropdown() {
  try {
    const supabase = await createClient();
    const PAGE_SIZE = 1000;
    let allShops: any[] = [];
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from("shops")
        .select("id, shop_name, outlet_code, shop_type")
        .order("shop_name")
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        console.error("[getShopsForDropdown] error:", error.message);
        break;
      }

      if (data && data.length > 0) {
        allShops.push(...data);
        if (data.length < PAGE_SIZE) hasMore = false;
        else from += PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }

    return allShops;
  } catch (err: any) {
    console.error("[getShopsForDropdown] unexpected error:", err?.message ?? err);
    return [];
  }
}

export async function getEmployeesForDropdown() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("employees")
      .select("id, full_name, role")
      .order("full_name");
    if (error) {
      console.error("[getEmployeesForDropdown] error:", error.message);
      return [];
    }
    return data || [];
  } catch (err: any) {
    console.error("[getEmployeesForDropdown] unexpected error:", err?.message ?? err);
    return [];
  }
}

export async function saveInvoiceReturns(
  invoiceId: string,
  returns: { product_name: string; returned_qty: number; note?: string }[]
) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized: Tenant session not found.");

  const rows = returns
    .filter((r) => r.returned_qty > 0)
    .map((r) => ({
      tenant_id: tenantId,
      invoice_id: invoiceId,
      product_name: r.product_name,
      returned_qty: r.returned_qty,
      return_date: new Date().toISOString().split("T")[0],
      note: r.note || null,
    }));

  if (rows.length === 0) return [];

  const { data, error } = await supabase
    .from("invoice_returns")
    .upsert(rows, { onConflict: "tenant_id,invoice_id,product_name" })
    .select();

  if (error) throw new Error(error.message);

  revalidatePath("/tab1/invoices");
  revalidatePath("/inventory/warehouse");
  return data;
}

export async function getInvoiceReturns(invoiceId: string) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("invoice_returns")
      .select("*")
      .eq("invoice_id", invoiceId);
    if (error) { console.error("[getInvoiceReturns]", error.message); return []; }
    return data || [];
  } catch (err: any) {
    console.error("[getInvoiceReturns] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getWarehouseProductNamesWithCategory(): Promise<{
  id: string;
  product_name: string;
  qty_total: number;
  available: number;
  sale_rate: number;
  is_returnable: boolean;
}[]> {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();

    const [stdReq, rgbData, empData, catReq] = await Promise.all([
      supabase.from("warehouse_standard_levels").select("product_id, product_name, total_qty, flappy").eq("tenant_id", tenantId ?? ""),
      getWarehouseRGBLevels(),
      getWarehouseEmptiesLevels(),
      supabase.from("products").select("id, product_name, sale_rate, is_returnable").eq("tenant_id", tenantId ?? ""),
    ]);

    const returnableSet = new Set<string>();
    const saleRateMap = new Map<string, number>();
    const productIdMap = new Map<string, string>();

    if (catReq.data) {
      catReq.data.forEach((p: any) => {
        if (p.is_returnable) returnableSet.add(p.product_name);
        saleRateMap.set(p.product_name, Number(p.sale_rate) || 0);
        productIdMap.set(p.product_name, p.id);
      });
    }

    const seen = new Set<string>();
    const items: { id: string; product_name: string; qty_total: number; available: number; sale_rate: number; is_returnable: boolean }[] = [];

    if (stdReq.data) {
      stdReq.data.forEach((s: any) => {
        if (seen.has(s.product_name)) return;
        seen.add(s.product_name);
        const netTotal = Math.max(0, Number(s.total_qty || 0));
        items.push({
          id: productIdMap.get(s.product_name) || s.product_id || s.product_name,
          product_name: s.product_name,
          qty_total: netTotal,
          available: netTotal,
          sale_rate: saleRateMap.get(s.product_name) || 0,
          is_returnable: returnableSet.has(s.product_name),
        });
      });
    }

    if (rgbData) {
      rgbData.forEach((s: any) => {
        if (seen.has(s.product_name)) return;
        seen.add(s.product_name);
        items.push({
          id: productIdMap.get(s.product_name) || s.product_id || s.product_name,
          product_name: s.product_name,
          qty_total: s.total_qty || 0,
          available: s.available || 0,
          sale_rate: saleRateMap.get(s.product_name) || 0,
          is_returnable: true,
        });
      });
    }

    if (empData) {
      empData.forEach((s: any) => {
        if (seen.has(s.product_name)) return;
        seen.add(s.product_name);
        items.push({
          id: productIdMap.get(s.product_name) || s.product_id || s.product_name,
          product_name: s.product_name,
          qty_total: s.total_qty || 0,
          available: s.available || 0,
          sale_rate: saleRateMap.get(s.product_name) || 0,
          is_returnable: true,
        });
      });
    }

    if (catReq.data) {
      catReq.data.forEach((p: any) => {
        if (seen.has(p.product_name)) return;
        seen.add(p.product_name);
        items.push({
          id: p.id,
          product_name: p.product_name,
          qty_total: 0,
          available: 0,
          sale_rate: Number(p.sale_rate) || 0,
          is_returnable: Boolean(p.is_returnable),
        });
      });
    }

    items.sort((a, b) => a.product_name.localeCompare(b.product_name));
    return items;
  } catch (err: any) {
    console.error("[getWarehouseProductNamesWithCategory] error:", err?.message ?? err);
    return [];
  }
}

export async function saveAdditionalDiscount(invoiceId: string, amount: number) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("invoices")
    .update({ additional_discount: amount })
    .eq("id", invoiceId);
  if (error) throw new Error(error.message);
  revalidatePath("/tab1/invoices");
  revalidatePath("/reports/financial");
}


