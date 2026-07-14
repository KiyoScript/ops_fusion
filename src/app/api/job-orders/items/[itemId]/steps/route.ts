import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getProductionStepService } from "@/modules/quotations/services";

// GET /api/job-orders/items/:itemId/steps — the JO item's production steps.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const actor = await requireActor();
    const { itemId } = await params;
    const steps = await getProductionStepService().listItemSteps(actor, itemId);
    return NextResponse.json(ok(steps));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}

// PATCH /api/job-orders/items/:itemId/steps — toggle one step done/undone.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const actor = await requireActor();
    await params; // itemId not needed — the step id identifies the row
    const body = (await request.json()) as { stepId?: string; done?: boolean };
    if (!body.stepId || typeof body.done !== "boolean") {
      throw new ValidationError("stepId and done are required.");
    }
    await getProductionStepService().setStepDone(actor, body.stepId, body.done);
    return NextResponse.json(ok(null));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
