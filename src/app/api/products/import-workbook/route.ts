import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { fileToSheets } from "@/lib/spreadsheet";
import { getWorkbookImportService } from "@/modules/quotations/services";

const MAX_BYTES = 20 * 1024 * 1024;

// POST /api/products/import-workbook — one upload of the legacy price
// workbook (.xlsx) imports every product tab at once.
export async function POST(request: Request) {
  try {
    const actor = await requireActor();

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ValidationError("Attach the .xlsx workbook.");
    }
    if (file.size > MAX_BYTES) {
      throw new ValidationError("File is too large (max 20 MB).");
    }

    const sheets = await fileToSheets(file);
    const summary = await getWorkbookImportService().import(actor, sheets);
    return NextResponse.json(ok(summary));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
