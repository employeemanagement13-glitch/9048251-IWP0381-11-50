import { describe, expect, it } from "vitest";
import { runFifo, type FifoEvent, type FifoRunResult } from "./engine";

// ── Fixtures ───────────────────────────────────────────────────────────────────────────
//
// The primary suite replays the exact scenario the FIFO rewrite was specified against:
// one SKU, a seeded stock report, two purchase loads at different rates, and deliveries
// spread over five days. Every expected figure below was computed by hand first.

const COKE = "coke-1.5l";
const RATE_A = 910.3; // original CCBPL rate
const RATE_B = 915; // rate after the CCBPL price change

const count = (date: string, qty: number, value: number): FifoEvent => ({
  productId: COKE,
  date,
  kind: "opening_count",
  qty,
  value,
  ref: "STOCK-REPORT",
});

const load = (date: string, qty: number, rate: number, ref: string): FifoEvent => ({
  productId: COKE,
  date,
  kind: "purchase",
  qty,
  rate,
  ref,
});

const deliver = (date: string, qty: number, ref = "INV"): FifoEvent => ({
  productId: COKE,
  date,
  kind: "sale",
  qty,
  ref,
});

/** products.purchase_rate, which the engine must only ever use as a stock-out fallback. */
const fallbackRates = new Map([[COKE, RATE_A]]);

const run = (events: FifoEvent[], fromDate: string, toDate: string): FifoRunResult =>
  runFifo(events, { fromDate, toDate, fallbackRates });

/** Opening + Purchases + Adjustments + Unrecorded − WriteOffs − Closing must equal COGS. */
function expectBalanced(r: FifoRunResult) {
  const derived =
    r.openingStockValue +
    r.purchasesValue +
    r.adjustmentsInValue +
    r.unrecordedPurchasesValue -
    r.writeOffsValue -
    r.closingStockValue;
  expect(derived).toBeCloseTo(r.cogs, 6);
  // The ledger's own COGS measurement must agree with the derived figure; anything beyond
  // a couple of cents of rounding means the ledger and the statement have diverged.
  expect(Math.abs(r.identityDelta)).toBeLessThanOrEqual(0.05);
}

