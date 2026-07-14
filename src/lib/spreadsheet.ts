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
