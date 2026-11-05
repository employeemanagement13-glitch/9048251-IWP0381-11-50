"use server";

import { createClient, createAdminClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface PromoInvoiceRecord {
  id?: string;
  tenant_id?: string;
  outlet_code: string;
  shop_name: string;
  invoice_no: string;
  invoice_date: string;
  col_01_trade_discount: number;
  col_58_cross_promotion: number;
  col_59_additional_trade: number;
  col_63_distributor: number;
  col_68_trade_promotions: number;
  col_utc_discount?: number;
  row_total: number;
  imported_at?: string;
}

function getDb() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : createClient();
}

export async function bulkImportPromoInvoices(rows: Omit<PromoInvoiceRecord, "id" | "tenant_id" | "imported_at">[]) {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");

  const supabase = await getDb();

  if (!rows || rows.length === 0) return { inserted: 0, updated: 0 };

  const { error: colCheckErr } = await supabase
    .from("promo_invoices")
    .select("col_utc_discount")
    .limit(0);
  const hasColUtc = !colCheckErr;

  const uniqueRowsMap = new Map<string, (typeof rows)[0]>();
  for (const r of rows) {
    if (r.invoice_no) {
      uniqueRowsMap.set(r.invoice_no.toUpperCase(), r);
    }
  }
  const deduplicatedRows = Array.from(uniqueRowsMap.values());

  const BATCH = 100;
  let inserted = 0;
  let updated = 0;

  for (let i = 0; i < deduplicatedRows.length; i += BATCH) {
    const chunk = deduplicatedRows.slice(i, i + BATCH);
    const invoiceNos = chunk.map((r) => r.invoice_no);

    const { data: existing, error: selectErr } = await supabase
      .from("promo_invoices")
      .select("id, invoice_no")
      .eq("tenant_id", tenantId)
      .in("invoice_no", invoiceNos);

    if (selectErr) {
      console.error("[bulkImportPromoInvoices] Check existing error:", selectErr);
      throw new Error(`Failed to check existing invoices: ${selectErr.message}`);
    }

    const existingMap = new Map((existing || []).map((e: any) => [e.invoice_no.toUpperCase(), e.id]));

    const inserts: any[] = [];
    const updates: { id: string; payload: any }[] = [];

    for (const r of chunk) {
      const existingId = existingMap.get(r.invoice_no.toUpperCase());
      const payload: any = {
        outlet_code: r.outlet_code,
        shop_name: r.shop_name,
        invoice_date: convertPdfDate(r.invoice_date),
        col_01_trade_discount: r.col_01_trade_discount || 0,
        col_58_cross_promotion: r.col_58_cross_promotion || 0,
        col_59_additional_trade: r.col_59_additional_trade || 0,
        col_63_distributor: r.col_63_distributor || 0,
        col_68_trade_promotions: hasColUtc
          ? (r.col_68_trade_promotions || 0)
          : (r.col_68_trade_promotions || 0) + (r.col_utc_discount || 0),
        row_total: r.row_total || 0,
      };

      if (hasColUtc) {
        payload.col_utc_discount = r.col_utc_discount || 0;
      }

      if (existingId) {
        updates.push({ id: existingId, payload });
      } else {
        inserts.push({
          tenant_id: tenantId,
          invoice_no: r.invoice_no,
          ...payload,
        });
      }
    }

    if (inserts.length > 0) {
      const { error: insErr } = await supabase.from("promo_invoices").insert(inserts);
      if (insErr) {
        console.error("[bulkImportPromoInvoices] Insert error:", insErr);
        throw new Error(`Database insert failed: ${insErr.message}`);
      }
      inserted += inserts.length;
    }

    if (updates.length > 0) {
      const results = await Promise.all(
        updates.map(({ id, payload }) =>
          supabase.from("promo_invoices").update(payload).eq("id", id).eq("tenant_id", tenantId)
        )
      );
      for (const res of results) {
        if (res.error) {
          console.error("[bulkImportPromoInvoices] Update error:", res.error);
          throw new Error(`Database update failed: ${res.error.message}`);
        }
        updated++;
      }
    }
  }

  revalidatePath("/sales-credit/promo-management");
  return { inserted, updated };
}