describe("specified scenario: single SKU through a CCBPL price change", () => {
  // Step 1 — a stock report seeds 1000 cases at 910.30 on 1 June, before that day's invoices.
  const afterCount = [count("2026-06-01", 1000, 1000 * RATE_A)];

  it("treats a stock count dated on fromDate as Opening Stock", () => {
    const r = run(afterCount, "2026-06-01", "2026-06-01");
    expect(r.openingStockValue).toBe(910300);
    expect(r.purchasesValue).toBe(0);
    expect(r.closingStockValue).toBe(910300);
    expect(r.cogs).toBe(0);
    expectBalanced(r);
  });

  it("treats a stock count dated after fromDate as an in-period adjustment, not Opening Stock", () => {
    const r = run(afterCount, "2026-05-30", "2026-06-01");
    expect(r.openingStockValue).toBe(0);
    expect(r.purchasesValue).toBe(0);
    expect(r.adjustmentsInValue).toBe(910300);
    expect(r.closingStockValue).toBe(910300);
    expect(r.cogs).toBe(0);
    expectBalanced(r);
  });

  it("values a period that ends before the stock count at zero", () => {
    const r = run(afterCount, "2026-05-01", "2026-05-01");
    expect(r.openingStockValue).toBe(0);
    expect(r.closingStockValue).toBe(0);
    expect(r.cogs).toBe(0);
    expectBalanced(r);
  });

  // Step 2 — 600 cases delivered on 1 June.
  const afterFirstDeliveries = [...afterCount, deliver("2026-06-01", 600)];

  it("consumes the opening batch for same-day deliveries", () => {
    const r = run(afterFirstDeliveries, "2026-06-01", "2026-06-01");
    expect(r.openingStockValue).toBe(910300);
    expect(r.purchasesValue).toBe(0);
    expect(r.cogs).toBe(546180); // 600 × 910.30
    expect(r.closingStockValue).toBe(364120); // 400 × 910.30
    expectBalanced(r);
  });

  // Step 3 — a 2000-case load arrives on 1 June, after the deliveries were entered.
  const afterFirstLoad = [...afterFirstDeliveries, load("2026-06-01", 2000, RATE_A, "PO-1")];

  it("counts a load dated on fromDate as a Purchase and makes it available the same day", () => {
    const r = run(afterFirstLoad, "2026-06-01", "2026-06-01");
    expect(r.openingStockValue).toBe(910300);
    expect(r.purchasesValue).toBe(1820600); // 2000 × 910.30
    expect(r.cogs).toBe(546180);
    expect(r.closingStockValue).toBe(2184720); // 2400 × 910.30
    expectBalanced(r);
  });

  // Steps 4 and 5 — 400 cases on 2 June, 1000 on 3 June.
  const afterThirdDay = [
    ...afterFirstLoad,
    deliver("2026-06-02", 400),
    deliver("2026-06-03", 1000),
  ];

  it("carries one opening position across a multi-day period", () => {
    const twoDays = run(afterThirdDay, "2026-06-01", "2026-06-02");
    expect(twoDays.openingStockValue).toBe(910300);
    expect(twoDays.purchasesValue).toBe(1820600);
    expect(twoDays.closingStockValue).toBe(1820600); // 2000 × 910.30
    expect(twoDays.cogs).toBe(910300);
    expectBalanced(twoDays);

    const threeDays = run(afterThirdDay, "2026-06-01", "2026-06-03");
    expect(threeDays.openingStockValue).toBe(910300);
    expect(threeDays.purchasesValue).toBe(1820600);
    expect(threeDays.closingStockValue).toBe(910300); // 1000 × 910.30
    expect(threeDays.cogs).toBe(1820600);
    expectBalanced(threeDays);
  });

  // Step 6 — CCBPL raises the rate and the user updates the Products menu. Nothing may move
  // until a load actually arrives at the new rate.
  it("ignores a products.purchase_rate change until a load arrives at the new rate", () => {
    const before = run(afterThirdDay, "2026-06-01", "2026-06-03");
    const after = runFifo(afterThirdDay, {
      fromDate: "2026-06-01",
      toDate: "2026-06-03",
      fallbackRates: new Map([[COKE, RATE_B]]),
    });
    expect(after.openingStockValue).toBe(before.openingStockValue);
    expect(after.purchasesValue).toBe(before.purchasesValue);
    expect(after.closingStockValue).toBe(before.closingStockValue);
    expect(after.cogs).toBe(before.cogs);
  });

  // Step 7 — 2500 cases arrive on 4 June at the new 915 rate.
  const afterSecondLoad = [...afterThirdDay, load("2026-06-04", 2500, RATE_B, "PO-2")];

  it("holds two rates side by side without revaluing the older layer", () => {
    const r = run(afterSecondLoad, "2026-06-01", "2026-06-04");
    expect(r.openingStockValue).toBe(910300);
    expect(r.purchasesValue).toBe(4108100); // 1,820,600 + 2500 × 915
    expect(r.closingStockValue).toBe(3197800); // 1000 × 910.30 + 2500 × 915
    expectBalanced(r);
  });

  // Step 8 — 900 cases delivered on 4 June, drawn from the older 910.30 layer first.
  const afterFourthDay = [...afterSecondLoad, deliver("2026-06-04", 900)];

  it("drains the oldest layer first when two rates are in stock", () => {
    const r = run(afterFourthDay, "2026-06-01", "2026-06-04");
    expect(r.openingStockValue).toBe(910300);
    expect(r.purchasesValue).toBe(4108100);
    expect(r.closingStockValue).toBe(2378530); // 100 × 910.30 + 2500 × 915
    expect(r.cogs).toBe(2639870); // 2900 × 910.30
    expectBalanced(r);
  });

  // Step 9 — 1200 cases on 5 June: the last 100 old cases, then 1100 at the new rate.
  const fullHistory = [...afterFourthDay, deliver("2026-06-05", 1200)];

  it("spans a layer boundary mid-delivery", () => {
    const r = run(fullHistory, "2026-06-01", "2026-06-05");
    expect(r.openingStockValue).toBe(910300);
    expect(r.purchasesValue).toBe(4108100);
    expect(r.closingStockValue).toBe(1281000); // 1400 × 915
    expect(r.cogs).toBe(3737400); // 3000 × 910.30 + 1100 × 915
    expectBalanced(r);
  });

  // ── The regression that motivated the rewrite ─────────────────────────────────────────
  // Single-day filters used to drift because Opening Stock and COGS were measured on two
  // separate ledger clones. These two properties make that class of bug impossible to
  // reintroduce unnoticed.

  const days = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"];

  it("chains day by day: each day's Closing Stock is the next day's Opening Stock", () => {
    const results = days.map((d) => run(fullHistory, d, d));
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i + 1].openingStockValue).toBeCloseTo(results[i].closingStockValue, 2);
    }
    expect(results[0].openingStockValue).toBe(910300);
    expect(results[results.length - 1].closingStockValue).toBe(1281000);
    results.forEach(expectBalanced);
  });

  it("sums single-day COGS to the whole-period COGS", () => {
    const perDay = days.map((d) => run(fullHistory, d, d).cogs);
    expect(perDay).toEqual([546180, 364120, 910300, 819270, 1097530]);
    const total = perDay.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(run(fullHistory, "2026-06-01", "2026-06-05").cogs, 2);
  });

  it("reports a matching per-product breakdown", () => {
    const r = run(fullHistory, "2026-06-01", "2026-06-05");
    expect(r.byProduct).toHaveLength(1);
    const p = r.byProduct[0];
    expect(p.productId).toBe(COKE);
    expect(p.openingQty).toBe(1000);
    expect(p.purchaseQty).toBe(4500);
    expect(p.soldQty).toBe(4100);
    expect(p.closingQty).toBe(1400);
    expect(p.closingValue).toBe(1281000);
    expect(p.shortfallQty).toBe(0);
  });
});

