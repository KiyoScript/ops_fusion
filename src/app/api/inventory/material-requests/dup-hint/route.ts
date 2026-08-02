import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getMaterialRequestService } from "@/modules/inventory/services/material-request-service";

// GET /api/inventory/material-requests/dup-hint?jobOrderId= — existing MRs on a
// JO, for the soft duplicate warning in the new-MR form.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const jobOrderId = new URL(request.url).searchParams.get("jobOrderId");
    if (!jobOrderId) throw new ValidationError("jobOrderId is required.");
    const hint = await getMaterialRequestService().duplicateHint(actor, jobOrderId);
    return NextResponse.json(ok(hint));
  } catch (err) {
    return NextResponse.json(fail(err), { status: err instanceof AppError ? err.status : 500 });
  }
}
