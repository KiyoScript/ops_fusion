import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getMaterialService } from "@/modules/inventory/services/material-service";

// GET /api/inventory/reorder — items whose on-hand is below the reorder level.
export async function GET() {
  try {
    const actor = await requireActor();
    const rows = await getMaterialService().reorderReport(actor);
    return NextResponse.json(ok(rows));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
