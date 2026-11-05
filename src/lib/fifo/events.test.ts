import { describe, expect, it } from "vitest";
import { runFifo } from "./engine";
import {
  buildFifoEvents,
  classifyProducts,
  getOrderEffDate,
  resolveArrivedQty,
  resolveLineRate,
  type ProductRow,
  type SellInOrderRow,
} from "./events";

// ── Fixtures ───────────────────────────────────────────────────────────────────────────

const coke: ProductRow = {
  id: "p-coke",
  product_name: "Coca-Cola PET 1.5L",
  product_code: "1234567",
  purchase_rate: 910.3,
  product_categories: { is_implied: false },
};

const shell: ProductRow = {
  id: "p-shell",
  product_name: "RGB Shell",
  product_code: "800001",
  purchase_rate: 120,
  product_categories: { is_implied: true },
};

const promo: ProductRow = {
  id: "p-promo",
  product_name: "PRICE-100 Scheme",
  product_code: "191431",
  purchase_rate: 500,
  product_categories: null,
};

const ALL_PRODUCTS = [coke, shell, promo];

const empty = {
  stockReports: [],
  sellInOrders: [],
  saleEntries: [],
  invoices: [],
};

const build = (overrides: Partial<Parameters<typeof buildFifoEvents>[0]>) =>
  buildFifoEvents({ products: classifyProducts(ALL_PRODUCTS), ...empty, ...overrides });

// ── Product classification ─────────────────────────────────────────────────────────────

describe("classifyProducts", () => {
  it("flags implied products from the category flag alone", () => {
    const c = classifyProducts([
      shell,
      { id: "p-a", product_name: "IMPLIED RGB", product_code: "9001", purchase_rate: 10 },
      { id: "p-b", product_name: "Crate", product_code: "8000099", purchase_rate: 10 },
      coke,
    ]);
    expect([...c.impliedProductIds]).toEqual(["p-shell"]);
    expect(c.fallbackRates.get("p-shell")).toBe(0);
    expect(c.fallbackRates.get("p-coke")).toBe(910.3);
  });

  it("costs a product that merely reads like an empty rather than erasing it", () => {
    // Exclusion is irreversible and invisible: an excluded product's whole position drops out
    // of Opening and Closing Stock with no shortfall raised. A name or code resemblance is
    // not evidence enough to do that, so these stay in the ledger at their own rate.
    const c = classifyProducts([
      { id: "p-a", product_name: "IMPLIED RGB", product_code: "9001", purchase_rate: 10 },
      { id: "p-b", product_name: "Crate", product_code: "8000099", purchase_rate: 25 },
    ]);
    expect(c.impliedProductIds.size).toBe(0);
    expect(c.fallbackRates.get("p-a")).toBe(10);
    expect(c.fallbackRates.get("p-b")).toBe(25);
  });

  it("reports a suspected empty whose category flag is missing", () => {
    const c = classifyProducts([
      coke,
      shell,
      { id: "p-a", product_name: "COKE 250 ML IMPLIED EMP 24B RGB", product_code: "9001" },
      { id: "p-b", product_name: "Wooden Pallets", product_code: "800000525" },
    ]);
    expect(c.suspectedUnflaggedImplied.map((p) => p.id)).toEqual(["p-a", "p-b"]);
  });

  it("does not report a correctly flagged empty, nor an ordinary beverage", () => {
    const c = classifyProducts([coke, shell]);
    expect(c.suspectedUnflaggedImplied).toEqual([]);
  });

  it("accepts a category arriving as an array from a PostgREST embed", () => {
    const c = classifyProducts([
      { id: "p-x", product_name: "Thing", product_code: "4321", product_categories: [{ is_implied: true }] },
    ]);
    expect(c.impliedProductIds.has("p-x")).toBe(true);
  });

  it("keeps a promotional SKU in the ledger at its own purchase_rate", () => {
    // No product code is special-cased any more. A PRICE-100 style pack is ordinary stock
    // with an ordinary cost; only a genuinely zero rate makes it free.
    const c = classifyProducts(ALL_PRODUCTS);
    expect(c.impliedProductIds.has("p-promo")).toBe(false);
    expect(c.fallbackRates.get("p-promo")).toBe(500);
  });

  it("indexes products by code and lower-cased name", () => {
    const c = classifyProducts(ALL_PRODUCTS);
    expect(c.productCodeMap.get("1234567")?.id).toBe("p-coke");
    expect(c.productNameMap.get("coca-cola pet 1.5l")?.id).toBe("p-coke");
  });
});

