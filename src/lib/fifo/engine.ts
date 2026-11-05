/**
 * Perpetual FIFO inventory engine.
 * ================================
 *
 * Pure, deterministic and I/O-free so it can be unit-tested exhaustively and reused by
 * the Income Statement, the Balance Sheet, stock reports and any future valuation screen.
 *
 * ── The model ──────────────────────────────────────────────────────────────────────────
 *
 * Everything that moves inventory is a single `FifoEvent`. The engine replays the whole
 * event stream once, in chronological order, maintaining one FIFO layer queue per product.
 * Two measurements are taken from that single replay:
 *
 *   • Opening Stock — total layer value at the instant the period starts
 *   • Closing Stock — total layer value after the last event dated on or before `toDate`
 *
 * Because both come from the same ledger, the accounting identity
 *
 *      Closing = Opening + Purchases + AdjustmentsIn + UnrecordedPurchases
 *                        − COGS − WriteOffs
 *
 * holds by construction rather than by convention. There is no second "clone" of the
 * ledger that can drift away from the first, and Closing Stock is measured rather than
 * back-solved from COGS.
 *
 * ── Intra-day ordering ─────────────────────────────────────────────────────────────────
 *
 * Dates have no time component, so events on the same day are ordered by `kind`:
 *
 *   0  opening_count   physical stock count — effective at the START of its date
 *   1  purchase        goods arrive from the supplier
 *   2  adjustment_in   returns from shops, found stock, corrections
 *   3  sale            delivered invoices
 *   4  adjustment_out  damage, shrinkage, write-offs, dispatch of empties
 *
 * Rank 0 sitting before the period boundary is what makes a stock count dated exactly on
 * `fromDate` part of Opening Stock, while a purchase dated on `fromDate` is a Purchase of
 * the period. Goods must arrive before they can be delivered, hence purchases precede
 * sales within a day. `seq` breaks ties inside one rank; equal keys keep input order.
 *
 * ── Why layers carry `value` as well as `qty` ──────────────────────────────────────────
 *
 * A layer's unit rate is frequently a non-terminating decimal (a stock report records a
 * total `amount` over a case count, e.g. 1000 / 3). Tracking the layer's remaining *value*
 * alongside its remaining *quantity* — and releasing the exact remaining value when a layer
 * is fully drained — means consumed cost and remaining cost always re-add to the original
 * value with no floating-point residue, however many partial draws occur.
 */

// ── Event model ────────────────────────────────────────────────────────────────────────

export type FifoEventKind =
  | "opening_count"
  | "purchase"
  | "adjustment_in"
  | "sale"
  | "adjustment_out";

const KIND_RANK: Record<FifoEventKind, number> = {
  opening_count: 0,
  purchase: 1,
  adjustment_in: 2,
  sale: 3,
  adjustment_out: 4,
};

/** Events at this rank are effective at the start of their date, i.e. before the period opens. */
const START_OF_DAY_RANK = 0;

export interface FifoEvent {
  productId: string;
  /** `YYYY-MM-DD`. Longer ISO strings are truncated to the date part. */
  date: string;
  kind: FifoEventKind;
  /**
   * Movement magnitude in the product's stock unit (cases).
   * A negative `sale` qty is a customer return and restores stock.
   */
  qty: number;
  /** Per-unit cost. Required for inflows unless `value` is given. */
  rate?: number;
  /**
   * Exact total cost of an inflow. Takes precedence over `qty * rate` and should be used
   * whenever the source data stores a total rather than a unit rate (stock reports do).
   */
  value?: number;
  /** Audit label — PO number, invoice number, "STOCK-REPORT". */
  ref?: string;
  /** Tie-break within the same date and kind. */
  seq?: number;
}

export interface FifoRunOptions {
  /** Inclusive period start, `YYYY-MM-DD`. */
  fromDate: string;
  /** Inclusive period end, `YYYY-MM-DD`. */
  toDate: string;
  /**
   * Products kept out of the ledger entirely — implied/empties SKUs that have no cost
   * basis. Their events are dropped and they never appear in any total.
   */
  excludedProductIds?: ReadonlySet<string>;
  /**
   * Last-resort unit cost used when a sale draws more stock than the ledger holds.
   * Normally `products.purchase_rate`.
   */
  fallbackRates?: ReadonlyMap<string, number>;
  /** Cap on how many shortfall records to keep for diagnostics. Default 200. */
  maxShortfallRecords?: number;
}

// ── Results ────────────────────────────────────────────────────────────────────────────

