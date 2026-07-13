import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { fileToRows } from "@/lib/spreadsheet";
import { getPriceImportService } from "@/modules/quotations/services";

const MAX_BYTES = 20 * 1024 * 1024;

// Tab picked when a whole workbook is uploaded (falls back to first sheet).
// "Products" first — the legacy "Online Product specs" workbook keeps its
// flattened Group/Name/Price/Type list there.
const PREFERRED_SHEETS = ["Products", "Price List", "PriceDatabase", "Prices"];

// POST /api/products/import — multipart upload of the price-list sheet
// (.csv or .xlsx). Same pipeline as the JO legacy import.
export async function POST(request: Request) {
  try {
    const actor = await requireActor();

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ValidationError("Attach a .csv or .xlsx file.");
    }
    if (file.size > MAX_BYTES) {
      throw new ValidationError("File is too large (max 20 MB).");
    }

    const rows = await fileToRows(file, PREFERRED_SHEETS);
    const summary = await getPriceImportService().import(actor, rows);
    return NextResponse.json(ok(summary));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
