import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getJobOrderService } from "@/modules/job-orders/services";

// GET /api/job-orders/reorder-items?customerId= — the distinct items a customer
// has ordered before, for the reorder picker.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const customerId = new URL(request.url).searchParams.get("customerId");
    if (!customerId) throw new ValidationError("customerId is required.");
    const items = await getJobOrderService().getReorderItems(actor, customerId);
    return NextResponse.json(ok(items));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