export interface FifoShortfall {
  productId: string;
  date: string;
  ref: string;
  /** Quantity that had no FIFO layer to draw from. */
  qty: number;
  /** Cost assigned to that quantity from `fallbackRates`. */
  value: number;
  /** Whether the shortfall happened inside the reporting period. */
  inPeriod: boolean;
}

export interface FifoProductPosition {
  productId: string;
  openingQty: number;
  openingValue: number;
  purchaseQty: number;
  purchaseValue: number;
  soldQty: number;
  cogs: number;
  closingQty: number;
  closingValue: number;
  shortfallQty: number;
}

export interface FifoRunResult {
  fromDate: string;
  toDate: string;

  /** FIFO value of stock held at the instant the period opened. */
  openingStockValue: number;
  /** Value of `purchase` inflows dated inside the period. */
  purchasesValue: number;
  /** Value of `opening_count` / `adjustment_in` inflows dated inside the period. */
  adjustmentsInValue: number;
  /**
   * Cost assigned to in-period sales that drew on stock the ledger never received.
   * A non-zero figure means POs or stock counts are missing from the data, not that the
   * arithmetic is wrong — the value is reported so the gap is visible instead of silently
   * unbalancing the statement.
   */
  unrecordedPurchasesValue: number;
  /** FIFO cost of `adjustment_out` events dated inside the period (damage, shrinkage). */
  writeOffsValue: number;
  /** FIFO value of stock still held at the end of `toDate`. */
  closingStockValue: number;
  /**
   * Cost of goods sold for the period, derived from the rounded figures above so the
   * identity shown on screen balances to the cent.
   */
  cogs: number;
  /** COGS as measured directly from the ledger, before rounding reconciliation. */
  measuredCogs: number;
  /** FIFO cost of sales before `fromDate`. Informational. */
  prePeriodCogs: number;

  /** `measuredCogs − cogs`. Pure rounding noise; a large value means a real defect. */
  identityDelta: number;

  byProduct: FifoProductPosition[];

  diagnostics: {
    eventCount: number;
    processedEventCount: number;
    skippedEventCount: number;
    shortfalls: FifoShortfall[];
    shortfallQty: number;
    /** True when more shortfalls occurred than `maxShortfallRecords` kept. */
    shortfallsTruncated: boolean;
  };
}

// ── Numeric helpers ────────────────────────────────────────────────────────────────────

/** Quantities are stored as NUMERIC(12,2); anything below this is noise, not stock. */
const QTY_EPSILON = 1e-6;

export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  // Scale-then-round is wrong for values like 1.005 whose binary form sits just below the
  // midpoint. Nudging by one ULP first makes the common money cases round as a human would.
  const scaled = n * 100;
  const nudged = scaled >= 0 ? scaled + Number.EPSILON * Math.abs(scaled) : scaled - Number.EPSILON * Math.abs(scaled);
  return Math.round(nudged) / 100;
}

/**
 * Neumaier compensated summation. Adding hundreds of thousands of invoice costs with a
 * plain `+=` accumulates visible error; this keeps the running total accurate to the last
 * representable digit at any scale.
 */
class CompensatedSum {
  private sum = 0;
  private compensation = 0;

  add(value: number): void {
    if (!Number.isFinite(value) || value === 0) return;
    const t = this.sum + value;
    if (Math.abs(this.sum) >= Math.abs(value)) {
      this.compensation += this.sum - t + value;
    } else {
      this.compensation += value - t + this.sum;
    }
    this.sum = t;
  }

