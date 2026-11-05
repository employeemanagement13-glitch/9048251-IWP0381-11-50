"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { replaceLeaseReturns, type LeasedEmptyRecord } from "@/lib/actions/leased-empties";

type ReturnLine = {
  key: string;
  product_id: string;
  return_date: string;
  quantity: number;
  is_legacy?: boolean;
};

function buildInitialLines(lease: LeasedEmptyRecord, today: string): ReturnLine[] {
  const init: ReturnLine[] = [];
  for (const it of lease.items) {
    const returns = it.returns || [];
    if (returns.length > 0) {
      for (const r of returns) {
        if ((r.quantity || 0) <= 0) continue;
        init.push({
          key: r.id || `${it.product_id}-${r.date}-${r.quantity}`,
          product_id: it.product_id,
          return_date: r.date,
          quantity: Number(r.quantity || 0),
          is_legacy: Boolean(r.is_legacy),
        });
      }
      continue;
    }
    if ((it.returned_qty || 0) > 0) {
      init.push({
        key: `legacy-${it.product_id}`,
        product_id: it.product_id,
        return_date: (it.returned_date || lease.date || today).slice(0, 10),
        quantity: Number(it.returned_qty || 0),
        is_legacy: true,
      });
    }
  }
  return init;
}

export function ReturnedLeaseModal({
  lease,
  onClose,
  onSaved,
}: {
  lease: LeasedEmptyRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [lines, setLines] = useState<ReturnLine[]>(() => buildInitialLines(lease, today));
  const [addDate, setAddDate] = useState(today);
  const [addProductId, setAddProductId] = useState(lease.items[0]?.product_id || "");
  const [addQty, setAddQty] = useState(1);

  const productLabel = (pid: string) => {
    const it = lease.items.find((x) => x.product_id === pid);
    if (!it) return pid;
    return it.product_code ? `${it.product_code} ${it.product_name}` : it.product_name;
  };

  const leasedQty = (pid: string) =>
    Number(lease.items.find((x) => x.product_id === pid)?.quantity || 0);

  const returnedTotal = (pid: string, exceptKey?: string) =>
    lines
      .filter((l) => l.product_id === pid && l.key !== exceptKey)
      .reduce((s, l) => s + (Number(l.quantity) || 0), 0);

  const addLine = () => {
    const qty = Number(addQty) || 0;
    const d = String(addDate || "").slice(0, 10);
    if (!addProductId) {
      alert("Select a product.");
      return;
    }
    if (!d) {
      alert("Select a return date.");
      return;
    }
    if (lease.date && d < lease.date) {
      alert("Returned date cannot be before the lease date.");
      return;
    }
    if (d > today) {
      alert("Returned date cannot be in the future.");
      return;
    }
    if (qty <= 0) {
      alert("Quantity must be greater than 0.");
      return;
    }
    const max = leasedQty(addProductId);
    if (returnedTotal(addProductId) + qty > max + 0.0001) {
      alert(`Total returned cannot exceed leased quantity (${max}).`);
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        key: `${addProductId}-${d}-${Date.now()}`,
        product_id: addProductId,
        return_date: d,
        quantity: qty,
      },
    ]);
    setAddQty(1);
  };

  const updateLine = (key: string, patch: Partial<ReturnLine>) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        if (patch.quantity !== undefined) next.is_legacy = false;
        if (patch.return_date !== undefined) next.is_legacy = false;
        return next;
      })
    );
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    for (const l of lines) {
      const d = String(l.return_date || "").slice(0, 10);
      if (!d) {
        alert("Every return needs a date.");
        return;
      }
      if (lease.date && d < lease.date) {
        alert("Returned date cannot be before the lease date.");
        return;
      }
      if (d > today) {
        alert("Returned date cannot be in the future.");
        return;
      }
      if ((Number(l.quantity) || 0) <= 0) {
        alert("Every return quantity must be greater than 0.");
        return;
      }
    }
    for (const it of lease.items) {
      const total = returnedTotal(it.product_id);
      if (total > Number(it.quantity || 0) + 0.0001) {
        alert(`Total returned for ${it.product_name} cannot exceed leased quantity.`);
        return;
      }
    }

    startTransition(async () => {
      try {
        await replaceLeaseReturns(
          lease.id,
          lines.map((l) => ({
            product_id: l.product_id,
            return_date: String(l.return_date).slice(0, 10),
            quantity: Number(l.quantity) || 0,
            is_legacy: Boolean(l.is_legacy),
          }))
        );
        onSaved();
      } catch (err: any) {
        alert(err.message ?? "Failed to save returns.");
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden max-h-[90vh]">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-zinc-100 flex-shrink-0">
          <div>
            <h3 className="text-[0.875rem] font-bold text-zinc-900">Lease Returns</h3>
            <p className="text-[0.6875rem] text-zinc-500 mt-0.5">
              {lease.outlet_code} — {lease.outlet_name}
              {lease.date ? ` · leased ${lease.date}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 text-lg"
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-3 sm:px-6 py-3 sm:py-4 space-y-4 flex-1 overflow-y-auto">
            <div className="rounded-lg border border-zinc-100 bg-zinc-50/80 px-3 py-2 text-[0.6875rem] text-zinc-600 space-y-0.5">
              {lease.items.map((it) => (
                <div key={it.product_id} className="flex justify-between gap-2 font-mono">
                  <span className="truncate">{productLabel(it.product_id)}</span>
                  <span>
                    returned {returnedTotal(it.product_id)} / {it.quantity}
                  </span>
                </div>
              ))}
            </div>

            <table className="w-full text-[0.75rem]">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200">
                  <th className="text-left px-2 py-2 font-semibold text-zinc-600">Date</th>
                  <th className="text-left px-2 py-2 font-semibold text-zinc-600">Product</th>
                  <th className="text-right px-2 py-2 font-semibold text-emerald-700">Qty</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-6 text-center text-zinc-400">
                      No returns yet. Add a dated return below.
                    </td>
                  </tr>
                )}
                {lines.map((l) => (
                  <tr key={l.key} className="border-b border-zinc-100">
                    <td className="px-2 py-1.5">
                      <input
                        type="date"
                        value={l.return_date}
                        min={lease.date || undefined}
                        max={today}
                        onChange={(e) => updateLine(l.key, { return_date: e.target.value })}
                        className="w-full border border-zinc-200 rounded px-1.5 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400"
                      />
                      {l.is_legacy && (
                        <span className="text-[0.625rem] text-amber-600 font-medium">legacy</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={l.product_id}
                        onChange={(e) => updateLine(l.key, { product_id: e.target.value, is_legacy: false })}
                        className="w-full border border-zinc-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400"
                      >
                        {lease.items.map((it) => (
                          <option key={it.product_id} value={it.product_id}>
                            {productLabel(it.product_id)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        value={l.quantity}
                        onChange={(e) =>
                          updateLine(l.key, { quantity: Math.max(0, parseFloat(e.target.value) || 0) })
                        }
                        className="w-20 border border-emerald-200 rounded px-1.5 py-1 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400"
                      />
                    </td>
                    <td className="px-1 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => removeLine(l.key)}
                        className="p-1 text-zinc-400 hover:text-red-600"
                        title="Remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="rounded-lg border border-dashed border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
              <p className="text-[0.6875rem] font-semibold text-emerald-800 uppercase tracking-wide">
                Add return
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[8.5rem]">
                  <label className="block text-[0.625rem] text-zinc-500 mb-0.5">Date</label>
                  <input
                    type="date"
                    value={addDate}
                    min={lease.date || undefined}
                    max={today}
                    onChange={(e) => setAddDate(e.target.value)}
                    className="w-full border border-zinc-200 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-white"
                  />
                </div>
                <div className="flex-1 min-w-[10rem]">
                  <label className="block text-[0.625rem] text-zinc-500 mb-0.5">Product</label>
                  <select
                    value={addProductId}
                    onChange={(e) => setAddProductId(e.target.value)}
                    className="w-full border border-zinc-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-white"
                  >
                    {lease.items.map((it) => (
                      <option key={it.product_id} value={it.product_id}>
                        {productLabel(it.product_id)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-24">
                  <label className="block text-[0.625rem] text-zinc-500 mb-0.5">Qty</label>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    value={addQty}
                    onChange={(e) => setAddQty(parseFloat(e.target.value) || 0)}
                    className="w-full border border-zinc-200 rounded px-2 py-1.5 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-white"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addLine}
                  className="h-8 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add
                </Button>
              </div>
            </div>
          </div>
          <div className="px-4 sm:px-6 py-3 border-t border-zinc-100 flex gap-2 flex-shrink-0">
            <Button
              type="submit"
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center gap-1.5"
              disabled={isPending}
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? "Saving..." : "Save Returns"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
