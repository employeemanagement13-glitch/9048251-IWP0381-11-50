"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { ExportButtons } from "@/components/export/ExportButtons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { createTenant, updateTenant, deleteTenant } from "@/lib/actions/admin";

interface Props {
  initialTenants: any[];
}

export function AdminDashboardClient({ initialTenants }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);

  const [form, setForm] = useState({
    distro_name: "",
    email: "",
    phone_number: "",
    access_enabled: true,
  });

  const resetForm = () => {
    setForm({
      distro_name: "",
      email: "",
      phone_number: "",
      access_enabled: true,
    });
  };

  const handleEditClick = (tenant: any) => {
    setEditingItem(tenant);
    setForm({
      distro_name: tenant.distro_name,
      email: tenant.email,
      phone_number: tenant.phone_number || "",
      access_enabled: tenant.access_enabled,
    });
    setShowModal(true);
  };

  const handleToggleAccess = (tenant: any) => {
    startTransition(async () => {
      try {
        await updateTenant(tenant.id, { access_enabled: !tenant.access_enabled });
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this tenant and all associated data? This action is irreversible.")) return;
    startTransition(async () => {
      try {
        await deleteTenant(id);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.distro_name.trim() || !form.email.trim() || !form.phone_number.trim()) {
      alert("Please fill in all required fields (Distro Name, Email, Phone Number).");
      return;
    }

    startTransition(async () => {
      try {
        if (editingItem) {
          await updateTenant(editingItem.id, form);
        } else {
          await createTenant(form);
        }
        setShowModal(false);
        setEditingItem(null);
        resetForm();
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      }
    });
  };

  const filteredTenants = initialTenants.filter(
    (t) =>
      t.distro_name.toLowerCase().includes(search.toLowerCase()) ||
      t.phone_number.toLowerCase().includes(search.toLowerCase())
  );

  const exportData = filteredTenants.map((t) => ({
    "Distro Name": t.distro_name,
    Phone: t.phone_number,
    Email: t.email,
    Access: t.access_enabled ? "Enabled" : "Disabled",
    Created: new Date(t.created_at).toLocaleDateString(),
    "Last Edit": new Date(t.updated_at).toLocaleDateString(),
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex gap-2 items-center flex-1 max-w-md">
          <Input
            placeholder="Search by name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {/* Admin panel calls for Export to Excel only */}
          <ExportButtons data={exportData} filename="tenants_list" />
          <Button onClick={() => { setEditingItem(null); resetForm(); setShowModal(true); }}>
            + Add Distribution
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Distro Name</TableHead>
              <TableHead>Phone No.</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last Edit</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTenants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-zinc-400 py-8">
                  No distributions found
                </TableCell>
              </TableRow>
            ) : (
              filteredTenants.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-semibold text-zinc-900">
                    <Link
                      href={`/admin/tenants/${item.id}`}
                      className="text-red-600 hover:underline"
                    >
                      {item.distro_name}
                    </Link>
                  </TableCell>
                  <TableCell>{item.phone_number}</TableCell>
                  <TableCell>{item.email}</TableCell>
                  <TableCell>
                    <button
                      onClick={() => handleToggleAccess(item)}
                      disabled={isPending}
                      className="focus:outline-none"
                    >
                      <Badge variant={item.access_enabled ? "success" : "destructive"}>
                        {item.access_enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </button>
                  </TableCell>
                  <TableCell>{new Date(item.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>{new Date(item.updated_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Link href={`/admin/tenants/${item.id}`}>
                        <Button size="sm" variant="outline">
                          Configure
                        </Button>
                      </Link>
                      <Button size="sm" variant="ghost" onClick={() => handleEditClick(item)}>
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

      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-zinc-900 mb-4">
              {editingItem ? "Edit Distribution" : "Add Distribution"}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Distro Name *</label>
                <Input
                  placeholder="e.g. Ahmed Distribution"
                  value={form.distro_name}
                  onChange={(e) => setForm({ ...form, distro_name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Email *</label>
                <Input
                  type="email"
                  placeholder="distributor@email.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Phone No. *</label>
                <Input
                  placeholder="e.g. 0300-1234567"
                  value={form.phone_number}
                  onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="access_enabled"
                  checked={form.access_enabled}
                  onChange={(e) => setForm({ ...form, access_enabled: e.target.checked })}
                  className="rounded border-zinc-300 text-red-600 focus:ring-indigo-500 h-4 w-4"
                />
                <label htmlFor="access_enabled" className="text-sm font-medium text-zinc-700">
                  Allow platform access
                </label>
              </div>

              {!editingItem && (
                <p className="text-xs text-zinc-500 bg-zinc-50 rounded p-2 border border-zinc-200">
                  Tenant settings and alert rules are auto-provisioned. The system attempts to bind the Clerk account with the matched email automatically.
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Distribution"}
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

