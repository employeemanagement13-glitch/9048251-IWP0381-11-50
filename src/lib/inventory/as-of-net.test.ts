import { describe, expect, it } from "vitest";
import { warehouseNetAsOf } from "./as-of-net";

describe("warehouseNetAsOf", () => {
  it("equals cumulative stock whether or not a From date splits the period", () => {
    const allIn = 130;
    const allOut = 100;
    const priorIn = 50;
    const priorOut = 100;
    const periodIn = 80;
    const periodOut = 0;

    expect(warehouseNetAsOf(0, 0, allIn, allOut)).toBe(30);
    expect(warehouseNetAsOf(priorIn, priorOut, periodIn, periodOut)).toBe(30);
  });

  it("does not overstate Net when prior out exceeds prior in", () => {
    // Clamping opening to 0 then adding period IN would yield 80. True stock is 30.
    expect(warehouseNetAsOf(50, 100, 80, 0)).toBe(30);
  });

  it("never goes negative", () => {
    expect(warehouseNetAsOf(10, 40, 5, 20)).toBe(0);
  });
});
