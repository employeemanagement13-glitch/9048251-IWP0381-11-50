import { NextRequest, NextResponse } from "next/server";
import { parseStockReportPdfText } from "@/lib/parsers/stockReportPdf";
import { createClient, getTenantId } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No PDF file provided" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });

    if (!text || !text.trim()) {
      return NextResponse.json(
        { error: "Could not extract text from the PDF file. Please ensure it is a valid text-based PDF report." },
        { status: 422 }
      );
    }

    const parsed = parseStockReportPdfText(text);

    if (parsed.items.length === 0) {
      return NextResponse.json(
        { error: "No products could be parsed from the PDF. Please check the document format." },
        { status: 422 }
      );
    }

    const supabase = await createClient();
    const tenantId = await getTenantId();

    // Fetch existing active products & categories for this tenant
    let dbProducts: any[] = [];
    let dbCategories: any[] = [];

    if (tenantId) {
      const [prodsRes, catsRes] = await Promise.all([
        supabase
          .from("products")
          .select("id, product_name, product_code, category_id, purchase_rate, sale_rate, product_categories(id, title, set_un_case, is_returnable, is_rgb, is_implied)")
          .eq("tenant_id", tenantId)
          .eq("active", true),
        supabase
          .from("product_categories")
          .select("id, title, set_un_case, is_returnable, is_rgb, is_implied")
          .eq("tenant_id", tenantId),
      ]);
      dbProducts = prodsRes.data || [];
      dbCategories = catsRes.data || [];
    }

    // Helper functions for matching
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Build lookup maps
    const codeMap = new Map<string, any>();
    const normCodeMap = new Map<string, any>();
    const nameMap = new Map<string, any>();
    const normNameMap = new Map<string, any>();

    dbProducts.forEach((p) => {
      if (p.product_code) {
        const rawCode = String(p.product_code).trim();
        codeMap.set(rawCode, p);
        const digits = rawCode.replace(/\D/g, "");
        if (digits) normCodeMap.set(digits, p);
      }
      if (p.product_name) {
        const rawName = String(p.product_name).trim().toLowerCase();
        nameMap.set(rawName, p);
        normNameMap.set(norm(rawName), p);
      }
    });

    const categoryByTitle = new Map<string, any>();
    dbCategories.forEach((c) => {
      categoryByTitle.set(norm(c.title), c);
    });

    // Match each parsed item
    const matchedLines = [];
    const missingToCreate = [];
    const missingRateMessages: string[] = [];

    for (const item of parsed.items) {
      let matchedProduct =
        codeMap.get(item.code) ||
        normCodeMap.get(item.code.replace(/\D/g, "")) ||
        nameMap.get(item.name.toLowerCase()) ||
        normNameMap.get(norm(item.name));

      // Partial fallback match
      if (!matchedProduct) {
        const itemNorm = norm(item.name);
        matchedProduct = dbProducts.find((p) => {
          const pNorm = norm(p.product_name || "");
          return pNorm.length > 4 && (pNorm.includes(itemNorm) || itemNorm.includes(pNorm));
        });
      }

      if (matchedProduct) {
        const setUnCase = Number(matchedProduct.product_categories?.set_un_case) || 1;
        const purchaseRate = Number(matchedProduct.purchase_rate) || 0;

        const ph = item.ph_case;
        const uc = parseFloat((ph * setUnCase).toFixed(2));
        const amt = purchaseRate > 0 ? parseFloat((ph * purchaseRate).toFixed(2)) : 0;

        if (!(purchaseRate > 0)) {
          missingRateMessages.push(
            `Purchase rate missing of [${matchedProduct.product_name} | ${matchedProduct.product_code || "—"}]`
          );
        }

        matchedLines.push({
          product: matchedProduct,
          ph_case: ph,
          unit_case: uc,
          amount: amt,
        });
      } else {
        missingToCreate.push(item);
      }
    }

    // Auto-create missing products so user won't get foreign key constraint violations
    if (missingToCreate.length > 0 && tenantId) {
      for (const item of missingToCreate) {
        // Find best category by group
        let matchedCat = null;
        if (item.group) {
          matchedCat = categoryByTitle.get(norm(item.group));
          if (!matchedCat) {
            // fuzzy match group to existing categories
            const gNorm = norm(item.group);
            matchedCat = dbCategories.find((c) => {
              const cNorm = norm(c.title || "");
              return cNorm.includes(gNorm) || gNorm.includes(cNorm);
            });
          }
        }
        if (!matchedCat && dbCategories.length > 0) {
          matchedCat = dbCategories[0];
        }

        const { data: newProd, error: createErr } = await supabase
          .from("products")
          .insert({
            tenant_id: tenantId,
            product_code: item.code,
            product_name: item.name,
            category_id: matchedCat?.id || null,
            purchase_rate: 0,
            sale_rate: 0,
            packing_qty: 1,
            active: true,
          })
          .select("id, product_name, product_code, category_id, purchase_rate, sale_rate, product_categories(id, title, set_un_case, is_returnable, is_rgb, is_implied)")
          .single();

        const setUnCase = Number(matchedCat?.set_un_case) || 1;
        const ph = item.ph_case;
        const uc = parseFloat((ph * setUnCase).toFixed(2));
        const amt = 0;

        missingRateMessages.push(
          `Purchase rate missing of [${item.name} | ${item.code || "—"}]`
        );

        if (!createErr && newProd) {
          matchedLines.push({
            product: newProd,
            ph_case: ph,
            unit_case: uc,
            amount: amt,
          });
        } else {
          // If creation failed (e.g. RLS or constraint), still return item with temporary object
          matchedLines.push({
            product: {
              id: "",
              product_name: item.name,
              product_code: item.code,
              category_id: matchedCat?.id || null,
              purchase_rate: 0,
              sale_rate: 0,
              product_categories: matchedCat || null,
            },
            ph_case: ph,
            unit_case: uc,
            amount: amt,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      reportDate: parsed.reportDate,
      lines: matchedLines,
      missingRateMessages,
      totalCount: matchedLines.length,
    });
  } catch (err: any) {
    console.error("[parse-stock-report-pdf]", err);
    return NextResponse.json(
      { error: err.message || "Failed to process PDF file." },
      { status: 500 }
    );
  }
}