// ── Sell-in field resolution ───────────────────────────────────────────────────────────

describe("getOrderEffDate", () => {
  it("prefers transaction_date, then billed_date, then created_at", () => {
    expect(
      getOrderEffDate({
        id: "o",
        transaction_date: "2026-06-01",
        billed_date: "2026-06-09",
        created_at: "2026-06-10T08:00:00Z",
      })
    ).toBe("2026-06-01");
    expect(getOrderEffDate({ id: "o", billed_date: "2026-06-09T00:00:00Z", created_at: "2026-06-10T08:00:00Z" })).toBe(
      "2026-06-09"
    );
    expect(getOrderEffDate({ id: "o", created_at: "2026-06-10T08:00:00Z" })).toBe("2026-06-10");
    expect(getOrderEffDate({ id: "o" })).toBeNull();
  });
});

describe("resolveArrivedQty", () => {
  it("uses ordered qty when no arrival was recorded", () => {
    expect(resolveArrivedQty({ product_id: "p", qty: 100 })).toBe(100);
    expect(resolveArrivedQty({ product_id: "p", qty: 100, sell_in_arrived_lines: null })).toBe(100);
  });

  it("uses arrived minus returned when an arrival was recorded", () => {
    expect(
      resolveArrivedQty({ product_id: "p", qty: 100, sell_in_arrived_lines: { arrived_qty: 90, returned_qty: 5 } })
    ).toBe(85);
  });

  it("accepts the embed arriving as an array", () => {
    expect(
      resolveArrivedQty({ product_id: "p", qty: 100, sell_in_arrived_lines: [{ arrived_qty: 40 }] })
    ).toBe(40);
  });

  it("treats a recorded zero arrival as zero rather than falling back to ordered qty", () => {
    expect(
      resolveArrivedQty({ product_id: "p", qty: 100, sell_in_arrived_lines: { arrived_qty: 0 } })
    ).toBe(0);
  });

  it("never returns a negative quantity", () => {
    expect(
      resolveArrivedQty({ product_id: "p", qty: 10, sell_in_arrived_lines: { arrived_qty: 5, returned_qty: 20 } })
    ).toBe(0);
  });
});

describe("resolveLineRate", () => {
  it("prefers the stored rate", () => {
    expect(resolveLineRate({ product_id: "p", qty: 10, rate: 910.3, bill_amount: 1 })).toBe(910.3);
  });

  it("recovers the rate from bill_amount when rate is blank", () => {
    expect(resolveLineRate({ product_id: "p", qty: 10, rate: 0, bill_amount: 9103 })).toBe(910.3);
  });

  it("falls back to net_bill_amount", () => {
    expect(resolveLineRate({ product_id: "p", qty: 10, net_bill_amount: 9000 })).toBe(900);
  });

  it("keeps a genuinely free scheme line at zero", () => {
    expect(resolveLineRate({ product_id: "p", qty: 10, rate: 0, bill_amount: 0, net_bill_amount: 0 })).toBe(0);
  });
});

// ── Stock reports ──────────────────────────────────────────────────────────────────────

