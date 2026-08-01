import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getStockAdjustmentService } from "@/modules/inventory/services/stock-adjustment-service";

// GET /api/inventory/adjustments/:id — adjustment detail with lines.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const adj = await getStockAdjustmentService().get(actor, id);
    return NextResponse.json(ok(adj));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
