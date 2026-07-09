import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getJobOrderService } from "@/modules/job-orders/services";

// GET /api/job-orders/:joId/deadline-history — calendar deadline moves.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ joId: string }> }
) {
  try {
    const actor = await requireActor();
    const { joId } = await params;
    const moves = await getJobOrderService().getDeadlineHistory(actor, joId);
    return NextResponse.json(ok(moves));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