describe("stock reports", () => {
  it("adds every row, matching how warehouse_standard_levels counts on-hand stock", () => {
    const { events } = build({
      stockReports: [
        { product_id: "p-coke", report_date: "2026-06-01", ph_case: 1000, amount: 910300 },
        { product_id: "p-coke", report_date: "2026-07-01", ph_case: 500, amount: 457500 },
      ],
    });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.kind === "opening_count")).toBe(true);
    expect(events.map((e) => e.value)).toEqual([910300, 457500]);
  });

  it("passes amount through as an exact value instead of a derived unit rate", () => {
    const { events } = build({
      stockReports: [{ product_id: "p-coke", report_date: "2026-06-01", ph_case: 3, amount: 1000 }],
    });
    expect(events[0].value).toBe(1000);
    expect(events[0].rate).toBeUndefined();
  });

  it("values a report with no amount at products.purchase_rate", () => {
    const { events } = build({
      stockReports: [{ product_id: "p-coke", report_date: "2026-06-01", ph_case: 10, amount: 0 }],
    });
    expect(events[0].value).toBeCloseTo(9103, 6);
  });

  it("drops rows with no quantity, no date or no product", () => {
    const { events } = build({
      stockReports: [
        { product_id: "p-coke", report_date: "2026-06-01", ph_case: 0, amount: 100 },
        { product_id: "p-coke", report_date: "", ph_case: 10, amount: 100 },
        { product_id: "", report_date: "2026-06-01", ph_case: 10, amount: 100 },
      ],
    });
    expect(events).toHaveLength(0);
  });
});

// ── Purchase orders ────────────────────────────────────────────────────────────────────

describe("purchase orders", () => {
  const order = (overrides: Partial<SellInOrderRow>): SellInOrderRow => ({
    id: "o-1",
    po_no: "PO-1",
    transaction_date: "2026-06-04",
    status: "stock_arrived",
    sell_in_lines: [{ product_id: "p-coke", qty: 2500, rate: 915 }],
    ...overrides,
  });

  it("books a confirmed PO as a purchase inflow and totals its value", () => {
    const { events, orderValueById } = build({ sellInOrders: [order({})] });
    expect(events).toEqual([
      { productId: "p-coke", date: "2026-06-04", kind: "purchase", qty: 2500, rate: 915, ref: "PO-1" },
    ]);
    expect(orderValueById.get("o-1")).toBe(2287500);
  });

  it.each(["stock_arrived", "on_credit", "billed"])("includes status %s", (status) => {
    const { events } = build({ sellInOrders: [order({ status })] });
    expect(events).toHaveLength(1);
  });

  it.each(["in_progress", "draft", "", undefined])("excludes status %s", (status) => {
    const { events, orderValueById } = build({ sellInOrders: [order({ status: status as string })] });
    expect(events).toHaveLength(0);
    expect(orderValueById.size).toBe(0);
  });

  it("books only what came off the truck", () => {
    const { events, orderValueById } = build({
      sellInOrders: [
        order({
          sell_in_lines: [
            {
              product_id: "p-coke",
              qty: 2500,
              rate: 915,
              sell_in_arrived_lines: { arrived_qty: 2400, returned_qty: 100 },
            },
          ],
        }),
      ],
    });
    expect(events[0].qty).toBe(2300);
    expect(orderValueById.get("o-1")).toBe(2300 * 915);
  });

  it("turns a return line into a negative purchase", () => {
    const { events, orderValueById } = build({
      sellInOrders: [
        order({
          sell_in_lines: [
            { product_id: "p-coke", qty: 100, rate: 915 },
            { product_id: "p-coke", qty: 20, rate: 915, invoice_type: "return" },
          ],
        }),
      ],
    });
    expect(events.map((e) => e.qty)).toEqual([100, -20]);
    expect(orderValueById.get("o-1")).toBe(80 * 915);
  });

  it("keeps implied quantities out of the purchase total but still in the ledger", () => {
    const { events, orderValueById } = build({
      sellInOrders: [
        order({
          sell_in_lines: [
            { product_id: "p-coke", qty: 10, rate: 100 },
            { product_id: "p-shell", qty: 10, rate: 120 },
          ],
        }),
      ],
    });
    expect(events).toHaveLength(2);
    expect(orderValueById.get("o-1")).toBe(1000);
  });

  it("counts a billed promotional pack in the purchase total", () => {
    const { orderValueById } = build({
      sellInOrders: [
        order({ sell_in_lines: [{ product_id: "p-promo", qty: 20, rate: 973.87 }] }),
      ],
    });
    expect(orderValueById.get("o-1")).toBeCloseTo(19477.4, 2);
  });
});