// ── Intra-day ordering ─────────────────────────────────────────────────────────────────

describe("intra-day ordering", () => {
  it("makes a same-day load available to that day's deliveries regardless of input order", () => {
    const events: FifoEvent[] = [
      deliver("2026-06-01", 500),
      load("2026-06-01", 500, 100, "PO-1"),
    ];
    const r = run(events, "2026-06-01", "2026-06-01");
    expect(r.purchasesValue).toBe(50000);
    expect(r.cogs).toBe(50000);
    expect(r.closingStockValue).toBe(0);
    expect(r.diagnostics.shortfallQty).toBe(0);
    expectBalanced(r);
  });

  it("applies a stock count before the same day's load", () => {
    const events: FifoEvent[] = [
      load("2026-06-01", 10, 200, "PO-1"),
      count("2026-06-01", 10, 1000),
      deliver("2026-06-01", 10),
    ];
    const r = run(events, "2026-06-01", "2026-06-01");
    expect(r.openingStockValue).toBe(1000); // the count, not the load
    expect(r.purchasesValue).toBe(2000);
    expect(r.cogs).toBe(1000); // counted cases at 100 are consumed first
    expect(r.closingStockValue).toBe(2000);
    expectBalanced(r);
  });

  it("orders by explicit seq within the same date and kind", () => {
    const events: FifoEvent[] = [
      { productId: COKE, date: "2026-06-01", kind: "purchase", qty: 10, rate: 50, seq: 2, ref: "B" },
      { productId: COKE, date: "2026-06-01", kind: "purchase", qty: 10, rate: 10, seq: 1, ref: "A" },
      deliver("2026-06-01", 10),
    ];
    const r = run(events, "2026-06-01", "2026-06-01");
    expect(r.cogs).toBe(100); // seq 1 (rate 10) consumed first
    expect(r.closingStockValue).toBe(500);
    expectBalanced(r);
  });
});

// ── Precision ──────────────────────────────────────────────────────────────────────────

describe("precision", () => {
  it("conserves value exactly for a non-terminating unit rate", () => {
    // A stock report records a 1000.00 total over 3 cases: 333.333... per case.
    const events: FifoEvent[] = [
      count("2026-06-01", 3, 1000),
      deliver("2026-06-02", 1),
      deliver("2026-06-03", 1),
      deliver("2026-06-04", 1),
    ];
    const r = run(events, "2026-06-02", "2026-06-04");
    expect(r.openingStockValue).toBe(1000);
    expect(r.closingStockValue).toBe(0);
    expect(r.cogs).toBe(1000);
    expectBalanced(r);
  });

  it("keeps a part-drained layer's value and quantity consistent", () => {
    const events: FifoEvent[] = [count("2026-06-01", 7, 100), deliver("2026-06-02", 2)];
    const r = run(events, "2026-06-02", "2026-06-02");
    expect(r.cogs + r.closingStockValue).toBeCloseTo(100, 6);
    expect(r.byProduct[0].closingQty).toBe(5);
    expectBalanced(r);
  });

  it("stays accurate across a hundred thousand small deliveries", () => {
    const events: FifoEvent[] = [count("2026-01-01", 100000, 100000 * 0.07)];
    for (let i = 0; i < 100000; i++) events.push(deliver("2026-02-01", 1, `INV-${i}`));
    const r = runFifo(events, { fromDate: "2026-02-01", toDate: "2026-02-01" });
    expect(r.openingStockValue).toBe(7000);
    expect(r.closingStockValue).toBe(0);
    expect(r.cogs).toBe(7000);
    expectBalanced(r);
  });
});