  get value(): number {
    return this.sum + this.compensation;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normaliseDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const date = raw.trim().slice(0, 10);
  return DATE_RE.test(date) ? date : null;
}

// ── Internal ledger state ──────────────────────────────────────────────────────────────

interface Layer {
  date: string;
  ref: string;
  qty: number;
  value: number;
  rate: number;
}

/**
 * A product's FIFO queue. `head` is the index of the oldest layer that still has stock, so
 * drained layers are never re-scanned. Without it, consumption is O(layers) per sale and
 * degenerates to O(n²) across a full history replay.
 */
interface ProductQueue {
  layers: Layer[];
  head: number;
  qty: number;
  value: number;
}

interface Accumulator {
  openingQty: number;
  openingValue: number;
  purchaseQty: number;
  purchaseValue: number;
  soldQty: number;
  cogs: number;
  shortfallQty: number;
}

// ── Engine ─────────────────────────────────────────────────────────────────────────────

export function runFifo(events: readonly FifoEvent[], options: FifoRunOptions): FifoRunResult {
  const fromDate = normaliseDate(options.fromDate);
  const toDate = normaliseDate(options.toDate);
  if (!fromDate || !toDate) {
    throw new Error(
      `[runFifo] fromDate and toDate must be YYYY-MM-DD (received "${options.fromDate}" / "${options.toDate}")`
    );
  }
  if (fromDate > toDate) {
    throw new Error(`[runFifo] fromDate (${fromDate}) must not be after toDate (${toDate})`);
  }

  const excluded = options.excludedProductIds ?? new Set<string>();
  const fallbackRates = options.fallbackRates ?? new Map<string, number>();
  const maxShortfallRecords = options.maxShortfallRecords ?? 200;

  // ── 1. Normalise and order ───────────────────────────────────────────────────────────
  // Only an index permutation is sorted: the event array itself is left untouched, and a
  // million-event history costs 8 MB of ordering data rather than a full array copy.
  interface Prepared {
    index: number;
    date: string;
    rank: number;
    seq: number;
  }

  const prepared: Prepared[] = [];
  let skipped = 0;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const date = normaliseDate(ev.date);
    const rank = KIND_RANK[ev.kind];
    if (
      date === null ||
      rank === undefined ||
      !ev.productId ||
      excluded.has(ev.productId) ||
      !Number.isFinite(ev.qty) ||
      ev.qty === 0 ||
      date > toDate
    ) {
      // Events after toDate are not errors — they simply lie outside the valuation window.
      if (date === null || rank === undefined || !ev.productId) skipped++;
      continue;
    }
    prepared.push({ index: i, date, rank, seq: ev.seq ?? 0 });
  }