// ── Invoices ───────────────────────────────────────────────────────────────────────────

describe("delivered invoices", () => {
  it("prefers sale_entry lines and dates them by delivery_date", () => {
    const { events, unlinkedInvoices } = build({
      invoices: [{ invoice_no: "5001", delivery_date: "2026-06-02", products: "1234567 Coca-Cola PET 1.5L×999" }],
      saleEntries: [{ sale_no: "INV-5001", sale_entry_lines: [{ product_id: "p-coke", qty: 400 }] }],
    });
    expect(events).toEqual([
      { productId: "p-coke", date: "2026-06-02", kind: "sale", qty: 400, ref: "5001" },
    ]);
    expect(unlinkedInvoices).toEqual([]);
  });

  it.each([
    ["5001", "INV-5001"],
    ["INV-5001", "5001"],
    ["5001", "5001"],
    ["05001", "5001"],
  ])("matches invoice %s to sale entry %s", (invoiceNo, saleNo) => {
    const { events } = build({
      invoices: [{ invoice_no: invoiceNo, delivery_date: "2026-06-02" }],
      saleEntries: [{ sale_no: saleNo, sale_entry_lines: [{ product_id: "p-coke", qty: 1 }] }],
    });
    expect(events).toHaveLength(1);
  });

  it("falls back to parsing the products text when no sale entry exists", () => {
    const { events } = build({
      invoices: [
        { invoice_no: "5002", delivery_date: "2026-06-03", products: "1234567 Coca-Cola PET 1.5L×120, 800001 RGB Shell×-20" },
      ],
    });
    expect(events).toEqual([
      { productId: "p-coke", date: "2026-06-03", kind: "sale", qty: 120, ref: "5002" },
      { productId: "p-shell", date: "2026-06-03", kind: "sale", qty: -20, ref: "5002" },
    ]);
  });

  it("reports an invoice that can be costed from neither source", () => {
    const { events, unlinkedInvoices } = build({
      invoices: [{ invoice_no: "5003", delivery_date: "2026-06-03", products: "" }],
    });
    expect(events).toEqual([]);
    expect(unlinkedInvoices).toEqual(["5003"]);
  });

  it("keeps a negative sale_entry quantity as a return", () => {
    const { events } = build({
      invoices: [{ invoice_no: "5004", delivery_date: "2026-06-03" }],
      saleEntries: [{ sale_no: "INV-5004", sale_entry_lines: [{ product_id: "p-coke", qty: -15 }] }],
    });
    expect(events[0].qty).toBe(-15);
  });

  it("skips invoices with no delivery date", () => {
    const { events, unlinkedInvoices } = build({
      invoices: [{ invoice_no: "5005", delivery_date: null, products: "1234567 Coca-Cola PET 1.5L×10" }],
    });
    expect(events).toEqual([]);
    expect(unlinkedInvoices).toEqual([]);
  });

  it("truncates a timestamp delivery_date to its date", () => {
    const { events } = build({
      invoices: [{ invoice_no: "5006", delivery_date: "2026-06-03T19:45:00+05:00" }],
      saleEntries: [{ sale_no: "INV-5006", sale_entry_lines: [{ product_id: "p-coke", qty: 5 }] }],
    });
    expect(events[0].date).toBe("2026-06-03");
  });
});

// ── Non-sale outflows ──────────────────────────────────────────────────────────────────

