"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { ExportButtons } from "@/components/export/ExportButtons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { createDamagedStock, updateDamagedStock, deleteDamagedStock, deleteDamagedStocks } from "@/lib/actions/inventory";
import { useRouter } from "next/navigation";

interface DamagedClientProps {
  initialDamaged: any[];
  products: any[]; // list of products in warehouse to use in dropdown
  purchases: any[]; // purchasing records to auto-fill batch number
}

export function DamagedClient({ initialDamaged, products, purchases }: DamagedClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const productOptions = products.map((p: any) => ({
    value: p.product_name,
    label: p.product_name,
    sub: p.product_code || undefined,
  }));

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState(0);
  const [damageType, setDamageType] = useState("");
  const [webspaceRef, setWebspaceRef] = useState("");
  const [status, setStatus] = useState<"pending" | "complaint_filed" | "adjusted">("pending");
  const [note, setNote] = useState("");

  const filteredDamaged = initialDamaged.filter((item) => {
    const s = search.toLowerCase();
    const matchSearch =
      !search ||
      item.product_name.toLowerCase().includes(s) ||
      item.damage_type?.toLowerCase().includes(s) ||
      item.webspace_ref?.toLowerCase().includes(s);

    const matchStatus = !statusFilter || item.status === statusFilter;

    return matchSearch && matchStatus;
  });

  const handleEdit = (item: any) => {
    setEditingId(item.id);
    setProductName(item.product_name);
    setQuantity(item.quantity);
    setDamageType(item.damage_type || "");
    setWebspaceRef(item.webspace_ref || "");
    setStatus(item.status);
    setNote(item.note || "");
    setShowModal(true);
  };

    const isAllSelected = filteredDamaged.length > 0 && filteredDamaged.every((item) => selectedIds.includes(item.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(filteredDamaged.map((item) => item.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected damaged stock record(s)?`)) return;
    startTransition(async () => {
      try {
        await deleteDamagedStocks(selectedIds);
        setSelectedIds([]);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this damaged stock record?")) return;
    startTransition(async () => {
      try {
        await deleteDamagedStock(id);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName) return;

    startTransition(async () => {
      try {
        if (editingId) {
          await updateDamagedStock(editingId, {
            product_name: productName,
            quantity: quantity,
            damage_type: damageType || undefined,
            webspace_ref: webspaceRef || undefined,
            status,
            note: note || undefined,
          });
        } else {
          await createDamagedStock({
            product_name: productName,
            quantity: quantity,
            damage_type: damageType || undefined,
            webspace_ref: webspaceRef || undefined,
            status,
            note: note || undefined,
          });
        }
        setShowModal(false);
        setEditingId(null);
        setProductName("");
        setQuantity(0);
        setDamageType("");
        setWebspaceRef("");
        setStatus("pending");
        setNote("");
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const statusBadge = (s: string) => {
    switch (s) {
      case "adjusted":
        return <Badge variant="success">Adjusted</Badge>;
      case "complaint_filed":
        return <Badge variant="default">Complaint Filed</Badge>;
      default:
        return <Badge variant="warning">Pending</Badge>;
    }
  };

  const exportData = filteredDamaged.map((s) => ({
    "Product": s.product_name,
    "Qty": s.quantity,
    "Damage Type": s.damage_type || "",
    "Batch": s.batch_no || "",
    "Recorded": s.recorded_date,
    "Webspace Ref": s.webspace_ref || "",
    "Status": s.status,
    "Note": s.note || "",
  }));

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[12.5rem]">
          <Input
            placeholder="Search by Product, Damage Type, Webspace Ref..."
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
          <option value="pending">Pending</option>
          <option value="complaint_filed">Complaint Filed</option>
          <option value="adjusted">Adjusted</option>
        </select>
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
        <ExportButtons data={exportData} filename="damaged_stock" />
        <Button onClick={() => {
          setEditingId(null);
          setProductName(products.length > 0 ? products[0].product_name : "");
          setQuantity(0);
          setDamageType("");
          setWebspaceRef("");
          setStatus("pending");
          setNote("");
          setShowModal(true);
        }}>
          + Record Damage
        </Button>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center"><input type="checkbox" checked={isAllSelected} onChange={handleToggleSelectAll} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Damage Type</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Recorded</TableHead>
              <TableHead>Webspace Ref</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredDamaged.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-zinc-400 py-8">
                  No records found
                </TableCell>
              </TableRow>
            ) : (
              filteredDamaged.map((item) => (
                <TableRow key={item.id} className={selectedIds.includes(item.id) ? "bg-red-50/50" : ""}>
                  <TableCell className="w-10 text-center"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => setSelectedIds(prev => prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id])} className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4" /></TableCell>
                  <TableCell className="font-medium">{item.product_name}</TableCell>
                  <TableCell className="text-right font-semibold">{item.quantity.toLocaleString()}</TableCell>
                  <TableCell>{item.damage_type || "—"}</TableCell>
                  <TableCell>{item.batch_no || "—"}</TableCell>
                  <TableCell>{item.recorded_date}</TableCell>
                  <TableCell>{item.webspace_ref || "—"}</TableCell>
                  <TableCell>{statusBadge(item.status)}</TableCell>
                  <TableCell className="text-xs text-zinc-500 max-w-[9.375rem] truncate" title={item.note}>
                    {item.note || "—"}
                  </TableCell>
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
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ADD / EDIT MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-4">
              {editingId ? "Edit Damaged Stock" : "Record Damaged Stock"}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Product *
                </label>
                <SearchableSelect
                  options={productOptions}
                  value={productName}
                  onChange={(v) => setProductName(v)}
                  placeholder="Select product..."
                  searchPlaceholder="Search products..."
                  required
                />
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
                    Status *
                  </label>
                  <select
                    className="w-full h-9 rounded-md border border-zinc-300 px-3 text-sm bg-white"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    required
                  >
                    <option value="pending">Pending</option>
                    <option value="complaint_filed">Complaint Filed</option>
                    <option value="adjusted">Adjusted</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Damage Type
                </label>
                <Input
                  placeholder="e.g. Leaking caps"
                  value={damageType}
                  onChange={(e) => setDamageType(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Webspace Ref
                </label>
                <Input
                  placeholder="e.g. WS-0441"
                  value={webspaceRef}
                  onChange={(e) => setWebspaceRef(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Note
                </label>
                <Input
                  placeholder="Additional description..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Record"}
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

