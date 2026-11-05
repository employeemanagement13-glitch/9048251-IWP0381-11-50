"use server";

import { createClient, getTenantId } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

import { PERMANENT_FROM, PERMANENT_TO, isPermanentDiscount } from "@/lib/discount-constants";


function revalidateAll() {
  revalidatePath("/prerequisites/discounts");
  revalidatePath("/reports/financial");
  revalidatePath("/income/statement");
  revalidatePath("/expenses/sheet");
}

export interface DiscountProductInput {
  product_id: string;
  sale_rate: number;
  discounted_rate: number;
}

export interface DiscountConfigInput {
  shop_id: string;
  from_date: string;
  to_date: string;
  given_by_type: "owner" | "preseller";
  preseller_id?: string | null;
  products: DiscountProductInput[];
}

export async function getDiscountConfigs() {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    const [configsRes, configProductsRes, shopsRes, productsRes, employeesRes] = await Promise.all([
      supabase.from("discount_configs").select("*, shop:shops(id, outlet_code, shop_name)").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      supabase.from("discount_config_products").select("*").eq("tenant_id", tenantId),
      supabase.from("shops").select("id, outlet_code, shop_name"),
      supabase.from("products").select("id, product_name, product_code, sale_rate"),
      supabase.from("employees").select("id, full_name, employee_code"),
    ]);

    const rawConfigs = configsRes.data || [];
    const rawConfigProducts = configProductsRes.data || [];
    const shops = shopsRes.data || [];
    const products = productsRes.data || [];
    const employees = employeesRes.data || [];

    const shopMap = new Map(shops.map((s) => [s.id, s]));
    const productMap = new Map(products.map((p) => [p.id, p]));
    const employeeMap = new Map(employees.map((e) => [e.id, e]));

    return rawConfigs.map((cfg) => ({
      ...cfg,
      shop: cfg.shop || shopMap.get(cfg.shop_id) || { id: cfg.shop_id, outlet_code: "", shop_name: "Shop" },
      preseller: cfg.preseller_id ? employeeMap.get(cfg.preseller_id) : null,
      discount_config_products: rawConfigProducts
        .filter((cp) => cp.discount_config_id === cfg.id)
        .map((cp) => ({
          ...cp,
          product: productMap.get(cp.product_id) || { id: cp.product_id, product_name: "", product_code: "" },
        })),
    }));
  } catch (err: any) {
    console.error("[getDiscountConfigs] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function createDiscountConfig(input: DiscountConfigInput) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Tenant not found");

  const { data: config, error: configErr } = await supabase
    .from("discount_configs")
    .insert({
      tenant_id: tenantId,
      shop_id: input.shop_id,
      from_date: input.from_date,
      to_date: input.to_date,
      given_by_type: input.given_by_type,
      preseller_id: input.preseller_id || null,
    })
    .select()
    .single();

  if (configErr) throw new Error(configErr.message);

  const productRows = input.products.map((p) => ({
    discount_config_id: config.id,
    tenant_id: tenantId,
    product_id: p.product_id,
    sale_rate: p.sale_rate,
    discounted_rate: p.discounted_rate,
  }));

  const { error: prodErr } = await supabase
    .from("discount_config_products")
    .insert(productRows);

  if (prodErr) throw new Error(prodErr.message);

  revalidateAll();
  return config;
}

export async function updateDiscountConfig(id: string, input: DiscountConfigInput) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Tenant not found");

  const { error: configErr } = await supabase
    .from("discount_configs")
    .update({
      shop_id: input.shop_id,
      from_date: input.from_date,
      to_date: input.to_date,
      given_by_type: input.given_by_type,
      preseller_id: input.preseller_id || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (configErr) throw new Error(configErr.message);

  const { error: delErr } = await supabase
    .from("discount_config_products")
    .delete()
    .eq("discount_config_id", id);

  if (delErr) throw new Error(delErr.message);

  const productRows = input.products.map((p) => ({
    discount_config_id: id,
    tenant_id: tenantId,
    product_id: p.product_id,
    sale_rate: p.sale_rate,
    discounted_rate: p.discounted_rate,
  }));

  const { error: prodErr } = await supabase
    .from("discount_config_products")
    .insert(productRows);

  if (prodErr) throw new Error(prodErr.message);

  revalidateAll();
}

export async function deleteDiscountConfig(id: string) {
  const supabase = await createClient();
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Tenant not found");

  const { error } = await supabase
    .from("discount_configs")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) throw new Error(error.message);
  revalidateAll();
}

