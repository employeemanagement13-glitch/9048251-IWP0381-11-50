import { NextRequest, NextResponse } from "next/server";
import { generateFastPromoPdfBuffer } from "@/lib/pdf/fastPromoPdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { groups, hasUtc, fromDate, toDate, filename } = body || {};

    if (!groups || !Array.isArray(groups) || groups.length === 0) {
      return NextResponse.json({ error: "No promo data provided for export" }, { status: 400 });
    }

    const arrayBuffer = generateFastPromoPdfBuffer({
      groups,
      hasUtc: Boolean(hasUtc),
      fromDate,
      toDate,
      filename: filename || "Promo Summary Report",
    });

    const safeFilename = String(filename || "promo_summary_report").replace(/[^a-zA-Z0-9._-]+/g, "_");

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(safeFilename)}.pdf"`,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (err: any) {
    console.error("[API export-promo-pdf] Error:", err?.message ?? err);
    return NextResponse.json(
      { error: err?.message || "Failed to generate promo PDF on server" },
      { status: 500 }
    );
  }
}
