/**
 * Date-aware outstanding leased empties.
 *
 * A lease leaves the warehouse on `leaseDate`. Each return restores stock on
 * its own `return_date`. Legacy rows with only returned_qty / returned_date
 * (or returned_qty with no date) keep the previous behaviour.
 */

export type LeaseReturnEntry = {
  date: string;
  quantity: number;
  is_legacy?: boolean;
};

export function leaseReturnedQtyAsOf(
  returnedQty: number,
  returnedDate: string | null | undefined,
  asOfDate?: string | null,
  returns?: LeaseReturnEntry[] | null,
): number {
  if (returns && returns.length > 0) {
    const asOf = asOfDate || new Date().toISOString().slice(0, 10);
    return returns.reduce((sum, r) => {
      const d = String(r.date || "").slice(0, 10);
      const q = Number(r.quantity) || 0;
      if (q <= 0 || !d || d > asOf) return sum;
      return sum + q;
    }, 0);
  }

  const ret = Number(returnedQty || 0);
  if (ret <= 0) return 0;
  if (!returnedDate) return ret;
  const asOf = asOfDate || new Date().toISOString().slice(0, 10);
  return returnedDate <= asOf ? ret : 0;
}

export function leaseOutstandingAsOf(opts: {
  quantity: number;
  returnedQty?: number | null;
  returnedDate?: string | null;
  returns?: LeaseReturnEntry[] | null;
  leaseDate: string;
  asOfDate?: string | null;
}): number {
  if (opts.asOfDate && opts.leaseDate > opts.asOfDate) return 0;
  const returned = leaseReturnedQtyAsOf(
    opts.returnedQty || 0,
    opts.returnedDate,
    opts.asOfDate,
    opts.returns,
  );
  return Math.max(0, Number(opts.quantity || 0) - returned);
}
