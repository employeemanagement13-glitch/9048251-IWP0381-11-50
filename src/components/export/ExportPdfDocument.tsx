import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { ensureArialRegistered, formatExportDateTime } from "@/lib/pdf/registerFonts";

const styles = StyleSheet.create({
  page: {
    padding: 20,
    fontFamily: "Arial",
    backgroundColor: "#ffffff",
  },
  title: {
    fontSize: 14,
    fontWeight: 700,
    fontFamily: "Arial",
    marginBottom: 4,
    color: "#b91c1c",
  },
  table: {
    borderWidth: 1,
    borderColor: "#e51e2a",
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  rowEven: {
    backgroundColor: "#fffdfd",
  },
  rowOdd: {
    backgroundColor: "#fef2f2",
  },
  headerCell: {
    padding: 5,
    backgroundColor: "#e51e2a",
    fontWeight: 700,
    fontFamily: "Arial",
    color: "#ffffff",
    borderRightWidth: 1,
    borderRightColor: "#dc2626",
    overflow: "hidden",
  },
  cell: {
    padding: 4,
    borderRightWidth: 1,
    borderRightColor: "#f3f4f6",
    fontFamily: "Arial",
    color: "#1f2937",
    overflow: "hidden",
  },
  lastCell: {
    borderRightWidth: 0,
  },
});

function formatPdfValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

// react-pdf only wraps text at existing spaces/hyphens. A long unbroken
// token (account number, ID with no separators) has no wrap point and
// will render past its column width. Insert zero-width spaces every few
// characters in long unbroken runs so the renderer always has somewhere
// to break the line.
function withSoftBreaks(value: string) {
  return value.replace(/\S{9,}/g, (token) => {
    const chunks = token.match(/.{1,6}/g) ?? [token];
    return chunks.join("\u200B");
  });
}

function formatPdfCellValue(value: unknown) {
  return withSoftBreaks(formatPdfValue(value));
}

/**
 * Per-column "weight" — the longest string that will actually appear in
 * that column (header or any cell), clamped to a sane range. This is the
 * raw signal used to decide how much horizontal room a column deserves
 * relative to the others.
 */
function computeColumnContentWeights(data: Array<Record<string, unknown>>, headers: string[]) {
  return headers.map((header) => {
    if (header === "#") {
      const digits = String(data.length).length;
      return Math.max(digits + 2, 4);
    }
    let max = header.length;
    for (const row of data) {
      const len = formatPdfValue(row[header]).length;
      if (len > max) max = len;
    }
    return Math.min(Math.max(max, 4), 80);
  });
}

const PDF_BASE_FONT_SIZE = 9; // default, comfortable size
const PDF_MIN_FONT_SIZE = 6.5; // absolute floor — never go below this
const PDF_CELL_PADDING = 4; // fixed, matches styles.headerCell/cell padding
const PDF_MIN_COLUMN_WIDTH = 42; // pt — floor so short columns (Type, DM) stay legible
const PDF_MAX_COLUMN_WIDTH = 260; // pt — ceiling so one long free-text column (Products) can't dominate; excess text wraps to more lines instead of stretching or overflowing
const PDF_PAGE_HEIGHT = 595.28; // pt — landscape A4 height, kept constant
const PDF_PAGE_PADDING = 20; // pt — matches styles.page padding
const PDF_MIN_PAGE_WIDTH = 841.89; // pt — landscape A4 width, the floor so small tables still look like a normal page
const PDF_MAX_PAGE_WIDTH = 14000; // pt — PDF spec caps a page edge at 14400pt; stay safely under it

const AVG_CHAR_WIDTH_FACTOR = 0.52;

function estimateColumnWidth(weight: number, fontSize: number) {
  const charWidth = fontSize * AVG_CHAR_WIDTH_FACTOR;
  const raw = weight * charWidth + PDF_CELL_PADDING * 2;
  return Math.min(Math.max(raw, PDF_MIN_COLUMN_WIDTH), PDF_MAX_COLUMN_WIDTH);
}

interface PdfTableLayout {
  columnWidths: number[];
  fontSize: number;
  pageWidth: number;
}

/**
 * Computes one shared font size, a width per column (in points), and the
 * page width needed to fit those columns — for the WHOLE table at once.
 * All columns end up on the same continuous table; the page gets wider
 * instead of the table getting cut into groups.
 */
function computeTableLayout(data: Array<Record<string, unknown>>, headers: string[]): PdfTableLayout {
  if (headers.length === 0) {
    return { columnWidths: [], fontSize: PDF_BASE_FONT_SIZE, pageWidth: PDF_MIN_PAGE_WIDTH };
  }

  const weights = computeColumnContentWeights(data, headers);

  let fontSize = PDF_BASE_FONT_SIZE;
  let rawWidths = weights.map((w) => estimateColumnWidth(w, fontSize));
  let rawTotal = rawWidths.reduce((sum, w) => sum + w, 0);

  // Safety net: only realistic with far more than ~26 columns, or
  // pathologically long values everywhere. Step font down until the table
  // fits under the page-size ceiling.
  while (rawTotal + PDF_PAGE_PADDING * 2 > PDF_MAX_PAGE_WIDTH && fontSize > PDF_MIN_FONT_SIZE) {
    fontSize -= 0.5;
    rawWidths = weights.map((w) => estimateColumnWidth(w, fontSize));
    rawTotal = rawWidths.reduce((sum, w) => sum + w, 0);
  }

  const contentWidth = Math.min(
    Math.max(rawTotal, PDF_MIN_PAGE_WIDTH - PDF_PAGE_PADDING * 2),
    PDF_MAX_PAGE_WIDTH - PDF_PAGE_PADDING * 2
  );

  // Re-normalize so columns always sum EXACTLY to contentWidth
  const columnWidths =
    rawTotal > 0 ? rawWidths.map((w) => (w / rawTotal) * contentWidth) : headers.map(() => contentWidth / headers.length);

  const pageWidth = contentWidth + PDF_PAGE_PADDING * 2;

  return { columnWidths, fontSize, pageWidth };
}

function GridTable({
  data,
  headers,
  columnWidths,
  fontSize,
}: {
  data: Array<Record<string, unknown>>;
  headers: string[];
  columnWidths: number[];
  fontSize: number;
}) {
  return (
    <View style={styles.table}>
      {/* fixed so the header repeats on every physical page this table flows onto */}
      <View style={styles.row} fixed>
        {headers.map((header, index) => (
          <Text
            key={header}
            style={[
              styles.headerCell,
              { width: columnWidths[index], fontSize },
              index === headers.length - 1 ? styles.lastCell : {},
            ]}
          >
            {header}
          </Text>
        ))}
      </View>

      {data.map((row, rowIndex) => (
        <View
          key={`${rowIndex}-${headers.join("-")}`}
          style={[styles.row, rowIndex % 2 === 0 ? styles.rowEven : styles.rowOdd]}
          wrap={false}
        >
          {headers.map((header, index) => (
            <Text
              key={`${rowIndex}-${header}`}
              style={[
                styles.cell,
                { width: columnWidths[index], fontSize },
                header === "#" ? { textAlign: "center", color: "#4b5563", fontWeight: 700 } : {},
                index === headers.length - 1 ? styles.lastCell : {},
              ]}
            >
              {header === "#" ? `${rowIndex + 1}.` : formatPdfCellValue(row[header])}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

export function ExportPdfDocument({
  data,
  filename,
}: {
  data: Array<Record<string, unknown>>;
  filename: string;
}) {
  ensureArialRegistered();
  const rawHeaders = data.length > 0 ? Object.keys(data[0]) : [];
  const headers = rawHeaders.length > 0 ? ["#", ...rawHeaders] : [];
  const { columnWidths, fontSize, pageWidth } = computeTableLayout(data, headers);
  const exportTimeStr = formatExportDateTime();

  return (
    <Document>
      <Page size={[pageWidth, PDF_PAGE_HEIGHT]} style={styles.page}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: 8,
            paddingBottom: 4,
            borderBottomWidth: 1,
            borderBottomColor: "#fecaca",
          }}
        >
          <View>
            <Text style={styles.title}>{filename}</Text>
            <Text style={{ fontSize: 7.5, color: "#6b7280", marginTop: 1 }}>Generated by Distroline DMS</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 9.5, color: "#111827", fontWeight: 700 }}>
              Total Records: {data.length}
            </Text>
            <Text style={{ fontSize: 8, color: "#4b5563", marginTop: 2, fontWeight: 700 }}>
              {exportTimeStr}
            </Text>
          </View>
        </View>
        <GridTable data={data} headers={headers} columnWidths={columnWidths} fontSize={fontSize} />
        <View
          style={{
            marginTop: 8,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
          wrap={false}
        >
          <Text style={{ fontSize: 8, color: "#9ca3af" }}>Generated by Distroline DMS • {exportTimeStr}</Text>
          <Text style={{ fontSize: 8, color: "#4b5563", fontWeight: 700 }}>
            Total Records: {data.length}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
