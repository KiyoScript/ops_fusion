import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getMaterialRequestService } from "@/modules/inventory/services/material-request-service";
import { mrListFilters } from "@/modules/inventory/schemas/material-request";

// GET /api/inventory/material-requests?q=&status=&cursor=&take= — MR list.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = mrListFilters.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid filters.");
    }
    const page = await getMaterialRequestService().list(actor, parsed.data);
    return NextResponse.json(ok(page));
  } catch (err) {
    return NextResponse.json(fail(err), { status: err instanceof AppError ? err.status : 500 });
  }
}
