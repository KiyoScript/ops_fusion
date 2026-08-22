import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getJobOrderService } from "@/modules/job-orders/services";
import { reorderReviewInput } from "@/modules/job-orders/schemas/job-order";

// POST /api/job-orders/:joId/review — admin gate for a reorder JO:
// { action: "approve" | "reject", reason? }. Approve releases it to production;
// reject cancels it. Requires the "review" ability (MANAGER / ADMIN).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ joId: string }> }
) {
  try {
    const actor = await requireActor();
    const { joId } = await params;
    const parsed = reorderReviewInput.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid review."
      );
    }
    await getJobOrderService().reviewReorder(
      actor,
      joId,
      parsed.data.action,
      parsed.data.reason
    );
    return NextResponse.json(ok(null));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
