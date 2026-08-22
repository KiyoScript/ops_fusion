import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getBacklogService } from "@/modules/sales-audit/services";
import { pipelineFilters } from "@/modules/sales-audit/schemas/backlog";

// GET /api/pipeline?state=&customerId=&search=
//
// Backlog and unbilled work — the two states of a job order's value that are
// owed to us but are NOT on the A/R ledger, because no invoice exists yet.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = pipelineFilters.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid filters."
      );
    }
    const pipeline = await getBacklogService().getPipeline(actor, parsed.data);
    return NextResponse.json(ok(pipeline));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
