import { describe, expect, it } from "vitest";
import {
  findUnmatchedInvoiceProducts,
  formatUnmatchedProductAlert,
} from "./invoice-product-match";

const catalog = [
  { product_code: "103541", product_name: "COCA-COLA  PET 1.5L /6" },
  { product_code: "191431", product_name: "FANTA ORANGE PET500ML PRICE-100" },
];

function inv(invoice_no: string, products: string) {
  return { invoice_no, products };
}

describe("findUnmatchedInvoiceProducts", () => {
  it("reports nothing when every imported code is in the Products menu", () => {
    const r = findUnmatchedInvoiceProducts(
      [inv("5001", "103541     COCA-COLA  PET 1.5L /6×10")],
      catalog
    );
    expect(r.unmatched).toEqual([]);
    expect(r.unmatchedInvoiceKeys.size).toBe(0);
    expect(r.parsedLineCount).toBe(1);
  });

  it("accepts a line whose name matches even if the code is new", () => {
    const r = findUnmatchedInvoiceProducts(
      [inv("5001", "999999     COCA-COLA  PET 1.5L /6×2")],
      catalog
    );
    expect(r.unmatched).toEqual([]);
  });

  it("flags a code that is in no Products-menu row, by code or name", () => {
    const r = findUnmatchedInvoiceProducts(
      [inv("5001", "888888     MYSTERY DRINK×4")],
      catalog
    );
    expect(r.unmatched).toEqual([
      {
        label: "888888 MYSTERY DRINK",
        code: "888888",
        name: "MYSTERY DRINK",
        invoiceNos: ["5001"],
      },
    ]);
    expect(r.unmatchedInvoiceKeys.has("5001")).toBe(true);
  });

  it("groups the same missing product across invoices and is case-insensitive on invoice no", () => {
    const r = findUnmatchedInvoiceProducts(
      [
        inv("5001", "888888     MYSTERY DRINK×4"),
        inv("5002", "888888     MYSTERY DRINK×1"),
      ],
      catalog
    );
    expect(r.unmatched).toHaveLength(1);
    expect(r.unmatched[0].invoiceNos).toEqual(["5001", "5002"]);
    expect(r.unmatchedInvoiceKeys.has("5001")).toBe(true);
    expect(r.unmatchedInvoiceKeys.has("5002")).toBe(true);
  });

  it("skips invoices with no products string — the check only runs once Sale Detail is on the row", () => {
    const r = findUnmatchedInvoiceProducts([inv("5001", ""), inv("5002", "   ")], catalog);
    expect(r.parsedLineCount).toBe(0);
    expect(r.unmatched).toEqual([]);
  });

  it("formats a short alert listing the missing products", () => {
    const r = findUnmatchedInvoiceProducts(
      [inv("5001", "888888     MYSTERY DRINK×4")],
      catalog
    );
    const text = formatUnmatchedProductAlert(r.unmatched);
    expect(text).toContain("888888 MYSTERY DRINK");
    expect(text).toContain("5001");
    expect(text).toContain("not in the Products menu");
  });
});
