import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { fileToRows } from "@/lib/spreadsheet";
import { getLookupService } from "@/modules/shared/services/lookup-service";

const MAX_BYTES = 10 * 1024 * 1024;

// POST /api/lookups/import-categories — legacy OPSServices sheet (.csv/.xlsx).
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ValidationError("Attach a .csv or .xlsx file.");
    }
    if (file.size > MAX_BYTES) {
      throw new ValidationError("File is too large (max 10 MB).");
    }
    const rows = await fileToRows(file, ["OPSServices"]);
    const summary = await getLookupService().importCategories(actor, rows);
    return NextResponse.json(ok(summary));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
