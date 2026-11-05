import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { InvoiceFormData } from "@/lib/actions/invoices";
import { parseProducts } from "@/lib/parsers/products";

export async function parseInvoiceCSV(
  file: File,
  shops: any[],
  employees: any[] = [],
  warehouseStock: { product_name: string; available: number }[] = []
): Promise<InvoiceFormData[]> {
  const productNameMap = new Map<string, string>(
    warehouseStock.map((p) => [p.product_name.toLowerCase().trim(), p.product_name])
  );

  const isExcel = /\.(xlsx|xls)$/i.test(file.name);

  if (isExcel) {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
    return processRows(rows, shops, employees, productNameMap);
  }

  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          resolve(processRows(results.data as any[], shops, employees, productNameMap));
        } catch (error) {
          reject(error);
        }
      },
      error: (error) => reject(error),
    });
  });
}

function processRows(
  rows: any[],
  shops: any[],
  employees: any[],
  productNameMap: Map<string, string>
): InvoiceFormData[] {
  const allErrors: string[] = [];

  const parsedInvoices = rows.map((row: any, rowIdx: number) => {
    const rowLabel = String(row["Invoice No"] || row["invoice_no"] || `Row ${rowIdx + 1}`).trim();

    const outletCodeRaw = row["Outlet Code"] ?? row["outlet_code"] ?? "";
    const outletCodeStr = String(outletCodeRaw).trim();
    const matchingShop = shops.find(
      (s) => String(s.outlet_code).trim() === outletCodeStr
    );
    if (!matchingShop) {
      allErrors.push(
        `[${rowLabel}] Shop with Outlet Code "${outletCodeStr}" not found in system.`
      );
    }

    const presellerName = String(row["Preseller"] || row["preseller"] || "").trim().toLowerCase();
    const matchingPreseller = presellerName
      ? employees.find(
          (e) => e.role === "preseller" && e.full_name.trim().toLowerCase() === presellerName
        ) ??
        employees.find(
          (e) => e.role === "preseller" && e.full_name.trim().toLowerCase().includes(presellerName)
        )
      : null;

    const dmName = String(row["DM"] || row["dm"] || row["Delivery Man"] || "").trim().toLowerCase();
    const matchingDm = dmName
      ? employees.find(
          (e) => e.role === "dm" && e.full_name.trim().toLowerCase() === dmName
        ) ??
        employees.find(
          (e) => e.role === "dm" && e.full_name.trim().toLowerCase().includes(dmName)
        )
      : null;

    const rawType = String(
      row["Type"] || row["Invoice Type"] || row["type"] || row["invoice_type"] || "cash"
    ).trim().toLowerCase();
    const invoiceType: "cash" | "credit" = rawType === "credit" ? "credit" : "cash";

    const rawScheduled = String(row["Scheduled Date"] || row["scheduled_date"] || "").trim();
    const scheduledDate = rawScheduled || new Date().toISOString().split("T")[0];

    const rawInvoiceDate = String(row["Invoice Date"] || row["invoice_date"] || "").trim();
    const invoiceDate = rawInvoiceDate || new Date().toISOString().split("T")[0];

    const rawDueDate = String(row["Due Date"] || row["due_date"] || "").trim();
    const dueDate = invoiceType === "credit" && rawDueDate ? rawDueDate : undefined;

    const rawPromo = String(row["Promo Type"] || row["promo_type"] || "none").trim().toLowerCase();
    const promoType: "in_kind" | "in_rupees" | "none" =
      rawPromo === "in_kind" || rawPromo === "in rupees".replace(" ", "_")
        ? "in_kind"
        : rawPromo === "in_rupees" || rawPromo === "in rupees"
        ? "in_rupees"
        : "none";

    const rawProducts = String(row["Products"] || row["products"] || "").trim();

    if (productNameMap.size > 0 && rawProducts) {
      const parsedProducts = parseProducts(rawProducts);
      for (const { name } of parsedProducts) {
        const key = name.toLowerCase().trim();
        if (!productNameMap.has(key)) {
          allErrors.push(
            `[${rowLabel}] Product "${name}" not found in warehouse. Check spelling.`
          );
        }
      }
    }

    return {
      invoice_no: String(row["Invoice No"] || row["invoice_no"] || "").trim(),
      shop_id: matchingShop?.id || "",
      preseller_id: matchingPreseller?.id || undefined,
      dm_id: matchingDm?.id || undefined,
      products: rawProducts,
      promo_type: promoType,
      promo_note: String(row["Promo Note"] || row["promo_note"] || "").trim() || undefined,
      invoice_date: invoiceDate,
      scheduled_date: scheduledDate,
      due_date: dueDate,
      invoice_type: invoiceType,
      invoice_total: parseFloat(String(row["Invoice Total"] || row["invoice_total"] || "0")),
      discount_amount: parseFloat(String(row["Discount"] || row["discount_amount"] || "0")),
      advance_tax: parseFloat(String(row["Advance Tax"] || row["advance_tax"] || "0")),
      empties_deposit: 0,
      amount_received: 0,
    } satisfies InvoiceFormData;
  });

  if (allErrors.length > 0) {
    throw new Error(allErrors.join("\n"));
  }

  return parsedInvoices;
}
