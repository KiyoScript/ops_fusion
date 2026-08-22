import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok } from "@/lib/errors";
import { getCreditTermService } from "@/modules/customers/services/credit-term-service";

// GET /api/customers/credit-terms — active credit-term day options, for the
// inline "create customer" form embedded in the quotation flow.
export async function GET() {
  try {
    await requireActor();
    const days = await getCreditTermService().listActiveDays();
    return NextResponse.json(ok(days));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
