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
import { recordShopPayment } from "@/lib/actions/shops";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface CreditClientProps {
  initialShops: any[];
  invoices: any[];
  bankAccounts?: any[];
  creditInvoicesLimit?: number;
  initialPayments?: any[];
}

export function CreditClient({
  initialShops,
  invoices: initialInvoices,
  bankAccounts = [],
  creditInvoicesLimit = 1,
  initialPayments = [],
}: CreditClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [payments, setPayments] = useState<any[]>(initialPayments);
  const [invoices, setInvoices] = useState<any[]>(initialInvoices);

  useEffect(() => {
    setPayments(initialPayments);
  }, [initialPayments]);

  useEffect(() => {
    setInvoices(initialInvoices);
  }, [initialInvoices]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [payingShopId, setPayingShopId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentDate, setPaymentDate] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>("");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceDropdownOpen, setInvoiceDropdownOpen] = useState(false);
  const [paymentDescription, setPaymentDescription] = useState<string>("Online Rec");
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string>("");
  const [bankSearch, setBankSearch] = useState("");
  const [bankDropdownOpen, setBankDropdownOpen] = useState(false);

  const [drilldownShopId, setDrilldownShopId] = useState<string | null>(null);

  // Compute stats per shop
  const computedShops = initialShops.map((shop) => {
    // Filter invoices for this shop (match shop_id or outlet_code)
    const shopInvoices = invoices.filter(
      (i) =>
        (i.shop_id && i.shop_id === shop.id) ||
        (i.outlet_code && shop.outlet_code && i.outlet_code === shop.outlet_code)
    );

    // Unpaid invoices (balance > 0.01) — same membership idea as Credit Summary for a shop
    const invoiceDeliveryDate = (i: any) =>
      String(i.delivery_date || i.invoice_date || i.record_date || i.scheduled_date || "").split("T")[0];

    // Only unpaid credit invoices count toward Used / overdue on this page
    const creditInvoices = shopInvoices
      .filter((i) => {
        if ((i.invoice_type || "").toLowerCase() !== "credit") return false;
        const total = Number(i.amount ?? i.grand_total ?? i.invoice_total ?? 0);
        const paid = Number(i.amount_received || 0);
        return total - paid > 0.01;
      })
      .sort((a, b) => invoiceDeliveryDate(b).localeCompare(invoiceDeliveryDate(a)));

    // Overdue invoices: scheduled_date < today
    const overdueInvoices = creditInvoices.filter((i) => {
      if (!i.scheduled_date) return false;
      const invDate = new Date(i.scheduled_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return invDate < today;
    });

    // Used credit = sum of unpaid balances
    const used = creditInvoices.reduce((sum, i) => {
      const total = Number(i.amount ?? i.grand_total ?? i.invoice_total ?? 0);
      const paid = Number(i.amount_received || 0);
      return sum + Math.max(0, total - paid);
    }, 0);

    // Overdue credit = sum of overdue unpaid balances
    const overdue = overdueInvoices.reduce((sum, i) => {
      const total = Number(i.amount ?? i.grand_total ?? i.invoice_total ?? 0);
      const paid = Number(i.amount_received || 0);
      return sum + Math.max(0, total - paid);
    }, 0);

    const isOverdue = creditInvoices.length > creditInvoicesLimit;

    // Remaining limit (Credit Limit - Used Credit)
    const remainingLimit = Math.max(0, Number(shop.credit_limit || 0) - used);

    // Aging: 30 / 60 / 90
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const aging30 = creditInvoices.reduce((sum, i) => {
      if (!i.scheduled_date) return sum;
      const d = new Date(i.scheduled_date);
      d.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays >= 1 && diffDays <= 30) {
        const total = Number(i.amount ?? i.grand_total ?? i.invoice_total ?? 0);
        const paid = Number(i.amount_received || 0);
        return sum + Math.max(0, total - paid);
      }
      return sum;
    }, 0);

    const aging60 = creditInvoices.reduce((sum, i) => {
      if (!i.scheduled_date) return sum;
      const d = new Date(i.scheduled_date);
      d.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays >= 31 && diffDays <= 60) {
        const total = Number(i.amount ?? i.grand_total ?? i.invoice_total ?? 0);
        const paid = Number(i.amount_received || 0);
        return sum + Math.max(0, total - paid);
      }
      return sum;
    }, 0);

    const aging90 = creditInvoices.reduce((sum, i) => {
      if (!i.scheduled_date) return sum;
      const d = new Date(i.scheduled_date);
      d.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 60) {
        const total = Number(i.amount ?? i.grand_total ?? i.invoice_total ?? 0);
        const paid = Number(i.amount_received || 0);
        return sum + Math.max(0, total - paid);
      }
      return sum;
    }, 0);

    // Status: SAFE / OVERDUE / BLOCKED
    let status: "SAFE" | "OVERDUE" | "BLOCKED" = "SAFE";
    if (shop.is_blocked) {
      status = "BLOCKED";
    } else if (isOverdue) {
      status = "OVERDUE";
    }

    // Last Payment: Date of latest recorded retailer payment in shop_payments
    const shopPaymentsList = payments.filter(
      (p) =>
        (p.shop_id && p.shop_id === shop.id) ||
        (p.invoice_id && shopInvoices.some((inv) => inv.id === p.invoice_id))
    );
    let lastPaymentDate = "—";
    if (shopPaymentsList.length > 0) {
      lastPaymentDate = shopPaymentsList.reduce((latest, current) => {
        const pDate = current.payment_date ? String(current.payment_date).split("T")[0] : "";
        return pDate > latest ? pDate : latest;
      }, "");
      if (!lastPaymentDate) lastPaymentDate = "—";
    }

    return {
      ...shop,
      used,
      overdue,
      isOverdue,
      status,
      lastPaymentDate,
      shopInvoices,
      unpaidInvoices: creditInvoices,
      overdueInvoices,
    };
  });

  // Credit page: only shops marked credit (shop_type or outlet_type). Cash shops stay off this list.
  const filteredShops = computedShops.filter((shop) => {
    const isCreditShop =
      (shop.shop_type || "").toLowerCase() === "credit" ||
      (shop.outlet_type || "").toLowerCase() === "credit";
    if (!isCreditShop) return false;

    const s = search.toLowerCase();
    const matchSearch =
      !search ||
      (shop.shop_name && shop.shop_name.toLowerCase().includes(s)) ||
      (shop.outlet_code && shop.outlet_code.toLowerCase().includes(s));

    const matchStatus =
      !statusFilter ||
      (statusFilter === "overdue" && shop.status === "OVERDUE") ||
      (statusFilter === "safe" && shop.status === "SAFE");

    return matchSearch && matchStatus;
  });

  const handleRecordPayment = () => {
    if (!selectedInvoiceId || paymentAmount <= 0) {
      alert("Please select an invoice and enter a valid payment amount.");
      return;
    }
    startTransition(async () => {
      try {
        await recordShopPayment(
          selectedInvoiceId,
          paymentAmount,
          paymentDescription,
          selectedBankAccountId || undefined,
          paymentDate
        );
        setPayments((prev) => [
          {
            id: `temp-${Date.now()}`,
            shop_id: payingShopId,
            invoice_id: selectedInvoiceId,
            amount: paymentAmount,
            payment_date: paymentDate,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
        setInvoices((prev) =>
          prev.map((inv) =>
            inv.id === selectedInvoiceId
              ? { ...inv, amount_received: Number(inv.amount_received || 0) + paymentAmount }
              : inv
          )
        );
        setPayingShopId(null);
        setSelectedInvoiceId("");
        setPaymentAmount(0);
        setPaymentDate(new Date().toISOString().split("T")[0]);
        setInvoiceSearch("");
        setInvoiceDropdownOpen(false);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  // Export Data matching table
  const mainExportData = filteredShops.map((s) => ({
    "Outlet Name": s.shop_name,
    "Outlet Code": s.outlet_code,
    Used: s.used,
    Overdue: s.overdue,
    Status: s.status,
    "Last Payment": s.lastPaymentDate,
  }));

  const drilldownShop = computedShops.find((s) => s.id === drilldownShopId);
  const payingShop = computedShops.find((s) => s.id === payingShopId);

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[12.5rem]">
          <Input
            placeholder="Search by Outlet Name or Outlet Code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="overdue">Overdue</option>
          <option value="safe">Safe</option>
        </select>
        <ExportButtons data={mainExportData} filename="credit_outlets" />
      </div>

      {/* Main Table: Outlet Name | Used | Overdue | Status | Last Payment | Actions */}
      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Outlet Name</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="text-right">Overdue</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Payment</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredShops.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-zinc-400 py-8">
                  No credit outlets found
                </TableCell>
              </TableRow>
            ) : (
              filteredShops.map((shop) => (
                <TableRow key={shop.id}>
                  <TableCell className="text-xs">
                    <Link
                      href={`/shop-details/${shop.id}`}
                      className="font-medium text-red-600 hover:text-red-900 block text-xs"
                    >
                      {shop.shop_name}
                    </Link>
                    <span className="text-[0.625rem] text-zinc-400 block">{shop.outlet_code}</span>
                  </TableCell>
                  <TableCell className="text-right font-medium text-xs">
                    {shop.used > 0
                      ? `Rs.${shop.used.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right font-bold text-red-600 text-xs">
                    {shop.status === "OVERDUE" && shop.overdue > 0
                      ? `Rs.${shop.overdue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : shop.status === "OVERDUE"
                      ? `Overdue (${shop.unpaidInvoices.length} invs)`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {shop.status === "SAFE" ? (
                      <Badge variant="success" className="text-[0.625rem] py-0 px-1 font-semibold">
                        SAFE
                      </Badge>
                    ) : shop.status === "OVERDUE" ? (
                      <Badge variant="warning" className="text-[0.625rem] py-0 px-1 font-bold">
                        OVERDUE
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="text-[0.625rem] py-0 px-1 font-bold">
                        BLOCKED
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{shop.lastPaymentDate}</TableCell>
                  <TableCell className="text-right text-xs">
                    <div className="flex gap-1 justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDrilldownShopId(shop.id)}
                      >
                        View Unpaid
                      </Button>
                      {shop.unpaidInvoices.length > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setPayingShopId(shop.id);
                            setSelectedInvoiceId(shop.unpaidInvoices[0]?.id || "");
                            setPaymentAmount(0);
                            setPaymentDate(new Date().toISOString().split("T")[0]);
                            setInvoiceSearch("");
                            setInvoiceDropdownOpen(false);
                            setBankDropdownOpen(false);
                          }}
                        >
                          Record Payment
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* RECORD PAYMENT MODAL */}
      {payingShopId && payingShop && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-4">Record Retailer Payment</h3>
            <div className="space-y-4">
              <div className="relative">
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Select Unpaid Invoice *
                </label>
                {(() => {
                  const selInv = payingShop.unpaidInvoices.find((inv: any) => inv.id === selectedInvoiceId);
                  const selTotal = selInv ? Number(selInv.amount ?? selInv.grand_total ?? selInv.invoice_total ?? 0) : 0;
                  const selBal = selInv ? Math.max(0, selTotal - Number(selInv.amount_received ?? 0)) : 0;
                  const label = selInv
                    ? `${selInv.invoice_no} (Bal: Rs.${selBal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
                    : "— Select Unpaid Invoice —";

                  return (
                    <div
                      className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white flex items-center justify-between cursor-pointer focus:outline-none"
                      onClick={() => {
                        setInvoiceDropdownOpen((o) => !o);
                        setBankDropdownOpen(false);
                      }}
                    >
                      <span className={selectedInvoiceId ? "text-zinc-900 font-medium" : "text-zinc-400"}>
                        {label}
                      </span>
                      <span className="text-xs text-zinc-400">▼</span>
                    </div>
                  );
                })()}

                {invoiceDropdownOpen && (
                  <div className="absolute z-50 mt-1 left-0 right-0 bg-white border border-zinc-200 rounded-lg shadow-xl overflow-hidden">
                    <div className="p-2 border-b border-zinc-100">
                      <input
                        autoFocus
                        className="w-full text-sm border border-zinc-200 rounded px-2 py-1 outline-none focus:border-zinc-400"
                        placeholder="Search invoice number or date..."
                        value={invoiceSearch}
                        onChange={(e) => setInvoiceSearch(e.target.value)}
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto divide-y divide-zinc-100">
                      {payingShop.unpaidInvoices
                        .filter((inv: any) => {
                          const q = invoiceSearch.toLowerCase().trim();
                          if (!q) return true;
                          return (
                            (inv.invoice_no && inv.invoice_no.toLowerCase().includes(q)) ||
                            (inv.scheduled_date && inv.scheduled_date.toLowerCase().includes(q))
                          );
                        })
                        .map((inv: any) => {
                          const total = Number(inv.amount ?? inv.grand_total ?? inv.invoice_total ?? 0);
                          const bal = Math.max(0, total - Number(inv.amount_received ?? 0));
                          const isSelected = selectedInvoiceId === inv.id;
                          return (
                            <button
                              key={inv.id}
                              type="button"
                              className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 flex justify-between items-center ${
                                isSelected ? "bg-red-50 text-red-700 font-semibold" : ""
                              }`}
                              onClick={() => {
                                setSelectedInvoiceId(inv.id);
                                setInvoiceSearch("");
                                setInvoiceDropdownOpen(false);
                              }}
                            >
                              <div>
                                <span className="font-mono font-medium">{inv.invoice_no}</span>
                                {inv.scheduled_date && (
                                  <span className="text-xs text-zinc-400 ml-2">({inv.scheduled_date})</span>
                                )}
                              </div>
                              <span className="text-xs font-mono text-zinc-600">
                                Bal: Rs.{bal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </button>
                          );
                        })}
                      {payingShop.unpaidInvoices.filter((inv: any) => {
                        const q = invoiceSearch.toLowerCase().trim();
                        if (!q) return true;
                        return (
                          (inv.invoice_no && inv.invoice_no.toLowerCase().includes(q)) ||
                          (inv.scheduled_date && inv.scheduled_date.toLowerCase().includes(q))
                        );
                      }).length === 0 && (
                        <div className="p-3 text-xs text-zinc-400 text-center">
                          No matching unpaid invoices
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Payment Amount (Rs.) *
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(parseFloat(e.target.value))}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Payment Date *
                </label>
                <Input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Description / Remarks
                </label>
                <Input
                  placeholder="e.g. Online Rec, Cash Collection"
                  value={paymentDescription}
                  onChange={(e) => setPaymentDescription(e.target.value)}
                />
              </div>
              <div className="relative">
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Deposit to Account
                </label>
                <div
                  className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white flex items-center cursor-pointer"
                  onClick={() => {
                    setBankDropdownOpen((o) => !o);
                    setInvoiceDropdownOpen(false);
                  }}
                >
                  <span className={selectedBankAccountId ? "text-zinc-900" : "text-zinc-400"}>
                    {selectedBankAccountId
                      ? bankAccounts.find((b: any) => b.id === selectedBankAccountId)
                          ? `${(bankAccounts.find((b: any) => b.id === selectedBankAccountId) as any).bank_name} (${(bankAccounts.find((b: any) => b.id === selectedBankAccountId) as any).account_title})`
                          : "None —"
                      : "None —"}
                  </span>
                </div>
                {bankDropdownOpen && (
                  <div className="absolute z-50 mt-1 left-0 right-0 bg-white border border-zinc-200 rounded-lg shadow-xl overflow-hidden">
                    <div className="p-2 border-b border-zinc-100">
                      <input
                        autoFocus
                        className="w-full text-sm border border-zinc-200 rounded px-2 py-1 outline-none focus:border-zinc-400"
                        placeholder="Search account..."
                        value={bankSearch}
                        onChange={(e) => setBankSearch(e.target.value)}
                      />
                    </div>
                    <div className="max-h-44 overflow-y-auto divide-y divide-zinc-100">
                      <button
                        type="button"
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 ${
                          !selectedBankAccountId ? "bg-zinc-100 font-semibold" : ""
                        }`}
                        onClick={() => { setSelectedBankAccountId(""); setBankSearch(""); setBankDropdownOpen(false); }}
                      >
                        — None —
                      </button>
                      {bankAccounts
                        .filter((b: any) => {
                          const q = bankSearch.toLowerCase();
                          return !q || b.bank_name?.toLowerCase().includes(q) || b.account_title?.toLowerCase().includes(q);
                        })
                        .map((b: any) => (
                          <button
                            key={b.id}
                            type="button"
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 ${
                              selectedBankAccountId === b.id ? "bg-red-50 text-red-700 font-semibold" : ""
                            }`}
                            onClick={() => { setSelectedBankAccountId(b.id); setBankSearch(""); setBankDropdownOpen(false); }}
                          >
                            {b.bank_name} ({b.account_title})
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={handleRecordPayment}
                  disabled={isPending || paymentAmount <= 0}
                >
                  Save Payment
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPayingShopId(null);
                    setInvoiceDropdownOpen(false);
                    setBankDropdownOpen(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* UNPAID INVOICES DRILLDOWN MODAL */}
      {drilldownShopId && drilldownShop && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-zinc-200 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-zinc-900">
                  Unpaid Credit Invoices — {drilldownShop.shop_name}
                </h3>
                <p className="text-sm text-zinc-500 mt-1">
                  Outlet Code: {drilldownShop.outlet_code} | Total Unpaid: {drilldownShop.unpaidInvoices.length} invoices (Limit: {creditInvoicesLimit})
                </p>
              </div>
              <Button variant="ghost" onClick={() => setDrilldownShopId(null)}>
                Close
              </Button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice No</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Grand Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Overdue Reason</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drilldownShop.unpaidInvoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-zinc-400 py-6">
                        No unpaid invoices.
                      </TableCell>
                    </TableRow>
                  ) : (
                    drilldownShop.unpaidInvoices.map((inv: any, idx: number) => {
                      const total = Number(inv.amount ?? inv.grand_total ?? inv.invoice_total ?? 0);
                      const paid = Number(inv.amount_received ?? 0);
                      const balance = Math.max(0, total - paid);
                      const invDate =
                        inv.delivery_date || inv.invoice_date || inv.record_date || inv.scheduled_date || "—";
                      // Newest N (by delivery date) are within the credit invoices limit
                      const isInvoiceOverdue = idx >= creditInvoicesLimit;

                      return (
                        <TableRow key={inv.id}>
                          <TableCell className="font-medium">{inv.invoice_no}</TableCell>
                          <TableCell>{invDate}</TableCell>
                          <TableCell className="text-right">Rs.{total.toLocaleString()}</TableCell>
                          <TableCell className="text-right">Rs.{paid.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-semibold">
                            Rs.{balance.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs">
                            {isInvoiceOverdue ? (
                              <span className="text-red-600 font-semibold">Previous unpaid invoice</span>
                            ) : (
                              <span className="text-zinc-400">Within limit</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {isInvoiceOverdue ? (
                              <Badge variant="destructive">OVERDUE</Badge>
                            ) : (
                              <Badge variant="warning">Outstanding</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
