"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { createInvoice, updateInvoice, type InvoiceFormData } from "@/lib/actions/invoices";
import { parseProductsWithCode } from "@/lib/parsers/products";
import { Plus, Trash2 } from "lucide-react";

interface ProductRow {
  code: string;
  name: string;
  qty: string; // keep as string for input
}

interface InvoiceFormProps {
  shops: any[];
  onClose: () => void;
  onSuccess: (updatedPendingData?: any) => void;
  editData?: any;
  isPending?: boolean;
}

/** Parse the stored products string into editable rows */
function parseProductRows(products: string): ProductRow[] {
  if (!products || !products.trim()) return [];
  return parseProductsWithCode(products).map((p) => ({
    code: p.code,
    name: p.name,
    qty: String(p.qty),
  }));
}

/** Serialize rows back to the canonical format: "CODE     NAME×QTY, ..." */
function serializeProductRows(rows: ProductRow[]): string {
  return rows
    .filter((r) => r.code.trim() || r.name.trim())
    .map((r) => {
      const qty = r.qty !== "" && r.qty !== undefined ? r.qty : "1";
      return `${r.code.trim()}     ${r.name.trim()}×${qty}`;
    })
    .join(", ");
}

export function InvoiceForm({ shops, onClose, onSuccess, editData, isPending }: InvoiceFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [shopSearch, setShopSearch] = useState(() => {
    if (editData?.shop_id) {
      const s = shops.find((s: any) => s.id === editData.shop_id);
      return s ? `${s.outlet_code} — ${s.shop_name}` : "";
    }
    return editData?.outlet_code ? `${editData.outlet_code} — ${editData.outlet_name || ""}` : "";
  });
  const [shopOpen, setShopOpen] = useState(false);
  const shopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (shopRef.current && !shopRef.current.contains(e.target as Node)) setShopOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filteredShops = shops.filter((s: any) => {
    const q = shopSearch.toLowerCase();
    return s.outlet_code?.toLowerCase().includes(q) || s.shop_name?.toLowerCase().includes(q);
  });

  const [invoiceNo, setInvoiceNo] = useState(editData?.invoice_no || "");
  const [shopId, setShopId] = useState(editData?.shop_id || "");
  const [outletCode, setOutletCode] = useState(editData?.outlet_code || "");
  const [outletName, setOutletName] = useState(editData?.outlet_name || "");
  const [recordDate, setRecordDate] = useState(editData?.record_date || "");
  const [deliveryDate, setDeliveryDate] = useState(editData?.delivery_date || "");
  const [sellerCode, setSellerCode] = useState(editData?.seller_code || "");
  const [sellerName, setSellerName] = useState(editData?.seller_name || "");
  const [storeName, setStoreName] = useState(editData?.store_name || "");
  const [outletType, setOutletType] = useState(editData?.outlet_type || "");
  const [totalQty, setTotalQty] = useState(editData?.total_qty ?? "");
  const [amount, setAmount] = useState(editData?.amount ?? editData?.grand_total ?? "");
  const [taxReturn, setTaxReturn] = useState(editData?.tax_return || editData?.tax_return_book_no || "");
  const [exclTax, setExclTax] = useState(editData?.excl_tax ?? editData?.excl_tax_amount ?? "");
  const [salesTax, setSalesTax] = useState(editData?.sales_tax ?? "");
  const [advTax, setAdvTax] = useState(editData?.adv_tax ?? editData?.advance_income_tax ?? "");
  const [discTot, setDiscTot] = useState(editData?.disc_tot ?? editData?.discount_total ?? "");

  // Product rows state
  const [productRows, setProductRows] = useState<ProductRow[]>(() =>
    parseProductRows(editData?.products || "")
  );

  const addProductRow = () => {
    setProductRows((prev) => [...prev, { code: "", name: "", qty: "1" }]);
  };

  const removeProductRow = (idx: number) => {
    setProductRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateProductRow = (idx: number, field: keyof ProductRow, value: string) => {
    setProductRows((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const serializedProducts = serializeProductRows(productRows);
      const formData: InvoiceFormData = {
        invoice_no: invoiceNo,
        shop_id: shopId,
        outlet_code: outletCode || undefined,
        outlet_name: outletName || undefined,
        record_date: recordDate || undefined,
        delivery_date: deliveryDate || undefined,
        seller_code: sellerCode || undefined,
        seller_name: sellerName || undefined,
        store_name: storeName || undefined,
        outlet_type: outletType || undefined,
        total_qty: totalQty !== "" ? Number(totalQty) : undefined,
        amount: amount !== "" ? Number(amount) : undefined,
        tax_return: taxReturn || undefined,
        excl_tax: exclTax !== "" ? Number(exclTax) : undefined,
        sales_tax: salesTax !== "" ? Number(salesTax) : undefined,
        adv_tax: advTax !== "" ? Number(advTax) : undefined,
        disc_tot: discTot !== "" ? Number(discTot) : undefined,
        products: serializedProducts || undefined,
      };

      if (isPending || editData?._pending) {
        onSuccess({
          ...editData,
          ...formData,
          grand_total: formData.amount,
          excl_tax_amount: formData.excl_tax,
          advance_income_tax: formData.adv_tax,
          discount_total: formData.disc_tot,
          _pending: true,
        });
        return;
      }

      if (editData) {
        await updateInvoice(editData.id, formData);
      } else {
        await createInvoice(formData);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to save invoice");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-4 sm:p-6 border-b border-zinc-200">
          <h2 className="text-base sm:text-lg font-bold text-zinc-900">
            {isPending || editData?._pending ? "Edit Pending Invoice" : editData ? "Edit Invoice" : "Add Invoice"}
          </h2>
        </div>
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-3 sm:space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg border border-red-200">{error}</div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs sm:text-sm font-medium text-zinc-700 mb-1">Invoice No *</label>
              <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} required placeholder="gi0059494" />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-medium text-zinc-700 mb-1">Shop (link to outlet code)</label>
              <div ref={shopRef} className="relative">
                <input
                  type="text"
                  className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#e51e2a]/40 focus:border-[#e51e2a]"
                  placeholder="Search outlet code or shop name…"
                  value={shopSearch}
                  onChange={(e) => { setShopSearch(e.target.value); setShopId(""); setShopOpen(true); }}
                  onFocus={() => setShopOpen(true)}
                  autoComplete="off"
                />
                {shopId && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#e51e2a] text-xs font-medium pointer-events-none">✓</span>}
                {shopOpen && (
                  <div className="absolute z-50 mt-1 w-full bg-white border border-zinc-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                    {filteredShops.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-zinc-400">No shops found</div>
                    ) : filteredShops.map((s: any) => (
                      <button key={s.id} type="button"
                        className={["w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 transition-colors", shopId === s.id ? "bg-red-50 text-[#e51e2a] font-medium" : "text-zinc-800"].join(" ")}
                        onClick={() => { setShopId(s.id); setOutletCode(s.outlet_code || ""); setOutletName(s.shop_name || ""); setShopSearch(`${s.outlet_code} — ${s.shop_name}`); setShopOpen(false); }}
                      >
                        <span className="font-mono text-xs text-zinc-500 mr-2">{s.outlet_code}</span>{s.shop_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs sm:text-sm font-medium text-zinc-700 mb-1">Outlet Code</label>
              <Input value={outletCode} onChange={(e) => setOutletCode(e.target.value)} placeholder="3009842793" />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-medium text-zinc-700 mb-1">Outlet Name</label>
              <Input value={outletName} onChange={(e) => setOutletName(e.target.value)} placeholder="Ez mart" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs sm:text-sm font-medium text-zinc-700 mb-1">Record Date</label>
              <Input type="date" value={recordDate} onChange={(e) => setRecordDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-medium text-zinc-700 mb-1">Delivery Date</label>
              <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs sm:text-sm font-medium text-zinc-700 mb-1">Seller Code</label>
              <Input value={sellerCode} onChange={(e) => setSellerCode(e.target.value)} placeholder="T2" />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-medium text-zinc-700 mb-1">Seller Name</label>
              <Input value={sellerName} onChange={(e) => setSellerName(e.target.value)} placeholder="GJ.TAYYAB RAZA" />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-medium text-zinc-700 mb-1">Store Name</label>
              <Input value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="MAIN WAREHOUSE" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs sm:text-sm font-medium text-zinc-700 mb-1">Type</label>
              <Input value={outletType} onChange={(e) => setOutletType(e.target.value)} placeholder="Supermarket-Small" />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-medium text-zinc-700 mb-1">Total Qty</label>
              <Input type="number" step="0.01" value={totalQty} onChange={(e) => setTotalQty(e.target.value)} placeholder="0" />
            </div>
          </div>

          <div className="bg-zinc-50 rounded-lg p-3 sm:p-4 border border-zinc-200 space-y-3">
            <h3 className="text-xs sm:text-sm font-semibold text-zinc-900">Financial Fields</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Amount</label>
                <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Excl Tax</label>
                <Input type="number" step="0.01" value={exclTax} onChange={(e) => setExclTax(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Sales Tax</label>
                <Input type="number" step="0.01" value={salesTax} onChange={(e) => setSalesTax(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Adv. Tax</label>
                <Input type="number" step="0.01" value={advTax} onChange={(e) => setAdvTax(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Disc. Tot</label>
                <Input type="number" step="0.01" value={discTot} onChange={(e) => setDiscTot(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Tax Return</label>
                <select className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white" value={taxReturn} onChange={(e) => setTaxReturn(e.target.value)}>
                  <option value="">—</option>
                  <option value="Y">Y</option>
                  <option value="N">N</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── Products Table ─────────────────────────────────────────────── */}
          <div className="border border-zinc-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between bg-zinc-50 px-3 py-2 border-b border-zinc-200">
              <span className="text-xs font-semibold text-zinc-700 uppercase tracking-wide">Products</span>
              <button
                type="button"
                onClick={addProductRow}
                className="flex items-center gap-1 text-xs text-[#e51e2a] font-medium hover:underline"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Row
              </button>
            </div>

            {/* Header row */}
            <div className="grid grid-cols-[6.25rem_1fr_4.5rem_2rem] gap-1 px-2 py-1 bg-zinc-100 border-b border-zinc-200 text-[0.625rem] font-bold text-zinc-500 uppercase tracking-wider">
              <span>Code</span>
              <span>Product</span>
              <span className="text-right">Qty</span>
              <span />
            </div>

            {productRows.length === 0 ? (
              <div className="text-center text-zinc-400 text-xs py-4 font-medium">
                No products — click <span className="font-semibold text-zinc-500">Add Row</span> to add one
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 max-h-56 overflow-y-auto">
                {productRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-[6.25rem_1fr_4.5rem_2rem] gap-1 px-2 py-1 items-center hover:bg-zinc-50">
                    <input
                      type="text"
                      value={row.code}
                      onChange={(e) => updateProductRow(idx, "code", e.target.value)}
                      placeholder="100130"
                      className="h-7 w-full rounded border border-zinc-200 px-2 text-xs font-mono bg-white focus:outline-none focus:border-[#e51e2a]"
                    />
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateProductRow(idx, "name", e.target.value)}
                      placeholder="COCA-COLA RB 250 ML"
                      className="h-7 w-full rounded border border-zinc-200 px-2 text-xs bg-white focus:outline-none focus:border-[#e51e2a]"
                    />
                    <input
                      type="number"
                      value={row.qty}
                      onChange={(e) => updateProductRow(idx, "qty", e.target.value)}
                      placeholder="1"
                      step="1"
                      className="h-7 w-full rounded border border-zinc-200 px-2 text-xs text-right bg-white focus:outline-none focus:border-[#e51e2a]"
                    />
                    <button
                      type="button"
                      onClick={() => removeProductRow(idx)}
                      className="h-7 w-7 flex items-center justify-center rounded hover:bg-red-50 text-zinc-400 hover:text-red-500 transition-colors"
                      title="Remove row"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {productRows.length > 0 && (
              <div className="px-3 py-1.5 bg-zinc-50 border-t border-zinc-200 text-[0.625rem] text-zinc-400 font-mono truncate">
                Preview: {serializeProductRows(productRows).slice(0, 120) || "—"}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4 border-t border-zinc-200">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? "Saving..." : editData ? "Update Invoice" : "Create Invoice"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