// ── Data-integrity handling ────────────────────────────────────────────────────────────

describe("stock-out handling", () => {
  it("reports goods sold that were never recorded as purchased instead of unbalancing", () => {
    const events: FifoEvent[] = [count("2026-06-01", 10, 1000), deliver("2026-06-02", 25)];
    const r = run(events, "2026-06-02", "2026-06-02");
    expect(r.openingStockValue).toBe(1000);
    expect(r.closingStockValue).toBe(0);
    // 15 cases had no layer; they are valued at products.purchase_rate and surfaced.
    expect(r.unrecordedPurchasesValue).toBeCloseTo(15 * RATE_A, 2);
    expect(r.diagnostics.shortfallQty).toBe(15);
    expect(r.diagnostics.shortfalls).toHaveLength(1);
    expect(r.diagnostics.shortfalls[0]).toMatchObject({ productId: COKE, qty: 15, inPeriod: true });
    expectBalanced(r);
  });

  it("does not let a pre-period stock-out inflate the current period", () => {
    const events: FifoEvent[] = [deliver("2026-05-01", 10), count("2026-06-01", 5, 500)];
    const r = run(events, "2026-06-01", "2026-06-01");
    expect(r.openingStockValue).toBe(500);
    expect(r.unrecordedPurchasesValue).toBe(0);
    expect(r.diagnostics.shortfalls[0].inPeriod).toBe(false);
    expectBalanced(r);
  });

  it("caps the shortfall records it keeps", () => {
    const events: FifoEvent[] = [];
    for (let i = 0; i < 50; i++) events.push(deliver("2026-06-01", 1, `INV-${i}`));
    const r = runFifo(events, {
      fromDate: "2026-06-01",
      toDate: "2026-06-01",
      fallbackRates,
      maxShortfallRecords: 10,
    });
    expect(r.diagnostics.shortfalls).toHaveLength(10);
    expect(r.diagnostics.shortfallsTruncated).toBe(true);
    expect(r.diagnostics.shortfallQty).toBe(50);
    expectBalanced(r);
  });

  it("assigns zero cost when no fallback rate is known", () => {
    const r = runFifo([deliver("2026-06-01", 10)], {
      fromDate: "2026-06-01",
      toDate: "2026-06-01",
    });
    expect(r.cogs).toBe(0);
    expect(r.diagnostics.shortfallQty).toBe(10);
    expectBalanced(r);
  });
});

// ── Product classification ─────────────────────────────────────────────────────────────

describe("product classification", () => {
  it("drops excluded products from the ledger entirely", () => {
    const events: FifoEvent[] = [
      { productId: "implied-shell", date: "2026-06-01", kind: "purchase", qty: 500, rate: 120 },
      { productId: "implied-shell", date: "2026-06-02", kind: "sale", qty: 100 },
      count("2026-06-01", 10, 1000),
    ];
    const r = runFifo(events, {
      fromDate: "2026-06-01",
      toDate: "2026-06-02",
      excludedProductIds: new Set(["implied-shell"]),
    });
    expect(r.purchasesValue).toBe(0);
    expect(r.closingStockValue).toBe(1000);
    expect(r.byProduct.map((p) => p.productId)).toEqual([COKE]);
    expectBalanced(r);
  });

  it("costs free scheme goods at nothing on the strength of their own zero rate", () => {
    const promo = "promo-free";
    const events: FifoEvent[] = [
      { productId: promo, date: "2026-06-01", kind: "purchase", qty: 500, rate: 0, ref: "PO-1" },
      { productId: promo, date: "2026-06-02", kind: "sale", qty: 200 },
    ];
    const r = runFifo(events, { fromDate: "2026-06-01", toDate: "2026-06-02" });
    expect(r.purchasesValue).toBe(0);
    expect(r.cogs).toBe(0);
    expect(r.closingStockValue).toBe(0);
    expect(r.byProduct[0].closingQty).toBe(300);
    expectBalanced(r);
  });

  it("costs a promotional pack that was genuinely billed, with no SKU able to opt out", () => {
    // A hardcoded zero-cost SKU list used to discard the billed rate here, which understated
    // Opening Stock and COGS by the pack's real value. Cost now always comes from the data.
    const promo = "promo-priced";
    const events: FifoEvent[] = [
      { productId: promo, date: "2026-06-01", kind: "purchase", qty: 20, rate: 973.87, ref: "PO-1" },
      { productId: promo, date: "2026-06-02", kind: "sale", qty: 7 },
    ];
    const r = runFifo(events, { fromDate: "2026-06-01", toDate: "2026-06-02" });
    expect(r.purchasesValue).toBeCloseTo(19477.4, 2);
    expect(r.cogs).toBeCloseTo(6817.09, 2);
    expect(r.closingStockValue).toBeCloseTo(12660.31, 2);
    expectBalanced(r);
  });
});

