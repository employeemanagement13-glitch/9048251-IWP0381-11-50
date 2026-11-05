"use client";

import { useState, useEffect, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
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
import { Loader2, Edit2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateInvoiceType, getShopLedger } from "@/lib/actions/shops";
import { getShopInvoicesWithDiscounts } from "@/lib/actions/discounts";

interface ShopProfileClientProps {
  shop: any;
  invoices: any[];
  initialLedger: any[];
}

export function ShopProfileClient({ shop, invoices: initialInvoices, initialLedger }: ShopProfileClientProps) {
  const router = useRouter();
  const [invoices, setInvoices] = useState<any[]>(initialInvoices);
  const [ledger, setLedger] = useState<any[]>(initialLedger);

  useEffect(() => {
    setInvoices(initialInvoices);
  }, [initialInvoices]);

  useEffect(() => {
    setLedger(initialLedger);
  }, [initialLedger]);

  const [isPending, startTransition] = useTransition();
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [appliedFromDate, setAppliedFromDate] = useState<string>("");
  const [appliedToDate, setAppliedToDate] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"statement" | "invoices">("statement");

  const [editInvoice, setEditInvoice] = useState<any | null>(null);
  const [editType, setEditType] = useState<"cash" | "credit">("cash");
  const [editPaid, setEditPaid] = useState<number>(0);
  const [editError, setEditError] = useState<string | null>(null);

  const handleLoad = async () => {
    setIsLoading(true);
    try {
      const [freshInvoices, freshLedger] = await Promise.all([
        getShopInvoicesWithDiscounts(shop.id),
        getShopLedger(shop.id),
      ]);
      setInvoices(freshInvoices);
      setLedger(freshLedger);
    } catch (err) {
      console.error("[ShopProfile] reload failed:", err);
    } finally {
      setAppliedFromDate(fromDate);
      setAppliedToDate(toDate);
      setIsLoading(false);
    }
  };

  const filteredLedger = ledger.filter((item) => {
    if (appliedFromDate && item.date < appliedFromDate) return false;
    if (appliedToDate && item.date > appliedToDate) return false;
    return true;
  });

  const filteredInvoices = invoices.filter((inv) => {
    const d = inv.scheduled_date || inv.record_date || inv.invoice_date || "";
    if (appliedFromDate && d < appliedFromDate) return false;
    if (appliedToDate && d > appliedToDate) return false;
    return true;
  });

  const totalDebit = filteredLedger.reduce((acc, curr) => acc + (curr.debit || 0), 0);
  const totalCredit = filteredLedger.reduce((acc, curr) => acc + (curr.credit || 0), 0);
  const endingBalance = filteredLedger.length > 0 ? filteredLedger[filteredLedger.length - 1].balance : 0;

  const openEdit = (inv: any) => {
    setEditInvoice(inv);
    setEditType((inv.invoice_type === "credit" ? "credit" : "cash") as "cash" | "credit");
    setEditPaid(Number(inv.amount_received || 0));
    setEditError(null);
  };

  const handleEditSave = () => {
    if (!editInvoice) return;
    setEditError(null);
    startTransition(async () => {
      try {
        await updateInvoiceType(editInvoice.id, editType, editPaid);
        setInvoices((prev) =>
          prev.map((inv) =>
            inv.id === editInvoice.id
              ? { ...inv, invoice_type: editType, amount_received: editPaid }
              : inv
          )
        );
        setEditInvoice(null);
        router.refresh();
      } catch (err: any) {
        setEditError(err?.message || "Failed to save.");
      }
    });
  };

  const exportData = filteredLedger.map((row) => ({
    Date: row.date,
    "Voucher No.": row.voucher_no,
    Description: row.description,
    "Debit (Rs.)": row.debit ? row.debit : "",
    "Credit (Rs.)": row.credit ? row.credit : "",
    "Balance (Rs.)": row.balance,
  }));

  return (
    <div className="space-y-6">
      <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-5 flex flex-col md:flex-row justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs text-zinc-400 font-semibold uppercase tracking-wider">
            Outlet Account Statement
          </div>
          <h2 className="text-xl font-bold text-red-900">{shop.shop_name}</h2>
          <div className="text-sm text-zinc-600 flex flex-wrap gap-x-4 gap-y-1 pt-1">
            <span>Code: <strong>{shop.outlet_code || "—"}</strong></span>
            <span>Related Person: <strong>{shop.owner_name || "—"}</strong></span>
            <span>Status: <strong>{shop.status || "Active"}</strong></span>
            <span>Tax Number: <strong>{shop.tax_number || "—"}</strong></span>
            <span>Sub Trade Channel: <strong>{shop.sub_trade_channel || "—"}</strong></span>
            <span>Trade Channel: <strong>{shop.trade_channel || "—"}</strong></span>
            <span>GPS: <strong>{shop.gps || "—"}</strong></span>
            <span>Open Date: <strong>{shop.open_date || "—"}</strong></span>
            <span>Address: <strong>{shop.address || "—"}</strong></span>
            <span>Main Channel: <strong>{shop.main_channel_desc || "—"}</strong></span>
            <span>Preseller: <strong>{shop.preseller_name || "—"}</strong></span>
            <span>Segment: <strong>{shop.segment_desc || "—"}</strong></span>
            <span>Phone: <strong>{shop.phone || "—"}</strong></span>
            <span>Type: <strong>{shop.outlet_type ? (shop.outlet_type.toLowerCase() === "credit" ? "Credit" : "Cash") : (shop.shop_type === "credit" ? "Credit" : "—")}</strong></span>
            <span>Filer: <strong className={shop.filer_status === "Yes" || shop.is_filer ? "text-green-600" : shop.filer_status === "Partial" ? "text-amber-600" : "text-zinc-600"}>
              {shop.filer_status || (shop.is_filer ? "Yes" : "No")}
            </strong></span>
          </div>
        </div>
        <div className="shrink-0 flex items-start gap-2">
          <Link href="/shop-details">
            <Button variant="outline">Back to Shops</Button>
          </Link>
          <Link href="/tab2/credit">
            <Button variant="ghost">Credit Balances</Button>
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-end bg-zinc-50 p-4 rounded-lg border border-zinc-200 justify-between">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-1">From Date</label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-9 text-sm bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-1">To Date</label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-9 text-sm bg-white"
            />
          </div>

          <Button
            size="sm"
            disabled={isLoading}
            onClick={handleLoad}
            className="h-9 px-4 font-semibold flex items-center gap-2"
          >
            {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            {isLoading ? "Loading..." : "Load"}
          </Button>

          {(appliedFromDate || appliedToDate || fromDate || toDate) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFromDate("");
                setToDate("");
                setAppliedFromDate("");
                setAppliedToDate("");
              }}
            >
              Clear Filter
            </Button>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("statement")}
            className={`px-4 py-2 text-sm font-semibold rounded-lg border transition-colors ${
              activeTab === "statement"
                ? "bg-red-600 text-white border-red-600 shadow-sm"
                : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300"
            }`}
          >
            Account Statement
          </button>
          <button
            onClick={() => setActiveTab("invoices")}
            className={`px-4 py-2 text-sm font-semibold rounded-lg border transition-colors ${
              activeTab === "invoices"
                ? "bg-red-600 text-white border-red-600 shadow-sm"
                : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300"
            }`}
          >
            Invoices List ({filteredInvoices.length})
          </button>
        </div>
      </div>

      {activeTab === "statement" ? (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-zinc-950">
              ACCOUNT LEDGER ({filteredLedger.length} entries)
            </h3>
            <ExportButtons data={exportData} filename={`shop_${shop.outlet_code}_statement`} />
          </div>

          <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-zinc-100">
                  <TableHead className="font-bold text-zinc-900">Date</TableHead>
                  <TableHead className="font-bold text-zinc-900">Voucher No.</TableHead>
                  <TableHead className="font-bold text-zinc-900">Description</TableHead>
                  <TableHead className="font-bold text-zinc-900 text-right">Debit (Rs.)</TableHead>
                  <TableHead className="font-bold text-zinc-900 text-right">Credit (Rs.)</TableHead>
                  <TableHead className="font-bold text-zinc-900 text-right">Balance (Rs.)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-14 text-zinc-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Loader2 className="w-6 h-6 animate-spin text-red-600" />
                        <span className="text-xs font-semibold text-zinc-600">Loading ledger records...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filteredLedger.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-zinc-400 py-12">
                      No ledger entries found for selected date range.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLedger.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-sm font-medium">{row.date}</TableCell>
                      <TableCell className="font-mono text-xs">{row.voucher_no}</TableCell>
                      <TableCell>
                        <div className="text-xs font-semibold text-zinc-800">{row.description}</div>
                      </TableCell>
                      <TableCell className="text-right text-green-700 font-medium">
                        {row.debit ? `Rs. ${Number(row.debit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-red-600 font-medium">
                        {row.credit ? `Rs. ${Number(row.credit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-bold text-zinc-900">
                        Rs. {Number(row.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs text-red-600">DR</span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
                {!isLoading && filteredLedger.length > 0 && (
                  <TableRow className="bg-zinc-100 font-bold border-t-2 border-zinc-300">
                    <TableCell colSpan={3} className="text-right uppercase tracking-wider text-xs">
                      Summary :
                    </TableCell>
                    <TableCell className="text-right text-green-700">
                      Rs. {totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right text-red-600">
                      Rs. {totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-bold text-zinc-900">
                      Rs. {endingBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs text-red-600">DR</span>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50 border-b border-zinc-200">
                <TableHead className="text-xs font-bold text-zinc-800">Invoice No</TableHead>
                <TableHead className="text-xs font-bold text-zinc-800">Date</TableHead>
                <TableHead className="text-xs font-bold text-zinc-800">Type</TableHead>
                <TableHead className="text-xs font-bold text-zinc-800">Products</TableHead>
                <TableHead className="text-xs font-bold text-zinc-800 text-right">Discount</TableHead>
                <TableHead className="text-xs font-bold text-zinc-800">Given By</TableHead>
                <TableHead className="text-xs font-bold text-zinc-800 text-right">Grand Total</TableHead>
                <TableHead className="text-xs font-bold text-zinc-800 text-right">Paid</TableHead>
                <TableHead className="text-xs font-bold text-zinc-800">Payment</TableHead>
                {shop.shop_type !== "credit" && (
                  <TableHead className="text-xs font-bold text-zinc-800 text-right">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={shop.shop_type !== "credit" ? 10 : 9} className="text-center py-14 text-zinc-500">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Loader2 className="w-6 h-6 animate-spin text-red-600" />
                      <span className="text-xs font-semibold text-zinc-600">Loading invoices...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredInvoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={shop.shop_type !== "credit" ? 10 : 9} className="text-center py-10 text-xs text-zinc-400">
                    No invoices recorded for this shop.
                  </TableCell>
                </TableRow>
              ) : (
                filteredInvoices.map((inv) => {
                  const productsDisplay = inv.formatted_products || inv.products || "";
                  const discountValue = Number(inv.calculated_discount ?? 0);
                  const givenByDisplay =
                    discountValue > 0 && inv.given_by && inv.given_by !== "-"
                      ? inv.given_by
                      : "—";

                  const invoiceAmount = Number(inv.amount ?? inv.invoice_total ?? inv.grand_total ?? 0);
                  const isCash = inv.invoice_type?.toLowerCase() === "cash";

                  // Paid: invoice amount for cash; actual amount paid for credit
                  const paidAmount = isCash ? invoiceAmount : Number(inv.amount_received || 0);

                  // Payment: always Paid for cash; Paid / Partial / Unpaid for credit
                  let paymentLabel = "Unpaid";
                  let paymentVariant: "success" | "warning" | "destructive" = "destructive";

                  if (isCash) {
                    paymentLabel = "Paid";
                    paymentVariant = "success";
                  } else if (paidAmount >= invoiceAmount - 0.01 && invoiceAmount > 0) {
                    paymentLabel = "Paid";
                    paymentVariant = "success";
                  } else if (paidAmount > 0.01) {
                    paymentLabel = "Partial";
                    paymentVariant = "warning";
                  } else {
                    paymentLabel = "Unpaid";
                    paymentVariant = "destructive";
                  }

                  return (
                    <TableRow key={inv.id} className="hover:bg-zinc-50/70">
                      <TableCell className="font-mono text-xs font-semibold text-zinc-800">{inv.invoice_no}</TableCell>
                      <TableCell className="font-mono text-xs text-zinc-600">{inv.scheduled_date}</TableCell>
                      <TableCell className="capitalize text-xs">
                        <Badge variant={inv.invoice_type === "cash" ? "default" : "secondary"}>
                          {inv.invoice_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs max-w-xs font-mono text-zinc-700">
                        <div className="flex flex-wrap gap-1">
                          {String(productsDisplay)
                            .split(",")
                            .map((p, pIdx) => (
                              <span
                                key={pIdx}
                                className="inline-flex items-center px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-[0.6875rem]"
                              >
                                {p.trim()}
                              </span>
                            ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-xs" style={{ color: "var(--primary)" }}>
                        {discountValue > 0 ? `Rs. ${discountValue.toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[0.6875rem] font-semibold bg-zinc-100 text-zinc-800 border border-zinc-200">
                          {givenByDisplay}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium text-xs">
                        Rs.{invoiceAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono text-zinc-700 text-xs">
                        Rs.{paidAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={paymentVariant}>
                          {paymentLabel}
                        </Badge>
                      </TableCell>
                      {shop.shop_type !== "credit" && (
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                            onClick={() => openEdit(inv)}
                          >
                            <Edit2 className="h-3.5 w-3.5 mr-1" />
                            Edit
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {editInvoice && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-zinc-900">
              Edit Invoice — <span className="font-mono text-sm text-zinc-600">{editInvoice.invoice_no}</span>
            </h3>
            {editError && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{editError}</div>
            )}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Type</label>
              <div className="flex gap-3">
                {(["cash", "credit"] as const).map((t) => (
                  <label
                    key={t}
                    className={`flex-1 flex items-center justify-center gap-2 p-2.5 rounded-lg border cursor-pointer text-xs font-semibold capitalize transition-colors ${
                      editType === t
                        ? "border-red-600 bg-red-50 text-red-800"
                        : "border-zinc-200 bg-white text-zinc-600"
                    }`}
                  >
                    <input
                      type="radio"
                      name="editType"
                      value={t}
                      checked={editType === t}
                      onChange={() => setEditType(t)}
                      className="accent-red-600"
                    />
                    {t}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Paid (Rs.)</label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={editPaid}
                onChange={(e) => setEditPaid(parseFloat(e.target.value) || 0)}
                className="h-9 text-sm"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1"
                onClick={handleEditSave}
                disabled={isPending}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                Save
              </Button>
              <Button variant="outline" onClick={() => setEditInvoice(null)} disabled={isPending}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
