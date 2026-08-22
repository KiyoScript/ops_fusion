import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getJobOrderService } from "@/modules/job-orders/services";
import { reorderCreateInput } from "@/modules/job-orders/schemas/job-order";

// POST /api/job-orders/reorder — create a JO from a customer's picked past
// items. Lands in PENDING_REVIEW (needs customer + admin approval).
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const parsed = reorderCreateInput.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid reorder."
      );
    }
    const result = await getJobOrderService().createReorder(actor, parsed.data);
    return NextResponse.json(ok(result));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