// ── Returns ────────────────────────────────────────────────────────────────────────────

describe("returns", () => {
  it("credits a customer return back against COGS", () => {
    const events: FifoEvent[] = [
      count("2026-06-01", 100, 10000),
      deliver("2026-06-01", 40),
      deliver("2026-06-02", -10, "INV-RETURN"),
    ];
    const r = run(events, "2026-06-01", "2026-06-02");
    expect(r.cogs).toBe(3000); // 40 out at 100, 10 back at 100
    expect(r.closingStockValue).toBe(7000);
    expect(r.byProduct[0].closingQty).toBe(70);
    expectBalanced(r);
  });

  it("removes stock and reduces Purchases for a return to the supplier", () => {
    const events: FifoEvent[] = [
      load("2026-06-01", 100, 50, "PO-1"),
      { productId: COKE, date: "2026-06-02", kind: "purchase", qty: -20, ref: "PO-1-RETURN" },
    ];
    const r = run(events, "2026-06-01", "2026-06-02");
    expect(r.purchasesValue).toBe(4000); // 5000 − 20 × 50
    expect(r.closingStockValue).toBe(4000);
    expect(r.cogs).toBe(0);
    expectBalanced(r);
  });
});

// ── Write-offs ─────────────────────────────────────────────────────────────────────────

describe("write-offs", () => {
  it("removes damaged stock at FIFO cost without charging it to COGS", () => {
    const events: FifoEvent[] = [
      count("2026-06-01", 100, 10000),
      { productId: COKE, date: "2026-06-02", kind: "adjustment_out", qty: 5, ref: "DAMAGED" },
      deliver("2026-06-02", 10),
    ];
    const r = run(events, "2026-06-01", "2026-06-02");
    expect(r.cogs).toBe(1000);
    expect(r.writeOffsValue).toBe(500);
    expect(r.closingStockValue).toBe(8500);
    expectBalanced(r);
  });
});

// ── Robustness ─────────────────────────────────────────────────────────────────────────

describe("robustness", () => {
  it("ignores events dated after toDate", () => {
    const events: FifoEvent[] = [count("2026-06-01", 10, 1000), load("2026-07-01", 100, 50, "PO-FUTURE")];
    const r = run(events, "2026-06-01", "2026-06-30");
    expect(r.purchasesValue).toBe(0);
    expect(r.closingStockValue).toBe(1000);
    expectBalanced(r);
  });

  it("skips malformed and empty events and counts them", () => {
    const events: FifoEvent[] = [
      count("2026-06-01", 10, 1000),
      { productId: COKE, date: "not-a-date", kind: "purchase", qty: 5, rate: 10 },
      { productId: "", date: "2026-06-01", kind: "purchase", qty: 5, rate: 10 },
      { productId: COKE, date: "2026-06-01", kind: "purchase", qty: 0, rate: 10 },
    ];
    const r = run(events, "2026-06-01", "2026-06-01");
    expect(r.closingStockValue).toBe(1000);
    expect(r.diagnostics.skippedEventCount).toBe(2);
    expect(r.diagnostics.processedEventCount).toBe(1);
    expectBalanced(r);
  });

  it("accepts full ISO timestamps by truncating to the date", () => {
    const events: FifoEvent[] = [
      { productId: COKE, date: "2026-06-01T18:30:00.000Z", kind: "purchase", qty: 10, rate: 10, ref: "PO" },
    ];
    const r = run(events, "2026-06-01", "2026-06-01");
    expect(r.purchasesValue).toBe(100);
    expect(r.closingStockValue).toBe(100);
  });

  it("produces identical results whatever order the events arrive in", () => {
    const events: FifoEvent[] = [
      count("2026-06-01", 100, 10000),
      load("2026-06-02", 50, 120, "PO-1"),
      deliver("2026-06-02", 70),
      load("2026-06-03", 30, 130, "PO-2"),
      deliver("2026-06-03", 40),
      { productId: COKE, date: "2026-06-03", kind: "adjustment_out", qty: 5, ref: "DAMAGED" },
    ];
    const baseline = run(events, "2026-06-02", "2026-06-03");
    const shuffled = [...events].reverse();
    const r = run(shuffled, "2026-06-02", "2026-06-03");
    expect(r).toEqual(baseline);
  });

  it("rejects an inverted date range", () => {
    expect(() => run([], "2026-06-05", "2026-06-01")).toThrow(/must not be after/);
  });

  it("rejects a non-ISO period", () => {
    expect(() => run([], "01/06/2026", "2026-06-01")).toThrow(/YYYY-MM-DD/);
  });

  it("handles an empty event stream", () => {
    const r = run([], "2026-06-01", "2026-06-30");
    expect(r.openingStockValue).toBe(0);
    expect(r.closingStockValue).toBe(0);
    expect(r.cogs).toBe(0);
    expect(r.byProduct).toEqual([]);
  });
});