  prepared.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.seq !== b.seq) return a.seq - b.seq;
    return a.index - b.index;
  });

  // ── 2. Ledger state and accumulators ─────────────────────────────────────────────────
  const queues = new Map<string, ProductQueue>();
  const perProduct = new Map<string, Accumulator>();

  const purchasesValue = new CompensatedSum();
  const adjustmentsInValue = new CompensatedSum();
  const unrecordedPurchases = new CompensatedSum();
  const writeOffsValue = new CompensatedSum();
  const inPeriodCogs = new CompensatedSum();
  const prePeriodCogs = new CompensatedSum();

  const shortfalls: FifoShortfall[] = [];
  let shortfallQtyTotal = 0;
  let shortfallsTruncated = false;

  const queueFor = (productId: string): ProductQueue => {
    let q = queues.get(productId);
    if (!q) {
      q = { layers: [], head: 0, qty: 0, value: 0 };
      queues.set(productId, q);
    }
    return q;
  };

  const accFor = (productId: string): Accumulator => {
    let a = perProduct.get(productId);
    if (!a) {
      a = {
        openingQty: 0,
        openingValue: 0,
        purchaseQty: 0,
        purchaseValue: 0,
        soldQty: 0,
        cogs: 0,
        shortfallQty: 0,
      };
      perProduct.set(productId, a);
    }
    return a;
  };

  const fallbackRateFor = (productId: string): number => {
    const rate = fallbackRates.get(productId);
    return Number.isFinite(rate) && (rate as number) > 0 ? (rate as number) : 0;
  };

  /**
   * Total cost of an inflow: an explicit `value` wins, otherwise `qty * rate`.
   * There is no per-product cost override. Goods are worth what they were billed at, so a
   * genuinely free scheme pack arrives at rate 0 and costs nothing on its own merits — no
   * hardcoded SKU list can discard a cost the data actually recorded.
   */
  const inflowValue = (ev: FifoEvent, qty: number): number => {
    if (Number.isFinite(ev.value)) return Math.max(0, ev.value as number);
    const rate = Number.isFinite(ev.rate) ? (ev.rate as number) : 0;
    return Math.max(0, qty * rate);
  };

  const pushLayer = (productId: string, date: string, ref: string, qty: number, value: number): void => {
    const q = queueFor(productId);
    q.layers.push({ date, ref, qty, value, rate: qty > 0 ? value / qty : 0 });
    q.qty += qty;
    q.value += value;
  };

  /**
   * Draw `qty` from the oldest layers. Returns the FIFO cost plus any quantity the ledger
   * could not supply (valued at the fallback rate and reported separately).
   */
  const draw = (productId: string, qty: number): { cost: number; shortfall: number } => {
    const q = queues.get(productId);
    let need = qty;
    const cost = new CompensatedSum();

    if (q) {
      while (need > QTY_EPSILON && q.head < q.layers.length) {
        const layer = q.layers[q.head];
        if (layer.qty <= QTY_EPSILON) {
          q.head++;
          continue;
        }
        if (layer.qty - need <= QTY_EPSILON) {
          // Layer fully drained — release its exact remaining value so repeated partial
          // draws can never leave a rounding residue behind.
          cost.add(layer.value);
          need -= layer.qty;
          q.qty -= layer.qty;
          q.value -= layer.value;
          layer.qty = 0;
          layer.value = 0;
          q.head++;
        } else {
          const takeValue = Math.min(need * layer.rate, layer.value);
          cost.add(takeValue);
          layer.qty -= need;
          layer.value -= takeValue;
          q.qty -= need;
          q.value -= takeValue;
          need = 0;
        }
      }
      // Clamp accumulated drift so an empty queue reports exactly zero.
      if (q.qty <= QTY_EPSILON) {
        q.qty = 0;
        q.value = 0;
      }
    }

    const shortfall = need > QTY_EPSILON ? need : 0;
    if (shortfall > 0) cost.add(shortfall * fallbackRateFor(productId));
    return { cost: cost.value, shortfall };
  };

  /** Average cost of a product's remaining stock, used to value customer returns. */
  const restoreRate = (productId: string): number => {
    const q = queues.get(productId);
    if (q && q.qty > QTY_EPSILON) return q.value / q.qty;
    return fallbackRateFor(productId);
  };

  const recordShortfall = (
    productId: string,
    date: string,
    ref: string,
    qty: number,
    inPeriod: boolean
  ): void => {
    shortfallQtyTotal += qty;
    accFor(productId).shortfallQty += qty;
    const value = qty * fallbackRateFor(productId);
    // Only in-period shortfalls belong to this period's identity. A pre-period shortfall
    // left the ledger empty before the period opened, so it is already reflected in a lower
    // Opening Stock and must not be added again here.
    if (inPeriod) unrecordedPurchases.add(value);
    if (shortfalls.length < maxShortfallRecords) {
      shortfalls.push({ productId, date, ref, qty, value, inPeriod });
    } else {
      shortfallsTruncated = true;
    }
  };

  const isPrePeriod = (date: string, rank: number): boolean =>
    date < fromDate || (date === fromDate && rank === START_OF_DAY_RANK);

  // ── 3. Replay ────────────────────────────────────────────────────────────────────────
  // Pre-period events run first and are then frozen into Opening Stock, so the opening
  // position is a real measurement of the ledger rather than a parallel estimate.
  let boundary = prepared.length;
  for (let i = 0; i < prepared.length; i++) {
    if (!isPrePeriod(prepared[i].date, prepared[i].rank)) {
      boundary = i;
      break;
    }
  }

  const snapshotOpening = (): void => {
    for (const [productId, q] of queues) {
      if (q.qty <= QTY_EPSILON && q.value === 0) continue;
      const acc = accFor(productId);
      acc.openingQty = q.qty;
      acc.openingValue = q.value;
    }
  };

  const applyInflow = (ev: FifoEvent, date: string, qty: number): number => {
    const value = inflowValue(ev, qty);
    pushLayer(ev.productId, date, ev.ref ?? ev.kind, qty, value);
    return value;
  };

  const applyOutflow = (
    ev: FifoEvent,
    date: string,
    qty: number,
    inPeriod: boolean
  ): number => {
    const { cost, shortfall } = draw(ev.productId, qty);
    if (shortfall > 0) recordShortfall(ev.productId, date, ev.ref ?? ev.kind, shortfall, inPeriod);
    return cost;
  };

  for (let i = 0; i < prepared.length; i++) {
    const { index, date } = prepared[i];
    const ev = events[index];
    const inPeriod = i >= boundary;
    const acc = accFor(ev.productId);

    switch (ev.kind) {
      case "opening_count":
      case "adjustment_in": {
        const qty = Math.abs(ev.qty);
        const value = applyInflow(ev, date, qty);
        if (inPeriod) adjustmentsInValue.add(value);
        break;
      }

      case "purchase": {
        // A negative purchase qty is a return to the supplier: stock leaves at FIFO cost
        // and the purchase total is reduced by the same amount.
        if (ev.qty < 0) {
          const qty = -ev.qty;
          const cost = applyOutflow(ev, date, qty, inPeriod);
          if (inPeriod) {
            purchasesValue.add(-cost);
            acc.purchaseQty -= qty;
            acc.purchaseValue -= cost;
          }
        } else {
          const value = applyInflow(ev, date, ev.qty);
          if (inPeriod) {
            purchasesValue.add(value);
            acc.purchaseQty += ev.qty;
            acc.purchaseValue += value;
          }
        }
        break;
      }

      case "sale": {
        if (ev.qty < 0) {
          // Customer return. Restored at the average cost of stock currently held, which
          // is the closest deterministic estimate of what the goods originally cost, and
          // credited back against COGS so the identity stays exact.
          const qty = -ev.qty;
          const value = qty * restoreRate(ev.productId);
          pushLayer(ev.productId, date, ev.ref ?? "RETURN", qty, value);
          if (inPeriod) {
            inPeriodCogs.add(-value);
            acc.soldQty -= qty;
            acc.cogs -= value;
          } else {
            prePeriodCogs.add(-value);
          }
        } else {
          const cost = applyOutflow(ev, date, ev.qty, inPeriod);
          if (inPeriod) {
            inPeriodCogs.add(cost);
            acc.soldQty += ev.qty;
            acc.cogs += cost;
          } else {
            prePeriodCogs.add(cost);
          }
        }
        break;
      }

      case "adjustment_out": {
        const qty = Math.abs(ev.qty);
        const cost = applyOutflow(ev, date, qty, inPeriod);
        if (inPeriod) writeOffsValue.add(cost);
        break;
      }
    }

    // Freeze the opening position the moment the period boundary is crossed. `boundary` is
    // 0 when nothing precedes the period, in which case Opening Stock is legitimately zero
    // and this never fires; when every event is pre-period it fires on the last iteration.
    if (i + 1 === boundary) snapshotOpening();
  }

  // ── 4. Measure and reconcile ─────────────────────────────────────────────────────────
  const rawOpening = new CompensatedSum();
  const rawClosing = new CompensatedSum();
  for (const acc of perProduct.values()) rawOpening.add(acc.openingValue);
  for (const q of queues.values()) rawClosing.add(q.value);

  const openingStockValue = round2(rawOpening.value);
  const purchases = round2(purchasesValue.value);
  const adjustmentsIn = round2(adjustmentsInValue.value);
  const unrecorded = round2(unrecordedPurchases.value);
  const writeOffs = round2(writeOffsValue.value);
  const closingStockValue = round2(rawClosing.value);

  // COGS is derived from the rounded line items so that the statement balances exactly as
  // displayed. `measuredCogs` is the ledger's own figure; the two differ only by rounding,
  // and `identityDelta` makes any real divergence impossible to miss.
  const cogs = round2(
    openingStockValue + purchases + adjustmentsIn + unrecorded - writeOffs - closingStockValue
  );
  const measuredCogs = round2(inPeriodCogs.value);

  const byProduct: FifoProductPosition[] = [];
  for (const [productId, acc] of perProduct) {
    const q = queues.get(productId);
    const closingQty = q ? q.qty : 0;
    const closingValue = q ? q.value : 0;
    const hasActivity =
      acc.openingQty !== 0 ||
      acc.purchaseQty !== 0 ||
      acc.soldQty !== 0 ||
      closingQty > QTY_EPSILON ||
      acc.shortfallQty !== 0;
    if (!hasActivity) continue;
    byProduct.push({
      productId,
      openingQty: round2(acc.openingQty),
      openingValue: round2(acc.openingValue),
      purchaseQty: round2(acc.purchaseQty),
      purchaseValue: round2(acc.purchaseValue),
      soldQty: round2(acc.soldQty),
      cogs: round2(acc.cogs),
      closingQty: round2(closingQty),
      closingValue: round2(closingValue),
      shortfallQty: round2(acc.shortfallQty),
    });
  }
  byProduct.sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));

  return {
    fromDate,
    toDate,
    openingStockValue,
    purchasesValue: purchases,
    adjustmentsInValue: adjustmentsIn,
    unrecordedPurchasesValue: unrecorded,
    writeOffsValue: writeOffs,
    closingStockValue,
    cogs,
    measuredCogs,
    prePeriodCogs: round2(prePeriodCogs.value),
    identityDelta: round2(measuredCogs - cogs),
    byProduct,
    diagnostics: {
      eventCount: events.length,
      processedEventCount: prepared.length,
      skippedEventCount: skipped,
      shortfalls,
      shortfallQty: round2(shortfallQtyTotal),
      shortfallsTruncated,
    },
  };
}
