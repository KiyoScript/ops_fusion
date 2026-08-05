import { NextResponse } from "next/server";
import { requireActor } from "@/lib/authz";
import { AppError, fail, ok, ValidationError } from "@/lib/errors";
import { getReceivableService } from "@/modules/sales-audit/services";
import { receivableFilters } from "@/modules/sales-audit/schemas/receipt";

// GET /api/receivables?q=&bucket=&overLimitOnly= — the A/R ledger by customer.
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = receivableFilters.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid filters."
      );
    }
    const page = await getReceivableService().list(actor, parsed.data);
    return NextResponse.json(ok(page));
  } catch (err) {
    return NextResponse.json(fail(err), {
      status: err instanceof AppError ? err.status : 500,
    });
  }
}
