"use client";

import { pdf } from "@react-pdf/renderer";
import { FileSpreadsheet, Printer, Loader2 } from "lucide-react";
import { useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/Button";
import { ExportPdfDocument } from "./ExportPdfDocument";
export { ExportPdfDocument };

interface ExportButtonsProps {
  data: Array<Record<string, unknown>>;
  filename: string;
}

export function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

function formatExcelValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return value;
}

export function buildWorksheet(data: Array<Record<string, unknown>>) {
  const cleaned = data.map((row) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      out[key] = formatExcelValue(row[key]);
    }
    return out;
  });

  const worksheet = XLSX.utils.json_to_sheet(cleaned);
  const headers = data.length > 0 ? Object.keys(data[0]) : [];

  // Auto-size each column from header + longest cell value, so text
  // doesn't get visually crammed/truncated against the next column
  worksheet["!cols"] = headers.map((header) => {
    let maxLen = header.length;
    for (const row of data) {
      const len = String(formatExcelValue(row[header]) ?? "").length;
      if (len > maxLen) maxLen = len;
    }
    return { wch: Math.min(Math.max(maxLen + 2, 10), 50) };
  });

  // Freeze the header row so it stays visible while scrolling
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };

  // Bold the header row
  headers.forEach((_, colIndex) => {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: colIndex });
    if (worksheet[cellRef]) {
      worksheet[cellRef].s = { font: { bold: true } };
    }
  });

  return worksheet;
}

// Max rows per PDF file. Above this threshold we split into multiple files
// so the browser never blocks for more than a few seconds per chunk.
const PDF_CHUNK_SIZE = 500;

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Delay revoke so the browser has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportButtons({ data, filename }: ExportButtonsProps) {
  const [pdfProgress, setPdfProgress] = useState<string | null>(null);
  const [isExcelExporting, setIsExcelExporting] = useState(false);
  const safeFileName = sanitizeFileName(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
  const excelFileName = sanitizeFileName(filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);

  const handleExportPdf = async () => {
    if (!data || !data.length) return;

    const chunks: Array<typeof data> = [];
    for (let i = 0; i < data.length; i += PDF_CHUNK_SIZE) {
      chunks.push(data.slice(i, i + PDF_CHUNK_SIZE));
    }

    const baseName = safeFileName.replace(/\.pdf$/i, "");
    const isMulti = chunks.length > 1;

    setPdfProgress(isMulti ? `Preparing PDF 1 of ${chunks.length}...` : "Preparing PDF...");

    try {
      for (let ci = 0; ci < chunks.length; ci++) {
        if (isMulti) {
          setPdfProgress(`Preparing PDF ${ci + 1} of ${chunks.length}...`);
        }

        // Yield to the browser between chunks so the tab stays responsive
        await new Promise<void>((resolve) => setTimeout(resolve, 50));

        const chunkFilename = isMulti
          ? `${baseName}_part${ci + 1}of${chunks.length}.pdf`
          : `${baseName}.pdf`;

        const blob = await pdf(
          <ExportPdfDocument data={chunks[ci]} filename={isMulti ? `${filename} (${ci + 1}/${chunks.length})` : filename} />
        ).toBlob();

        downloadBlob(blob, chunkFilename);

        // Give the browser a moment between sequential downloads
        if (ci < chunks.length - 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 300));
        }
      }
    } finally {
      setPdfProgress(null);
    }
  };

  const handleExportExcel = async () => {
    if (!data || !data.length) return;
    setIsExcelExporting(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 60));

    try {
      const worksheet = buildWorksheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
      XLSX.writeFile(workbook, excelFileName);
    } finally {
      setTimeout(() => setIsExcelExporting(false), 800);
    }
  };

  return (
    <div className="flex gap-2">
      <Button
        onClick={handleExportPdf}
        variant="default"
        size="sm"
        className="whitespace-nowrap"
        icon={pdfProgress !== null ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
        iconClassName="text-white"
        disabled={pdfProgress !== null || isExcelExporting || !data?.length}
      >
        {pdfProgress ?? "Print PDF"}
      </Button>

      <Button
        onClick={handleExportExcel}
        variant="default"
        size="sm"
        className="whitespace-nowrap"
        icon={isExcelExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
        disabled={isExcelExporting || pdfProgress !== null || !data?.length}
      >
        {isExcelExporting ? "Exporting..." : "Export Excel"}
      </Button>
    </div>
  );
}