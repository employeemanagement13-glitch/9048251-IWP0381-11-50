"use client";

import React, { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { ExportButtons } from "@/components/export/ExportButtons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { createReturn, deleteReturn, approveReturn, rejectReturn } from "@/lib/actions/inventory";
import { parseProducts } from "@/lib/parsers/products";
import { useRouter } from "next/navigation";

interface ReturnsClientProps {
  initialReturns: any[];
  shops: any[];
  invoices: any[];
  products: any[];
  categories?: any[];
}

function isProductReturnable(productName: string, categories?: any[]): boolean {
  const lower = productName.toLowerCase().trim();
  if (
    lower.includes("rgb") ||
    lower.includes("pallet") ||
    lower.includes("shell") ||
    lower.includes("sheet") ||
    lower.includes("empties") ||
    lower.includes("crate") ||
    lower.includes("bottle rgb")
  ) {
    return true;
  }
  if (categories && categories.length > 0) {
    const returnableCats = categories.filter((c: any) => c.is_returnable);
    for (const cat of returnableCats) {
      if (lower.includes((cat.title || "").toLowerCase())) return true;
    }
  }
  return false;
}

export function ReturnsClient({ initialReturns, shops, invoices, products, categories }: ReturnsClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Search & Date filters
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Modal forms
  const [showModal, setShowModal] = useState(false);
  const [shopId, setShopId] = useState("");
  const [productName, setProductName] = useState("");
  const [originalInvoiceId, setOriginalInvoiceId] = useState("");
  const [receivedQty, setReceivedQty] = useState(0);
  const [status, setStatus] = useState<"approved" | "rejected" | "pending">("approved");
  const [reason, setReason] = useState("");

  // Expand / Details inline state per invoice
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);

  // Reject inline modal state
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Process invoices containing returnable products
  const invoiceRows = invoices.map((inv) => {
    const shopObj = shops.find((s: any) => s.id === inv.shop_id) || inv.shop;
    const parsed = parseProducts(inv.products || "");
    const returnableItems = parsed.filter((p) => isProductReturnable(p.name, categories));
    const totalReturnableQty = returnableItems.reduce((acc, item) => acc + item.qty, 0);

    const invReturns = initialReturns.filter(
      (r: any) => r.original_invoice_id === inv.id || r.original_invoice?.invoice_no === inv.invoice_no
    );

    const returnedQty = invReturns
      .filter((r: any) => r.status !== "rejected")
      .reduce((acc: number, r: any) => acc + Number(r.received_qty || 0), 0);

    const unreturnedQty = Math.max(0, totalReturnableQty - returnedQty);

    return {
      invoice: inv,
      shop: shopObj,
      productName: inv.products || "—",
      returnableItems,
      totalReturnableQty,
      returnedQty,
      unreturnedQty,
      returnsLog: invReturns,
    };
  }).filter((row) => row.returnableItems.length > 0 || row.returnsLog.length > 0);

  const filteredRows = invoiceRows.filter((row) => {
    const s = search.toLowerCase();
    const inv = row.invoice;
    const shopName = row.shop?.shop_name || "";
    const outletCode = row.shop?.outlet_code || "";
    const invNo = inv.invoice_no || "";
    const prod = row.productName;

    const matchSearch =
      !search ||
      invNo.toLowerCase().includes(s) ||
      shopName.toLowerCase().includes(s) ||
      outletCode.toLowerCase().includes(s) ||
      prod.toLowerCase().includes(s);

    const invDate = inv.invoice_date || inv.scheduled_date;
    const matchFrom = !dateFrom || (invDate && invDate >= dateFrom);
    const matchTo = !dateTo || (invDate && invDate <= dateTo);

    return matchSearch && matchFrom && matchTo;
  });

  const handleDeleteReturn = (id: string) => {
    if (!confirm("Are you sure you want to delete this return record?")) return;
    startTransition(async () => {
      try {
        await deleteReturn(id);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleOpenRecordReturn = (row?: any) => {
    if (row) {
      setShopId(row.invoice.shop_id || row.shop?.id || "");
      setOriginalInvoiceId(row.invoice.id || "");
      if (row.returnableItems.length > 0) {
        setProductName(row.returnableItems[0].name);
      } else {
        setProductName("");
      }
    } else {
      setShopId("");
      setOriginalInvoiceId("");
      setProductName("");
    }
    setReceivedQty(0);
    setStatus("approved");
    setReason("");
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !productName || receivedQty <= 0) {
      alert("Please fill in all required fields.");
      return;
    }

    startTransition(async () => {
      try {
        await createReturn({
          shop_id: shopId,
          product_name: productName,
          original_invoice_id: originalInvoiceId || undefined,
          received_qty: receivedQty,
          status: status,
          reason: status === "rejected" ? reason : undefined,
        });
        setShowModal(false);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const exportData = filteredRows.map((row) => ({
    "Invoice No": row.invoice.invoice_no,
    "Shop": row.shop?.shop_name || "",
    "Product Name": row.productName,
    "Returned": row.returnedQty,
    "Unreturned": row.unreturnedQty,
  }));

  return (
    <div className="space-y-4">
      {/* Top controls */}
      <div className="flex flex-wrap gap-3 items-end bg-zinc-50 p-3 rounded-lg border border-zinc-200 justify-between">
        <div className="flex flex-wrap gap-3 items-end flex-1">
          <div className="min-w-[13.75rem]">
            <label className="block text-[0.6875rem] font-semibold text-zinc-500 uppercase tracking-wide mb-1">
              Search Invoices
            </label>
            <Input
              placeholder="Search by Invoice No, Shop, or Product..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-[0.6875rem] font-semibold text-zinc-500 uppercase tracking-wide mb-1">
              From Date
            </label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-36 bg-white"
            />
          </div>

          <div>
            <label className="block text-[0.6875rem] font-semibold text-zinc-500 uppercase tracking-wide mb-1">
              To Date
            </label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-36 bg-white"
            />
          </div>

          {(search || dateFrom || dateTo) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setDateFrom("");
                setDateTo("");
              }}
              className="text-xs text-zinc-500 hover:text-zinc-800"
            >
              Reset
            </Button>
          )}
        </div>

        <div className="flex gap-2">
          <ExportButtons data={exportData} filename="returns_head_invoices" />
          <Button onClick={() => handleOpenRecordReturn()} size="sm">
            + Record Return
          </Button>
        </div>
      </div>

      {/* Main Table §4.4 */}
      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice No</TableHead>
              <TableHead>Shop</TableHead>
              <TableHead>Product Name</TableHead>
              <TableHead className="text-right">Returned</TableHead>
              <TableHead className="text-right">Unreturned</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-zinc-400 py-8">
                  No invoices with returnable products found.
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => (
                <React.Fragment key={row.invoice.id}>
                  <TableRow>
                    <TableCell className="font-mono text-sm font-semibold text-zinc-900">
                      {row.invoice.invoice_no}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-zinc-900">{row.shop?.shop_name}</div>
                      <div className="text-xs text-zinc-400">{row.shop?.outlet_code}</div>
                    </TableCell>
                    <TableCell className="max-w-md text-xs text-zinc-700 font-medium">
                      {row.productName}
                    </TableCell>
                    <TableCell className="text-right font-bold text-green-700">
                      {row.returnedQty}
                    </TableCell>
                    <TableCell className="text-right font-bold text-amber-700">
                      {row.unreturnedQty}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOpenRecordReturn(row)}
                        >
                          Record Return
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setExpandedInvoiceId(
                              expandedInvoiceId === row.invoice.id ? null : row.invoice.id
                            )
                          }
                        >
                          {expandedInvoiceId === row.invoice.id ? "Hide Details" : "View"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>

                  {/* Expanded Return Details & Logs for this invoice */}
                  {expandedInvoiceId === row.invoice.id && (
                    <TableRow className="bg-zinc-50/80 border-t border-b border-zinc-200">
                      <TableCell colSpan={6} className="p-4">
                        <div className="space-y-3">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-600">
                            Recorded Return Logs for Invoice {row.invoice.invoice_no}
                          </h4>
                          {row.returnsLog.length === 0 ? (
                            <p className="text-xs text-zinc-400 italic">No return entries recorded yet for this invoice.</p>
                          ) : (
                            <div className="space-y-2">
                              {row.returnsLog.map((ret: any) => (
                                <div
                                  key={ret.id}
                                  className="flex items-center justify-between bg-white p-2.5 rounded border border-zinc-200 text-xs"
                                >
                                  <div className="space-y-0.5">
                                    <div className="font-semibold text-zinc-800">
                                      {ret.product_name} — <span className="text-green-700 font-bold">{ret.received_qty} units returned</span>
                                    </div>
                                    <div className="text-[0.6875rem] text-zinc-400">
                                      Return Date: {ret.return_date || ret.created_at?.slice(0, 10)} {ret.reason ? `| Note: ${ret.reason}` : ""}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {ret.status === "approved" ? (
                                      <Badge variant="success">Approved</Badge>
                                    ) : ret.status === "rejected" ? (
                                      <Badge variant="destructive">Rejected</Badge>
                                    ) : (
                                      <Badge variant="warning">Pending Review</Badge>
                                    )}

                                    {ret.status === "pending" && (
                                      <>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="text-green-600 hover:text-green-800 h-7 px-2 text-xs"
                                          disabled={isPending}
                                          onClick={() => {
                                            if (!confirm("Approve this return?")) return;
                                            startTransition(async () => {
                                              try {
                                                await approveReturn(ret.id);
                                                router.refresh();
                                              } catch (err: any) { alert(err.message); }
                                            });
                                          }}
                                        >
                                          Approve
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="text-amber-600 hover:text-amber-800 h-7 px-2 text-xs"
                                          disabled={isPending}
                                          onClick={() => {
                                            setRejectingId(ret.id);
                                            setRejectReason("");
                                          }}
                                        >
                                          Reject
                                        </Button>
                                      </>
                                    )}

                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-red-500 hover:text-red-700 h-7 px-2 text-xs"
                                      onClick={() => handleDeleteReturn(ret.id)}
                                    >
                                      Delete
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* RECORD RETURN MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-4">Record Product Return</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Shop *
                </label>
                <select
                  className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white"
                  value={shopId}
                  onChange={(e) => {
                    setShopId(e.target.value);
                    setOriginalInvoiceId("");
                  }}
                  required
                >
                  <option value="">Select Shop...</option>
                  {shops.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.outlet_code} — {s.shop_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Original Invoice
                </label>
                <select
                  className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white"
                  value={originalInvoiceId}
                  onChange={(e) => {
                    setOriginalInvoiceId(e.target.value);
                    const selectedInv = invoices.find((inv: any) => inv.id === e.target.value);
                    if (selectedInv) {
                      const parsed = parseProducts(selectedInv.products || "");
                      const retItems = parsed.filter((p) => isProductReturnable(p.name, categories));
                      if (retItems.length > 0) setProductName(retItems[0].name);
                    }
                  }}
                >
                  <option value="">No Invoice Link / Unlinked</option>
                  {invoices
                    .filter((inv) => !shopId || inv.shop_id === shopId)
                    .map((inv: any) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_no} ({inv.invoice_date || inv.scheduled_date})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Returnable Product *
                </label>
                <input
                  type="text"
                  className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white"
                  placeholder="Enter or select product name..."
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">
                    Returned Qty *
                  </label>
                  <Input
                    type="number"
                    value={receivedQty}
                    onChange={(e) => setReceivedQty(parseInt(e.target.value) || 0)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">
                    Status *
                  </label>
                  <select
                    className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    required
                  >
                    <option value="approved">Approved</option>
                    <option value="pending">Pending Review</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
              </div>

              {status === "rejected" && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">
                    Rejection Reason *
                  </label>
                  <Input
                    placeholder="Specify why the return is rejected..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                  />
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1" disabled={isPending}>
                  {isPending ? "Saving..." : "Record Return"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REJECT REASON MODAL */}
      {rejectingId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-3">Reject Return</h3>
            <p className="text-sm text-zinc-500 mb-4">Provide a reason for rejecting this return.</p>
            <Input
              placeholder="Enter rejection reason..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2 mt-4">
              <Button
                className="flex-1"
                disabled={isPending || !rejectReason.trim()}
                onClick={() => {
                  startTransition(async () => {
                    try {
                      await rejectReturn(rejectingId, rejectReason);
                      setRejectingId(null);
                      setRejectReason("");
                      router.refresh();
                    } catch (err: any) { alert(err.message); }
                  });
                }}
              >
                {isPending ? "Saving..." : "Confirm Reject"}
              </Button>
              <Button variant="outline" onClick={() => setRejectingId(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
