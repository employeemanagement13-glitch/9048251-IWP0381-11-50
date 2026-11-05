import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { executeTenantBackup } from "@/lib/actions/backup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const hasCronBearer =
    !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isVercelCron && !hasCronBearer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const { data: tenantRows, error: tErr } = await serviceSupabase
      .from("tenants")
      .select("id");

    if (tErr) throw tErr;
    if (!tenantRows || tenantRows.length === 0) {
      return NextResponse.json({ success: true, count: 0, message: "No tenants found" });
    }

    const cutoff20h = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
    const cutoff10m = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    let successCount = 0;

    for (const { id: tenantId } of tenantRows) {
      const { data: recentCompleted } = await serviceSupabase
        .from("backups")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .gt("backup_date", cutoff20h)
        .limit(1)
        .maybeSingle();

      if (recentCompleted) continue;

      const { data: inProgress } = await serviceSupabase
        .from("backups")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("status", "in_progress")
        .gt("created_at", cutoff10m)
        .limit(1)
        .maybeSingle();

      if (inProgress) continue;

      try {
        await executeTenantBackup(tenantId, "auto");
        successCount++;
      } catch (err: any) {
        console.error(`[cron/backups] tenant ${tenantId}:`, err?.message);
      }
    }

    return NextResponse.json({ success: true, count: successCount });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

