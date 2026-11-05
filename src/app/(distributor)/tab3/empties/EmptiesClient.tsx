"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Trash2 } from "lucide-react";
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
import { logEmpties, deleteEmptiesLogEntry, deleteEmptiesLogEntries, getEmptiesOnHand } from "@/lib/actions/inventory";
import { useRouter } from "next/navigation";

interface EmptiesClientProps {
  initialEmpties: any[];
  shops: any[];
  products: any[];
  invoices: any[]; // to validate invoice_no on blur
  emptiesOnHand: any[]; // summary stats
}

export function EmptiesClient({
  initialEmpties,
  shops,
  products,
  invoices,
  emptiesOnHand,
}: EmptiesClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Search filter
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Modal form states
  const [showModal, setShowModal] = useState(false);
  const [shopId, setShopId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState(0);
  const [depositAmount, setDepositAmount] = useState(0);
  const [logDate, setLogDate] = useState(new Date().toISOString().split("T")[0]);

  // Invoice validation status
  const [invoiceWarning, setInvoiceWarning] = useState("");

  const filteredEmpties = initialEmpties.filter((item) => {
    const s = search.toLowerCase();
    return (
      item.product_name.toLowerCase().includes(s) ||
      item.shop?.shop_name.toLowerCase().includes(s) ||
      item.invoice?.invoice_no?.toLowerCase().includes(s)
    );
  });

  const handleInvoiceBlur = () => {
    if (!invoiceNo.trim()) {
      setInvoiceWarning("");
      return;
    }
    const match = invoices.find((inv) => inv.invoice_no === invoiceNo.trim());
    if (!match) {
      setInvoiceWarning("Invoice No not found — entry will be saved unlinked.");
    } else {
      setInvoiceWarning("");
      // Autofill shop if invoice matches
      if (match.shop_id) {
        setShopId(match.shop_id);
      }
    }
  };

    const isAllSelected = filteredEmpties.length > 0 && filteredEmpties.every((item) => selectedIds.includes(item.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(filteredEmpties.map((item) => item.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected empties log entry(ies)?`)) return;
    startTransition(async () => {
      try {
        await deleteEmptiesLogEntries(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this empty bottles log entry?")) return;
    startTransition(async () => {
      try {
        await deleteEmptiesLogEntry(id);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopId || !productName || quantity <= 0) {
      alert("Please fill in all required fields.");
      return;
    }

    startTransition(async () => {
      try {
        await logEmpties({
          shop_id: shopId,
          invoice_no: invoiceNo || undefined,
          product_name: productName,
          quantity,
          deposit_amount: depositAmount,
          log_date: logDate,
        });
        setShowModal(false);
        setShopId("");
        setInvoiceNo("");
        setProductName("");
        setQuantity(0);
        setDepositAmount(0);
        setLogDate(new Date().toISOString().split("T")[0]);
        setInvoiceWarning("");
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const exportData = filteredEmpties.map((item) => ({
    "Shop": item.shop?.shop_name || "",
    "Invoice No": item.invoice?.invoice_no || item.invoice_no || "Unlinked",
    "Product": item.product_name,
    "Quantity": item.quantity,
    "Deposit Amount": item.deposit_amount,
    "Log Date": item.log_date,
  }));

  return (
    <div className="space-y-6">
      {/* Total Empties On Hand Cards / Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {emptiesOnHand.map((item, idx) => (
          <div key={idx} className="bg-zinc-50 border border-zinc-200 rounded-lg p-4 shadow-sm">
            <div className="text-xs font-semibold text-zinc-500 uppercase">{item.product_name}</div>
            <div className="text-xl font-bold text-zinc-900 mt-1">{Number(item.qty_on_hand).toLocaleString()} units</div>
            <div className="text-xs text-zinc-400 mt-1">Deposit: Rs.{Number(item.deposit_total).toLocaleString()}</div>
          </div>
        ))}
        {emptiesOnHand.length === 0 && (
          <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-4 shadow-sm col-span-full text-center text-zinc-400 text-sm">
            No bottles currently logged on hand.
          </div>
        )}
      </div>

      {/* Filters and Actions */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[12.5rem]">
          <Input
            placeholder="Search by Product, Shop, or Invoice..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
                <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={isAllSelected ? "ghost" : "outline"}
            size="sm"
            onClick={handleToggleSelectAll}
            className="whitespace-nowrap"
          >
            {isAllSelected ? "Deselect All" : "Select All"}
          </Button>
          {selectedIds.length > 0 && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={handleBulkDelete}
              disabled={isPending}
              className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 whitespace-nowrap"
            >
              <Trash2 className="h-4 w-4" />
              Delete ({selectedIds.length})
            </Button>
          )}
        </div>
        <ExportButtons data={exportData} filename="empties_log" />
        <Button onClick={() => {
          if (shops.length > 0) setShopId(shops[0].id);
          if (products.length > 0) setProductName(products[0].product_name);
          setInvoiceNo("");
          setQuantity(0);
          setDepositAmount(0);
          setLogDate(new Date().toISOString().split("T")[0]);
          setInvoiceWarning("");
          setShowModal(true);
        }}>
          + Add Empty Entries
        </Button>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center"><input type="checkbox" checked={isAllSelected} onChange={handleToggleSelectAll} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableHead>
              <TableHead>Shop</TableHead>
              <TableHead>Invoice No</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Deposit Amount</TableHead>
              <TableHead>Log Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEmpties.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-zinc-400 py-8">
                  No empty bottle logs found.
                </TableCell>
              </TableRow>
            ) : (
              filteredEmpties.map((item) => (
                <TableRow key={item.id} className={selectedIds.includes(item.id) ? "bg-red-50/50" : ""}>
                  <TableCell className="w-10 text-center"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => setSelectedIds(prev => prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableCell>
                  <TableCell>
                    <div className="font-medium">{item.shop?.shop_name}</div>
                    <div className="text-xs text-zinc-400">{item.shop?.outlet_code}</div>
                  </TableCell>
                  <TableCell>
                    {item.invoice?.invoice_no ? (
                      <span className="font-semibold text-zinc-700">{item.invoice.invoice_no}</span>
                    ) : (
                      <span className="text-xs text-zinc-400 italic">Unlinked</span>
                    )}
                  </TableCell>
                  <TableCell>{item.product_name}</TableCell>
                  <TableCell className="text-right font-semibold">{item.quantity}</TableCell>
                  <TableCell className="text-right">Rs.{Number(item.deposit_amount).toLocaleString()}</TableCell>
                  <TableCell>{item.log_date}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500 hover:text-red-700"
                      onClick={() => handleDelete(item.id)}
                      disabled={isPending}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ADD EMPTY ENTRIES MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-4">Log Empty Bottles / Crate Deposit</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Invoice No (optional)
                </label>
                <Input
                  placeholder="e.g. INV-001"
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  onBlur={handleInvoiceBlur}
                />
                {invoiceWarning && (
                  <p className="text-xs text-amber-600 mt-1 font-medium">{invoiceWarning}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Shop *
                </label>
                <select
                  className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white"
                  value={shopId}
                  onChange={(e) => setShopId(e.target.value)}
                  required
                >
                  <option value="">Select Shop...</option>
                  {shops.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.outlet_code} — {s.shop_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Product *
                </label>
                <select
                  className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  required
                >
                  <option value="">Select Product...</option>
                  {products.map((p: any) => (
                    <option key={p.id} value={p.product_name}>
                      {p.product_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">
                    Quantity *
                  </label>
                  <Input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">
                    Deposit Amount (Rs.)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Log Date
                </label>
                <Input
                  type="date"
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1" disabled={isPending}>
                  {isPending ? "Logging..." : "Add Empty Entry"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

