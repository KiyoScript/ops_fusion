import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getCycleCountService } from "@/modules/inventory/services/cycle-count-service";

// GET /api/inventory/cycle-counts/:id — cycle count detail with variances.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const count = await getCycleCountService().get(actor, id);
    return NextResponse.json(ok(count));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