describe("damaged stock", () => {
  it("writes off damaged cases on their recorded_date, matched by product name", () => {
    const { events, unmatchedDamagedNames } = build({
      damagedStock: [{ product_name: "Coca-Cola PET 1.5L", quantity: 12, recorded_date: "2026-06-04" }],
    });
    expect(unmatchedDamagedNames).toEqual([]);
    expect(events).toEqual([
      { productId: "p-coke", date: "2026-06-04", kind: "adjustment_out", qty: 12, ref: "DAMAGED" },
    ]);
  });

  it("matches the product name case- and whitespace-insensitively, as the views do", () => {
    const { events } = build({
      damagedStock: [{ product_name: "  coca-cola pet 1.5l  ", quantity: 3, recorded_date: "2026-06-04" }],
    });
    expect(events[0]?.productId).toBe("p-coke");
  });

  it("writes off damaged cases at every claim status", () => {
    // warehouse_standard_levels (v62) and stock_balance_by_level (v37) both subtract damaged
    // stock regardless of status, so there is no status field to filter on here at all.
    const { events } = build({
      damagedStock: [
        { product_name: "Coca-Cola PET 1.5L", quantity: 1, recorded_date: "2026-06-02" },
        { product_name: "Coca-Cola PET 1.5L", quantity: 2, recorded_date: "2026-06-03" },
      ],
    });
    expect(events.map((e) => e.qty)).toEqual([1, 2]);
  });

  it("reports a damaged row whose name matches no product instead of dropping it", () => {
    const { events, unmatchedDamagedNames } = build({
      damagedStock: [{ product_name: "Mystery Drink", quantity: 9, recorded_date: "2026-06-04" }],
    });
    expect(events).toEqual([]);
    expect(unmatchedDamagedNames).toEqual(["Mystery Drink"]);
  });

  it("ignores damaged rows with no date or no quantity", () => {
    const { events } = build({
      damagedStock: [
        { product_name: "Coca-Cola PET 1.5L", quantity: 5, recorded_date: null },
        { product_name: "Coca-Cola PET 1.5L", quantity: 0, recorded_date: "2026-06-04" },
      ],
    });
    expect(events).toEqual([]);
  });
});

describe("waybill dispatches", () => {
  it("writes off dispatched quantity on the waybill date", () => {
    const { events } = build({
      waybillItems: [{ product_id: "p-coke", quantity: 40, waybills: { date: "2026-06-05" } }],
    });
    expect(events).toEqual([
      { productId: "p-coke", date: "2026-06-05", kind: "adjustment_out", qty: 40, ref: "WAYBILL" },
    ]);
  });

  it("reads the waybill date whether PostgREST embeds it as an object or an array", () => {
    const { events } = build({
      waybillItems: [{ product_id: "p-coke", quantity: 40, waybills: [{ date: "2026-06-05" }] }],
    });
    expect(events[0]?.date).toBe("2026-06-05");
  });

  it("ignores an item whose waybill carries no date", () => {
    const { events } = build({
      waybillItems: [{ product_id: "p-coke", quantity: 40, waybills: null }],
    });
    expect(events).toEqual([]);
  });
});

describe("leased empties", () => {
  it("writes off only the quantity still out on loan", () => {
    const { events } = build({
      leasedEmptyItems: [
        { product_id: "p-coke", quantity: 50, returned_qty: 20, leased_empties: { date: "2026-06-02" } },
      ],
    });
    expect(events).toEqual([
      { productId: "p-coke", date: "2026-06-02", kind: "adjustment_out", qty: 30, ref: "LEASED-EMPTIES" },
    ]);
  });

  it("emits nothing once everything has come back", () => {
    const { events } = build({
      leasedEmptyItems: [
        { product_id: "p-coke", quantity: 50, returned_qty: 50, leased_empties: { date: "2026-06-02" } },
        { product_id: "p-coke", quantity: 50, returned_qty: 70, leased_empties: { date: "2026-06-02" } },
      ],
    });
    expect(events).toEqual([]);
  });

  it("keeps the lease outstanding until the returned date", () => {
    const { events } = build({
      leasedEmptyItems: [
        {
          product_id: "p-shell",
          quantity: 4,
          returned_qty: 4,
          returned_date: "2026-06-26",
          leased_empties: { date: "2026-06-06" },
        },
      ],
    });
    expect(events).toEqual([
      { productId: "p-shell", date: "2026-06-06", kind: "adjustment_out", qty: 4, ref: "LEASED-EMPTIES" },
      { productId: "p-shell", date: "2026-06-26", kind: "adjustment_in", qty: 4, ref: "LEASED-EMPTIES-RETURN" },
    ]);
  });
});

