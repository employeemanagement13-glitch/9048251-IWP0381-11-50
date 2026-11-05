import { NextRequest, NextResponse } from "next/server";
import { generateFastInvoicesPdfBuffer } from "@/lib/pdf/fastInvoicePdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { data, filename } = body;

    if (!data || !Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: "No data provided for export" }, { status: 400 });
    }

    const safeFilename = filename || "invoices_export";

    const arrayBuffer = generateFastInvoicesPdfBuffer(data, safeFilename);

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(safeFilename)}.pdf"`,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (err: any) {
    console.error("[API export-invoices-pdf] Error:", err?.message ?? err);
    return NextResponse.json(
      { error: err?.message || "Failed to generate PDF on server" },
      { status: 500 }
    );
  }
}