/**
 * Supabase/PostgREST silently caps every query at 1000 rows. Invoices, shops and
 * products can exceed that, so any report built from a single select() quietly
 * drops data (only the first 1000 invoices got discounts applied). This pages
 * through the whole result set.
 */
async function fetchAllRows(
  build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>
): Promise<any[]> {
  const PAGE = 1000;
  const all: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

interface InvoiceQtyIndex {
  byCode: Map<string, number>;
  byName: Map<string, number>;
}

function normName(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Invoice product strings come in two shapes: "1234567 Coca-Cola 1.5L×12" (with code)
 * and "Coca-Cola 1.5L×12" (without code). Index quantities by both code and name so
 * discount configs match either.
 */
function parseInvoiceProductQtys(productsStr: string): InvoiceQtyIndex {
  const byCode = new Map<string, number>();
  const byName = new Map<string, number>();
  if (!productsStr) return { byCode, byName };
  for (const raw of productsStr.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const m =
      /^(.*?)\s*[\u00d7*]\s*(-?\d+(?:\.\d+)?)$/.exec(part) ||
      /^(.*?)\s+[xX]\s*(-?\d+(?:\.\d+)?)$/.exec(part);
    if (!m) continue;
    const qty = Number(m[2]);
    if (!qty) continue;
    const label = m[1].replace(/\+[\d.]+[-\u2013\u2014][\d.]+$/, "").trim();
    const cm = /^(\S+)\s+(.+)$/.exec(label);
    if (cm) {
      byCode.set(cm[1], (byCode.get(cm[1]) || 0) + qty);
      const n = normName(cm[2]);
      if (n) byName.set(n, (byName.get(n) || 0) + qty);
    }
    const full = normName(label);
    if (full) byName.set(full, (byName.get(full) || 0) + qty);
  }
  return { byCode, byName };
}

function qtyForProduct(idx: InvoiceQtyIndex, product: any): number {
  const code = String(product?.product_code ?? "").trim();
  const name = normName(product?.product_name);
  const q = (code && idx.byCode.get(code)) || (name && idx.byName.get(name)) || 0;
  return q > 0 ? q : 0;
}

/**
 * Keep every invoice product line in its original format. Only lines that match a
 * discount-config SKU get the "+discounted-sale" marker inserted before ×qty.
 */
function annotateInvoiceProductsWithDiscounts(
  productsStr: string,
  marks: { product: any; discounted_rate: number; sale_rate: number }[]
): string {
  if (!productsStr) return "";
  if (!marks.length) return productsStr;

  return productsStr
    .split(",")
    .map((raw) => {
      const part = raw.trim();
      if (!part) return "";
      const idx = parseInvoiceProductQtys(part);
      const mark = marks.find((dp) => {
        if (qtyForProduct(idx, dp.product) > 0) return true;
        const code = String(dp.product?.product_code ?? "").trim();
        return !!code && part.includes(code);
      });
      if (!mark) return part;
      const m =
        /^(.*?)\s*[\u00d7*]\s*(-?\d+(?:\.\d+)?)$/.exec(part) ||
        /^(.*?)\s+[xX]\s*(-?\d+(?:\.\d+)?)$/.exec(part);
      if (!m) return part;
      const label = m[1].replace(/\+[\d.]+[-\u2013\u2014][\d.]+$/, "").trim();
      return `${label}+${mark.discounted_rate}-${mark.sale_rate}\u00d7${m[2]}`;
    })
    .filter(Boolean)
    .join(", ");
}

/**
 * Discounts are always applied on the basis of the delivery date.
 * In MDOS invoices this is stored as `delivery_date`, with `scheduled_date`
 * as the canonical fallback (they represent the same concept: when goods
 * were physically delivered to the shop). record_date / invoice_date are
 * ERP upload/booking dates and are irrelevant to discount eligibility.
 */
function getDeliveryDate(inv: any): string {
  return (
    (inv.delivery_date && String(inv.delivery_date).split("T")[0].trim()) ||
    (inv.scheduled_date && String(inv.scheduled_date).split("T")[0].trim()) ||
    ""
  );
}

function invoiceMatchesConfig(inv: any, cfg: any): boolean {
  if (isPermanentDiscount(cfg)) return true; // permanent — always active

  const cfgFrom = (cfg.from_date || "").split("T")[0].trim();
  const cfgTo = (cfg.to_date || "").split("T")[0].trim();
  if (!cfgFrom && !cfgTo) return true;

  const delivDate = getDeliveryDate(inv);
  if (!delivDate) return false;
  return delivDate >= cfgFrom && delivDate <= cfgTo;
}

export async function getDiscountConfigsForShop(shopId: string, date?: string) {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    const [configsRes, configProductsRes, productsRes, employeesRes, currentShopRes] = await Promise.all([
      supabase.from("discount_configs").select("*").eq("tenant_id", tenantId).eq("shop_id", shopId),
      supabase.from("discount_config_products").select("*").eq("tenant_id", tenantId),
      supabase.from("products").select("id, product_name"),
      supabase.from("employees").select("id, full_name"),
      supabase.from("shops").select("id, outlet_code").eq("id", shopId).maybeSingle(),
    ]);

    let rawConfigs = configsRes.data || [];
    const outletCode = currentShopRes.data?.outlet_code;
    if (rawConfigs.length === 0 && outletCode) {
      const { data: altConfigs } = await supabase
        .from("discount_configs")
        .select("*, shop:shops(outlet_code)")
        .eq("tenant_id", tenantId);
      rawConfigs = (altConfigs || []).filter((c: any) => c.shop?.outlet_code === outletCode);
    }

    const rawConfigProducts = configProductsRes.data || [];
    const products = productsRes.data || [];
    const employees = employeesRes.data || [];

    const productMap = new Map(products.map((p) => [p.id, p]));
    const employeeMap = new Map(employees.map((e) => [e.id, e]));

    return rawConfigs
      .filter((cfg) => {
        if (!date) return true;
        if (isPermanentDiscount(cfg)) return true; // permanent — always active
        const from = (cfg.from_date || "").split("T")[0];
        const to = (cfg.to_date || "").split("T")[0];
        return date >= from && date <= to;
      })
      .map((cfg) => ({
        ...cfg,
        preseller: cfg.preseller_id ? employeeMap.get(cfg.preseller_id) : null,
        discount_config_products: rawConfigProducts
          .filter((cp) => cp.discount_config_id === cfg.id)
          .map((cp) => ({
            ...cp,
            product: productMap.get(cp.product_id) || { id: cp.product_id, product_name: "" },
          })),
      }));
  } catch (err: any) {
    console.error("[getDiscountConfigsForShop] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getDiscountReportData(params?: {
  from?: string;
  to?: string;
  givenByType?: "owner" | "preseller";
  presellerId?: string;
}) {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    const [configsRes, configProductsRes, shops, products, employeesRes, invoices] = await Promise.all([
      supabase.from("discount_configs").select("*, shop:shops(id, outlet_code, shop_name)").eq("tenant_id", tenantId),
      supabase.from("discount_config_products").select("*").eq("tenant_id", tenantId),
      fetchAllRows((f, t) => supabase.from("shops").select("id, outlet_code, shop_name").order("id").range(f, t)),
      fetchAllRows((f, t) => supabase.from("products").select("id, product_name, product_code, sale_rate").order("id").range(f, t)),
      supabase.from("employees").select("id, full_name, employee_code"),
      fetchAllRows((f, t) => supabase.from("invoices").select("id, invoice_no, record_date, invoice_date, scheduled_date, delivery_date, created_at, shop_id, outlet_name, outlet_code, preseller_id, products, shop:shops(id, outlet_code, shop_name)").eq("tenant_id", tenantId).order("id").range(f, t)),
    ]);

    const rawConfigs = configsRes.data || [];
    const rawConfigProducts = configProductsRes.data || [];
    const employees = employeesRes.data || [];

    const shopMap = new Map(shops.map((s) => [s.id, s]));
    const shopByCode = new Map(shops.map((s) => [String(s.outlet_code || "").trim().toLowerCase(), s]));
    const productMap = new Map(products.map((p) => [p.id, p]));
    const employeeMap = new Map(employees.map((e) => [e.id, e]));

    const configsWithProducts = rawConfigs.map((cfg) => {
      const prods = rawConfigProducts
        .filter((cp) => cp.discount_config_id === cfg.id)
        .map((cp) => ({
          ...cp,
          product: productMap.get(cp.product_id) || { product_name: "Product" },
        }));
      return {
        ...cfg,
        shop: cfg.shop || shopMap.get(cfg.shop_id) || { shop_name: "Shop", outlet_code: "" },
        preseller: cfg.preseller_id ? employeeMap.get(cfg.preseller_id) : null,
        discount_config_products: prods,
      };
    });

    const configs = configsWithProducts.filter((cfg) => {
      if (params?.givenByType && cfg.given_by_type !== params.givenByType) return false;
      if (params?.givenByType === "preseller" && params?.presellerId && cfg.preseller_id !== params.presellerId) return false;
      return true;
    });

    if (configs.length === 0) return [];

    const rowsByDate = new Map<string, {
      date: string;
      shops: {
        shopName: string;
        invoiceNo: string;
        products: string;
        discount: number;
        givenBy: string;
      }[];
      totalDiscount: number;
    }>();

    for (const invoice of invoices) {
      const delivDate = getDeliveryDate(invoice);
      if (!delivDate) continue;

      const filterFrom = params?.from ? params.from.split("T")[0].trim() : "";
      const filterTo = params?.to ? params.to.split("T")[0].trim() : "";

      if (filterFrom && delivDate < filterFrom) continue;
      if (filterTo && delivDate > filterTo) continue;

      const matchingConfigs = configs.filter((cfg) => {
        // Match by shop_id first; fall back to outlet_code if invoice has no shop_id or different UUID
        const invShopId = invoice.shop_id ||
          (invoice.outlet_code
            ? shopByCode.get(String(invoice.outlet_code).trim().toLowerCase())?.id
            : null);
        const outletMatch = cfg.shop?.outlet_code && invoice.outlet_code &&
          String(cfg.shop.outlet_code).trim() === String(invoice.outlet_code).trim();
        const shopMatch = (invShopId && cfg.shop_id === invShopId) || outletMatch;
        if (!shopMatch) return false;
        return invoiceMatchesConfig(invoice, cfg);
      });

      if (matchingConfigs.length === 0) continue;

      const invQtys = parseInvoiceProductQtys((invoice as any).products || "");

      for (const cfg of matchingConfigs) {
        let invoiceDiscount = 0;
        const productParts: string[] = [];

        for (const dp of cfg.discount_config_products) {
          const qty = qtyForProduct(invQtys, dp.product);
          if (qty > 0) {
            const discPerUnit = Number(dp.sale_rate) - Number(dp.discounted_rate);
            invoiceDiscount += discPerUnit * qty;
            const pName = dp.product?.product_name || "Product";
            productParts.push(`${pName}+${dp.discounted_rate}-${dp.sale_rate}\u00d7${qty}`);
          }
        }

        if (invoiceDiscount <= 0) continue;

        const shopName =
          (cfg.shop?.shop_name && cfg.shop.shop_name !== "Shop" ? cfg.shop.shop_name : "") ||
          invoice.outlet_name ||
          (Array.isArray(invoice.shop) ? invoice.shop[0]?.shop_name : (invoice.shop as any)?.shop_name) ||
          cfg.shop?.shop_name ||
          "Unknown Shop";
        const invoiceNo = invoice.invoice_no || "—";
        const givenByLabel =
          cfg.given_by_type === "preseller" && cfg.preseller?.full_name
            ? `Preseller (${cfg.preseller.full_name})`
            : "Owner";

        const shopRow = {
          shopName,
          invoiceNo,
          products: productParts.join(", "),
          discount: invoiceDiscount,
          givenBy: givenByLabel,
        };

        const existing = rowsByDate.get(delivDate);
        if (existing) {
          existing.shops.push(shopRow);
          existing.totalDiscount += invoiceDiscount;
        } else {
          rowsByDate.set(delivDate, {
            date: delivDate,
            shops: [shopRow],
            totalDiscount: invoiceDiscount,
          });
        }
      }
    }

    return Array.from(rowsByDate.values()).sort((a, b) => b.date.localeCompare(a.date));
  } catch (err: any) {
    console.error("[getDiscountReportData] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getMonthlyAdditionalDiscountsTotal(from?: string, to?: string): Promise<number> {
  const data = await getDiscountReportData({ from, to });
  return (data || []).reduce((acc, row) => acc + (Number(row.totalDiscount) || 0), 0);
}

export async function getShopInvoicesWithDiscounts(shopId: string) {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    const [configsRes, configProductsRes, products, employeesRes, currentShopRes] = await Promise.all([
      supabase.from("discount_configs").select("*, shop:shops(id, outlet_code, shop_name)").eq("tenant_id", tenantId).eq("shop_id", shopId),
      supabase.from("discount_config_products").select("*").eq("tenant_id", tenantId),
      fetchAllRows((f, t) => supabase.from("products").select("id, product_name, product_code, sale_rate").order("id").range(f, t)),
      supabase.from("employees").select("id, full_name, employee_code"),
      supabase.from("shops").select("id, outlet_code, shop_name").eq("id", shopId).maybeSingle(),
    ]);

    const outletCode = currentShopRes.data?.outlet_code;
    let rawConfigs = configsRes.data || [];
    if (rawConfigs.length === 0 && outletCode) {
      const { data: altConfigs } = await supabase
        .from("discount_configs")
        .select("*, shop:shops(id, outlet_code, shop_name)")
        .eq("tenant_id", tenantId);
      rawConfigs = (altConfigs || []).filter((c: any) => c.shop?.outlet_code === outletCode);
    }

    const invoices = await fetchAllRows((f, t) => {
      let q = supabase.from("invoices").select("*").eq("tenant_id", tenantId);
      if (outletCode) {
        q = q.or(`shop_id.eq.${shopId},outlet_code.eq.${outletCode}`);
      } else {
        q = q.eq("shop_id", shopId);
      }
      return q.order("record_date", { ascending: false, nullsFirst: false }).order("id").range(f, t);
    });

    const rawConfigProducts = configProductsRes.data || [];
    const employees = employeesRes.data || [];

    const productMap = new Map(products.map((p) => [p.id, p]));
    const employeeMap = new Map(employees.map((e) => [e.id, e]));

    const configs = rawConfigs.map((cfg) => ({
      ...cfg,
      preseller: cfg.preseller_id ? employeeMap.get(cfg.preseller_id) : null,
      discount_config_products: rawConfigProducts
        .filter((cp) => cp.discount_config_id === cfg.id)
        .map((cp) => ({
          ...cp,
          product: productMap.get(cp.product_id) || { product_name: "Product" },
        })),
    }));

    return invoices.map((inv) => {
      const activeConfigs = configs.filter((cfg) => invoiceMatchesConfig(inv, cfg));

      const discountMarks: { product: any; discounted_rate: number; sale_rate: number }[] = [];
      let totalDiscount = 0;
      let givenBy: string | null = null;

      const invQtys = parseInvoiceProductQtys((inv as any).products || "");

      for (const cfg of activeConfigs) {
        for (const dp of cfg.discount_config_products) {
          const qty = qtyForProduct(invQtys, dp.product);
          if (qty > 0) {
            const disc = (Number(dp.sale_rate) - Number(dp.discounted_rate)) * qty;
            totalDiscount += disc;
            discountMarks.push(dp);
          }
        }

        if (!givenBy) {
          if (cfg.given_by_type === "preseller" && cfg.preseller?.full_name) {
            givenBy = `Preseller (${cfg.preseller.full_name})`;
          } else {
            givenBy = "Owner";
          }
        }
      }

      const rawProducts = (inv as any).products || "";
      return {
        ...inv,
        calculated_discount: totalDiscount,
        formatted_products: annotateInvoiceProductsWithDiscounts(rawProducts, discountMarks),
        given_by: totalDiscount > 0 && givenBy ? givenBy : "-",
      };
    });
  } catch (err: any) {
    console.error("[getShopInvoicesWithDiscounts] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getAdditionalDiscountSummary(params?: { from?: string; to?: string }) {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    const [configsRes, configProductsRes, shops, products, employeesRes, invoices] = await Promise.all([
      supabase.from("discount_configs").select("*, shop:shops(id, outlet_code, shop_name)").eq("tenant_id", tenantId),
      supabase.from("discount_config_products").select("*").eq("tenant_id", tenantId),
      fetchAllRows((f, t) => supabase.from("shops").select("id, outlet_code, shop_name").order("id").range(f, t)),
      fetchAllRows((f, t) => supabase.from("products").select("id, product_name, product_code").order("id").range(f, t)),
      supabase.from("employees").select("id, full_name"),
      fetchAllRows((f, t) => supabase.from("invoices").select("id, invoice_no, record_date, invoice_date, scheduled_date, delivery_date, created_at, shop_id, amount, grand_total, outlet_name, outlet_code, products, shop:shops(id, outlet_code, shop_name)").eq("tenant_id", tenantId).order("id").range(f, t)),
    ]);

    const rawConfigs = configsRes.data || [];
    const rawConfigProducts = configProductsRes.data || [];
    const employees = employeesRes.data || [];

    const shopMap = new Map(shops.map((s) => [s.id, s]));
    const shopByCode = new Map(shops.map((s) => [String(s.outlet_code || "").trim().toLowerCase(), s]));
    const productMap = new Map(products.map((p) => [p.id, p]));
    const employeeMap = new Map(employees.map((e) => [e.id, e]));

    const filterFrom = params?.from ? params.from.split("T")[0].trim() : "";
    const filterTo = params?.to ? params.to.split("T")[0].trim() : "";

    const configsWithProducts = rawConfigs.map((cfg) => ({
      ...cfg,
      shop: cfg.shop || shopMap.get(cfg.shop_id) || { shop_name: "Unknown" },
      preseller: cfg.preseller_id ? employeeMap.get(cfg.preseller_id) : null,
      discount_config_products: rawConfigProducts
        .filter((cp) => cp.discount_config_id === cfg.id)
        .map((cp) => ({ ...cp, product: productMap.get(cp.product_id) || { product_name: "Product" } })),
    }));

    const shopSummaryMap = new Map<string, {
      shopId: string; shopName: string; givenBy: string;
      invoiceCount: number; salesTotal: number; discountTotal: number;
    }>();

    for (const invoice of invoices) {
      const delivDate = getDeliveryDate(invoice);
      if (!delivDate) continue;
      if (filterFrom && delivDate < filterFrom) continue;
      if (filterTo && delivDate > filterTo) continue;

      const matchingConfigs = configsWithProducts.filter((cfg) => {
        const invShopId = invoice.shop_id ||
          (invoice.outlet_code
            ? shopByCode.get(String(invoice.outlet_code).trim().toLowerCase())?.id
            : null);
        const outletMatch = cfg.shop?.outlet_code && invoice.outlet_code &&
          String(cfg.shop.outlet_code).trim() === String(invoice.outlet_code).trim();
        const shopMatch = (invShopId && cfg.shop_id === invShopId) || outletMatch;
        if (!shopMatch) return false;
        return invoiceMatchesConfig(invoice, cfg);
      });
      if (matchingConfigs.length === 0) continue;

      let invDiscount = 0;
      let givenByLabel = "Owner";

      const invQtys = parseInvoiceProductQtys((invoice as any).products || "");

      for (const cfg of matchingConfigs) {
        for (const dp of cfg.discount_config_products) {
          const qty = qtyForProduct(invQtys, dp.product);
          if (qty > 0) invDiscount += (Number(dp.sale_rate) - Number(dp.discounted_rate)) * qty;
        }
        if (cfg.given_by_type === "preseller" && cfg.preseller?.full_name) {
          givenByLabel = `Preseller (${cfg.preseller.full_name})`;
        }
      }

      if (invDiscount <= 0) continue;

      const shopId: string =
        invoice.shop_id ||
        (invoice.outlet_code ? shopByCode.get(String(invoice.outlet_code).trim().toLowerCase())?.id : undefined) ||
        matchingConfigs[0].shop_id;
      const shopName =
        (matchingConfigs[0]?.shop?.shop_name && matchingConfigs[0].shop.shop_name !== "Unknown" ? matchingConfigs[0].shop.shop_name : "") ||
        invoice.outlet_name ||
        (Array.isArray(invoice.shop) ? invoice.shop[0]?.shop_name : (invoice.shop as any)?.shop_name) ||
        shopMap.get(shopId)?.shop_name ||
        "Unknown";
      const existing = shopSummaryMap.get(shopId);
      if (existing) {
        existing.invoiceCount += 1;
        existing.salesTotal += Number(invoice.amount ?? invoice.grand_total ?? 0);
        existing.discountTotal += invDiscount;
      } else {
        shopSummaryMap.set(shopId, {
          shopId, shopName, givenBy: givenByLabel,
          invoiceCount: 1,
          salesTotal: Number(invoice.amount ?? invoice.grand_total ?? 0),
          discountTotal: invDiscount,
        });
      }
    }

    return Array.from(shopSummaryMap.values()).sort((a, b) => a.shopName.localeCompare(b.shopName));
  } catch (err: any) {
    console.error("[getAdditionalDiscountSummary] unexpected:", err?.message ?? err);
    return [];
  }
}

export async function getAdditionalDiscountShopSummary(shopId: string, params?: { from?: string; to?: string }) {
  try {
    const supabase = await createClient();
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    const [configsRes, configProductsRes, products, employeesRes, currentShopRes] = await Promise.all([
      supabase.from("discount_configs").select("*, shop:shops(id, outlet_code, shop_name)").eq("tenant_id", tenantId).eq("shop_id", shopId),
      supabase.from("discount_config_products").select("*").eq("tenant_id", tenantId),
      fetchAllRows((f, t) => supabase.from("products").select("id, product_name, product_code").order("id").range(f, t)),
      supabase.from("employees").select("id, full_name"),
      supabase.from("shops").select("id, outlet_code, shop_name").eq("id", shopId).maybeSingle(),
    ]);

    const outletCode = currentShopRes.data?.outlet_code;
    let rawConfigs = configsRes.data || [];
    if (rawConfigs.length === 0 && outletCode) {
      const { data: altConfigs } = await supabase
        .from("discount_configs")
        .select("*, shop:shops(id, outlet_code, shop_name)")
        .eq("tenant_id", tenantId);
      rawConfigs = (altConfigs || []).filter((c: any) => c.shop?.outlet_code === outletCode);
    }

    const invoices = await fetchAllRows((f, t) => {
      let q = supabase
        .from("invoices")
        .select("id, invoice_no, record_date, invoice_date, scheduled_date, delivery_date, created_at, amount, grand_total, products, outlet_name, outlet_code, shop:shops(id, outlet_code, shop_name)")
        .eq("tenant_id", tenantId);
      if (outletCode) {
        q = q.or(`shop_id.eq.${shopId},outlet_code.eq.${outletCode}`);
      } else {
        q = q.eq("shop_id", shopId);
      }
      return q.order("record_date", { ascending: false, nullsFirst: false }).order("id").range(f, t);
    });

    const rawConfigProducts = configProductsRes.data || [];
    const employees = employeesRes.data || [];

    const productMap = new Map(products.map((p) => [p.id, p]));
    const employeeMap = new Map(employees.map((e) => [e.id, e]));

    const filterFrom = params?.from ? params.from.split("T")[0].trim() : "";
    const filterTo = params?.to ? params.to.split("T")[0].trim() : "";

    const configs = rawConfigs.map((cfg) => ({
      ...cfg,
      preseller: cfg.preseller_id ? employeeMap.get(cfg.preseller_id) : null,
      discount_config_products: rawConfigProducts
        .filter((cp) => cp.discount_config_id === cfg.id)
        .map((cp) => ({ ...cp, product: productMap.get(cp.product_id) || { product_name: "Product" } })),
    }));

    const rows: { date: string; invoiceNo: string; grandTotal: number; products: string; givenBy: string; discount: number }[] = [];

    for (const inv of invoices) {
      const delivDate = getDeliveryDate(inv);
      if (!delivDate) continue;
      if (filterFrom && delivDate < filterFrom) continue;
      if (filterTo && delivDate > filterTo) continue;

      const activeConfigs = configs.filter((cfg) => invoiceMatchesConfig(inv, cfg));

      const productParts: string[] = [];
      let invDiscount = 0;
      let givenBy = "";

      const invQtys = parseInvoiceProductQtys((inv as any).products || "");

      for (const cfg of activeConfigs) {
        for (const dp of cfg.discount_config_products) {
          const qty = qtyForProduct(invQtys, dp.product);
          if (qty > 0) {
            const disc = (Number(dp.sale_rate) - Number(dp.discounted_rate)) * qty;
            invDiscount += disc;
            productParts.push(`${dp.product?.product_name || "Product"}+${dp.discounted_rate}-${dp.sale_rate}\u00d7${qty}`);
          }
        }
        if (invDiscount > 0 && !givenBy) {
          if (cfg.given_by_type === "preseller" && cfg.preseller?.full_name) {
            givenBy = `Preseller (${cfg.preseller.full_name})`;
          } else {
            givenBy = "Owner";
          }
        }
      }

      rows.push({
        date: delivDate,
        invoiceNo: inv.invoice_no || "—",
        grandTotal: Number(inv.amount ?? inv.grand_total ?? 0),
        products: productParts.join(", "),
        givenBy: invDiscount > 0 ? givenBy : "",
        discount: invDiscount,
      });
    }

    return rows;
  } catch (err: any) {
    console.error("[getAdditionalDiscountShopSummary] unexpected:", err?.message ?? err);
    return [];
  }
}
