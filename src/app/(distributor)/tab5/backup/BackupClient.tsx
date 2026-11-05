"use client";

import { useState, useTransition } from "react";
import { Trash2, Loader2, Download as DownloadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { getBackupSignedUrl, deleteBackup, deleteBackups } from "@/lib/actions/backup";

interface Props {
  initialBackups: any[];
}

export function BackupClient({ initialBackups }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupProgress, setBackupProgress] = useState<{ percent: number; stage: string }>({
    percent: 0,
    stage: "",
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);

  const handleBackupNow = async () => {
    setIsBackingUp(true);
    setBackupProgress({ percent: 2, stage: "Starting backup process..." });

    try {
      const res = await fetch("/api/backup", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP error ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const item = JSON.parse(line);
              if (item.error) throw new Error(item.error);
              if (typeof item.percent === "number") {
                setBackupProgress({ percent: item.percent, stage: item.stage || "" });
              }
            } catch (err: any) {
              if (err.message && !err.message.includes("JSON")) throw err;
            }
          }
        }
      }

      setBackupProgress({ percent: 100, stage: "Backup complete!" });
      setTimeout(() => {
        setIsBackingUp(false);
        router.refresh();
      }, 700);
    } catch (err: any) {
      alert(err.message || "Failed to complete backup");
      setIsBackingUp(false);
    }
  };

  const handleDownload = (id: string, filePath: string) => {
    setDownloadingId(id);
    setDownloadProgress(20);
    const interval = setInterval(() => {
      setDownloadProgress((p) => {
        if (p >= 90) {
          clearInterval(interval);
          return 90;
        }
        return p + 25;
      });
    }, 120);

    startTransition(async () => {
      try {
        const url = await getBackupSignedUrl(filePath);
        setDownloadProgress(100);
        clearInterval(interval);
        setTimeout(() => {
          window.open(url, "_blank");
          setDownloadingId(null);
          setDownloadProgress(0);
        }, 350);
      } catch (err: any) {
        clearInterval(interval);
        setDownloadingId(null);
        setDownloadProgress(0);
        alert(err.message);
      }
    });
  };

  const isAllSelected = initialBackups.length > 0 && initialBackups.every((b) => selectedIds.includes(b.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) setSelectedIds([]);
    else setSelectedIds(initialBackups.map((b) => b.id));
  };

  const handleBulkDelete = () => {
    if (!selectedIds.length) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected backup(s)?`)) return;
    const itemsToDelete = initialBackups
      .filter((b) => selectedIds.includes(b.id))
      .map((b) => ({ id: b.id, file_path: b.file_path }));

    setIsBulkDeleting(true);
    startTransition(async () => {
      try {
        await deleteBackups(itemsToDelete);
        setSelectedIds([]);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      } finally {
        setIsBulkDeleting(false);
      }
    });
  };

  const handleDelete = (id: string, filePath?: string) => {
    if (!confirm("Are you sure you want to permanently delete this backup?")) return;
    setDeletingId(id);
    startTransition(async () => {
      try {
        await deleteBackup(id, filePath);
        router.refresh();
      } catch (err: any) {
        alert(err.message);
      } finally {
        setDeletingId(null);
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Circular Percentage Loader Modal */}
      {isBackingUp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl p-6 sm:p-8 max-w-sm w-full shadow-2xl border border-zinc-100 flex flex-col items-center text-center">
            {/* SVG Circular Progress */}
            <div className="relative w-36 h-36 flex items-center justify-center mb-5">
              <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  className="stroke-zinc-100"
                  strokeWidth="8"
                  fill="transparent"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  className="stroke-red-600 transition-all duration-300 ease-out"
                  strokeWidth="8"
                  strokeDasharray={264}
                  strokeDashoffset={264 - (264 * Math.min(100, Math.max(0, backupProgress.percent))) / 100}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-extrabold text-zinc-900 tracking-tight">
                  {backupProgress.percent}%
                </span>
                <span className="text-[0.625rem] font-semibold text-zinc-400 uppercase tracking-wider mt-0.5">
                  Progress
                </span>
              </div>
            </div>

            <h4 className="text-base font-bold text-zinc-900 mb-1">
              Backing Up Distribution Data
            </h4>
            <p className="text-xs text-zinc-500 max-w-xs min-h-[2rem] flex items-center justify-center transition-all leading-snug">
              {backupProgress.stage || "Processing tables..."}
            </p>

            <div className="mt-4 flex items-center gap-2 text-[0.6875rem] text-zinc-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-red-600" />
              <span>Please do not close or refresh this tab</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center bg-zinc-50 p-4 rounded-lg border border-zinc-200">
        <div>
          <h3 className="font-semibold text-zinc-900">Distributor Data Backup</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Triggering a backup will dump all tables scoped to your distribution to a secure JSON file.
          </p>
          <div className="mt-2 text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded border border-blue-100 inline-flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
            Automatic daily backups run every 24 hours for all tenants.
          </div>
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
              disabled={isBulkDeleting || !!deletingId}
              className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 whitespace-nowrap"
            >
              {isBulkDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete ({selectedIds.length})
            </Button>
          )}
          <Button
            onClick={handleBackupNow}
            disabled={isBackingUp || isBulkDeleting || !!deletingId}
            className="flex items-center gap-1.5"
          >
            {isBackingUp ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Backing up...</span>
              </>
            ) : (
              "Backup Now"
            )}
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={handleToggleSelectAll}
                  className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                />
              </TableHead>
              <TableHead>Backup Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Triggered By</TableHead>
              <TableHead className="text-center">Download</TableHead>
              <TableHead className="text-center">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialBackups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-zinc-400 py-8">
                  No backups found. Trigger your first backup above.
                </TableCell>
              </TableRow>
            ) : (
              initialBackups.map((item) => (
                <TableRow key={item.id} className={selectedIds.includes(item.id) ? "bg-red-50/50" : ""}>
                  <TableCell className="w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() =>
                        setSelectedIds((prev) =>
                          prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]
                        )
                      }
                      className="rounded border-zinc-300 accent-red-600 cursor-pointer h-4 w-4"
                    />
                  </TableCell>
                  <TableCell suppressHydrationWarning>
                    {new Date(item.backup_date).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        item.status === "completed"
                          ? "success"
                          : item.status === "failed"
                          ? "destructive"
                          : "warning"
                      }
                    >
                      {item.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="capitalize">
                    {item.triggered_by === "auto" ? "Automatic Daily" : "Manual"}
                  </TableCell>

                  {/* Download column with progress bar indicator */}
                  <TableCell className="text-center">
                    {downloadingId === item.id ? (
                      <div className="w-28 mx-auto flex flex-col items-center gap-1">
                        <div className="w-full bg-zinc-100 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-200"
                            style={{ width: `${downloadProgress}%` }}
                          />
                        </div>
                        <span className="text-[0.625rem] font-semibold text-blue-600 font-mono">
                          {downloadProgress}%
                        </span>
                      </div>
                    ) : item.status === "in_progress" ? (
                      <div className="w-28 mx-auto flex flex-col items-center gap-1">
                        <div className="w-full bg-zinc-100 rounded-full h-2 overflow-hidden">
                          <div className="bg-amber-500 h-2 rounded-full w-2/3 animate-pulse" />
                        </div>
                        <span className="text-[0.625rem] font-semibold text-amber-600">
                          In Progress...
                        </span>
                      </div>
                    ) : item.status === "completed" && item.file_path ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownload(item.id, item.file_path)}
                        disabled={isPending || downloadingId !== null}
                        className="inline-flex items-center gap-1.5"
                      >
                        <DownloadIcon className="w-3.5 h-3.5 text-zinc-600" />
                        <span>Download</span>
                      </Button>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </TableCell>

                  {/* Action column */}
                  <TableCell className="text-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500 hover:text-red-700"
                      onClick={() => handleDelete(item.id, item.file_path)}
                      disabled={deletingId === item.id || isBulkDeleting || isBackingUp}
                    >
                      {deletingId === item.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                      ) : (
                        "Delete"
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