describe("outflows against the ledger", () => {
  const stockReports = [
    { product_id: "p-coke", report_date: "2026-06-01", ph_case: 1000, amount: 910300 },
  ];

  it("reduces Closing Stock by the FIFO cost of every non-sale outflow", () => {
    const { events } = build({
      stockReports,
      damagedStock: [{ product_name: "Coca-Cola PET 1.5L", quantity: 10, recorded_date: "2026-06-02" }],
      waybillItems: [{ product_id: "p-coke", quantity: 15, waybills: { date: "2026-06-03" } }],
      leasedEmptyItems: [
        { product_id: "p-coke", quantity: 30, returned_qty: 5, leased_empties: { date: "2026-06-04" } },
      ],
    });
    const r = runFifo(events, { fromDate: "2026-06-01", toDate: "2026-06-05" });

    // 1000 counted in, 10 + 15 + 25 = 50 out, all drawn from the single 910.30 layer.
    expect(r.openingStockValue).toBeCloseTo(910300, 2);
    expect(r.closingStockValue).toBeCloseTo(950 * 910.3, 2);
    expect(r.writeOffsValue).toBeCloseTo(50 * 910.3, 2);

    // None of it is cost of goods *sold* — nothing was sold.
    expect(r.cogs).toBeCloseTo(0, 2);
    expect(r.identityDelta).toBeCloseTo(0, 2);
  });

  it("leaves the statement untouched when stock is written off that the ledger never received", () => {
    // No purchases and no stock report, so there is no cost basis to write off against. The
    // engine must not invent a loss: the shortfall is reported, and the write-off and the
    // unrecorded purchase that covers it cancel out of COGS and of the adjustments line.
    const { events } = build({
      waybillItems: [{ product_id: "p-coke", quantity: 15, waybills: { date: "2026-06-03" } }],
    });
    const r = runFifo(events, {
      fromDate: "2026-06-01",
      toDate: "2026-06-05",
      fallbackRates: new Map([["p-coke", 910.3]]),
    });

    expect(r.closingStockValue).toBeCloseTo(0, 2);
    expect(r.cogs).toBeCloseTo(0, 2);
    expect(r.diagnostics.shortfallQty).toBeCloseTo(15, 6);
    expect(r.writeOffsValue).toBeCloseTo(r.unrecordedPurchasesValue, 2);
    expect(r.identityDelta).toBeCloseTo(0, 2);
  });

  it("settles sales before write-offs when the same day cannot cover both", () => {
    // A sale carries revenue, so it gets the real cost; the write-off takes the shortfall.
    const { events } = build({
      stockReports: [
        { product_id: "p-coke", report_date: "2026-06-01", ph_case: 100, amount: 91030 },
      ],
      invoices: [{ invoice_no: "9001", delivery_date: "2026-06-01" }],
      saleEntries: [
        { sale_no: "9001", sale_entry_lines: [{ product_id: "p-coke", qty: 100 }] },
      ],
      damagedStock: [{ product_name: "Coca-Cola PET 1.5L", quantity: 20, recorded_date: "2026-06-01" }],
    });
    const r = runFifo(events, {
      fromDate: "2026-06-01",
      toDate: "2026-06-01",
      fallbackRates: new Map([["p-coke", 910.3]]),
    });

    expect(r.cogs).toBeCloseTo(91030, 2);
    expect(r.diagnostics.shortfallQty).toBeCloseTo(20, 6);
    expect(r.closingStockValue).toBeCloseTo(0, 2);
  });

  it("drops outflows for implied products along with everything else implied", () => {
    const { events } = build({
      damagedStock: [{ product_name: "RGB Shell", quantity: 10, recorded_date: "2026-06-02" }],
      waybillItems: [{ product_id: "p-shell", quantity: 10, waybills: { date: "2026-06-02" } }],
      leasedEmptyItems: [
        { product_id: "p-shell", quantity: 10, returned_qty: 0, leased_empties: { date: "2026-06-02" } },
      ],
    });
    expect(events).toHaveLength(3);

    const r = runFifo(events, {
      fromDate: "2026-06-01",
      toDate: "2026-06-05",
      excludedProductIds: classifyProducts(ALL_PRODUCTS).impliedProductIds,
    });
    expect(r.diagnostics.eventCount).toBe(3);
    expect(r.diagnostics.processedEventCount).toBe(0);
    expect(r.writeOffsValue).toBe(0);
    expect(r.closingStockValue).toBe(0);
  });
});

