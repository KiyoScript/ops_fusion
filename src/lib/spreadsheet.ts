import ExcelJS from "exceljs";
import { ValidationError } from "@/lib/errors";
import { parseCsv } from "@/lib/csv";

// Turns an uploaded .csv or .xlsx into positional string rows so every
// importer shares one pipeline. For .xlsx workbooks the sheet is picked by
// name (users can upload the whole workbook and we find the right tab);
// falls back to the first sheet.
export async function fileToRows(
  file: File,
  preferredSheets: string[] = []
): Promise<string[][]> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".csv") || file.type === "text/csv") {
    return parseCsv(await file.text());
  }

  if (name.endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = pickSheet(workbook, preferredSheets);
    if (!sheet) throw new ValidationError("The workbook has no sheets.");
    return sheetToRows(sheet);
  }

  throw new ValidationError(
    "Unsupported file type — upload a .csv or .xlsx file."
  );
}

/** Every worksheet of an .xlsx as name → positional rows. For the full
 *  price-workbook import (one upload, many differently-shaped tabs). */
export async function fileToSheets(
  file: File
): Promise<{ name: string; rows: string[][] }[]> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new ValidationError("Upload the .xlsx workbook.");
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  return workbook.worksheets.map((sheet) => ({
    name: sheet.name.trim(),
    rows: sheetToRows(sheet),
  }));
}

function pickSheet(
  workbook: ExcelJS.Workbook,
  preferredSheets: string[]
): ExcelJS.Worksheet | undefined {
  for (const wanted of preferredSheets) {
    const exact = workbook.worksheets.find(
      (ws) => ws.name.trim().toLowerCase() === wanted.toLowerCase()
    );
    if (exact) return exact;
  }
  for (const wanted of preferredSheets) {
    const partial = workbook.worksheets.find((ws) =>
      ws.name.trim().toLowerCase().includes(wanted.toLowerCase())
    );
    if (partial) return partial;
  }
  return workbook.worksheets[0];
}

function sheetToRows(sheet: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    const colCount = Math.max(row.cellCount, sheet.columnCount);
    for (let col = 1; col <= colCount; col++) {
      cells.push(cellToString(row.getCell(col).value));
    }
    rows.push(cells);
  });
  return rows;
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value) {
      return cellToString(value.result as ExcelJS.CellValue); // formula cell
    }
    if ("richText" in value) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("text" in value) return cellToString(value.text); // hyperlink cell
    if ("error" in value) return "";
    return String(value);
  }
  return String(value).trim();
}

// ══════════════════════════════════════════════════════════════════════════
// WRITING — the other direction. One workbook, many sheets.
// ══════════════════════════════════════════════════════════════════════════

export type SheetSpec = {
  name: string;
  /** Header row. Rendered bold and frozen. */
  columns: string[];
  /**
   * Body rows. A `number` lands in the cell as a number so Excel can total it;
   * a money string like "1,234.50" would arrive as text and silently break
   * every SUM the accountant writes — so pass money as a number.
   */
  rows: (string | number | null)[][];
  /** 1-based column indexes to format as money with thousands separators. */
  moneyColumns?: number[];
};

/**
 * Build an .xlsx in memory. Returns the bytes, ready to stream.
 *
 * Column widths are fitted to content because a spreadsheet that opens with
 * ###### in every money column reads as broken, and the first thing anyone
 * does is widen them by hand.
 */
export async function sheetsToXlsx(sheets: SheetSpec[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  for (const spec of sheets) {
    // Excel refuses these characters in a sheet name and rejects the file
    // rather than fixing it, so they are stripped here.
    const sheet = workbook.addWorksheet(
      spec.name.replace(/[*?:/\[\]]/g, "").slice(0, 31) || "Sheet"
    );

    sheet.addRow(spec.columns);
    const header = sheet.getRow(1);
    header.font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    for (const row of spec.rows) sheet.addRow(row);

    const money = new Set(spec.moneyColumns ?? []);
    spec.columns.forEach((label, i) => {
      const column = sheet.getColumn(i + 1);
      if (money.has(i + 1)) {
        column.numFmt = "#,##0.00";
        column.alignment = { horizontal: "right" };
      }
      const widest = spec.rows.reduce(
        (w, r) => Math.max(w, String(r[i] ?? "").length),
        label.length
      );
      column.width = Math.min(Math.max(widest + 2, 10), 48);
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