// ── Many products ──────────────────────────────────────────────────────────────────────

describe("multi-product aggregation", () => {
  it("totals independent per-product ledgers", () => {
    const events: FifoEvent[] = [];
    for (let p = 0; p < 50; p++) {
      const id = `p-${p}`;
      events.push({ productId: id, date: "2026-06-01", kind: "opening_count", qty: 100, value: 100 * (p + 1) });
      events.push({ productId: id, date: "2026-06-02", kind: "purchase", qty: 50, rate: p + 2, ref: "PO" });
      events.push({ productId: id, date: "2026-06-03", kind: "sale", qty: 120 });
    }
    const r = runFifo(events, { fromDate: "2026-06-02", toDate: "2026-06-03" });

    // Opening: 100 cases of each product at (p+1). Purchases: 50 at (p+2).
    // Sales of 120 take all 100 opening cases plus 20 purchased cases.
    let opening = 0;
    let purchases = 0;
    let cogs = 0;
    let closing = 0;
    for (let p = 0; p < 50; p++) {
      opening += 100 * (p + 1);
      purchases += 50 * (p + 2);
      cogs += 100 * (p + 1) + 20 * (p + 2);
      closing += 30 * (p + 2);
    }
    expect(r.openingStockValue).toBeCloseTo(opening, 2);
    expect(r.purchasesValue).toBeCloseTo(purchases, 2);
    expect(r.cogs).toBeCloseTo(cogs, 2);
    expect(r.closingStockValue).toBeCloseTo(closing, 2);
    expect(r.byProduct).toHaveLength(50);
    expectBalanced(r);
  });
});

// ── Property test ──────────────────────────────────────────────────────────────────────
//
// The hand-written cases above prove specific numbers. This proves the invariant that makes
// the statement trustworthy — the identity balances for arbitrary histories and arbitrary
// reporting windows — which is what silently broke in the previous two-clone design.

