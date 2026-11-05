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
import { createProduct, updateProduct, deleteProduct, deleteWarehouseStocks } from "@/lib/actions/inventory";
import { useRouter } from "next/navigation";

interface WarehouseClientProps {
  initialStock: any[];
}

export function WarehouseClient({ initialStock }: WarehouseClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Search filter
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Add/Edit Form Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [qtyTotal, setQtyTotal] = useState(0);
  const [qtyFlappy, setQtyFlappy] = useState(0);

  const filteredStock = initialStock.filter((item) =>
    item.product_name.toLowerCase().includes(search.toLowerCase())
  );

  const handleEdit = (item: any) => {
    setEditingId(item.id);
    setProductName(item.product_name);
    setQtyTotal(item.qty_total);
    setQtyFlappy(item.qty_flappy);
    setShowModal(true);
  };

    const isAllSelected = filteredStock.length > 0 && filteredStock.every((item) => selectedIds.includes(item.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(filteredStock.map((item) => item.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected warehouse stock item(s)?`)) return;
    startTransition(async () => {
      try {
        await deleteWarehouseStocks(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this product from warehouse stock?")) return;
    startTransition(async () => {
      try {
        await deleteProduct(id);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName.trim()) return;

    startTransition(async () => {
      try {
        if (editingId) {
          await updateProduct(editingId, {
            product_name: productName,
            qty_total: qtyTotal,
            qty_flappy: qtyFlappy,
          });
        } else {
          await createProduct({
            product_name: productName,
            qty_total: qtyTotal,
            qty_flappy: qtyFlappy,
            // qty_reserved is implicitly 0
          });
        }
        setShowModal(false);
        setEditingId(null);
        setProductName("");
        setQtyTotal(0);
        setQtyFlappy(0);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const exportData = filteredStock.map((s) => {
    const available = (s.qty_total || 0) - (s.qty_reserved || 0) - (s.qty_flappy || 0);
    return {
      "Product Name": s.product_name,
      "Total Qty": s.qty_total,
      "Reserved Qty": s.qty_reserved,
      "Available Qty": available,
      "Flappy Qty": s.qty_flappy,
    };
  });

  return (
    <div className="space-y-4">
      {/* Search and Buttons */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[12.5rem]">
          <Input
            placeholder="Search products..."
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
        <ExportButtons data={exportData} filename="warehouse_stock" />
        <Button onClick={() => {
          setEditingId(null);
          setProductName("");
          setQtyTotal(0);
          setQtyFlappy(0);
          setShowModal(true);
        }}>
          + Add Product
        </Button>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center"><input type="checkbox" checked={isAllSelected} onChange={handleToggleSelectAll} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableHead>
              <TableHead>Product Name</TableHead>
              <TableHead className="text-right">Total Qty</TableHead>
              <TableHead className="text-right">Reserved</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="text-right">Flappy</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredStock.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-zinc-400 py-8">
                  No products found
                </TableCell>
              </TableRow>
            ) : (
              filteredStock.map((item) => {
                const available = (item.qty_total || 0) - (item.qty_reserved || 0) - (item.qty_flappy || 0);
                return (
                <TableRow key={item.id} className={selectedIds.includes(item.id) ? "bg-red-50/50" : ""}>
                  <TableCell className="w-10 text-center"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => setSelectedIds(prev => prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableCell>
                  <TableCell className="font-medium">{item.product_name}</TableCell>
                  <TableCell className="text-right font-semibold">{item.qty_total.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-zinc-500">{item.qty_reserved.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-red-600 font-semibold">{available.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-red-500">{item.qty_flappy.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => handleEdit(item)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-700"
                        onClick={() => handleDelete(item.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* ADD / EDIT MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-4">
              {editingId ? "Edit Product" : "Add Product"}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Product Name *
                </label>
                <Input
                  placeholder="e.g. Coke 1.5L"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Total Qty *
                  </label>
                  <Input
                    type="number"
                    value={qtyTotal}
                    onChange={(e) => setQtyTotal(parseInt(e.target.value) || 0)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Flappy
                  </label>
                  <Input
                    type="number"
                    value={qtyFlappy}
                    onChange={(e) => setQtyFlappy(parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Product"}
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

