"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ExportButtons } from "@/components/export/ExportButtons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { unblockShop } from "@/lib/actions/shops";
import { useRouter } from "next/navigation";

interface BlockedClientProps {
  blockedShops: any[];
}

export function BlockedClient({ blockedShops }: BlockedClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  const handleUnblock = (id: string) => {
    if (!confirm("Are you sure you want to unblock this shop account?")) return;
    setUnblockingId(id);
    startTransition(async () => {
      try {
        await unblockShop(id);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      } finally {
        setUnblockingId(null);
      }
    });
  };

  const exportData = blockedShops.map((s) => ({
    "Outlet Name": s.shop_name,
    "Phone": s.phone || "",
    "Overdue": s.overdue || 0,
    "Blocked Date": s.blocked_at ? new Date(s.blocked_at).toLocaleDateString() : "—",
    "Reason": s.block_reason || "",
  }));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButtons data={exportData} filename="blocked_shops" />
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Outlet Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Overdue Balance</TableHead>
              <TableHead>Blocked Date</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {blockedShops.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-zinc-400 py-8">
                  No blocked accounts found.
                </TableCell>
              </TableRow>
            ) : (
              blockedShops.map((shop) => (
                <TableRow key={shop.id}>
                  <TableCell className="font-medium">{shop.shop_name}</TableCell>
                  <TableCell>{shop.phone || "—"}</TableCell>
                  <TableCell className="text-right font-bold text-red-500">
                    Rs.{Number(shop.overdue || 0).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {shop.blocked_at ? new Date(shop.blocked_at).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-zinc-500 max-w-[15.625rem] truncate" title={shop.block_reason}>
                    {shop.block_reason || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleUnblock(shop.id)}
                      disabled={isPending}
                    >
                      {unblockingId === shop.id ? (
                        <>
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          Unblocking...
                        </>
                      ) : (
                        "Unblock"
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

