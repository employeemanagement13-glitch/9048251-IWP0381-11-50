import { NextResponse } from "next/server";
import { getTenantId } from "@/lib/supabase/server";
import { executeTenantBackup } from "@/lib/actions/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const tenantId = await getTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized: Tenant session not found." }, { status: 401 });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendProgress = async (percent: number, stage: string, extra: Record<string, any> = {}) => {
    const payload = JSON.stringify({ percent: Math.min(100, Math.max(0, percent)), stage, ...extra }) + "\n";
    await writer.write(encoder.encode(payload));
  };

  (async () => {
    try {
      await sendProgress(2, "Initializing backup environment...");
      const result = await executeTenantBackup(tenantId, "manual", {
        onProgress: async (percent, stage) => {
          await sendProgress(percent, stage);
        },
      });
      await sendProgress(100, "Backup complete!", { success: true, ...result });
    } catch (err: any) {
      console.error("[backup-stream] error:", err);
      await sendProgress(0, "Backup failed", { error: err?.message || "Backup failed." });
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