describe("invariants under randomised histories", () => {
  function mulberry32(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const KINDS: FifoEvent["kind"][] = [
    "opening_count",
    "purchase",
    "adjustment_in",
    "sale",
    "adjustment_out",
  ];

  it("balances for 300 random histories and windows", () => {
    for (let trial = 0; trial < 300; trial++) {
      const rnd = mulberry32(trial * 7919 + 13);
      const productIds = ["a", "b", "c"];
      const rates = new Map(productIds.map((p) => [p, Math.round(rnd() * 90000) / 100 + 1]));

      const events: FifoEvent[] = [];
      const eventCount = 5 + Math.floor(rnd() * 60);
      for (let i = 0; i < eventCount; i++) {
        const day = 1 + Math.floor(rnd() * 28);
        const kind = KINDS[Math.floor(rnd() * KINDS.length)];
        const qty = Math.round((rnd() * 400 + 1) * 100) / 100;
        const signed = kind === "sale" && rnd() < 0.1 ? -qty : qty;
        const rate = Math.round(rnd() * 120000) / 100;
        events.push({
          productId: productIds[Math.floor(rnd() * productIds.length)],
          date: `2026-06-${String(day).padStart(2, "0")}`,
          kind,
          qty: signed,
          // Half the inflows carry a total value, half a unit rate, mirroring stock reports
          // versus purchase orders.
          ...(rnd() < 0.5 ? { value: Math.round(qty * rate * 100) / 100 } : { rate }),
          ref: `E-${i}`,
        });
      }

      const fromDay = 1 + Math.floor(rnd() * 28);
      const toDay = fromDay + Math.floor(rnd() * (29 - fromDay));
      const fromDate = `2026-06-${String(fromDay).padStart(2, "0")}`;
      const toDate = `2026-06-${String(toDay).padStart(2, "0")}`;

      const r = runFifo(events, { fromDate, toDate, fallbackRates: rates });

      const derived =
        r.openingStockValue +
        r.purchasesValue +
        r.adjustmentsInValue +
        r.unrecordedPurchasesValue -
        r.writeOffsValue -
        r.closingStockValue;

      expect(derived, `trial ${trial} identity`).toBeCloseTo(r.cogs, 6);
      expect(Math.abs(r.identityDelta), `trial ${trial} ledger vs statement`).toBeLessThanOrEqual(0.05);
      expect(r.openingStockValue, `trial ${trial} opening`).toBeGreaterThanOrEqual(0);
      expect(r.closingStockValue, `trial ${trial} closing`).toBeGreaterThanOrEqual(0);
    }
  });

  it("chains contiguous windows: closing of one window opens the next", () => {
    const rnd = mulberry32(42);
    const events: FifoEvent[] = [];
    for (let i = 0; i < 400; i++) {
      const day = 1 + Math.floor(rnd() * 20);
      const kind = rnd() < 0.4 ? "purchase" : "sale";
      events.push({
        productId: `p-${Math.floor(rnd() * 5)}`,
        date: `2026-06-${String(day).padStart(2, "0")}`,
        kind,
        qty: Math.round((rnd() * 100 + 1) * 100) / 100,
        rate: Math.round(rnd() * 50000) / 100,
        ref: `E-${i}`,
      });
    }
    const rates = new Map(Array.from({ length: 5 }, (_, i) => [`p-${i}`, 100 + i] as const));

    let previousClosing: number | null = null;
    let cogsTotal = 0;
    for (let day = 1; day <= 20; day++) {
      const d = `2026-06-${String(day).padStart(2, "0")}`;
      const r = runFifo(events, { fromDate: d, toDate: d, fallbackRates: rates });
      if (previousClosing !== null) {
        expect(r.openingStockValue, `day ${day} opening`).toBeCloseTo(previousClosing, 2);
      }
      previousClosing = r.closingStockValue;
      cogsTotal += r.cogs;
    }

    const whole = runFifo(events, { fromDate: "2026-06-01", toDate: "2026-06-20", fallbackRates: rates });
    expect(cogsTotal).toBeCloseTo(whole.cogs, 1);
    expect(previousClosing).toBeCloseTo(whole.closingStockValue, 2);
  });
});

// ── Scale ──────────────────────────────────────────────────────────────────────────────

describe("scale", () => {
  it("replays 400,000 events in a single pass", () => {
    const events: FifoEvent[] = [];
    const products = 2000;
    for (let p = 0; p < products; p++) {
      events.push({
        productId: `p-${p}`,
        date: "2026-01-01",
        kind: "opening_count",
        qty: 1000,
        value: 1000 * 100,
      });
    }
    // 200 days of deliveries and loads across every product.
    for (let day = 1; day <= 100; day++) {
      const date = `2026-04-${String((day % 30) + 1).padStart(2, "0")}`;
      for (let p = 0; p < products; p++) {
        events.push({ productId: `p-${p}`, date, kind: "purchase", qty: 10, rate: 100, ref: "PO" });
        events.push({ productId: `p-${p}`, date, kind: "sale", qty: 10, ref: "INV" });
      }
    }
    expect(events.length).toBeGreaterThan(400000);

    const started = Date.now();
    const r = runFifo(events, { fromDate: "2026-04-10", toDate: "2026-04-20" });
    const elapsed = Date.now() - started;

    expect(r.byProduct).toHaveLength(products);
    expect(r.diagnostics.shortfallQty).toBe(0);
    expectBalanced(r);
    // A quadratic implementation does not finish this in anything like the time budget.
    expect(elapsed).toBeLessThan(15000);
  }, 60000);
});
