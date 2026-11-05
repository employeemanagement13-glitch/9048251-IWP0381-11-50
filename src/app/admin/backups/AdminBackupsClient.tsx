"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Download, RotateCcw, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { getAdminBackupSignedUrl, getAdminRestoreUploadUrl } from "@/lib/actions/backup";

interface TenantBackupRow {
  tenant_id: string;
  distro_name: string;
  email: string;
  backup_id: string | null;
  backup_date: string | null;
  file_path: string | null;
  status: string;
}

export function AdminBackupsClient({ initialRows }: { initialRows: TenantBackupRow[] }) {
  const router = useRouter();
  const [rows] = useState<TenantBackupRow[]>(initialRows);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [restoreModalRow, setRestoreModalRow] = useState<TenantBackupRow | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileJson, setFileJson] = useState<Record<string, any[]> | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);

  // Circular percentage restoration state
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restoreStage, setRestoreStage] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleDownload = async (row: TenantBackupRow) => {
    if (!row.file_path) return;
    setDownloadingId(row.tenant_id);
    try {
      const url = await getAdminBackupSignedUrl(row.file_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      alert("Download failed: " + (err?.message || "Unknown error"));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    setRestoreSuccess(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".json")) {
      setFileError("Please upload a valid JSON backup file.");
      setSelectedFile(null);
      setFileJson(null);
      return;
    }

    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object") {
          throw new Error("Invalid backup format");
        }
        setFileJson(parsed);
      } catch (err: any) {
        setFileError("Error parsing JSON: " + (err?.message || "Invalid format"));
        setFileJson(null);
      }
    };
    reader.readAsText(file);
  };

  const handleRestoreSubmit = async () => {
    if (!restoreModalRow || !fileJson) return;
    setIsRestoring(true);
    setRestoreProgress(0);
    setRestoreStage("Connecting to restoration engine...");
    setFileError(null);
    setRestoreSuccess(null);

    try {
      setRestoreStage("Uploading backup file...");
      const upload = await getAdminRestoreUploadUrl(restoreModalRow.tenant_id);
      const fileBody =
        selectedFile ?? new Blob([JSON.stringify(fileJson)], { type: "application/json" });
      const putRes = await fetch(upload.signedUrl, {
        method: "PUT",
        body: fileBody,
        headers: { "Content-Type": "application/json" },
      });
      if (!putRes.ok) {
        throw new Error(`Failed to upload backup file (${putRes.status})`);
      }

      const response = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: restoreModalRow.tenant_id,
          filePath: upload.path,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Server error (${response.status})`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Unable to read streaming progress from server.");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let isSuccess = false;
      let totalInserted: number | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.error) {
              throw new Error(data.error);
            }
            if (typeof data.percent === "number") {
              setRestoreProgress(data.percent);
            }
            if (data.stage) {
              setRestoreStage(data.stage);
            }
            if (data.success) {
              isSuccess = true;
              if (typeof data.totalInserted === "number") {
                totalInserted = data.totalInserted;
              }
            }
          } catch (e: any) {
            if (e.message && !e.message.includes("JSON")) {
              throw e;
            }
          }
        }
      }

      if (isSuccess) {
        setRestoreProgress(100);
        setRestoreStage("Database restored successfully!");
        setRestoreSuccess(
          `Successfully restored database for "${restoreModalRow.distro_name}"${
            totalInserted != null ? ` (${totalInserted.toLocaleString()} records).` : "."
          }`
        );
        setSelectedFile(null);
        setFileJson(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setTimeout(() => {
          setIsRestoring(false);
          setRestoreModalRow(null);
          router.refresh();
        }, 1800);
      } else {
        throw new Error("Restore concluded without confirmation.");
      }
    } catch (err: any) {
      console.error("[handleRestoreSubmit] error:", err);
      setIsRestoring(false);
      setFileError("Restore failed: " + (err?.message || "Unknown error"));
    }
  };

  const openRestoreModal = (row: TenantBackupRow) => {
    setRestoreModalRow(row);
    setSelectedFile(null);
    setFileJson(null);
    setFileError(null);
    setRestoreSuccess(null);
    setIsRestoring(false);
    setRestoreProgress(0);
    setRestoreStage("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-xs">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50/75 text-zinc-500 font-semibold uppercase tracking-wider">
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Backup File</th>
              <th className="px-4 py-3">Distribution Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-400">
                  No tenants or distributions found.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const dateStr = row.backup_date
                  ? new Date(row.backup_date).toLocaleString("en-PK", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                  : "No backup available";

                const isDownloading = downloadingId === row.tenant_id;

                return (
                  <tr key={row.tenant_id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-zinc-600">
                      {dateStr}
                    </td>
                    <td className="px-4 py-3">
                      {row.file_path ? (
                        <button
                          type="button"
                          onClick={() => handleDownload(row)}
                          disabled={isDownloading}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {isDownloading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />
                          ) : (
                            <Download className="w-3.5 h-3.5 text-zinc-500" />
                          )}
                          <span>Download</span>
                        </button>
                      ) : (
                        <span className="text-zinc-400 italic">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-zinc-900">
                      {row.distro_name}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 font-mono">
                      {row.email || "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openRestoreModal(row)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Restore</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Fullscreen Percentage Circular Loading Modal */}
      {isRestoring && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-zinc-950/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 max-w-sm w-full shadow-2xl flex flex-col items-center text-center space-y-6">
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">
                Restoring Database
              </h3>
              <p className="text-xs text-zinc-400 mt-1">
                {restoreModalRow?.distro_name}
              </p>
            </div>

            {/* Circular Gauge */}
            <div className="relative w-36 h-36 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
                {/* Background Ring */}
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  className="text-zinc-800"
                  stroke="currentColor"
                  strokeWidth="8"
                  fill="transparent"
                />
                {/* Animated Progress Ring */}
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  className={`transition-all duration-300 ease-out ${
                    restoreProgress >= 100 ? "text-emerald-500" : "text-amber-500"
                  }`}
                  stroke="currentColor"
                  strokeWidth="8"
                  strokeLinecap="round"
                  fill="transparent"
                  strokeDasharray={2 * Math.PI * 50}
                  strokeDashoffset={2 * Math.PI * 50 * (1 - restoreProgress / 100)}
                />
              </svg>

              {/* Percentage in Center */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                {restoreProgress >= 100 ? (
                  <CheckCircle2 className="w-12 h-12 text-emerald-400 animate-in zoom-in duration-300" />
                ) : (
                  <>
                    <span className="text-3xl font-black text-white font-mono tracking-tight">
                      {Math.round(restoreProgress)}%
                    </span>
                    <span className="text-[0.625rem] uppercase font-semibold text-zinc-400 tracking-wider mt-0.5">
                      Progress
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Status & Subtitle */}
            <div className="space-y-2 w-full">
              <p className="text-xs font-medium text-zinc-200 min-h-[2rem] flex items-center justify-center px-2">
                {restoreStage || "Restoring database records..."}
              </p>
              <p className="text-[0.6875rem] text-zinc-500">
                Please do not close or navigate away from this page.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* File Upload & Confirmation Modal */}
      {restoreModalRow && !isRestoring && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-zinc-200 max-w-lg w-full p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-bold text-zinc-900">
                  Restore Backup — {restoreModalRow.distro_name}
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Tenant ID: <span className="font-mono">{restoreModalRow.tenant_id}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRestoreModalRow(null)}
                className="text-zinc-400 hover:text-zinc-600 text-lg leading-none cursor-pointer"
              >
                &times;
              </button>
            </div>

            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                Warning: Overwrites Tenant Data
              </p>
              <p>
                Restoring will purge all existing data for <strong>{restoreModalRow.distro_name}</strong> and replace it with records from the uploaded JSON backup file.
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-zinc-700">
                Upload Backup File (.json)
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileChange}
                className="w-full text-xs text-zinc-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-zinc-100 file:text-zinc-700 hover:file:bg-zinc-200 cursor-pointer"
              />
              {selectedFile && fileJson && (
                <p className="text-xs text-emerald-600 font-medium">
                  Valid backup JSON parsed ({Object.keys(fileJson).length} tables detected).
                </p>
              )}
              {fileError && (
                <p className="text-xs text-red-600 font-medium">{fileError}</p>
              )}
              {restoreSuccess && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{restoreSuccess}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
              <button
                type="button"
                onClick={() => setRestoreModalRow(null)}
                className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-zinc-700 text-xs font-medium hover:bg-zinc-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRestoreSubmit}
                disabled={!fileJson}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                <span>Confirm & Restore</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
