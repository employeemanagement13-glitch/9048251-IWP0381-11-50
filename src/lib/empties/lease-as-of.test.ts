import { describe, expect, it } from "vitest";
import { leaseOutstandingAsOf, leaseReturnedQtyAsOf } from "./lease-as-of";

const LEASE = {
  quantity: 4,
  returnedQty: 4,
  returnedDate: "2026-06-26",
  leaseDate: "2026-06-06",
};

describe("leaseReturnedQtyAsOf", () => {
  it("ignores a return that has not happened yet", () => {
    expect(leaseReturnedQtyAsOf(4, "2026-06-26", "2026-06-25")).toBe(0);
  });

  it("counts a return on and after the returned date", () => {
    expect(leaseReturnedQtyAsOf(4, "2026-06-26", "2026-06-26")).toBe(4);
    expect(leaseReturnedQtyAsOf(4, "2026-06-26", "2026-07-01")).toBe(4);
  });

  it("nets immediately when returned_date is missing (legacy rows)", () => {
    expect(leaseReturnedQtyAsOf(4, null, "2026-06-25")).toBe(4);
  });
});

describe("leaseOutstandingAsOf", () => {
  it("keeps 4 Plastic Separators leased until 25/06 and clears them on 26/06", () => {
    expect(leaseOutstandingAsOf({ ...LEASE, asOfDate: "2026-06-25" })).toBe(4);
    expect(leaseOutstandingAsOf({ ...LEASE, asOfDate: "2026-06-26" })).toBe(0);
  });

  it("does not count a lease that has not started yet", () => {
    expect(leaseOutstandingAsOf({ ...LEASE, asOfDate: "2026-06-05" })).toBe(0);
  });

  it("counts the full quantity on the lease date before any return", () => {
    expect(leaseOutstandingAsOf({ ...LEASE, asOfDate: "2026-06-06" })).toBe(4);
  });

  it("supports multiple dated returns (PS x8 example)", () => {
    const returns = [
      { date: "2026-06-06", quantity: 6 },
      { date: "2026-06-09", quantity: 2 },
    ];
    const base = {
      quantity: 8,
      leaseDate: "2026-05-04",
      returns,
      returnedQty: 0,
      returnedDate: null as string | null,
    };
    expect(leaseOutstandingAsOf({ ...base, asOfDate: "2026-06-05" })).toBe(8);
    expect(leaseOutstandingAsOf({ ...base, asOfDate: "2026-06-06" })).toBe(2);
    expect(leaseOutstandingAsOf({ ...base, asOfDate: "2026-06-08" })).toBe(2);
    expect(leaseOutstandingAsOf({ ...base, asOfDate: "2026-06-09" })).toBe(0);
  });
});