export async function getPromoInvoices(fromDate?: string, toDate?: string) {
  const tenantId = await getTenantId();
  if (!tenantId) return [];

  const supabase = await getDb();
  const BATCH_SIZE = 1000;

  const parsedFrom = fromDate ? parseDateFilter(fromDate) : null;
  const parsedTo = toDate ? parseDateFilter(toDate) : null;

  const COLUMNS =
    "id, outlet_code, shop_name, invoice_no, invoice_date, col_01_trade_discount, col_58_cross_promotion, col_59_additional_trade, col_63_distributor, col_68_trade_promotions, col_utc_discount, row_total";

  const buildPage = (from: number, columns: string): PromiseLike<any> => {
    let query: any = (supabase as any)
      .from("promo_invoices")
      .select(columns, from === 0 ? { count: "exact" } : undefined)
      .eq("tenant_id", tenantId)
      .order("invoice_date", { ascending: true })
      .order("outlet_code", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + BATCH_SIZE - 1);
    if (parsedFrom) query = query.gte("invoice_date", parsedFrom);
    if (parsedTo) query = query.lte("invoice_date", parsedTo);
    return query;
  };

  // col_utc_discount may not exist on older databases; fall back to select(*).
  let columns = COLUMNS;
  let first = await buildPage(0, columns);
  if (first.error && /col_utc_discount/.test(first.error.message)) {
    columns = "*";
    first = await buildPage(0, columns);
  }
  if (first.error) {
    console.error("[getPromoInvoices] error:", first.error.message);
    throw new Error(`Failed to load promo invoices: ${first.error.message}`);
  }

  const allRows: any[] = [...(first.data || [])];
  const total = first.count ?? allRows.length;

  // Remaining pages are independent — fetch them in parallel instead of one-by-one.
  if (total > BATCH_SIZE) {
    const offsets: number[] = [];
    for (let from = BATCH_SIZE; from < total; from += BATCH_SIZE) offsets.push(from);
    const pages = await Promise.all(offsets.map((from) => buildPage(from, columns)));
    for (const page of pages) {
      if (page.error) {
        console.error("[getPromoInvoices] error:", page.error.message);
        throw new Error(`Failed to load promo invoices: ${page.error.message}`);
      }
      allRows.push(...(page.data || []));
    }
  }

  return allRows;
}

function parseDateFilter(date: string): string | null {
  if (!date) return null;
  const trimmed = date.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parts = trimmed.split(/[/.-]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
    }
    const [p1, p2, y] = parts;
    const year = y.length === 2 ? `20${y}` : y;
    if (parseInt(p1, 10) > 12) {
      return `${year}-${p2.padStart(2, "0")}-${p1.padStart(2, "0")}`;
    }
    return `${year}-${p1.padStart(2, "0")}-${p2.padStart(2, "0")}`;
  }
  return trimmed;
}

function convertPdfDate(date: string): string {
  if (!date) return new Date().toISOString().split("T")[0];
  const trimmed = date.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parts = trimmed.split("/");
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
    }
    const m = parts[0].padStart(2, "0");
    const d = parts[1].padStart(2, "0");
    const y = parts[2];
    return `${y}-${m}-${d}`;
  }
  return trimmed;
}

export async function deletePromoInvoice(id: string) {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");
  const supabase = await getDb();
  const { error } = await supabase.from("promo_invoices").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  revalidatePath("/sales-credit/promo-management");
}

export async function deletePromoInvoices(ids: string[]) {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Unauthorized");
  if (!ids || ids.length === 0) return;

  const supabase = await getDb();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("promo_invoices")
      .delete()
      .in("id", chunk)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/sales-credit/promo-management");
}
