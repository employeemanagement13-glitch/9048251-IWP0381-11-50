import { checkAdmin } from "@/lib/actions/admin";
import {
  restoreTenantBackup,
  loadBackupPayloadFromStorage,
} from "@/lib/actions/backup";
import { unwrapBackupData, getServiceSupabase } from "@/lib/backup-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

async function parseRestoreRequest(req: Request): Promise<{
  tenantId: string;
  backupData: Record<string, any[]>;
  inboxPath?: string;
}> {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await req.json();
    const tenantId = String(body.tenantId || "");
    if (body.filePath) {
      const filePath = String(body.filePath);
      if (!filePath || filePath.includes("..")) {
        throw new Error("Invalid backup file path.");
      }
      const backupData = await loadBackupPayloadFromStorage(filePath);
      return { tenantId, backupData, inboxPath: filePath.includes("/restore-inbox/") ? filePath : undefined };
    }
    return { tenantId, backupData: unwrapBackupData(body.backupData ?? body) };
  }

  const form = await req.formData();
  const tenantId = String(form.get("tenantId") || "");
  const raw = form.get("backupData");
  if (raw == null || raw === "") {
    throw new Error("Missing backupData field");
  }

  let parsed: any;
  if (typeof raw === "string") {
    parsed = JSON.parse(raw);
  } else if (typeof (raw as Blob).text === "function") {
    parsed = JSON.parse(await (raw as Blob).text());
  } else {
    parsed = raw;
  }

  return { tenantId, backupData: unwrapBackupData(parsed) };
}

export async function POST(req: Request) {
  try {
    await checkAdmin();
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || "Unauthorized: Platform Admin access required." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  let tenantId: string;
  let backupData: Record<string, any[]>;
  let inboxPath: string | undefined;
  try {
    const parsed = await parseRestoreRequest(req);
    tenantId = parsed.tenantId;
    backupData = parsed.backupData;
    inboxPath = parsed.inboxPath;
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: "Invalid payload: " + (err?.message || "parse error") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!tenantId) {
    return new Response(JSON.stringify({ error: "Tenant ID is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendProgress = async (percent: number, stage: string, extra: Record<string, any> = {}) => {
    const payload =
      JSON.stringify({ percent: Math.min(100, Math.max(0, percent)), stage, ...extra }) + "\n";
    await writer.write(encoder.encode(payload));
  };

  (async () => {
    try {
      const result = await restoreTenantBackup(tenantId, backupData, {
        onProgress: sendProgress,
        skipAdminCheck: true,
      });

      if (inboxPath) {
        try {
          await getServiceSupabase().storage.from("backups").remove([inboxPath]);
        } catch {}
      }

      await sendProgress(100, "Database successfully restored!", {
        success: true,
        inserted: result.inserted,
        totalInserted: result.totalInserted,
      });
    } catch (err: any) {
      console.error("[restore-stream] error:", err);
      await sendProgress(0, "Restore failed", { error: err?.message || "Restoration failed." });
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