// ── End to end ─────────────────────────────────────────────────────────────────────────
//
// The same scenario the engine suite covers, this time entered the way the application
// stores it: a stock report row, two sell-in POs and five days of delivered invoices.

describe("database rows through to a statement", () => {
  const classification = classifyProducts(ALL_PRODUCTS);

  const input = {
    products: classification,
    stockReports: [{ product_id: "p-coke", report_date: "2026-06-01", ph_case: 1000, amount: 910300 }],
    sellInOrders: [
      {
        id: "o-1",
        po_no: "PO-1",
        transaction_date: "2026-06-01",
        status: "stock_arrived",
        sell_in_lines: [{ product_id: "p-coke", qty: 2000, rate: 910.3 }],
      },
      {
        id: "o-2",
        po_no: "PO-2",
        transaction_date: "2026-06-04",
        status: "billed",
        sell_in_lines: [{ product_id: "p-coke", qty: 2500, rate: 915 }],
      },
    ],
    saleEntries: [
      { sale_no: "INV-1", sale_entry_lines: [{ product_id: "p-coke", qty: 600 }] },
      { sale_no: "INV-2", sale_entry_lines: [{ product_id: "p-coke", qty: 400 }] },
      { sale_no: "INV-3", sale_entry_lines: [{ product_id: "p-coke", qty: 1000 }] },
      { sale_no: "INV-4", sale_entry_lines: [{ product_id: "p-coke", qty: 900 }] },
      { sale_no: "INV-5", sale_entry_lines: [{ product_id: "p-coke", qty: 1200 }] },
    ],
    invoices: [
      { invoice_no: "1", delivery_date: "2026-06-01" },
      { invoice_no: "2", delivery_date: "2026-06-02" },
      { invoice_no: "3", delivery_date: "2026-06-03" },
      { invoice_no: "4", delivery_date: "2026-06-04" },
      { invoice_no: "5", delivery_date: "2026-06-05" },
    ],
  };

  const statement = (fromDate: string, toDate: string) => {
    const { events } = buildFifoEvents(input);
    return runFifo(events, {
      fromDate,
      toDate,
      excludedProductIds: classification.impliedProductIds,
      fallbackRates: classification.fallbackRates,
    });
  };

  it("reproduces the specified figures for every window", () => {
    expect(statement("2026-06-01", "2026-06-01")).toMatchObject({
      openingStockValue: 910300,
      purchasesValue: 1820600,
      closingStockValue: 2184720,
      cogs: 546180,
    });
    expect(statement("2026-06-01", "2026-06-02")).toMatchObject({
      openingStockValue: 910300,
      purchasesValue: 1820600,
      closingStockValue: 1820600,
      cogs: 910300,
    });
    expect(statement("2026-06-01", "2026-06-03")).toMatchObject({
      openingStockValue: 910300,
      purchasesValue: 1820600,
      closingStockValue: 910300,
      cogs: 1820600,
    });
    expect(statement("2026-06-01", "2026-06-04")).toMatchObject({
      openingStockValue: 910300,
      purchasesValue: 4108100,
      closingStockValue: 2378530,
      cogs: 2639870,
    });
    expect(statement("2026-06-01", "2026-06-05")).toMatchObject({
      openingStockValue: 910300,
      purchasesValue: 4108100,
      closingStockValue: 1281000,
      cogs: 3737400,
    });
  });

  it("has no data gaps for a complete dataset", () => {
    const r = statement("2026-06-01", "2026-06-05");
    expect(r.diagnostics.shortfallQty).toBe(0);
    expect(r.unrecordedPurchasesValue).toBe(0);
    expect(r.adjustmentsInValue).toBe(0);
    expect(r.identityDelta).toBe(0);
  });
});
